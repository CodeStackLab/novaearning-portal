// Administrator Dashboard Controller for NOVA Portal

const API_BASE = '/api';
let activeEditUserId = null;
let activeReplyTicketId = null;

// Format Currency
function formatUSD(amount) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

// Fetch helper with token injection
async function adminRequest(endpoint, options = {}) {
    const token = localStorage.getItem('nova_token');
    
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers
    });

    if (response.status === 401 || response.status === 403) {
        logout();
        throw new Error('Authentication expired');
    }

    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.message || `Request failed with status ${response.status}`);
    }

    return response.json();
}

function logout() {
    localStorage.removeItem('nova_token');
    localStorage.removeItem('nova_role');
    window.location.href = '/login';
}

// Switch tabs inside admin dashboard
function switchTab(tabId) {
    const panels = document.querySelectorAll('.dashboard-panel-view');
    panels.forEach(panel => panel.classList.remove('active'));

    const activePanel = document.getElementById(`panel-${tabId}`);
    if (activePanel) {
        activePanel.classList.add('active');
        
        // Update sidebar links
        const sidebarLinks = document.querySelectorAll('.sidebar-item-link');
        sidebarLinks.forEach(link => {
            if (link.getAttribute('data-tab') === tabId) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });

        // Set hash link URL quietly
        window.history.pushState(null, null, `#${tabId}`);
        fetchActiveTabDetails(tabId);
    }
}

// Fetch active tab specific data logs
async function fetchActiveTabDetails(tabId) {
    try {
        if (tabId === 'overview') {
            const stats = await adminRequest('/admin/overview');
            document.getElementById('stat-users').textContent = stats.users;
            document.getElementById('stat-deposits').textContent = formatUSD(stats.deposits);
            document.getElementById('stat-payouts').textContent = stats.pendingWithdrawals;
        } else if (tabId === 'users') {
            const users = await adminRequest('/admin/users');
            renderUsersTable(users);
        } else if (tabId === 'deposits') {
            const deposits = await adminRequest('/admin/deposits');
            renderDepositsTable(deposits);
        } else if (tabId === 'payouts') {
            const payouts = await adminRequest('/admin/payouts');
            renderPayoutsTable(payouts);
        } else if (tabId === 'tickets') {
            const tickets = await adminRequest('/admin/tickets');
            renderTicketsTable(tickets);
        }
    } catch (e) {
        console.error('Error fetching tab details:', e.message);
    }
}

// Toast notification trigger
function showToast(message) {
    const toast = document.getElementById('toast-notif');
    const toastText = document.getElementById('toast-text-msg');
    if (toast && toastText) {
        toastText.textContent = message;
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }
}

// Initialize Application Routing & Listeners
document.addEventListener("DOMContentLoaded", async () => {
    // 1. Session Auth Role check
    const token = localStorage.getItem('nova_token');
    const role = localStorage.getItem('nova_role');
    
    if (!token || role !== 'admin') {
        logout();
        return;
    }

    // 2. Setup hash router or query param router
    const hash = window.location.hash.substring(1);
    const activeTab = hash || 'overview';
    switchTab(activeTab);

    // 3. Attach sidebar click events
    const sidebarLinks = document.querySelectorAll('.sidebar-item-link[data-tab]');
    sidebarLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const tabId = link.getAttribute('data-tab');
            switchTab(tabId);
        });
    });

    // 4. Attach Logout click event
    const logoutBtn = document.querySelector('.sidebar-item-link.logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logout();
        });
    }

    // 5. Periodic polling to keep admin logs updated in real-time
    setInterval(async () => {
        const currentHash = window.location.hash.substring(1) || 'overview';
        if (localStorage.getItem('nova_token')) {
            await fetchActiveTabDetails(currentHash);
        }
    }, 5000);

    // 6. Mobile Sidebar toggling logic
    const menuToggleBtn = document.querySelector('.header-left-toggle');
    const sidebar = document.querySelector('.dashboard-sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    if (menuToggleBtn && sidebar && overlay) {
        const toggleSidebar = () => {
            sidebar.classList.toggle('active');
            overlay.classList.toggle('active');
        };

        const closeSidebar = () => {
            sidebar.classList.remove('active');
            overlay.classList.remove('active');
        };

        menuToggleBtn.addEventListener('click', toggleSidebar);
        overlay.addEventListener('click', closeSidebar);

        // Close sidebar when a navigation item is clicked
        const menuLinks = document.querySelectorAll('.sidebar-item-link[data-tab]');
        menuLinks.forEach(link => {
            link.addEventListener('click', closeSidebar);
        });
    }

    // Admin Profile Dropdown logic
    const adminProfileBtn = document.getElementById('admin-profile-menu-btn');
    const adminDropdown = document.getElementById('admin-dropdown-menu');
    if (adminProfileBtn && adminDropdown) {
        adminProfileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            adminDropdown.classList.toggle('show');
        });

        document.addEventListener('click', () => {
            adminDropdown.classList.remove('show');
        });

        // Logout action button click
        const logoutLink = adminDropdown.querySelector('.logout-action-btn');
        if (logoutLink) {
            logoutLink.addEventListener('click', (e) => {
                e.preventDefault();
                logout();
            });
        }
    }
});

// Render dynamic tables
function renderUsersTable(users) {
    const tbody = document.getElementById('admin-users-table-body');
    if (!tbody) return;

    tbody.innerHTML = users.map(user => `
        <tr>
            <td>${user.id}</td>
            <td style="font-weight:600; color:#f1f5f9;">${user.name}</td>
            <td>${user.email}</td>
            <td style="font-weight:700; color:#10b981;">${formatUSD(user.balance)}</td>
            <td><span style="font-size:0.75rem; text-transform:uppercase; font-weight:700; color: ${user.role === 'admin' ? '#fbbf24' : '#94a3b8'};">${user.role}</span></td>
            <td>
                <button onclick="openEditBalanceModal(${user.id}, '${user.name}', ${user.balance})" style="background-color:#1e2538; border:1px solid #2e384e; color:#f1f5f9; padding:0.35rem 0.75rem; border-radius:6px; font-size:0.75rem; font-weight:600;">Edit Balance</button>
            </td>
        </tr>
    `).join('');
}

function renderDepositsTable(deposits) {
    const tbody = document.getElementById('admin-deposits-table-body');
    if (!tbody) return;

    if (deposits.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#64748b;">No deposits log found.</td></tr>`;
        return;
    }

    tbody.innerHTML = deposits.map(dep => {
        let actionCell = `<span style="color:#64748b; font-size:0.8rem;">Processed</span>`;
        if (dep.status === 'Pending') {
            actionCell = `
                <div style="display:flex; gap:0.5rem;">
                    <button onclick="verifyDeposit(${dep.id}, 'Approve')" style="background-color:#10b981; color:white; padding:0.3rem 0.60rem; border-radius:6px; font-size:0.75rem; font-weight:600;">Approve</button>
                    <button onclick="verifyDeposit(${dep.id}, 'Reject')" style="background-color:#ef4444; color:white; padding:0.3rem 0.60rem; border-radius:6px; font-size:0.75rem; font-weight:600;">Reject</button>
                </div>
            `;
        }

        return `
            <tr>
                <td>${dep.date}</td>
                <td style="font-weight:600; color:#f1f5f9;">${dep.user_name}</td>
                <td style="font-weight:700; color:#3b82f6;">$${dep.amount.toFixed(2)}</td>
                <td>
                    ${dep.screenshot_path ? `<a href="${dep.screenshot_path}" target="_blank" style="color: #3b82f6; text-decoration: underline; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem;"><span class="material-symbols-outlined" style="font-size: 1rem;">image</span>View Screenshot</a>` : `<span style="color: #64748b; font-size: 0.8rem;">No screenshot</span>`}
                </td>
                <td><span class="status-badge-lbl ${dep.status.toLowerCase()}">${dep.status}</span></td>
                <td>${actionCell}</td>
            </tr>
        `;
    }).join('');
}

function renderPayoutsTable(payouts) {
    const tbody = document.getElementById('admin-payouts-table-body');
    if (!tbody) return;

    if (payouts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#64748b;">No withdrawal requests found.</td></tr>`;
        return;
    }

    tbody.innerHTML = payouts.map(po => {
        let actionCell = `<span style="color:#64748b; font-size:0.8rem;">Processed</span>`;
        if (po.status === 'Pending') {
            actionCell = `
                <button onclick="verifyPayout(${po.id})" style="background-color:#3b82f6; color:white; padding:0.35rem 0.75rem; border-radius:6px; font-size:0.75rem; font-weight:600;">Confirm Payout</button>
            `;
        }

        return `
            <tr>
                <td>${po.date}</td>
                <td style="font-weight:600; color:#f1f5f9;">${po.user_name}</td>
                <td style="font-weight:700; color:#ef4444;">$${po.amount.toFixed(2)}</td>
                <td class="deposit-tx-hash" title="${po.ref}">${po.ref.substring(0, 16)}...</td>
                <td><span class="status-badge-lbl ${po.status.toLowerCase()}">${po.status}</span></td>
                <td>${actionCell}</td>
            </tr>
        `;
    }).join('');
}

function renderTicketsTable(tickets) {
    const tbody = document.getElementById('admin-tickets-table-body');
    if (!tbody) return;

    if (tickets.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#64748b;">No support tickets logged.</td></tr>`;
        return;
    }

    tbody.innerHTML = tickets.map(ticket => {
        let actionCell = `<span style="color:#64748b; font-size:0.8rem;">Resolved</span>`;
        if (ticket.status === 'Pending') {
            actionCell = `
                <button onclick="openReplyBox(${ticket.id}, '${ticket.ticket_id}', '${ticket.message}')" style="background-color:#3b82f6; color:white; padding:0.35rem 0.75rem; border-radius:6px; font-size:0.75rem; font-weight:600;">Reply</button>
            `;
        }

        return `
            <tr>
                <td>${ticket.date}</td>
                <td style="font-weight:600; color:#f1f5f9;">${ticket.user_name}</td>
                <td>${ticket.ticket_id}</td>
                <td style="font-weight:600; color:#cbd5e1;">${ticket.title}</td>
                <td><span class="status-badge-lbl ${ticket.status === 'Resolved' ? 'confirmed' : 'pending'}">${ticket.status}</span></td>
                <td>${actionCell}</td>
            </tr>
        `;
    }).join('');
}

// Edit balance Modal handlers
function openEditBalanceModal(userId, userName, currentBalance) {
    activeEditUserId = userId;
    document.getElementById('edit-balance-user-info').textContent = `User: ${userName} (Current Balance: ${formatUSD(currentBalance)})`;
    document.getElementById('edit-balance-val').value = currentBalance;
    document.getElementById('edit-balance-modal').classList.add('active');
}

function closeEditBalanceModal() {
    document.getElementById('edit-balance-modal').classList.remove('active');
    activeEditUserId = null;
}

async function applyEditBalance() {
    const balanceInput = document.getElementById('edit-balance-val');
    const newBalVal = parseFloat(balanceInput.value);

    if (activeEditUserId === null || isNaN(newBalVal) || newBalVal < 0) {
        alert('Please enter a valid balance amount');
        return;
    }

    try {
        await adminRequest('/admin/users/balance', {
            method: 'POST',
            body: JSON.stringify({
                userId: activeEditUserId,
                newBalance: newBalVal
            })
        });

        showToast('User balance successfully updated!');
        closeEditBalanceModal();
        await fetchActiveTabDetails('users');
    } catch (e) {
        alert(e.message || 'Failed to update balance');
    }
}

// Verify Deposit approvals
async function verifyDeposit(depositId, action) {
    try {
        await adminRequest('/admin/deposits/verify', {
            method: 'POST',
            body: JSON.stringify({ depositId, action })
        });

        showToast(`Deposit ${action === 'Approve' ? 'Approved' : 'Rejected'}!`);
        await fetchActiveTabDetails('deposits');
    } catch (e) {
        alert(e.message || 'Verification action failed');
    }
}

// Verify Payout approvals
async function verifyPayout(transactionId) {
    try {
        await adminRequest('/admin/payouts/verify', {
            method: 'POST',
            body: JSON.stringify({ transactionId })
        });

        showToast('Payout confirmed successfully!');
        await fetchActiveTabDetails('payouts');
    } catch (e) {
        alert(e.message || 'Payout confirm failed');
    }
}

// Ticket Reply Panel handlers
function openReplyBox(ticketId, ticketRef, message) {
    activeReplyTicketId = ticketId;
    document.getElementById('reply-ticket-header').textContent = `Reply to Ticket ${ticketRef}`;
    document.getElementById('reply-ticket-user-msg').textContent = message;
    document.getElementById('reply-ticket-text').value = '';
    document.getElementById('admin-reply-box-container').style.display = 'block';
    
    // Scroll to reply container
    document.getElementById('admin-reply-box-container').scrollIntoView({ behavior: 'smooth' });
}

function closeAdminReplyBox() {
    document.getElementById('admin-reply-box-container').style.display = 'none';
    activeReplyTicketId = null;
}

async function submitAdminTicketReply() {
    const textInput = document.getElementById('reply-ticket-text');
    const replyMsg = textInput.value.trim();

    if (activeReplyTicketId === null || replyMsg === '') {
        alert('Please enter a reply message');
        return;
    }

    try {
        await adminRequest('/admin/tickets/reply', {
            method: 'POST',
            body: JSON.stringify({
                ticketId: activeReplyTicketId,
                reply: replyMsg
            })
        });

        showToast('Reply submitted and ticket resolved.');
        closeAdminReplyBox();
        await fetchActiveTabDetails('tickets');
    } catch (e) {
        alert(e.message || 'Failed to submit reply');
    }
}
