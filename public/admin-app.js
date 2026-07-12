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
function renderUsersTable(serverUsers) {
    const tbody = document.getElementById('admin-users-table-body');
    if (!tbody) return;

    // Load custom advanced users state from localStorage
    let advancedUsers = JSON.parse(localStorage.getItem('nova_advanced_users') || '{}');
    let customUsers = JSON.parse(localStorage.getItem('nova_custom_added_users') || '[]');
    let deletedUserIds = JSON.parse(localStorage.getItem('nova_deleted_user_ids') || '[]');

    // Combine server users and custom users, filtering out deleted
    let allUsers = [...serverUsers, ...customUsers].filter(u => !deletedUserIds.includes(u.id));

    tbody.innerHTML = allUsers.map(user => {
        // Apply any advanced edits
        const advancedState = advancedUsers[user.id] || {};
        const displayUser = { ...user, ...advancedState };
        const status = displayUser.status || 'Active';
        
        let statusColor = '#10b981'; // Active green
        let statusBg = 'rgba(16, 185, 129, 0.15)';
        if (status === 'Suspended') { statusColor = '#ef4444'; statusBg = 'rgba(239, 68, 68, 0.15)'; }
        if (status === 'Hold') { statusColor = '#f59e0b'; statusBg = 'rgba(245, 158, 11, 0.15)'; }
        if (status === 'Under Review') { statusColor = '#3b82f6'; statusBg = 'rgba(59, 130, 246, 0.15)'; }

        // Escape quotes
        const safeName = (displayUser.name || '').replace(/'/g, "\\'");
        const safeEmail = (displayUser.email || '').replace(/'/g, "\\'");
        const safeRole = (displayUser.role || 'user').replace(/'/g, "\\'");
        const safeStatus = status.replace(/'/g, "\\'");

        return `
        <tr>
            <td>
                <div style="display:flex; align-items:center; gap:0.75rem;">
                    <div style="width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #3b82f6, #1d4ed8); display: flex; align-items: center; justify-content: center; font-size: 0.8rem; font-weight: 800; color: white;">
                        ${displayUser.name ? displayUser.name.substring(0, 2).toUpperCase() : 'U'}
                    </div>
                    <div>
                        <div style="font-weight:600; color:#f1f5f9;">${displayUser.name}</div>
                        <div style="font-size:0.75rem; color:#94a3b8;">${displayUser.email}</div>
                    </div>
                </div>
            </td>
            <td style="font-weight:700; color:#10b981;">${formatUSD(displayUser.balance)}</td>
            <td><span style="font-size:0.75rem; text-transform:uppercase; font-weight:700; color: ${displayUser.role === 'admin' ? '#fbbf24' : '#94a3b8'};">${displayUser.role}</span></td>
            <td><span style="background-color: ${statusBg}; color: ${statusColor}; padding: 0.2rem 0.6rem; border-radius: 99px; font-size: 0.75rem; font-weight: 600;">${status}</span></td>
            <td>
                <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
                    <button title="Edit Profile/Status" onclick="openEditUserModal(${displayUser.id}, '${safeName}', '${safeEmail}', '${safeRole}', '${safeStatus}')" style="background-color: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); padding: 0.35rem; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;"><span class="material-symbols-outlined" style="font-size: 1rem;">edit</span></button>
                    <button title="Edit Balance" onclick="openEditBalanceModal(${displayUser.id}, '${safeName}', ${displayUser.balance})" style="background-color: #1e2538; border: 1px solid #2e384e; color: #f1f5f9; padding: 0.35rem; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;"><span class="material-symbols-outlined" style="font-size: 1rem;">account_balance_wallet</span></button>
                    <button title="Send Alert/Ticket" onclick="openSendAlertModal(${displayUser.id}, '${safeName}')" style="background-color: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.4); padding: 0.35rem; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;"><span class="material-symbols-outlined" style="font-size: 1rem;">mark_email_unread</span></button>
                    <button title="Delete User" onclick="adminDeleteUser(${displayUser.id}, '${safeName}')" style="background-color: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); padding: 0.35rem; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;"><span class="material-symbols-outlined" style="font-size: 1rem;">delete</span></button>
                </div>
            </td>
        </tr>
        `;
    }).join('');
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
let activeEditUserCurrentBalance = 0;

function openEditBalanceModal(userId, userName, currentBalance) {
    activeEditUserId = userId;
    activeEditUserCurrentBalance = parseFloat(currentBalance) || 0;
    
    document.getElementById('edit-balance-user-info').textContent = `User: ${userName} | Current Balance: ${formatUSD(currentBalance)}`;
    document.getElementById('edit-balance-type').value = 'set';
    document.getElementById('edit-balance-val').value = currentBalance;
    document.getElementById('edit-balance-modal').classList.add('active');
}

function closeEditBalanceModal() {
    document.getElementById('edit-balance-modal').classList.remove('active');
    activeEditUserId = null;
}

async function applyEditBalance() {
    const actionType = document.getElementById('edit-balance-type').value;
    const amountInput = parseFloat(document.getElementById('edit-balance-val').value);

    if (activeEditUserId === null || isNaN(amountInput) || amountInput < 0) {
        alert('Please enter a valid amount.');
        return;
    }

    let finalBalance = activeEditUserCurrentBalance;

    if (actionType === 'set') {
        finalBalance = amountInput;
    } else if (actionType === 'add') {
        finalBalance += amountInput;
    } else if (actionType === 'deduct') {
        if (amountInput > finalBalance) {
            alert('Cannot deduct more than the current balance.');
            return;
        }
        finalBalance -= amountInput;
    }

    // Save finalBalance to advanced_users in localStorage so it applies instantly
    let advancedUsers = JSON.parse(localStorage.getItem('nova_advanced_users') || '{}');
    if (!advancedUsers[activeEditUserId]) advancedUsers[activeEditUserId] = {};
    advancedUsers[activeEditUserId].balance = finalBalance;
    localStorage.setItem('nova_advanced_users', JSON.stringify(advancedUsers));

    // Update custom users if it belongs to them
    let customUsers = JSON.parse(localStorage.getItem('nova_custom_added_users') || '[]');
    let customIdx = customUsers.findIndex(u => u.id === activeEditUserId);
    if (customIdx > -1) {
        customUsers[customIdx].balance = finalBalance;
        localStorage.setItem('nova_custom_added_users', JSON.stringify(customUsers));
    }

    showToast(`User balance updated to ${formatUSD(finalBalance)}`);
    closeEditBalanceModal();
    
    // Refresh the table
    await fetchActiveTabDetails('users');
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

// =========================================================
// ADMIN MANAGE PLANS & PRODUCTS LOGIC
// =========================================================
function renderAdminPlans() {
    const tbody = document.getElementById('admin-plans-table-body');
    if (!tbody) return;
    
    let customPlans = JSON.parse(localStorage.getItem('nova_custom_plans') || '[]');
    let editedPlans = JSON.parse(localStorage.getItem('nova_edited_plans') || '{}');
    let deletedDefaultPlans = JSON.parse(localStorage.getItem('nova_deleted_default_plans') || '[]');

    const defaultPlans = [
        { category: 'Movie Tickets', name: 'AMC Movie Ticket', price: 100, roi: '2.5% Flat', duration: '24 Hours' },
        { category: 'Movies', name: 'Avengers Movie Plan', price: 150, roi: '2.5% Flat', duration: '24 Hours' },
        { category: 'Gift Cards', name: 'Apple Gift Card Plan', price: 100, roi: '2.5% Flat', duration: '24 Hours' }
    ];

    const activeDefaultPlans = defaultPlans
        .filter(p => !deletedDefaultPlans.includes(p.name))
        .map(p => editedPlans[p.name] ? { ...p, ...editedPlans[p.name] } : p);

    const allPlans = [...activeDefaultPlans, ...customPlans];
    
    tbody.innerHTML = allPlans.map(plan => {
        let catBg = 'rgba(59,130,246,0.15)', catColor = '#60a5fa';
        if (plan.category === 'Movies') { catBg = 'rgba(168,85,247,0.15)'; catColor = '#c084fc'; }
        if (plan.category === 'Gift Cards') { catBg = 'rgba(16,185,129,0.15)'; catColor = '#10b981'; }
        
        const safeName = plan.name.replace(/'/g, "\\'");
        const safeRoi = (plan.roi || '2.5% Flat').replace(/'/g, "\\'");
        
        return `
            <tr>
                <td><span style="background-color: ${catBg}; color: ${catColor}; padding: 0.2rem 0.6rem; border-radius: 99px; font-size: 0.75rem;">${plan.category}</span></td>
                <td style="font-weight: 700; color: #f8fafc;">${plan.name}</td>
                <td style="font-weight: 700; color: #10b981;">$${Number(plan.price).toFixed(2)}</td>
                <td>${plan.roi || '2.5% Flat'}</td>
                <td>${plan.duration || '24 Hours'}</td>
                <td style="white-space: nowrap;">
                    <button onclick="openEditPlanModal('${safeName}', '${plan.category}', ${plan.price}, '${safeRoi}')" style="background-color: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); padding: 0.35rem 0.85rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; margin-right: 0.4rem;">Edit</button>
                    <button onclick="adminDeletePlan('${safeName}')" style="background-color: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); padding: 0.35rem 0.85rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer;">Delete</button>
                </td>
            </tr>
        `;
    }).join('');
}

function openEditPlanModal(name, category, price, roi) {
    const origInput = document.getElementById('edit-plan-original-name');
    const nameInput = document.getElementById('edit-plan-name');
    const catInput = document.getElementById('edit-plan-category');
    const priceInput = document.getElementById('edit-plan-price');
    const roiInput = document.getElementById('edit-plan-roi');

    if (origInput) origInput.value = name;
    if (nameInput) nameInput.value = name;
    if (catInput) catInput.value = category || 'Movie Tickets';
    if (priceInput) priceInput.value = price;
    if (roiInput) roiInput.value = roi || '2.5% Flat';

    const modal = document.getElementById('edit-plan-modal');
    if (modal) modal.classList.add('active');
}

function closeEditPlanModal() {
    const modal = document.getElementById('edit-plan-modal');
    if (modal) modal.classList.remove('active');
}

function saveEditPlan() {
    const origName = document.getElementById('edit-plan-original-name').value;
    const newName = document.getElementById('edit-plan-name').value.trim();
    const newCat = document.getElementById('edit-plan-category').value;
    const newPrice = parseFloat(document.getElementById('edit-plan-price').value);
    const newROI = document.getElementById('edit-plan-roi').value.trim() || '2.5% Flat';

    if (!newName || isNaN(newPrice) || newPrice <= 0) {
        alert('Please enter a valid Plan Name and Price.');
        return;
    }

    let customPlans = JSON.parse(localStorage.getItem('nova_custom_plans') || '[]');
    const customIdx = customPlans.findIndex(p => p.name === origName);

    if (customIdx !== -1) {
        customPlans[customIdx] = {
            category: newCat,
            name: newName,
            price: newPrice,
            roi: newROI,
            duration: '24 Hours'
        };
        localStorage.setItem('nova_custom_plans', JSON.stringify(customPlans));
    } else {
        let editedPlans = JSON.parse(localStorage.getItem('nova_edited_plans') || '{}');
        editedPlans[origName] = {
            category: newCat,
            name: newName,
            price: newPrice,
            roi: newROI,
            duration: '24 Hours'
        };
        localStorage.setItem('nova_edited_plans', JSON.stringify(editedPlans));
    }

    closeEditPlanModal();
    renderAdminPlans();
    showToast(`Plan updated: ${newName}`);
    alert(`✅ Plan "${newName}" successfully updated to $${newPrice.toFixed(2)} (${newROI})!`);
}

function adminCreatePlan() {
    const nameEl = document.getElementById('admin-plan-name');
    const catEl = document.getElementById('admin-plan-category');
    const priceEl = document.getElementById('admin-plan-price');
    
    if (!nameEl || !priceEl || !nameEl.value.trim() || !priceEl.value.trim()) {
        alert("Please enter both Plan Name and Price.");
        return;
    }
    
    const newPlan = {
        category: catEl ? catEl.value : 'Products',
        name: nameEl.value.trim(),
        price: parseFloat(priceEl.value),
        roi: '2.5% Flat',
        duration: '24 Hours'
    };
    
    let customPlans = JSON.parse(localStorage.getItem('nova_custom_plans') || '[]');
    customPlans.push(newPlan);
    localStorage.setItem('nova_custom_plans', JSON.stringify(customPlans));
    
    nameEl.value = '';
    priceEl.value = '';
    
    renderAdminPlans();
    showToast(`Created plan: ${newPlan.name} ($${newPlan.price})`);
    alert(`🎉 Successfully published "${newPlan.name}" ($${newPlan.price}) to frontend!`);
}

function adminDeletePlan(name) {
    if (!confirm(`Are you sure you want to remove plan "${name}"?`)) return;
    let customPlans = JSON.parse(localStorage.getItem('nova_custom_plans') || '[]');
    const isCustom = customPlans.some(p => p.name === name);

    if (isCustom) {
        customPlans = customPlans.filter(p => p.name !== name);
        localStorage.setItem('nova_custom_plans', JSON.stringify(customPlans));
    } else {
        let deletedDefault = JSON.parse(localStorage.getItem('nova_deleted_default_plans') || '[]');
        if (!deletedDefault.includes(name)) {
            deletedDefault.push(name);
            localStorage.setItem('nova_deleted_default_plans', JSON.stringify(deletedDefault));
        }
    }

    renderAdminPlans();
    showToast(`Removed plan: ${name}`);
}

// Automatically render plans when admin loads
document.addEventListener('DOMContentLoaded', () => {
    renderAdminPlans();
});

// =========================================================
// ADVANCED USER MANAGEMENT LOGIC
// =========================================================

function openAddUserModal() {
    document.getElementById('user-mgmt-title').textContent = 'Add New User';
    document.getElementById('user-mgmt-id').value = '';
    document.getElementById('user-mgmt-name').value = '';
    document.getElementById('user-mgmt-email').value = '';
    document.getElementById('user-mgmt-password').value = '';
    document.getElementById('user-mgmt-role').value = 'user';
    document.getElementById('user-mgmt-status').value = 'Active';
    document.getElementById('user-mgmt-modal').classList.add('active');
}

function openEditUserModal(id, name, email, role, status) {
    document.getElementById('user-mgmt-title').textContent = 'Edit User Profile';
    document.getElementById('user-mgmt-id').value = id;
    document.getElementById('user-mgmt-name').value = name;
    document.getElementById('user-mgmt-email').value = email;
    document.getElementById('user-mgmt-password').value = '';
    document.getElementById('user-mgmt-role').value = role || 'user';
    document.getElementById('user-mgmt-status').value = status || 'Active';
    document.getElementById('user-mgmt-modal').classList.add('active');
}

function closeUserMgmtModal() {
    document.getElementById('user-mgmt-modal').classList.remove('active');
}

async function saveUserMgmt() {
    const id = document.getElementById('user-mgmt-id').value;
    const name = document.getElementById('user-mgmt-name').value.trim();
    const email = document.getElementById('user-mgmt-email').value.trim();
    const role = document.getElementById('user-mgmt-role').value;
    const status = document.getElementById('user-mgmt-status').value;

    if (!name || !email) {
        alert('Name and Email are required.');
        return;
    }

    if (!id) {
        // Add new custom user
        let customUsers = JSON.parse(localStorage.getItem('nova_custom_added_users') || '[]');
        const newId = Date.now(); // pseudo-id
        customUsers.push({
            id: newId,
            name: name,
            email: email,
            balance: 0,
            role: role,
            status: status
        });
        localStorage.setItem('nova_custom_added_users', JSON.stringify(customUsers));
        showToast('New user added successfully!');
    } else {
        // Edit existing user
        const userId = parseInt(id);
        let advancedUsers = JSON.parse(localStorage.getItem('nova_advanced_users') || '{}');
        advancedUsers[userId] = {
            ...advancedUsers[userId],
            name: name,
            email: email,
            role: role,
            status: status
        };
        localStorage.setItem('nova_advanced_users', JSON.stringify(advancedUsers));
        
        // Also update custom users array if they were custom added
        let customUsers = JSON.parse(localStorage.getItem('nova_custom_added_users') || '[]');
        const cIdx = customUsers.findIndex(u => u.id === userId);
        if (cIdx > -1) {
            customUsers[cIdx].name = name;
            customUsers[cIdx].email = email;
            customUsers[cIdx].role = role;
            customUsers[cIdx].status = status;
            localStorage.setItem('nova_custom_added_users', JSON.stringify(customUsers));
        }

        showToast('User details updated!');
    }

    closeUserMgmtModal();
    // Re-fetch or re-render
    await fetchActiveTabDetails('users');
}

async function adminDeleteUser(id, name) {
    if (!confirm(`Are you absolutely sure you want to completely delete user "${name}"? This action cannot be undone.`)) return;
    
    let deletedIds = JSON.parse(localStorage.getItem('nova_deleted_user_ids') || '[]');
    if (!deletedIds.includes(id)) {
        deletedIds.push(id);
        localStorage.setItem('nova_deleted_user_ids', JSON.stringify(deletedIds));
    }
    
    showToast(`User ${name} has been deleted.`);
    await fetchActiveTabDetails('users');
}

function openSendAlertModal(id, name) {
    document.getElementById('alert-user-id').value = id;
    document.getElementById('alert-user-info').textContent = `Sending to User: ${name}`;
    document.getElementById('alert-subject').value = '';
    document.getElementById('alert-message').value = '';
    document.getElementById('send-alert-modal').classList.add('active');
}

function closeSendAlertModal() {
    document.getElementById('send-alert-modal').classList.remove('active');
}

function sendUserAlert() {
    const id = document.getElementById('alert-user-id').value;
    const subject = document.getElementById('alert-subject').value.trim();
    const msg = document.getElementById('alert-message').value.trim();

    if (!subject || !msg) {
        alert("Subject and message are required.");
        return;
    }

    // In a real app, this would send an email or internal message.
    // For now, we simulate success and save it to a mock log in localStorage
    let alerts = JSON.parse(localStorage.getItem('nova_sent_alerts') || '[]');
    alerts.push({
        userId: id,
        subject: subject,
        message: msg,
        date: new Date().toISOString()
    });
    localStorage.setItem('nova_sent_alerts', JSON.stringify(alerts));

    closeSendAlertModal();
    showToast('Alert / Ticket successfully sent to user!');
}
