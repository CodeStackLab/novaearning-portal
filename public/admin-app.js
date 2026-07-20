// Administrator Dashboard Controller for NOVA Portal

const API_BASE = '/api';
let activeEditUserId = null;
let activeReplyTicketId = null;
let globalUsersList = [];
let globalAuditLog = [];

function escapeAdminUi(value) { const node = document.createElement('div'); node.textContent = String(value ?? ''); return node.innerHTML; }

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
    window.location.href = '/login.html';
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
            const activeUsersEl = document.getElementById('stat-active-users');
            if (activeUsersEl) activeUsersEl.textContent = stats.activeUsers || 0;
            document.getElementById('stat-deposits').textContent = formatUSD(stats.deposits);
            document.getElementById('stat-payouts').textContent = stats.pendingWithdrawals;
        } else if (tabId === 'users') {
            const users = await adminRequest('/admin/users');
            globalUsersList = users;
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
        } else if (tabId === 'smtp') {
            await loadSmtpSettings();
        } else if (tabId === 'notifications') {
            await loadNotificationSettings();
        } else if (tabId === 'audit') {
            await loadAuditLog();
        }
    } catch (e) {
        console.error('Error fetching tab details:', e.message);
    }
}

async function loadAuditLog() {
    const list = document.getElementById('audit-log-list');
    if (!list) return;
    try { globalAuditLog = await adminRequest('/admin/audit-log'); renderAuditLog(globalAuditLog); }
    catch (error) { list.innerHTML = `<div class="notification-inbox-empty">${error.message || 'Unable to load audit log'}</div>`; }
}

function filterAuditLog() {
    const query = document.getElementById('audit-search')?.value.toLowerCase().trim() || '';
    renderAuditLog(globalAuditLog.filter(row => JSON.stringify(row).toLowerCase().includes(query)));
}

function renderAuditLog(rows) {
    const list = document.getElementById('audit-log-list');
    if (!list) return;
    if (!rows.length) { list.innerHTML = '<div class="notification-inbox-empty">No matching administrative actions.</div>'; return; }
    list.innerHTML = rows.map(row => `<article class="audit-log-item"><span class="material-symbols-outlined">verified_user</span><div><strong>${escapeAdminUi(row.action)}</strong><small>${escapeAdminUi(row.admin_name || 'Administrator')} · ${escapeAdminUi(row.target_type || 'system')} ${escapeAdminUi(row.target_id || '')}</small><time>${escapeAdminUi(row.created_at)} · ${escapeAdminUi(row.ip_address || 'IP unavailable')}</time></div></article>`).join('');
}

const notificationSettingKeys = [
    'admin_email_notifications', 'admin_email_deposit_notifications', 'admin_email_withdrawal_notifications',
    'admin_email_investment_notifications', 'admin_email_commission_notifications', 'admin_email_support_notifications'
];

async function loadNotificationSettings() {
    if (!document.getElementById('notification-settings-form')) return;
    try {
        const settings = await adminRequest('/admin/settings/notifications');
        notificationSettingKeys.forEach(key => {
            const input = document.getElementById(key);
            if (input) input.checked = settings[key] !== false;
        });
    } catch (error) {
        showToast(error.message || 'Unable to load notification settings');
    }
}

async function saveNotificationSettings(event) {
    event.preventDefault();
    const button = document.getElementById('notification-save-btn');
    const payload = {};
    notificationSettingKeys.forEach(key => payload[key] = Boolean(document.getElementById(key)?.checked));
    if (button) button.disabled = true;
    try {
        const result = await adminRequest('/admin/settings/notifications', { method: 'POST', body: JSON.stringify(payload) });
        showToast(result.message || 'Notification preferences saved');
    } catch (error) {
        showToast(error.message || 'Unable to save notification settings');
    } finally {
        if (button) button.disabled = false;
    }
}

async function loadSmtpSettings() {
    const status = document.getElementById('smtp-config-status');
    if (!document.getElementById('smtp-settings-form')) return;
    try {
        const smtp = await adminRequest('/admin/settings/smtp');
        document.getElementById('smtp-host').value = smtp.host || '';
        document.getElementById('smtp-port').value = smtp.port || 587;
        document.getElementById('smtp-encryption').value = smtp.encryption || 'tls';
        document.getElementById('smtp-username').value = smtp.username || '';
        document.getElementById('smtp-password').value = '';
        document.getElementById('smtp-from-email').value = smtp.fromEmail || '';
        document.getElementById('smtp-from-name').value = smtp.fromName || 'NOVA';
        const configured = Boolean(smtp.host && smtp.fromEmail && smtp.passwordConfigured);
        if (status) {
            status.textContent = configured ? 'Configured' : 'Setup required';
            status.classList.toggle('configured', configured);
        }
        const help = document.getElementById('smtp-password-help');
        if (help) help.textContent = smtp.passwordConfigured
            ? 'A password is already saved. Leave blank to keep it.'
            : 'Enter the SMTP or app password supplied by your provider.';
    } catch (error) {
        if (status) status.textContent = 'Unable to load';
        showToast(error.message || 'Unable to load SMTP settings');
    }
}

async function saveSmtpSettings(event) {
    event.preventDefault();
    const button = document.getElementById('smtp-save-btn');
    const payload = {
        host: document.getElementById('smtp-host').value.trim(),
        port: Number(document.getElementById('smtp-port').value),
        encryption: document.getElementById('smtp-encryption').value,
        username: document.getElementById('smtp-username').value.trim(),
        password: document.getElementById('smtp-password').value,
        fromEmail: document.getElementById('smtp-from-email').value.trim(),
        fromName: document.getElementById('smtp-from-name').value.trim()
    };

    if (button) {
        button.disabled = true;
        button.classList.add('is-loading');
    }
    try {
        const result = await adminRequest('/admin/settings/smtp', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        showToast(result.message || 'SMTP configuration saved!');
        await loadSmtpSettings();
    } catch (error) {
        showToast(error.message || 'Unable to save SMTP configuration');
    } finally {
        if (button) {
            button.disabled = false;
            button.classList.remove('is-loading');
        }
    }
}

function getSmtpFormPayload() {
    return {
        host: document.getElementById('smtp-host').value.trim(),
        port: Number(document.getElementById('smtp-port').value),
        encryption: document.getElementById('smtp-encryption').value,
        username: document.getElementById('smtp-username').value.trim(),
        password: document.getElementById('smtp-password').value,
        fromEmail: document.getElementById('smtp-from-email').value.trim(),
        fromName: document.getElementById('smtp-from-name').value.trim()
    };
}

async function testSmtpSettings() {
    const form = document.getElementById('smtp-settings-form');
    const button = document.getElementById('smtp-test-btn');
    const resultBox = document.getElementById('smtp-test-result');
    if (!form || !form.reportValidity()) return;

    button.disabled = true;
    button.classList.add('is-loading');
    resultBox.className = 'smtp-test-result testing';
    resultBox.textContent = 'Connecting securely to the SMTP server…';
    try {
        const result = await adminRequest('/admin/settings/smtp-test', {
            method: 'POST',
            body: JSON.stringify(getSmtpFormPayload())
        });
        resultBox.className = 'smtp-test-result success';
        resultBox.textContent = result.message || 'SMTP connection succeeded.';
        showToast('SMTP connection successful!');
    } catch (error) {
        resultBox.className = 'smtp-test-result error';
        resultBox.textContent = error.message || 'SMTP connection failed.';
    } finally {
        button.disabled = false;
        button.classList.remove('is-loading');
    }
}

function toggleSmtpPassword() {
    const input = document.getElementById('smtp-password');
    const icon = document.getElementById('smtp-password-icon');
    if (!input) return;
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    if (icon) icon.textContent = reveal ? 'visibility_off' : 'visibility';
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

// Copy to Clipboard Utility
function copyToClipboard(text, message = "Copied to clipboard!") {
    navigator.clipboard.writeText(text)
        .then(() => showToast(message))
        .catch(() => showToast("Failed to copy."));
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
    fetchAdminTronAddress();

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
        const menuIcon = menuToggleBtn.querySelector('.material-symbols-outlined');
        const syncSidebarState = (isOpen) => {
            menuToggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            if (menuIcon) menuIcon.textContent = isOpen ? 'close' : 'menu';
        };
        const toggleSidebar = () => {
            sidebar.classList.toggle('active');
            overlay.classList.toggle('active');
            syncSidebarState(sidebar.classList.contains('active'));
        };

        const closeSidebar = () => {
            sidebar.classList.remove('active');
            overlay.classList.remove('active');
            syncSidebarState(false);
        };

        menuToggleBtn.addEventListener('click', toggleSidebar);
        overlay.addEventListener('click', closeSidebar);

        // Close sidebar when a navigation item is clicked
        const menuLinks = document.querySelectorAll('.sidebar-item-link[data-tab]');
        menuLinks.forEach(link => {
            link.addEventListener('click', closeSidebar);
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeSidebar();
        });
        syncSidebarState(false);
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

    // Pre-calculate referral counts dynamically based on the current list of users
    allUsers = allUsers.map(user => {
        const advancedState = advancedUsers[user.id] || {};
        const merged = { ...user, ...advancedState };
        const refCount = allUsers.filter(u => u.referred_by === user.id).length;
        return {
            ...merged,
            referral_count: refCount
        };
    });

    // Read filter values from DOM if they exist
    const searchInput = document.getElementById('user-search-input');
    const filterSelect = document.getElementById('user-filter-select');
    const sortSelect = document.getElementById('user-sort-select');

    const searchVal = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const filterVal = filterSelect ? filterSelect.value : 'all';
    const sortVal = sortSelect ? sortSelect.value : 'newest';

    // 1. Search Filter
    if (searchVal) {
        allUsers = allUsers.filter(u => 
            (u.name || '').toLowerCase().includes(searchVal) ||
            (u.email || '').toLowerCase().includes(searchVal) ||
            (u.referral_code || '').toLowerCase().includes(searchVal)
        );
    }

    // 2. Dropdown Filter
    if (filterVal === 'has-referrals') {
        allUsers = allUsers.filter(u => u.referral_count > 0);
    } else if (filterVal === 'active') {
        allUsers = allUsers.filter(u => (u.status || 'Active') === 'Active');
    } else if (filterVal === 'suspended') {
        allUsers = allUsers.filter(u => u.status === 'Suspended');
    }

    // 3. Sorting
    if (sortVal === 'newest') {
        allUsers.sort((a, b) => b.id - a.id);
    } else if (sortVal === 'oldest') {
        allUsers.sort((a, b) => a.id - b.id);
    } else if (sortVal === 'balance-desc') {
        allUsers.sort((a, b) => b.balance - a.balance);
    } else if (sortVal === 'referrals-desc') {
        allUsers.sort((a, b) => b.referral_count - a.referral_count);
    }

    tbody.innerHTML = allUsers.map(user => {
        const status = user.status || 'Active';
        
        let statusColor = '#10b981'; // Active green
        let statusBg = 'rgba(16, 185, 129, 0.15)';
        if (status === 'Suspended') { statusColor = '#ef4444'; statusBg = 'rgba(239, 68, 68, 0.15)'; }
        if (status === 'Hold') { statusColor = '#f59e0b'; statusBg = 'rgba(245, 158, 11, 0.15)'; }
        if (status === 'Under Review') { statusColor = '#3b82f6'; statusBg = 'rgba(59, 130, 246, 0.15)'; }

        // Escape quotes
        const safeName = (user.name || '').replace(/'/g, "\\'");
        const safeEmail = (user.email || '').replace(/'/g, "\\'");
        const safeStatus = status.replace(/'/g, "\\'");

        return `
        <tr>
            <td style="cursor: pointer;" title="Click to view referral members" onclick="viewReferredMembers(${user.id}, '${safeName}', '${user.referral_code || ''}')">
                <div style="display:flex; align-items:center; gap:0.75rem;">
                    <div style="width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #3b82f6, #1d4ed8); display: flex; align-items: center; justify-content: center; font-size: 0.8rem; font-weight: 800; color: white;">
                        ${user.name ? user.name.substring(0, 2).toUpperCase() : 'U'}
                    </div>
                    <div>
                        <div style="font-weight:600; color:#f1f5f9; display: flex; align-items: center; gap: 0.25rem;">
                            <span>${user.name}</span>
                            <span class="material-symbols-outlined" style="font-size: 0.85rem; color: #94a3b8;">open_in_new</span>
                        </div>
                        <div style="font-size:0.75rem; color:#94a3b8;">${user.email}</div>
                    </div>
                </div>
            </td>
            <td style="font-weight:700; color:#10b981;">${formatUSD(user.balance)}</td>
            <td>
                <span onclick="viewReferredMembers(${user.id}, '${safeName}', '${user.referral_code || ''}')" style="cursor: pointer; background-color: rgba(59, 130, 246, 0.15); color: #60a5fa; padding: 0.2rem 0.6rem; border-radius: 99px; font-size: 0.75rem; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem;">
                    <span class="material-symbols-outlined" style="font-size: 0.85rem;">group</span>
                    <span>${user.referral_count} referred</span>
                </span>
            </td>
            <td><span style="background-color: ${statusBg}; color: ${statusColor}; padding: 0.2rem 0.6rem; border-radius: 99px; font-size: 0.75rem; font-weight: 600;">${status}</span></td>
            <td>
                <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
                    <button title="View Referred Members" onclick="viewReferredMembers(${user.id}, '${safeName}', '${user.referral_code || ''}')" style="background-color: rgba(251, 191, 36, 0.15); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.4); padding: 0.35rem; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;"><span class="material-symbols-outlined" style="font-size: 1rem;">group</span></button>
                    <button title="Edit Profile/Status" onclick="openEditUserModal(${user.id}, '${safeName}', '${safeEmail}', '${safeStatus}')" style="background-color: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); padding: 0.35rem; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;"><span class="material-symbols-outlined" style="font-size: 1rem;">edit</span></button>
                    <button title="Edit Balance" onclick="openEditBalanceModal(${user.id}, '${safeName}', ${user.balance})" style="background-color: #1e2538; border: 1px solid #2e384e; color: #f1f5f9; padding: 0.35rem; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;"><span class="material-symbols-outlined" style="font-size: 1rem;">account_balance_wallet</span></button>
                    <button title="Send Alert/Ticket" onclick="openSendAlertModal(${user.id}, '${safeName}')" style="background-color: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.4); padding: 0.35rem; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;"><span class="material-symbols-outlined" style="font-size: 1rem;">mark_email_unread</span></button>
                    <button title="Delete User" onclick="adminDeleteUser(${user.id}, '${safeName}')" style="background-color: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); padding: 0.35rem; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;"><span class="material-symbols-outlined" style="font-size: 1rem;">delete</span></button>
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

function triggerUsersFilter() {
    renderUsersTable(globalUsersList);
}

function renderDepositsTable(deposits) {
    const tbody = document.getElementById('admin-deposits-table-body');
    if (!tbody) return;

    let pendingCount = deposits.filter(d => d.status === 'Pending').length;
    if (pendingCount > 0 && !window.hasShownPendingDepositsToast) {
        window.hasShownPendingDepositsToast = true;
        setTimeout(() => {
            showToast(`You have ${pendingCount} pending deposit(s) awaiting review!`);
        }, 1500);
    }

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
                <td style="font-family: monospace; white-space: nowrap;">
                    <span>${dep.txn_id || 'N/A'}</span>
                    <button onclick="copyToClipboard('${dep.txn_id || ''}')" style="background: none; border: none; color: #3b82f6; cursor: pointer; display: inline-flex; align-items: center; vertical-align: middle; padding: 0; margin-left: 0.35rem;" title="Copy Transaction ID">
                        <span class="material-symbols-outlined" style="font-size: 13px;">content_copy</span>
                    </button>
                </td>
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
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#64748b;">No withdrawal requests found.</td></tr>`;
        return;
    }

    tbody.innerHTML = payouts.map(po => {
        let actionCell = `<span style="color:#64748b; font-size:0.8rem;">Processed</span>`;
        if (po.status === 'Pending') {
            actionCell = `
                <button onclick="verifyPayout(${po.id})" style="background-color:#3b82f6; color:white; padding:0.35rem 0.75rem; border-radius:6px; font-size:0.75rem; font-weight:600;">Confirm Payout</button>
            `;
        }

        const walletAddress = po.wallet_address || 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
        const copyButton = `
            <button onclick="navigator.clipboard.writeText('${walletAddress}'); showToast('Wallet address copied!')" style="background: none; border: none; color: #fbbf24; cursor: pointer; display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.75rem; margin-top: 0.25rem; padding: 0;">
                <span class="material-symbols-outlined" style="font-size: 0.95rem;">content_copy</span> Copy Address
            </button>
        `;

        return `
            <tr>
                <td>${po.date}</td>
                <td style="font-weight:600; color:#f1f5f9;">${po.user_name}</td>
                <td>
                    <div style="display:flex; flex-direction:column; align-items:flex-start; gap:0.15rem;">
                        <span style="font-size:0.8rem; color:#cbd5e1; font-family:monospace; word-break:break-all;">${walletAddress}</span>
                        ${copyButton}
                    </div>
                </td>
                <td style="font-weight:700; color:#ef4444;">$${po.amount.toFixed(2)}</td>
                <td class="deposit-tx-hash" title="${po.ref}">${po.ref.substring(0, 16)}...</td>
                <td><span class="status-badge-lbl ${po.status.toLowerCase()}">${po.status}</span></td>
                <td>${actionCell}</td>
            </tr>
        `;
    }).join('');
}

let activeChatUserId = null;
let activeChatUserTickets = [];
let allTicketsData = [];

function renderTicketsTable(tickets) {
    allTicketsData = tickets;
    const usersListContainer = document.getElementById('admin-chat-users-list');
    if (!usersListContainer) return;

    if (tickets.length === 0) {
        usersListContainer.innerHTML = `<p style="text-align: center; color: #64748b; font-size: 0.85rem; padding: 1.5rem 0;">No active threads found.</p>`;
        return;
    }

    // Group tickets by user_id
    const userGroups = {};
    tickets.forEach(t => {
        if (!userGroups[t.user_id]) {
            userGroups[t.user_id] = {
                userId: t.user_id,
                userName: t.user_name || 'Anonymous User',
                userEmail: t.user_email || 'no-email@nova.com',
                tickets: [],
                latestDate: new Date(t.date).getTime() || 0,
                status: 'Closed'
            };
        }
        userGroups[t.user_id].tickets.push(t);
        // Thread is open if any message is Open
        if (t.status === 'Open') {
            userGroups[t.user_id].status = 'Open';
        }
    });

    const groupsArray = Object.values(userGroups).sort((a, b) => b.latestDate - a.latestDate);

    usersListContainer.innerHTML = groupsArray.map(g => {
        const isCurrent = activeChatUserId === g.userId;
        const statusColor = g.status === 'Open' ? '#10b981' : '#64748b';
        const badgeBg = g.status === 'Open' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(100, 116, 139, 0.15)';
        const safeName = g.userName.replace(/'/g, "\\'");
        const safeEmail = g.userEmail.replace(/'/g, "\\'");

        return `
            <div onclick="selectAdminChatUser(${g.userId}, '${safeName}', '${safeEmail}')" style="padding: 1rem; border-bottom: 1px solid #1e2538; cursor: pointer; transition: background 0.2s; background-color: ${isCurrent ? '#0b0e14' : 'transparent'}; display: flex; flex-direction: column; gap: 0.35rem;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 700; color: #f8fafc; font-size: 0.85rem;">${g.userName}</span>
                    <span style="background-color: ${badgeBg}; color: ${statusColor}; border: 1px solid rgba(16,185,129,0.1); padding: 0.15rem 0.5rem; border-radius: 99px; font-size: 0.65rem; font-weight: 700;">${g.status}</span>
                </div>
                <div style="font-size: 0.75rem; color: #94a3b8; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
                    ${g.userEmail}
                </div>
            </div>
        `;
    }).join('');

    // If there is an active selected chat user, refresh their chat box too!
    if (activeChatUserId !== null) {
        const activeGroup = userGroups[activeChatUserId];
        if (activeGroup) {
            selectAdminChatUser(activeChatUserId, activeGroup.userName, activeGroup.userEmail, false);
        }
    }
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

// Ticket Reply Panel handlers (RE-DESIGNED FOR LIVE CHAT)
let selectedAdminChatImageBase64 = null;

function handleAdminChatImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        selectedAdminChatImageBase64 = e.target.result;
        document.getElementById('admin-chat-image-preview-thumb').src = selectedAdminChatImageBase64;
        document.getElementById('admin-chat-image-preview-box').style.display = 'flex';
    };
    reader.readAsDataURL(file);
}

function clearAdminChatImageSelection() {
    selectedAdminChatImageBase64 = null;
    document.getElementById('admin-chat-screenshot-file').value = '';
    document.getElementById('admin-chat-image-preview-box').style.display = 'none';
}

function selectAdminChatUser(userId, userName, userEmail, shouldScroll = true) {
    activeChatUserId = userId;

    document.getElementById('admin-chat-user-name').textContent = userName;
    document.getElementById('admin-chat-user-email').textContent = userEmail;

    // Show input and toggle containers
    document.getElementById('admin-chat-input-box').style.display = 'flex';
    document.getElementById('admin-chat-status-toggle-container').style.display = 'flex';

    // Filter tickets for this user
    const userTickets = allTicketsData.filter(t => t.user_id === userId);
    // Sort oldest first (chronological order)
    const sorted = [...userTickets].reverse();

    const messagesContainer = document.getElementById('admin-chat-messages-container');
    if (!messagesContainer) return;

    if (sorted.length === 0) {
        messagesContainer.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:#64748b;">
                <p>No messages in this chat yet.</p>
            </div>
        `;
        document.getElementById('admin-chat-thread-status').textContent = 'Open';
        document.getElementById('admin-chat-thread-status').className = 'status-badge-lbl confirmed';
        return;
    }

    // Determine latest status
    const latestTicket = sorted[sorted.length - 1];
    const currentStatus = latestTicket.status;
    const statusLabel = document.getElementById('admin-chat-thread-status');
    statusLabel.textContent = currentStatus;
    if (currentStatus === 'Open') {
        statusLabel.className = 'status-badge-lbl confirmed';
    } else {
        statusLabel.className = 'status-badge-lbl pending';
    }

    messagesContainer.innerHTML = sorted.map(ticket => {
        let userImageHtml = '';
        if (ticket.image_path) {
            userImageHtml = `<img src="${ticket.image_path}" style="max-width: 100%; border-radius: 8px; margin-top: 0.5rem; display: block; cursor: pointer;" onclick="window.open('${ticket.image_path}', '_blank')">`;
        }

        let html = '';
        if (ticket.message) {
            html += `
                <div class="chat-bubble-wrapper user" style="display: flex; justify-content: flex-end; margin-bottom: 0.5rem; width: 100%;">
                    <div class="chat-bubble" style="max-width: 70%; padding: 0.75rem 1rem; border-radius: 12px; font-size: 0.9rem; line-height: 1.4; word-break: break-word; background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; border-bottom-right-radius: 2px;">
                        ${escapeHTML(ticket.message)}
                        ${userImageHtml}
                        <span style="font-size: 0.65rem; color: rgba(255, 255, 255, 0.7); margin-top: 0.25rem; display: block; text-align: right;">${ticket.date}</span>
                    </div>
                </div>
            `;
        } else if (userImageHtml) {
            html += `
                <div class="chat-bubble-wrapper user" style="display: flex; justify-content: flex-end; margin-bottom: 0.5rem; width: 100%;">
                    <div class="chat-bubble" style="max-width: 70%; padding: 0.5rem; border-radius: 12px; font-size: 0.9rem; line-height: 1.4; word-break: break-word; background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; border-bottom-right-radius: 2px;">
                        ${userImageHtml}
                        <span style="font-size: 0.65rem; color: rgba(255, 255, 255, 0.7); margin-top: 0.25rem; display: block; text-align: right;">${ticket.date}</span>
                    </div>
                </div>
            `;
        }

        let adminImageHtml = '';
        if (ticket.admin_image_path) {
            adminImageHtml = `<img src="${ticket.admin_image_path}" style="max-width: 100%; border-radius: 8px; margin-top: 0.5rem; display: block; cursor: pointer;" onclick="window.open('${ticket.admin_image_path}', '_blank')">`;
        }

        if (ticket.admin_reply) {
            html += `
                <div class="chat-bubble-wrapper support" style="display: flex; justify-content: flex-start; margin-bottom: 0.5rem; width: 100%;">
                    <div class="chat-bubble" style="max-width: 70%; padding: 0.75rem 1rem; border-radius: 12px; font-size: 0.9rem; line-height: 1.4; word-break: break-word; background-color: #171d2c; color: #cbd5e1; border-bottom-left-radius: 2px; border: 1px solid #1e2538;">
                        ${escapeHTML(ticket.admin_reply)}
                        ${adminImageHtml}
                        <span style="font-size: 0.65rem; color: #94a3b8; margin-top: 0.25rem; display: block;">${ticket.date}</span>
                    </div>
                </div>
            `;
        } else if (adminImageHtml) {
            html += `
                <div class="chat-bubble-wrapper support" style="display: flex; justify-content: flex-start; margin-bottom: 0.5rem; width: 100%;">
                    <div class="chat-bubble" style="max-width: 70%; padding: 0.5rem; border-radius: 12px; font-size: 0.9rem; line-height: 1.4; word-break: break-word; background-color: #171d2c; color: #cbd5e1; border-bottom-left-radius: 2px; border: 1px solid #1e2538;">
                        ${adminImageHtml}
                        <span style="font-size: 0.65rem; color: #94a3b8; margin-top: 0.25rem; display: block;">${ticket.date}</span>
                    </div>
                </div>
            `;
        }
        return html;
    }).join('');

    if (shouldScroll) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

// HTML Escape Helper
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

async function sendAdminChatMessage() {
    const input = document.getElementById('admin-chat-message-input');
    if (!input || activeChatUserId === null) return;
    const msg = input.value.trim();
    if (msg === '' && !selectedAdminChatImageBase64) return;

    try {
        input.disabled = true;
        await adminRequest('/admin/tickets/reply', {
            method: 'POST',
            body: JSON.stringify({
                userId: activeChatUserId,
                reply: msg,
                screenshotBase64: selectedAdminChatImageBase64
            })
        });

        input.value = '';
        clearAdminChatImageSelection();
        const tickets = await adminRequest('/admin/tickets');
        renderTicketsTable(tickets);
    } catch (e) {
        alert(e.message || 'Failed to send message');
    } finally {
        input.disabled = false;
        input.focus();
    }
}

async function toggleCurrentThreadStatus() {
    if (activeChatUserId === null) return;
    const currentStatus = document.getElementById('admin-chat-thread-status').textContent;
    const nextStatus = currentStatus === 'Open' ? 'Closed' : 'Open';

    try {
        await adminRequest('/admin/tickets/toggle-status', {
            method: 'POST',
            body: JSON.stringify({
                userId: activeChatUserId,
                status: nextStatus
            })
        });
        showToast(`Thread status set to ${nextStatus}`);
        const tickets = await adminRequest('/admin/tickets');
        renderTicketsTable(tickets);
    } catch (e) {
        alert(e.message || 'Failed to toggle status');
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
        { name: 'AMC Movie Ticket', price: 100, roi: '2.5% Flat', duration: '24 Hours' },
        { name: 'Avengers Movie Plan', price: 150, roi: '2.5% Flat', duration: '24 Hours' },
        { name: 'Netflix Gift Card', price: 100, roi: '2.5% Flat', duration: '24 Hours' },
        { name: 'Amazon Gift Card', price: 200, roi: '2.5% Flat', duration: '24 Hours' }
    ];

    const activeDefaultPlans = defaultPlans
        .filter(p => !deletedDefaultPlans.includes(p.name))
        .map(p => editedPlans[p.name] ? { ...p, ...editedPlans[p.name] } : p);

    const allPlans = [...activeDefaultPlans, ...customPlans];
    
    tbody.innerHTML = allPlans.map(plan => {
        const planImg = plan.img || 'images/amc_theater.png';
        const safeName = plan.name.replace(/'/g, "\\'");
        const safeRoi = (plan.roi || '2.5% Flat').replace(/'/g, "\\'");

        return `
            <tr>
                <td style="font-weight: 700; color: #f8fafc;">
                    <div style="display:flex; align-items:center; gap:0.5rem;">
                        <img src="${planImg}" alt="Poster" style="width:36px; height:50px; object-fit:cover; border-radius:4px; border:1px solid #1e2538; background-color:#0b0e14;">
                        <span>${plan.name}</span>
                    </div>
                </td>
                <td style="font-weight: 700; color: #10b981;">$${Number(plan.price).toFixed(2)}</td>
                <td>${plan.roi || '2.5% Flat'}</td>
                <td>${plan.duration || '24 Hours'}</td>
                <td style="white-space: nowrap;">
                    <button onclick="openEditPlanModal('${safeName}', ${plan.price}, '${safeRoi}', '${planImg}')" style="background-color: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); padding: 0.35rem 0.85rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; margin-right: 0.4rem;">Edit</button>
                    <button onclick="adminDeletePlan('${safeName}')" style="background-color: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); padding: 0.35rem 0.85rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer;">Delete</button>
                </td>
            </tr>
        `;
    }).join('');
}

// Plan image upload handler (shared between create + edit forms)
let _createPlanImageBase64 = null;
let _editPlanImageBase64 = null;

function handlePlanImageSelect(event, formType) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const dataUrl = e.target.result;
        if (formType === 'create') {
            _createPlanImageBase64 = dataUrl;
            document.getElementById('create-plan-img-preview').src = dataUrl;
            document.getElementById('create-plan-img-preview-wrap').style.display = 'block';
            document.getElementById('admin-plan-image-url').value = '';
        } else {
            _editPlanImageBase64 = dataUrl;
            document.getElementById('edit-plan-img-preview').src = dataUrl;
            document.getElementById('edit-plan-img-preview-wrap').style.display = 'block';
            document.getElementById('edit-plan-image-url').value = '';
        }
    };
    reader.readAsDataURL(file);
}

function openEditPlanModal(name, price, roi, currentImg) {
    const origInput = document.getElementById('edit-plan-original-name');
    const nameInput = document.getElementById('edit-plan-name');
    const priceInput = document.getElementById('edit-plan-price');
    const roiInput = document.getElementById('edit-plan-roi');
    const imgUrlInput = document.getElementById('edit-plan-image-url');
    const imgPreview = document.getElementById('edit-plan-img-preview');
    const imgPreviewWrap = document.getElementById('edit-plan-img-preview-wrap');

    if (origInput) origInput.value = name;
    if (nameInput) nameInput.value = name;
    if (priceInput) priceInput.value = price;
    if (roiInput) roiInput.value = roi || '2.5% Flat';
    _editPlanImageBase64 = null;
    document.getElementById('edit-plan-image-file').value = '';

    if (currentImg) {
        imgUrlInput.value = currentImg.startsWith('data:') ? '' : currentImg;
        imgPreview.src = currentImg;
        imgPreviewWrap.style.display = 'block';
        if (currentImg.startsWith('data:')) {
            _editPlanImageBase64 = currentImg;
            imgUrlInput.value = '';
        }
    } else {
        if (imgUrlInput) imgUrlInput.value = '';
        if (imgPreviewWrap) imgPreviewWrap.style.display = 'none';
    }

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
    const newPrice = parseFloat(document.getElementById('edit-plan-price').value);
    const newROI = document.getElementById('edit-plan-roi').value.trim() || '2.5% Flat';
    const imgUrlVal = document.getElementById('edit-plan-image-url').value.trim();
    const newImg = _editPlanImageBase64 || imgUrlVal || '';

    if (!newName || isNaN(newPrice) || newPrice <= 0) {
        alert('Please enter a valid Plan Name and Price.');
        return;
    }

    let customPlans = JSON.parse(localStorage.getItem('nova_custom_plans') || '[]');
    const customIdx = customPlans.findIndex(p => p.name === origName);

    if (customIdx !== -1) {
        customPlans[customIdx] = {
            name: newName,
            price: newPrice,
            roi: newROI,
            img: newImg,
            duration: '24 Hours'
        };
        localStorage.setItem('nova_custom_plans', JSON.stringify(customPlans));
    } else {
        let editedPlans = JSON.parse(localStorage.getItem('nova_edited_plans') || '{}');
        editedPlans[origName] = {
            name: newName,
            price: newPrice,
            roi: newROI,
            img: newImg,
            duration: '24 Hours'
        };
        localStorage.setItem('nova_edited_plans', JSON.stringify(editedPlans));
    }

    _editPlanImageBase64 = null;
    closeEditPlanModal();
    renderAdminPlans();
    showToast(`Plan updated: ${newName}`);
}

function adminCreatePlan() {
    const nameEl = document.getElementById('admin-plan-name');
    const priceEl = document.getElementById('admin-plan-price');
    const imgUrlEl = document.getElementById('admin-plan-image-url');
    
    if (!nameEl || !priceEl || !nameEl.value.trim() || !priceEl.value.trim()) {
        alert("Please enter both Plan Name and Price.");
        return;
    }

    const imgVal = _createPlanImageBase64 || (imgUrlEl ? imgUrlEl.value.trim() : '');
    
    const newPlan = {
        name: nameEl.value.trim(),
        price: parseFloat(priceEl.value),
        img: imgVal,
        roi: '2.5% Flat',
        duration: '24 Hours'
    };
    
    let customPlans = JSON.parse(localStorage.getItem('nova_custom_plans') || '[]');
    customPlans.push(newPlan);
    localStorage.setItem('nova_custom_plans', JSON.stringify(customPlans));
    
    // Reset form
    nameEl.value = '';
    priceEl.value = '';
    if (imgUrlEl) imgUrlEl.value = '';
    _createPlanImageBase64 = null;
    document.getElementById('admin-plan-image-file').value = '';
    document.getElementById('create-plan-img-preview-wrap').style.display = 'none';
    
    renderAdminPlans();
    showToast(`Created plan: ${newPlan.name} ($${newPlan.price})`);
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
        const userId = parseInt(id);
        let customUsers = JSON.parse(localStorage.getItem('nova_custom_added_users') || '[]');
        const cIdx = customUsers.findIndex(u => u.id === userId);
        if (cIdx > -1) {
            customUsers[cIdx].name = name;
            customUsers[cIdx].email = email;
            customUsers[cIdx].role = role;
            customUsers[cIdx].status = status;
            localStorage.setItem('nova_custom_added_users', JSON.stringify(customUsers));
            showToast('User details updated!');
        } else {
            try {
                const result = await adminRequest('/admin/users/profile', {
                    method: 'POST',
                    body: JSON.stringify({
                        userId,
                        name,
                        email,
                        password: document.getElementById('user-mgmt-password').value
                    })
                });
                showToast(result.message || 'User details updated!');
            } catch (error) {
                showToast(error.message || 'Unable to update user details.');
                return;
            }
        }
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

function viewReferredMembers(userId, name, refCode) {
    document.getElementById('ref-modal-title').textContent = `Members Referred by ${name}`;
    const listContainer = document.getElementById('ref-members-list-container');
    if (!listContainer) return;

    // Filter globalUsersList for users whose referred_by matches this user's ID
    const referred = globalUsersList.filter(u => u.referred_by === userId);
    
    if (referred.length === 0) {
        listContainer.innerHTML = `<p style="text-align:center; color:#94a3b8; font-size:0.85rem; padding: 1.5rem 0;">No members referred yet (Code: ${refCode || 'N/A'}).</p>`;
    } else {
        listContainer.innerHTML = referred.map(u => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:0.75rem 0.5rem; border-bottom:1px solid #1e2538;">
                <div>
                    <div style="font-weight:600; color:#f8fafc; font-size:0.85rem;">${u.name}</div>
                    <div style="font-size:0.75rem; color:#94a3b8;">${u.email}</div>
                </div>
                <div style="font-size:0.75rem; background-color:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid rgba(59,130,246,0.3); padding:0.2rem 0.5rem; border-radius:4px;">
                    Balance: ${formatUSD(u.balance)}
                </div>
            </div>
        `).join('');
    }

    document.getElementById('referred-members-modal').classList.add('active');
}

function closeReferredMembersModal() {
    document.getElementById('referred-members-modal').classList.remove('active');
}


// TRON Deposit Address Management
let globalTronAddress = 'TQdJg7h5P6r8xkLyGk9Y8yq8eL5t3mZ6tX';

async function fetchAdminTronAddress() {
    try {
        const res = await fetch('/api/settings/tron-address');
        const data = await res.json();
        if (data.address) {
            globalTronAddress = data.address;
            const previewEl = document.getElementById('admin-tron-address-preview');
            const displayEl = document.getElementById('tron-address-current-display');
            if (previewEl) previewEl.innerText = globalTronAddress;
            if (displayEl) displayEl.value = globalTronAddress;
        }
    } catch (err) {
        console.error('Failed to fetch TRON address:', err);
    }
}

function copyAdminTronAddress() {
    navigator.clipboard.writeText(globalTronAddress);
    showToast('TRON Deposit Address copied!');
}

function copyTronAddress() {
    navigator.clipboard.writeText(globalTronAddress);
    showToast('TRON Deposit Address copied!');
}

function openTronAddressModal() {
    const modal = document.getElementById('tron-address-modal');
    const displayEl = document.getElementById('tron-address-current-display');
    const inputEl = document.getElementById('tron-address-new-input');
    
    if (displayEl) displayEl.value = globalTronAddress;
    if (inputEl) inputEl.value = '';
    if (modal) modal.classList.add('active');
}

function closeTronAddressModal() {
    const modal = document.getElementById('tron-address-modal');
    if (modal) modal.classList.remove('active');
}

async function saveTronAddress() {
    const inputEl = document.getElementById('tron-address-new-input');
    if (!inputEl) return;
    const newAddress = inputEl.value.trim();
    if (!newAddress) {
        alert('Please enter a valid TRON address.');
        return;
    }

    const token = localStorage.getItem('nova_token');
    try {
        const response = await fetch('/api/admin/settings/tron-address', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ address: newAddress })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Failed to update address');

        showToast('TRON Deposit Address updated successfully!');
        closeTronAddressModal();
        await fetchAdminTronAddress();
    } catch (err) {
        showToast(err.message);
    }
}
