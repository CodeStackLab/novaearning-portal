// Administrator Dashboard Controller for NOVA Portal

const API_BASE = '/api';
let activeEditUserId = null;
let activeReplyTicketId = null;
let globalUsersList = [];
let globalDepositsList = [];
let globalPayoutsList = [];
let globalAuditLog = [];

function escapeAdminUi(value) { const node = document.createElement('div'); node.textContent = String(value ?? ''); return node.innerHTML; }
function escapeUi(value) { return escapeAdminUi(value); }

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

        // Update mobile bottom navigation links
        const mobileNavItems = document.querySelectorAll('.mobile-nav-item[data-tab]');
        mobileNavItems.forEach(item => {
            if (item.getAttribute('data-tab') === tabId) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        // Set hash link URL quietly
        window.history.pushState(null, null, `#${tabId}`);
        window.scrollTo({ top: 0, behavior: 'smooth' });
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
            const cronStatus = document.getElementById('admin-cron-status');
            const cronLastRun = document.getElementById('admin-cron-last-run');
            if (cronStatus) { cronStatus.textContent = stats.cronHealthy ? 'Healthy' : 'Needs attention'; cronStatus.style.color = stats.cronHealthy ? '#51bd91' : '#f59e0b'; }
            if (cronLastRun) cronLastRun.textContent = stats.cronLastRun ? ` · Last run (UTC): ${stats.cronLastRun}` : ' · No run recorded yet';
        } else if (tabId === 'users') {
            const users = await adminRequest('/admin/users');
            globalUsersList = users;
            renderUsersTable(users);
        } else if (tabId === 'deposits') {
            const deposits = await adminRequest('/admin/deposits');
            globalDepositsList = Array.isArray(deposits) ? deposits : [];
            renderDepositsTable(deposits);
        } else if (tabId === 'payouts') {
            const payouts = await adminRequest('/admin/payouts');
            globalPayoutsList = Array.isArray(payouts) ? payouts : [];
            renderPayoutsTable(payouts);
        } else if (tabId === 'tickets') {
            const tickets = await adminRequest('/admin/tickets');
            renderTicketsTable(tickets);
        } else if (tabId === 'commissions') {
            const commissions = await adminRequest('/admin/commissions');
            renderCommissionsTable(commissions);
            await loadTransactionLimits();
            await loadReferralPercentages();
        } else if (tabId === 'investments') {
            await loadAdminInvestments();
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
        const passwordInput = document.getElementById('smtp-password');
        passwordInput.value = smtp.passwordConfigured ? '••••••••••••' : '';
        passwordInput.dataset.savedPassword = smtp.passwordConfigured ? 'true' : 'false';
        passwordInput.type = 'password';
        const passwordIcon = document.getElementById('smtp-password-icon');
        if (passwordIcon) passwordIcon.textContent = 'visibility';
        document.getElementById('smtp-from-email').value = smtp.fromEmail || '';
        document.getElementById('smtp-from-name').value = smtp.fromName || 'NOVA';
        const configured = Boolean(smtp.host && smtp.fromEmail && smtp.passwordConfigured);
        if (status) {
            status.textContent = configured ? 'Configured' : 'Setup required';
            status.classList.toggle('configured', configured);
        }
        const help = document.getElementById('smtp-password-help');
        if (help) help.textContent = smtp.passwordConfigured
            ? 'Password saved securely. Type a new password only when you want to replace it.'
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
        password: getSmtpPasswordForRequest(),
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
        await testSmtpSettings();
    } catch (error) {
        showToast(error.message || 'Unable to save SMTP configuration');
    } finally {
        if (button) {
            button.disabled = false;
            button.classList.remove('is-loading');
        }
    }
}

function applyIonosSmtpPreset() {
    const username = document.getElementById('smtp-username');
    document.getElementById('smtp-host').value = 'smtp.ionos.co.uk';
    document.getElementById('smtp-port').value = '587';
    document.getElementById('smtp-encryption').value = 'tls';
    if (username && !username.value.trim()) username.value = document.getElementById('smtp-from-email').value.trim();
    const resultBox = document.getElementById('smtp-test-result');
    if (resultBox) {
        resultBox.className = 'smtp-test-result testing';
        resultBox.textContent = 'IONOS preset applied. Enter the mailbox password, then save; authentication will be tested automatically.';
    }
}

function getSmtpFormPayload() {
    return {
        host: document.getElementById('smtp-host').value.trim(),
        port: Number(document.getElementById('smtp-port').value),
        encryption: document.getElementById('smtp-encryption').value,
        username: document.getElementById('smtp-username').value.trim(),
        password: getSmtpPasswordForRequest(),
        fromEmail: document.getElementById('smtp-from-email').value.trim(),
        fromName: document.getElementById('smtp-from-name').value.trim()
    };
}

function getSmtpPasswordForRequest() {
    const input = document.getElementById('smtp-password');
    if (!input || input.dataset.savedPassword === 'true') return '';
    return input.value;
}

function prepareSmtpPasswordReplacement() {
    const input = document.getElementById('smtp-password');
    if (input && input.dataset.savedPassword === 'true') {
        input.value = '';
        input.dataset.savedPassword = 'false';
    }
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
    if (input.dataset.savedPassword === 'true') {
        showToast('Saved SMTP password is encrypted and cannot be displayed. Type a new password to replace it.');
        return;
    }
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
    const shouldOpenTronModal = hash === 'tron-address-modal';
    const activeTab = shouldOpenTronModal ? 'overview' : (hash || 'overview');
    switchTab(activeTab);
    fetchAdminTronAddress();

    const changeTronAddressButton = document.getElementById('change-tron-address-btn');
    const closeTronAddressButton = document.getElementById('close-tron-address-modal-btn');
    const tronAddressModal = document.getElementById('tron-address-modal');
    changeTronAddressButton?.addEventListener('click', (event) => {
        event.preventDefault();
        openTronAddressModal();
        window.history.replaceState(null, '', '/admin/#tron-address-modal');
    });
    closeTronAddressButton?.addEventListener('click', (event) => {
        event.preventDefault();
        closeTronAddressModal();
    });
    tronAddressModal?.addEventListener('click', (event) => {
        if (event.target === tronAddressModal) closeTronAddressModal();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && tronAddressModal?.classList.contains('active')) closeTronAddressModal();
    });
    if (shouldOpenTronModal) {
        openTronAddressModal();
        window.history.replaceState(null, '', '/admin/#tron-address-modal');
    }

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
        const adminMobileDrawerTrigger = document.getElementById('admin-mobile-drawer-trigger');
        if (adminMobileDrawerTrigger) {
            adminMobileDrawerTrigger.addEventListener('click', toggleSidebar);
        }
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

    let allUsers = [...serverUsers];

    // Pre-calculate referral counts dynamically based on the current list of users
    allUsers = allUsers.map(user => {
        const refCount = allUsers.filter(u => Number(u.referred_by) === Number(user.id)).length;
        return {
            ...user,
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
    } else if (filterVal === 'hold') {
        allUsers = allUsers.filter(u => u.status === 'Hold');
    } else if (filterVal === 'under-review') {
        allUsers = allUsers.filter(u => u.status === 'Under Review');
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

    if (allUsers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:#94a3b8;">No users match the selected filters.</td></tr>';
        return;
    }

    tbody.innerHTML = allUsers.map(user => {
        const status = user.status || 'Active';
        
        let statusColor = '#10b981'; // Active green
        let statusBg = 'rgba(16, 185, 129, 0.15)';
        if (status === 'Suspended') { statusColor = '#ef4444'; statusBg = 'rgba(239, 68, 68, 0.15)'; }
        if (status === 'Hold') { statusColor = '#f59e0b'; statusBg = 'rgba(245, 158, 11, 0.15)'; }
        if (status === 'Under Review') { statusColor = '#3b82f6'; statusBg = 'rgba(59, 130, 246, 0.15)'; }

        const safeName = escapeUi(user.name || 'User');
        const safeEmail = escapeUi(user.email || '');
        const safeStatus = escapeUi(status);
        const safeInitials = escapeUi(user.name ? user.name.substring(0, 2).toUpperCase() : 'U');
        const numericId = Number(user.id);

        return `
        <tr class="admin-user-row">
            <td class="admin-user-identity" data-label="User" style="cursor: pointer;" title="Click to view referral members" onclick="viewReferredMembers(${numericId})">
                <div style="display:flex; align-items:center; gap:0.75rem;">
                    <div style="width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #3b82f6, #1d4ed8); display: flex; align-items: center; justify-content: center; font-size: 0.8rem; font-weight: 800; color: white;">
                        ${safeInitials}
                    </div>
                    <div>
                        <div style="font-weight:600; color:#f1f5f9; display: flex; align-items: center; gap: 0.25rem;">
                            <span>${safeName}</span>
                            <span class="material-symbols-outlined" style="font-size: 0.85rem; color: #94a3b8;">open_in_new</span>
                        </div>
                        <div style="font-size:0.75rem; color:#94a3b8;">${safeEmail}</div>
                    </div>
                </div>
            </td>
            <td class="admin-user-balance" data-label="Balance" style="font-weight:700; color:#10b981;">${formatUSD(user.balance)}</td>
            <td class="admin-user-referrals" data-label="Referrals">
                <span onclick="viewReferredMembers(${numericId})" style="cursor: pointer; background-color: rgba(59, 130, 246, 0.15); color: #60a5fa; padding: 0.2rem 0.6rem; border-radius: 99px; font-size: 0.75rem; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem;">
                    <span class="material-symbols-outlined" style="font-size: 0.85rem;">group</span>
                    <span>${user.referral_count} referred</span>
                </span>
            </td>
            <td class="admin-user-status" data-label="Account Status"><span style="background-color: ${statusBg}; color: ${statusColor}; padding: 0.2rem 0.6rem; border-radius: 99px; font-size: 0.75rem; font-weight: 600;">${safeStatus}</span></td>
            <td class="admin-user-actions-cell" data-label="Actions">
                <div class="admin-user-actions" style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
                    <button class="admin-user-action" data-action-label="Referrals" aria-label="View referred members" title="View Referred Members" onclick="viewReferredMembers(${numericId})" style="background-color: rgba(251, 191, 36, 0.15); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.4); padding: 0.35rem; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;"><span class="material-symbols-outlined" style="font-size: 1rem;">group</span></button>
                    <button class="admin-user-action" data-action-label="Edit User" aria-label="Edit profile and status" title="Edit Profile/Status" onclick="openEditUserModal(${numericId})" style="background-color: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); padding: 0.35rem; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;"><span class="material-symbols-outlined" style="font-size: 1rem;">edit</span></button>
                    <button class="admin-user-action" data-action-label="Balance" aria-label="Edit user balance" title="Edit Balance" onclick="openEditBalanceModal(${numericId})" style="background-color: #1e2538; border: 1px solid #2e384e; color: #f1f5f9; padding: 0.35rem; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;"><span class="material-symbols-outlined" style="font-size: 1rem;">account_balance_wallet</span></button>
                    <button class="admin-user-action" data-action-label="Send Alert" aria-label="Send alert or ticket" title="Send Alert/Ticket" onclick="openSendAlertModal(${numericId})" style="background-color: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.4); padding: 0.35rem; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;"><span class="material-symbols-outlined" style="font-size: 1rem;">mark_email_unread</span></button>
                    <button class="admin-user-action" data-action-label="Delete" aria-label="Delete user" title="Delete User" onclick="adminDeleteUser(${numericId})" style="background-color: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); padding: 0.35rem; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;"><span class="material-symbols-outlined" style="font-size: 1rem;">delete</span></button>
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

function triggerUsersFilter() {
    renderUsersTable(globalUsersList);
}

async function loadTransactionLimits() {
    try {
        const limits = await adminRequest('/admin/settings/transaction-limits');
        document.getElementById('minimum-deposit-setting').value = Number(limits.minimumDeposit || 100);
        document.getElementById('minimum-withdrawal-setting').value = Number(limits.minimumWithdrawal || 50);
    } catch (error) {
        showToast(error.message || 'Unable to load transaction limits.');
    }
}

async function saveTransactionLimits(event) {
    event.preventDefault();
    const button = document.getElementById('transaction-limits-save-btn');
    const payload = {
        minimumDeposit: Number(document.getElementById('minimum-deposit-setting').value),
        minimumWithdrawal: Number(document.getElementById('minimum-withdrawal-setting').value)
    };
    if (Object.values(payload).some(value => !Number.isFinite(value) || value < 1 || value > 1000000)) {
        showToast('Enter transaction minimums between $1 and $1,000,000.');
        return;
    }
    if (button) button.disabled = true;
    try {
        const result = await adminRequest('/admin/settings/transaction-limits', { method:'POST', body:JSON.stringify(payload) });
        showToast(result.message || 'Transaction limits saved.');
    } catch (error) {
        showToast(error.message || 'Unable to save transaction limits.');
    } finally {
        if (button) button.disabled = false;
    }
}

async function loadReferralPercentages() {
    try {
        const settings = await adminRequest('/admin/settings/referrals');
        document.getElementById('ref-first-deposit-pct').value = settings.firstDepositBonusPct;
        document.getElementById('ref-deposit-pct').value = settings.depositCommissionPct;
        document.getElementById('ref-daily-pct').value = settings.dailyCommissionPct;
    } catch (error) {
        showToast(error.message || 'Unable to load referral percentages.');
    }
}

async function saveReferralPercentages(event) {
    event.preventDefault();
    const button = document.getElementById('referral-percentage-save-btn');
    const payload = {
        firstDepositBonusPct: Number(document.getElementById('ref-first-deposit-pct').value),
        depositCommissionPct: Number(document.getElementById('ref-deposit-pct').value),
        dailyCommissionPct: Number(document.getElementById('ref-daily-pct').value)
    };
    if (Object.values(payload).some(value => !Number.isFinite(value) || value < 0 || value > 100)) {
        showToast('Enter percentages between 0 and 100.');
        return;
    }
    if (button) button.disabled = true;
    try {
        const result = await adminRequest('/admin/settings/referrals', { method:'POST', body:JSON.stringify(payload) });
        showToast(result.message || 'Referral percentages saved.');
    } catch (error) {
        showToast(error.message || 'Unable to save referral percentages.');
    } finally {
        if (button) button.disabled = false;
    }
}

function renderCommissionsTable(commissions) {
    const tbody = document.getElementById('admin-commissions-table-body');
    if (!tbody) return;
    if (!Array.isArray(commissions) || commissions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:#64748b;">No referral commissions recorded yet.</td></tr>';
        return;
    }
    tbody.innerHTML = commissions.map(item => {
        const confirmed = item.status === 'Confirmed';
        return `<tr>
            <td>${escapeAdminUi(item.date || '')}</td>
            <td><strong>${escapeAdminUi(item.user_name || 'User')}</strong><small style="display:block;color:#94a3b8;">${escapeAdminUi(item.user_email || '')}</small></td>
            <td>${formatUSD(item.amount)}</td>
            <td>${escapeAdminUi(item.ref || '')}</td>
            <td>${escapeAdminUi(item.status || '')}</td>
            <td>${confirmed ? `<button type="button" class="smtp-test-btn" onclick="revokeReferralCommission(${Number(item.id)}, this)">Revoke</button>` : '<span style="color:#94a3b8;">Processed</span>'}</td>
        </tr>`;
    }).join('');
}

async function revokeReferralCommission(transactionId, button) {
    if (!confirm('Revoke this referral commission and deduct it from the available balance?')) return;
    if (button) button.disabled = true;
    try {
        const result = await adminRequest('/admin/commissions/revoke', { method:'POST', body:JSON.stringify({ transactionId }) });
        showToast(result.message || 'Commission revoked.');
        await fetchActiveTabDetails('commissions');
    } catch (error) {
        showToast(error.message || 'Unable to revoke commission.');
        if (button) button.disabled = false;
    }
}

function renderDepositsTable(deposits) {
    const tbody = document.getElementById('admin-deposits-table-body');
    if (!tbody) return;

    if (!Array.isArray(deposits)) deposits = [];

    let pendingCount = deposits.filter(d => d && d.status === 'Pending').length;
    if (pendingCount > 0 && !window.hasShownPendingDepositsToast) {
        window.hasShownPendingDepositsToast = true;
        setTimeout(() => {
            if (typeof showToast === 'function') showToast(`You have ${pendingCount} pending deposit(s) awaiting review!`);
        }, 1500);
    }

    const query = document.getElementById('deposit-search-input')?.value.toLowerCase().trim() || '';
    const statusFilter = document.getElementById('deposit-status-filter')?.value || 'all';
    const filteredDeposits = deposits.filter(dep => {
        if (!dep) return false;
        const normalizedStatus = String(dep.status || 'Pending').toLowerCase();
        const statusMatches = statusFilter === 'all'
            || (statusFilter === 'rejected' ? ['failed', 'rejected'].includes(normalizedStatus) : normalizedStatus === statusFilter);
        const searchable = [dep.user_name, dep.user_email, dep.txn_id, dep.id, dep.amount].join(' ').toLowerCase();
        return statusMatches && (!query || searchable.includes(query));
    });
    const count = document.getElementById('deposit-filter-count');
    if (count) count.textContent = `${filteredDeposits.length} of ${deposits.length}`;

    if (filteredDeposits.length === 0) {
        tbody.innerHTML = `<tr class="admin-deposits-empty"><td colspan="7" style="text-align:center; padding: 2rem; color:#64748b; font-size: 0.9rem;"><span class="material-symbols-outlined" style="display:block; font-size: 2rem; margin-bottom: 0.5rem; color: #475569;">inbox</span>No deposits match your search or filter.</td></tr>`;
        return;
    }

    tbody.innerHTML = filteredDeposits.map(dep => {
        if (!dep) return '';
        const depId = dep.id || 0;
        const depStatus = dep.status || 'Pending';
        const rawAmount = parseFloat(dep.amount) || 0;
        const formattedAmount = rawAmount.toFixed(2);
        const userName = escapeUi(dep.user_name || dep.user_email || ('User #' + (dep.user_id || '')));
        const txnId = escapeUi(dep.txn_id || 'N/A');
        const screenshotPath = dep.screenshot_path ? escapeUi(dep.screenshot_path) : '';
        const depDate = escapeUi(dep.date || '');

        let actionCell = `<button type="button" class="deposit-action-btn revise" onclick="reviseDeposit(${Number(depId)}, this)"><span class="material-symbols-outlined">history</span>Revise</button>`;
        if (depStatus === 'Pending') {
            actionCell = `
                <div class="deposit-action-group">
                    <button type="button" class="deposit-action-btn approve" onclick="verifyDeposit(${Number(depId)}, 'Approve', this)">Approve</button>
                    <button type="button" class="deposit-action-btn reject" onclick="verifyDeposit(${Number(depId)}, 'Reject', this)">Reject</button>
                </div>
            `;
        }

        return `
            <tr class="admin-deposit-row">
                <td data-label="Date" style="white-space:nowrap;">${depDate}</td>
                <td data-label="User" style="font-weight:600; color:#f1f5f9;">${userName}</td>
                <td data-label="Amount" style="font-weight:700; color:#3b82f6;">$${formattedAmount}</td>
                <td data-label="Deposit ID" style="font-family: monospace; white-space: nowrap;">
                    <span>${txnId}</span>
                    <button type="button" onclick="copyDepositReference(${Number(depId)})" style="background: none; border: none; color: #3b82f6; cursor: pointer; display: inline-flex; align-items: center; vertical-align: middle; padding: 0; margin-left: 0.35rem;" title="Copy Transaction ID">
                        <span class="material-symbols-outlined" style="font-size: 13px;">content_copy</span>
                    </button>
                </td>
                <td data-label="Receipt">
                    ${screenshotPath ? `<a href="${screenshotPath}" target="_blank" style="color: #3b82f6; text-decoration: underline; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem;"><span class="material-symbols-outlined" style="font-size: 1rem;">image</span>View Screenshot</a>` : `<span style="color: #64748b; font-size: 0.8rem;">No screenshot</span>`}
                </td>
                <td data-label="Status"><span class="status-badge-lbl ${depStatus.toLowerCase()}">${escapeUi(depStatus === 'Failed' ? 'Rejected' : depStatus)}</span></td>
                <td data-label="Actions">${actionCell}</td>
            </tr>
        `;
    }).join('');
}

function triggerDepositsFilter() {
    renderDepositsTable(globalDepositsList);
}

function copyDepositReference(depositId) {
    const deposit = globalDepositsList.find(item => Number(item.id) === Number(depositId));
    if (deposit?.txn_id) copyToClipboard(String(deposit.txn_id));
}

function openManualDepositModal() {
    const userSelect = document.getElementById('manual-dep-user-select');
    const planSelect = document.getElementById('manual-dep-plan-select');
    const amtInput = document.getElementById('manual-dep-amount');

    if (amtInput) amtInput.value = '';

    if (userSelect && Array.isArray(globalUsersList)) {
        userSelect.innerHTML = globalUsersList.map(u => 
            `<option value="${u.id}">${escapeUi(u.name || u.email)} (ID #${u.id} - ${formatUSD(u.balance)})</option>`
        ).join('');
    }

    if (planSelect && Array.isArray(allPlans)) {
        planSelect.innerHTML = `<option value="">-- None (Add to Wallet Balance Only) --</option>` + 
            allPlans.map(p => `<option value="${escapeUi(p.name)}">${escapeUi(p.name)} ($${Number(p.price).toFixed(2)})</option>`).join('');
    }

    const modal = document.getElementById('manual-deposit-modal');
    if (modal) modal.classList.add('active');
}

function closeManualDepositModal() {
    const modal = document.getElementById('manual-deposit-modal');
    if (modal) modal.classList.remove('active');
}

async function submitManualDeposit() {
    const userSelect = document.getElementById('manual-dep-user-select');
    const amtInput = document.getElementById('manual-dep-amount');
    const planSelect = document.getElementById('manual-dep-plan-select');

    const userId = userSelect ? parseInt(userSelect.value) : 0;
    const amount = amtInput ? parseFloat(amtInput.value) : 0;
    const planName = planSelect ? planSelect.value : '';

    if (!userId || isNaN(amount) || amount <= 0) {
        alert('Please select a client and enter a valid positive amount.');
        return;
    }

    try {
        const result = await adminRequest('/admin/deposits/manual-create', {
            method: 'POST',
            body: JSON.stringify({ userId, amount, planName })
        });
        closeManualDepositModal();
        await fetchAdminDashboardData();
        showToast(result.message || 'Manual deposit created successfully!');
    } catch (err) {
        alert(err.message || 'Failed to submit manual deposit');
    }
}

function renderPayoutsTable(payouts) {
    const tbody = document.getElementById('admin-payouts-table-body');
    if (!tbody) return;
    if (!Array.isArray(payouts)) payouts = [];

    if (payouts.length === 0) {
        tbody.innerHTML = `<tr class="admin-payouts-empty"><td colspan="7" style="text-align:center; padding:2rem; color:#64748b;"><span class="material-symbols-outlined" style="display:block;font-size:2rem;margin-bottom:.5rem;">payments</span>No withdrawal requests found.</td></tr>`;
        return;
    }

    tbody.innerHTML = payouts.map(po => {
        let actionCell = `<span style="color:#64748b; font-size:0.8rem;">Processed</span>`;
        if (po.status === 'Pending') {
            actionCell = `
                <button type="button" class="payout-confirm-btn" onclick="verifyPayout(${Number(po.id)}, this)">Confirm Payout</button>
            `;
        }

        const payoutId = Number(po.id);
        const walletAddress = String(po.wallet_address || 'Address unavailable');
        const safeWalletAddress = escapeUi(walletAddress);
        const reference = String(po.ref || 'N/A');
        const safeReference = escapeUi(reference);
        const shortReference = escapeUi(reference.length > 16 ? `${reference.substring(0, 16)}…` : reference);
        const copyButton = `
            <button type="button" onclick="copyPayoutWallet(${payoutId})" class="payout-copy-btn">
                <span class="material-symbols-outlined" style="font-size: 0.95rem;">content_copy</span> Copy Address
            </button>
        `;

        return `
            <tr class="admin-payout-row">
                <td data-label="Date">${escapeUi(po.date || '')}</td>
                <td data-label="User" style="font-weight:600; color:#f1f5f9;">${escapeUi(po.user_name || 'User #' + po.user_id)}</td>
                <td data-label="Wallet Address">
                    <div style="display:flex; flex-direction:column; align-items:flex-start; gap:0.15rem;">
                        <span class="payout-wallet-value">${safeWalletAddress}</span>
                        ${copyButton}
                    </div>
                </td>
                <td data-label="Amount" style="font-weight:700; color:#ef4444;">$${Number(po.amount || 0).toFixed(2)}</td>
                <td data-label="Reference" class="deposit-tx-hash" title="${safeReference}">${shortReference}</td>
                <td data-label="Status"><span class="status-badge-lbl ${escapeUi(String(po.status || '').toLowerCase())}">${escapeUi(po.status || '')}</span></td>
                <td data-label="Action">${actionCell}</td>
            </tr>
        `;
    }).join('');
}

function copyPayoutWallet(payoutId) {
    const payout = globalPayoutsList.find(item => Number(item.id) === Number(payoutId));
    if (payout?.wallet_address) copyToClipboard(String(payout.wallet_address), 'Wallet address copied!');
    else showToast('Wallet address is unavailable.');
}

let activeChatUserId = null;
let activeChatUserTickets = [];
let allTicketsData = [];
let adminChatUserGroups = {};
let adminChatFilter = 'Open';
let adminChatPage = 1;
const adminChatPageSize = 8;

function renderTicketsTable(tickets) {
    allTicketsData = tickets;
    const usersListContainer = document.getElementById('admin-chat-users-list');
    if (!usersListContainer) return;

    if (tickets.length === 0) {
        adminChatUserGroups = {};
        renderAdminConversationList();
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

    adminChatUserGroups = userGroups;
    renderAdminConversationList();

    // If there is an active selected chat user, refresh their chat box too.
    if (activeChatUserId !== null && userGroups[activeChatUserId]) {
        selectAdminChatUser(activeChatUserId, false, false);
    }
}

function renderAdminConversationList() {
    const usersListContainer = document.getElementById('admin-chat-users-list');
    const pagination = document.getElementById('admin-chat-pagination');
    if (!usersListContainer) return;
    const query = document.getElementById('admin-chat-user-search')?.value.toLowerCase().trim() || '';
    const groupsArray = Object.values(adminChatUserGroups)
        .filter(group => adminChatFilter === 'All' || group.status === adminChatFilter)
        .filter(group => !query || `${group.userName} ${group.userEmail}`.toLowerCase().includes(query))
        .sort((a, b) => b.latestDate - a.latestDate);
    const totalPages = Math.max(1, Math.ceil(groupsArray.length / adminChatPageSize));
    adminChatPage = Math.min(Math.max(1, adminChatPage), totalPages);
    const pageGroups = groupsArray.slice((adminChatPage - 1) * adminChatPageSize, adminChatPage * adminChatPageSize);

    if (pageGroups.length === 0) {
        usersListContainer.innerHTML = `<div class="admin-conversation-empty"><span class="material-symbols-outlined">forum</span><strong>No ${adminChatFilter === 'All' ? '' : adminChatFilter.toLowerCase()} conversations</strong><small>Try another filter or search.</small></div>`;
    } else {
        usersListContainer.innerHTML = pageGroups.map(g => {
            const isCurrent = Number(activeChatUserId) === Number(g.userId);
            return `
                <button type="button" class="admin-conversation-item ${isCurrent ? 'selected' : ''}" onclick="selectAdminChatUser(${Number(g.userId)})">
                    <span class="admin-conversation-avatar">${escapeUi((g.userName || 'U').substring(0, 2).toUpperCase())}</span>
                    <span class="admin-conversation-details">
                        <span class="admin-conversation-name">${escapeUi(g.userName)}</span>
                        <span class="admin-conversation-email">${escapeUi(g.userEmail)}</span>
                    </span>
                    <span class="admin-conversation-status ${g.status.toLowerCase()}">${escapeUi(g.status === 'Open' ? 'Active' : 'Closed')}</span>
                </button>`;
        }).join('');
    }

    if (pagination) {
        pagination.innerHTML = groupsArray.length > adminChatPageSize ? `
            <button type="button" onclick="changeAdminConversationPage(-1)" ${adminChatPage === 1 ? 'disabled' : ''} aria-label="Previous page"><span class="material-symbols-outlined">chevron_left</span></button>
            <span>Page ${adminChatPage} of ${totalPages}</span>
            <button type="button" onclick="changeAdminConversationPage(1)" ${adminChatPage === totalPages ? 'disabled' : ''} aria-label="Next page"><span class="material-symbols-outlined">chevron_right</span></button>` : `<span>${groupsArray.length} conversation${groupsArray.length === 1 ? '' : 's'}</span>`;
    }
}

function setAdminConversationFilter(filter, button) {
    adminChatFilter = filter;
    adminChatPage = 1;
    document.querySelectorAll('.admin-conversation-filters button').forEach(item => item.classList.toggle('active', item === button));
    renderAdminConversationList();
}

function filterAdminConversations() {
    adminChatPage = 1;
    renderAdminConversationList();
}

function changeAdminConversationPage(direction) {
    adminChatPage += direction;
    renderAdminConversationList();
}

function closeAdminMobileChat() {
    document.querySelector('.admin-support-layout')?.classList.remove('mobile-chat-open');
}

// Edit balance Modal handlers
let activeEditUserCurrentBalance = 0;

function openEditBalanceModal(userId) {
    const user = findManagedUser(userId);
    if (!user) { showToast('User details are no longer available.'); return; }
    const userName = user.name || user.email;
    const currentBalance = Number(user.balance) || 0;
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

    try {
        const result = await adminRequest('/admin/users/balance', { method:'POST', body:JSON.stringify({ userId:activeEditUserId, newBalance:finalBalance }) });
        showToast(result.message || `User balance updated to ${formatUSD(finalBalance)}`);
    } catch (error) { alert(error.message); return; }
    closeEditBalanceModal();
    
    // Refresh the table
    await fetchActiveTabDetails('users');
}

// Verify Deposit approvals
async function verifyDeposit(depositId, action, button = null) {
    const originalLabel = button?.textContent;
    if (button) {
        button.disabled = true;
        button.textContent = action === 'Approve' ? 'Approving…' : 'Rejecting…';
    }
    try {
        const result = await adminRequest('/admin/deposits/verify', {
            method: 'POST',
            body: JSON.stringify({ depositId, action })
        });

        showToast(result.message || `Deposit ${action === 'Approve' ? 'Approved' : 'Rejected'}!`);
        await fetchActiveTabDetails('deposits');
        await fetchActiveTabDetails('overview');
    } catch (e) {
        alert(e.message || 'Verification action failed');
        if (button) {
            button.disabled = false;
            button.textContent = originalLabel;
        }
    }
}

async function reviseDeposit(depositId, button = null) {
    const deposit = globalDepositsList.find(item => Number(item.id) === Number(depositId));
    if (!deposit) { showToast('Deposit details are no longer available.'); return; }
    const status = deposit.status === 'Failed' ? 'Rejected' : deposit.status;
    const warning = status === 'Confirmed'
        ? 'This will reopen the deposit and roll back its credited amount. Continue?'
        : 'Reopen this rejected deposit for admin review?';
    if (!confirm(warning)) return;
    const originalLabel = button?.innerHTML;
    if (button) { button.disabled = true; button.textContent = 'Reopening…'; }
    try {
        const result = await adminRequest('/admin/deposits/revise', {
            method: 'POST',
            body: JSON.stringify({ depositId })
        });
        showToast(result.message || 'Deposit reopened for review.');
        await fetchActiveTabDetails('deposits');
        await fetchActiveTabDetails('overview');
    } catch (error) {
        alert(error.message || 'Unable to revise this deposit.');
        if (button) { button.disabled = false; button.innerHTML = originalLabel; }
    }
}

// Verify Payout approvals
async function verifyPayout(transactionId, button = null) {
    if (!confirm('Confirm that this payout has been completed?')) return;
    const originalLabel = button?.textContent;
    if (button) { button.disabled = true; button.textContent = 'Confirming…'; }
    try {
        const result = await adminRequest('/admin/payouts/verify', {
            method: 'POST',
            body: JSON.stringify({ transactionId })
        });

        showToast(result.message || 'Payout confirmed successfully!');
        await fetchActiveTabDetails('payouts');
        await fetchActiveTabDetails('overview');
    } catch (e) {
        alert(e.message || 'Payout confirm failed');
        if (button) { button.disabled = false; button.textContent = originalLabel; }
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

function selectAdminChatUser(userId, shouldScroll = true, openMobile = true) {
    const selectedGroup = adminChatUserGroups[userId];
    if (!selectedGroup) { showToast('Conversation is no longer available.'); return; }
    const userName = selectedGroup.userName;
    const userEmail = selectedGroup.userEmail;
    activeChatUserId = userId;
    if (openMobile) document.querySelector('.admin-support-layout')?.classList.add('mobile-chat-open');
    renderAdminConversationList();

    document.getElementById('admin-chat-user-name').textContent = userName;
    document.getElementById('admin-chat-user-email').textContent = userEmail;

    // Show input and toggle containers
    document.getElementById('admin-chat-input-box').style.display = 'flex';
    document.getElementById('admin-chat-status-toggle-container').style.display = 'flex';

    // Filter tickets for this user
    const userTickets = allTicketsData.filter(t => Number(t.user_id) === Number(userId));
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
            const imagePath = escapeUi(ticket.image_path);
            userImageHtml = `<a href="${imagePath}" target="_blank" rel="noopener"><img src="${imagePath}" alt="User attachment" style="max-width:100%;border-radius:8px;margin-top:.5rem;display:block;"></a>`;
        }

        let html = '';
        if (ticket.message) {
            html += `
                <div class="chat-bubble-wrapper user" style="display: flex; justify-content: flex-end; margin-bottom: 0.5rem; width: 100%;">
                    <div class="chat-bubble" style="max-width: 70%; padding: 0.75rem 1rem; border-radius: 12px; font-size: 0.9rem; line-height: 1.4; word-break: break-word; background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; border-bottom-right-radius: 2px;">
                        ${escapeHTML(ticket.message)}
                        ${userImageHtml}
                        <span style="font-size: 0.65rem; color: rgba(255, 255, 255, 0.7); margin-top: 0.25rem; display: block; text-align: right;">${escapeUi(ticket.date || '')}</span>
                    </div>
                </div>
            `;
        } else if (userImageHtml) {
            html += `
                <div class="chat-bubble-wrapper user" style="display: flex; justify-content: flex-end; margin-bottom: 0.5rem; width: 100%;">
                    <div class="chat-bubble" style="max-width: 70%; padding: 0.5rem; border-radius: 12px; font-size: 0.9rem; line-height: 1.4; word-break: break-word; background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; border-bottom-right-radius: 2px;">
                        ${userImageHtml}
                        <span style="font-size: 0.65rem; color: rgba(255, 255, 255, 0.7); margin-top: 0.25rem; display: block; text-align: right;">${escapeUi(ticket.date || '')}</span>
                    </div>
                </div>
            `;
        }

        let adminImageHtml = '';
        if (ticket.admin_image_path) {
            const adminImagePath = escapeUi(ticket.admin_image_path);
            adminImageHtml = `<a href="${adminImagePath}" target="_blank" rel="noopener"><img src="${adminImagePath}" alt="Admin attachment" style="max-width:100%;border-radius:8px;margin-top:.5rem;display:block;"></a>`;
        }

        if (ticket.admin_reply) {
            html += `
                <div class="chat-bubble-wrapper support" style="display: flex; justify-content: flex-start; margin-bottom: 0.5rem; width: 100%;">
                    <div class="chat-bubble" style="max-width: 70%; padding: 0.75rem 1rem; border-radius: 12px; font-size: 0.9rem; line-height: 1.4; word-break: break-word; background-color: #171d2c; color: #cbd5e1; border-bottom-left-radius: 2px; border: 1px solid #1e2538;">
                        ${escapeHTML(ticket.admin_reply)}
                        ${adminImageHtml}
                        <span style="font-size: 0.65rem; color: #94a3b8; margin-top: 0.25rem; display: block;">${escapeUi(ticket.date || '')}</span>
                    </div>
                </div>
            `;
        } else if (adminImageHtml) {
            html += `
                <div class="chat-bubble-wrapper support" style="display: flex; justify-content: flex-start; margin-bottom: 0.5rem; width: 100%;">
                    <div class="chat-bubble" style="max-width: 70%; padding: 0.5rem; border-radius: 12px; font-size: 0.9rem; line-height: 1.4; word-break: break-word; background-color: #171d2c; color: #cbd5e1; border-bottom-left-radius: 2px; border: 1px solid #1e2538;">
                        ${adminImageHtml}
                        <span style="font-size: 0.65rem; color: #94a3b8; margin-top: 0.25rem; display: block;">${escapeUi(ticket.date || '')}</span>
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
async function renderAdminPlans() {
    const tbody = document.getElementById('admin-plans-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5">Loading plans…</td></tr>';
    let allPlans;
    try { allPlans = await adminRequest('/admin/plans'); }
    catch (error) { tbody.innerHTML = `<tr><td colspan="5">${escapeAdminUi(error.message)}</td></tr>`; return; }
    allPlans = allPlans.filter(plan => Number(plan.is_active) === 1);
    tbody.innerHTML = allPlans.map(plan => {
        const planImg = plan.img || 'images/amc_theater.png';
        const safeName = plan.name.replace(/'/g, "\\'");
        const roi = Number(plan.roi || 2.5);

        return `
            <tr>
                <td style="font-weight: 700; color: #f8fafc;">
                    <div style="display:flex; align-items:center; gap:0.5rem;">
                        <img src="${planImg}" alt="Poster" style="width:36px; height:50px; object-fit:cover; border-radius:4px; border:1px solid #1e2538; background-color:#0b0e14;">
                        <span>${plan.name}</span>
                    </div>
                </td>
                <td style="font-weight: 700; color: #10b981;">$${Number(plan.price).toFixed(2)}</td>
                <td>${roi.toFixed(2)}%</td>
                <td>${Number(plan.duration_days || 1)} day(s)</td>
                <td style="white-space: nowrap;">
                    <button onclick="openEditPlanModal(${Number(plan.id)}, '${safeName}', ${plan.price}, ${roi}, '${planImg}')" style="background-color: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); padding: 0.35rem 0.85rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; margin-right: 0.4rem;">Edit</button>
                    <button onclick="adminDeletePlan(${Number(plan.id)}, '${safeName}')" style="background-color: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); padding: 0.35rem 0.85rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer;">Delete</button>
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

function openEditPlanModal(id, name, price, roi, currentImg) {
    const origInput = document.getElementById('edit-plan-original-name');
    const nameInput = document.getElementById('edit-plan-name');
    const priceInput = document.getElementById('edit-plan-price');
    const roiInput = document.getElementById('edit-plan-roi');
    const imgUrlInput = document.getElementById('edit-plan-image-url');
    const imgPreview = document.getElementById('edit-plan-img-preview');
    const imgPreviewWrap = document.getElementById('edit-plan-img-preview-wrap');

    if (origInput) origInput.value = id;
    if (nameInput) nameInput.value = name;
    if (priceInput) priceInput.value = price;
    if (roiInput) roiInput.value = roi || 2.5;
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

async function saveEditPlan() {
    const planId = Number(document.getElementById('edit-plan-original-name').value);
    const newName = document.getElementById('edit-plan-name').value.trim();
    const newPrice = parseFloat(document.getElementById('edit-plan-price').value);
    const newROI = parseFloat(document.getElementById('edit-plan-roi').value) || 2.5;
    const imgUrlVal = document.getElementById('edit-plan-image-url').value.trim();
    const newImg = _editPlanImageBase64 || imgUrlVal || '';

    if (!newName || isNaN(newPrice) || newPrice <= 0) {
        alert('Please enter a valid Plan Name and Price.');
        return;
    }

    try {
        const result = await adminRequest('/admin/plans', { method:'POST', body:JSON.stringify({ operation:'update', id:planId, name:newName, price:newPrice, roi:newROI, durationDays:1, image:newImg }) });
        _editPlanImageBase64 = null; closeEditPlanModal(); await renderAdminPlans(); showToast(result.message);
    } catch (error) { alert(error.message); }
}

async function adminCreatePlan() {
    const nameEl = document.getElementById('admin-plan-name');
    const priceEl = document.getElementById('admin-plan-price');
    const roiEl = document.getElementById('admin-plan-roi');
    const imgUrlEl = document.getElementById('admin-plan-image-url');
    
    if (!nameEl || !priceEl || !nameEl.value.trim() || !priceEl.value.trim()) {
        alert("Please enter both Plan Name and Price.");
        return;
    }

    const roiVal = roiEl && roiEl.value.trim() !== '' ? parseFloat(roiEl.value) : 2.5;
    const imgVal = _createPlanImageBase64 || (imgUrlEl ? imgUrlEl.value.trim() : '');
    
    const newPlan = { operation:'create', name:nameEl.value.trim(), price:parseFloat(priceEl.value), image:imgVal, roi:roiVal, durationDays:1 };
    try { await adminRequest('/admin/plans', { method:'POST', body:JSON.stringify(newPlan) }); }
    catch (error) { alert(error.message); return; }
    
    // Reset form
    nameEl.value = '';
    priceEl.value = '';
    if (roiEl) roiEl.value = '2.5';
    if (imgUrlEl) imgUrlEl.value = '';
    _createPlanImageBase64 = null;
    document.getElementById('admin-plan-image-file').value = '';
    document.getElementById('create-plan-img-preview-wrap').style.display = 'none';
    
    await renderAdminPlans();
    showToast(`Created plan: ${newPlan.name} ($${newPlan.price}, ${newPlan.roi}% daily)`);
}

async function adminDeletePlan(id, name) {
    if (!confirm(`Are you sure you want to remove plan "${name}"?`)) return;
    try { const result = await adminRequest('/admin/plans', { method:'POST', body:JSON.stringify({operation:'delete', id}) }); await renderAdminPlans(); showToast(result.message); }
    catch (error) { alert(error.message); }
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

function findManagedUser(id) {
    return globalUsersList.find(user => Number(user.id) === Number(id));
}

function openEditUserModal(id) {
    const user = findManagedUser(id);
    if (!user) { showToast('User details are no longer available. Refreshing list.'); fetchActiveTabDetails('users'); return; }
    document.getElementById('user-mgmt-title').textContent = 'Edit User Profile';
    document.getElementById('user-mgmt-id').value = id;
    document.getElementById('user-mgmt-name').value = user.name || '';
    document.getElementById('user-mgmt-email').value = user.email || '';
    document.getElementById('user-mgmt-password').value = '';
    document.getElementById('user-mgmt-role').value = user.role || 'user';
    document.getElementById('user-mgmt-status').value = user.status || 'Active';
    document.getElementById('user-mgmt-modal').classList.add('active');
}

function closeUserMgmtModal() {
    document.getElementById('user-mgmt-modal').classList.remove('active');
}

async function saveUserMgmt() {
    const id = document.getElementById('user-mgmt-id').value;
    const name = document.getElementById('user-mgmt-name').value.trim();
    const email = document.getElementById('user-mgmt-email').value.trim();
    const status = document.getElementById('user-mgmt-status').value;

    if (!name || !email) {
        alert('Name and Email are required.');
        return;
    }

    const password = document.getElementById('user-mgmt-password').value;
    if ((!id || password) && password.length < 8) {
        alert('Password must be at least 8 characters.');
        return;
    }

    if (!id) {
        try {
            const result = await adminRequest('/admin/users/create', { method:'POST', body:JSON.stringify({ name, email, password }) });
            showToast(result.message);
        } catch (error) { alert(error.message); return; }
    } else {
        const userId = parseInt(id);
        try {
            const result = await adminRequest('/admin/users/profile', { method:'POST', body:JSON.stringify({ userId, name, email, status, password }) });
            showToast(result.message || 'User details updated!');
        } catch (error) { showToast(error.message || 'Unable to update user details.'); return; }
    }

    closeUserMgmtModal();
    // Re-fetch or re-render
    await fetchActiveTabDetails('users');
}

async function adminDeleteUser(id) {
    const user = findManagedUser(id);
    if (!user) { showToast('User details are no longer available.'); return; }
    const name = user.name || `#${id}`;
    if (!confirm(`Are you absolutely sure you want to completely delete user "${name}"? This action cannot be undone.`)) return;
    try {
        const result = await adminRequest('/admin/users/delete', { method:'POST', body:JSON.stringify({ userId:id }) });
        showToast(result.message || `User ${name} has been deleted.`);
        await fetchActiveTabDetails('users');
    } catch (error) {
        alert(error.message || 'Unable to delete this user.');
    }
}

function openSendAlertModal(id) {
    const user = findManagedUser(id);
    if (!user) { showToast('User details are no longer available.'); return; }
    document.getElementById('alert-user-id').value = id;
    document.getElementById('alert-user-info').textContent = `Sending to User: ${user.name || user.email}`;
    document.getElementById('alert-subject').value = '';
    document.getElementById('alert-message').value = '';
    document.getElementById('send-alert-modal').classList.add('active');
}

function closeSendAlertModal() {
    document.getElementById('send-alert-modal').classList.remove('active');
}

async function sendUserAlert() {
    const id = document.getElementById('alert-user-id').value;
    const subject = document.getElementById('alert-subject').value.trim();
    const msg = document.getElementById('alert-message').value.trim();

    if (!subject || !msg) {
        alert("Subject and message are required.");
        return;
    }

    try {
        const result = await adminRequest('/admin/users/alert', { method:'POST', body:JSON.stringify({ userId:Number(id), subject, message:msg }) });
        closeSendAlertModal();
        showToast(result.message || 'Alert delivered to user.');
    } catch (error) {
        alert(error.message || 'Unable to send the alert.');
    }
}

function viewReferredMembers(userId) {
    const user = findManagedUser(userId);
    if (!user) { showToast('User details are no longer available.'); return; }
    document.getElementById('ref-modal-title').textContent = `Members Referred by ${user.name || user.email}`;
    const listContainer = document.getElementById('ref-members-list-container');
    if (!listContainer) return;

    // Filter globalUsersList for users whose referred_by matches this user's ID
    const referred = globalUsersList.filter(u => Number(u.referred_by) === Number(userId));
    
    if (referred.length === 0) {
        listContainer.innerHTML = `<p style="text-align:center; color:#94a3b8; font-size:0.85rem; padding: 1.5rem 0;">No members referred yet (Code: ${escapeUi(user.referral_code || 'N/A')}).</p>`;
    } else {
        listContainer.innerHTML = referred.map(u => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:0.75rem 0.5rem; border-bottom:1px solid #1e2538;">
                <div>
                    <div style="font-weight:600; color:#f8fafc; font-size:0.85rem;">${escapeUi(u.name || 'User')}</div>
                    <div style="font-size:0.75rem; color:#94a3b8;">${escapeUi(u.email || '')}</div>
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

    if (!modal) {
        console.error('TRON address modal element not found!');
        return;
    }

    if (displayEl) displayEl.value = globalTronAddress;
    if (inputEl) inputEl.value = '';
    const resultEl = document.getElementById('tron-address-result');
    if (resultEl) { resultEl.style.display = 'none'; resultEl.textContent = ''; }

    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('active');
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    modal.style.width = '100vw';
    modal.style.height = '100dvh';
    modal.style.minWidth = '100vw';
    modal.style.minHeight = '100vh';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.opacity = '1';
    modal.style.visibility = 'visible';
    modal.style.zIndex = '999999';
    document.body.style.overflow = 'hidden'; // Prevent background scroll
    window.setTimeout(() => inputEl?.focus(), 0);
}

function closeTronAddressModal() {
    const modal = document.getElementById('tron-address-modal');
    if (!modal) return;
    modal.classList.remove('active');
    modal.style.display = 'none';
    modal.style.position = '';
    modal.style.inset = '';
    modal.style.width = '';
    modal.style.height = '';
    modal.style.minWidth = '';
    modal.style.minHeight = '';
    modal.style.alignItems = '';
    modal.style.justifyContent = '';
    modal.style.opacity = '';
    modal.style.visibility = '';
    modal.style.zIndex = '';
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (window.location.hash === '#tron-address-modal') window.history.replaceState(null, '', '/admin/#overview');
    document.getElementById('change-tron-address-btn')?.focus();
}

async function saveTronAddress() {
    const inputEl = document.getElementById('tron-address-new-input');
    const resultEl = document.getElementById('tron-address-result');
    const setResult = (message, success = false) => {
        if (!resultEl) return;
        resultEl.textContent = message;
        resultEl.style.display = 'block';
        resultEl.style.color = success ? '#5bd69a' : '#fb8d99';
    };
    if (!inputEl) return;
    const newAddress = inputEl.value.trim();
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(newAddress)) {
        setResult('Enter a valid 34-character TRON TRC20 address beginning with T.');
        inputEl.focus();
        return;
    }

    const saveButton = document.getElementById('save-tron-address-btn');
    if (saveButton) { saveButton.disabled = true; saveButton.setAttribute('aria-busy', 'true'); }
    setResult('Saving address…', true);

    const token = localStorage.getItem('nova_token');
    if (!token) {
        setResult('Your admin session expired. Please sign in again.');
        if (saveButton) { saveButton.disabled = false; saveButton.removeAttribute('aria-busy'); }
        return;
    }
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

        await fetchAdminTronAddress();
        setResult('Deposit address updated successfully.', true);
        showToast('TRON Deposit Address updated successfully!');
        window.setTimeout(closeTronAddressModal, 700);
    } catch (err) {
        setResult(err.message || 'Unable to update the deposit address.');
        showToast(err.message);
    } finally {
        if (saveButton) { saveButton.disabled = false; saveButton.removeAttribute('aria-busy'); }
    }
}

// ==========================================
// ADMIN CHANGE EMAIL LOGIC
// ==========================================

function closeAdminChangeEmailModal() {
    const modal = document.getElementById('admin-change-email-modal');
    if (!modal) return;
    modal.setAttribute('hidden', '');
    modal.setAttribute('aria-hidden', 'true');
    modal.style.display = '';
}

async function adminSendChangeEmailOtp() {
    const currentPassword = document.getElementById('admin-ce-current-password')?.value?.trim();
    const newEmail = document.getElementById('admin-ce-new-email')?.value?.trim();
    if (!currentPassword || !newEmail) {
        showToast('Please fill in both fields.');
        return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
        showToast('Please enter a valid email address.');
        return;
    }
    try {
        await apiRequest('/admin/settings/change-email-request', {
            method: 'POST',
            body: JSON.stringify({ currentPassword, newEmail })
        });
        // Move to step 2
        const s1 = document.getElementById('admin-email-step-1');
        const s2 = document.getElementById('admin-email-step-2');
        if (s1) s1.style.display = 'none';
        if (s2) s2.style.display = 'block';
        showToast('OTP sent to your new email address!');
    } catch (e) {
        showToast('Error: ' + (e.message || 'Could not send OTP.'));
    }
}

async function adminVerifyChangeEmailOtp() {
    const otp = document.getElementById('admin-change-email-otp')?.value?.trim();
    const newEmail = document.getElementById('admin-ce-new-email')?.value?.trim();
    if (!otp || otp.length < 4) {
        showToast('Please enter the OTP code from your email.');
        return;
    }
    try {
        await apiRequest('/admin/settings/change-email-verify', {
            method: 'POST',
            body: JSON.stringify({ otp, newEmail })
        });
        showToast('Email successfully changed! Reloading...');
        closeAdminChangeEmailModal();
        setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
        showToast('Error: ' + (e.message || 'Invalid OTP.'));
    }
}

/* ==========================================================================
   ADMIN USER INVESTMENTS CONTROL & FINANCIAL OVERVIEW
   ========================================================================== */

let adminInvestmentsData = [];
let adminInvestmentsFilter = 'All';

async function loadAdminInvestments() {
    const tbody = document.getElementById('admin-investments-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:2rem; color:#8897ab;">Loading user investments...</td></tr>';
    try {
        const rows = await adminRequest('/admin/investments');
        adminInvestmentsData = Array.isArray(rows) ? rows : [];
        renderAdminInvestments();
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:2rem; color:#f87171;">Failed to load investments: ${escapeAdminUi(e.message)}</td></tr>`;
    }
}

function filterAdminInvestments(filterName) {
    if (filterName) {
        adminInvestmentsFilter = filterName;
        document.querySelectorAll('.inv-admin-filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-filter') === filterName);
        });
    }
    renderAdminInvestments();
}

function renderAdminInvestments() {
    const tbody = document.getElementById('admin-investments-tbody');
    if (!tbody) return;

    const searchTerm = (document.getElementById('admin-inv-search')?.value || '').toLowerCase().trim();

    let filtered = adminInvestmentsData;
    if (adminInvestmentsFilter !== 'All') {
        if (adminInvestmentsFilter === 'Hold') {
            filtered = filtered.filter(inv => inv.status === 'Hold');
        } else {
            filtered = filtered.filter(inv => inv.status === adminInvestmentsFilter);
        }
    }

    if (searchTerm) {
        filtered = filtered.filter(inv => 
            (inv.name || '').toLowerCase().includes(searchTerm) ||
            (inv.user_name || '').toLowerCase().includes(searchTerm) ||
            (inv.user_email || '').toLowerCase().includes(searchTerm) ||
            String(inv.id || '').includes(searchTerm)
        );
    }

    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:2rem; color:#8897ab;">No user investments found</td></tr>';
        return;
    }

    const dayMs = 86400000;
    tbody.innerHTML = filtered.map(inv => {
        const amount = Number(inv.amount) || 0;
        const roi = Number(inv.daily_profit_pct) || 0;
        const duration = Math.max(1, Number(inv.duration_days) || 1);
        let started = Number(inv.created_at) || Date.parse(inv.start_date || '') || Date.now();
        if (started < 1000000000000) started *= 1000;
        const elapsed = Math.max(0, Date.now() - started);
        const completedCycles = Math.min(duration, Math.floor(elapsed / dayMs));

        let badgeStyle = 'background:rgba(16,185,129,0.15); color:#34d399; border:1px solid rgba(16,185,129,0.3);';
        if (inv.status === 'Hold') badgeStyle = 'background:rgba(245,158,11,0.15); color:#fbbf24; border:1px solid rgba(245,158,11,0.3);';
        else if (inv.status === 'Suspended') badgeStyle = 'background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3);';
        else if (inv.status === 'Completed') badgeStyle = 'background:rgba(56,189,248,0.15); color:#38bdf8; border:1px solid rgba(56,189,248,0.3);';

        const invJson = JSON.stringify(inv).replace(/"/g, '&quot;');

        return `<tr>
            <td style="font-weight:700; color:#94a3b8;">#${inv.id}</td>
            <td>
                <div style="font-weight:600; color:#f8fafc;">${escapeAdminUi(inv.user_name || 'User #' + inv.user_id)}</div>
                <small style="color:#64748b;">${escapeAdminUi(inv.user_email || '')}</small>
                <button type="button" onclick="openUserFinancialOverviewModal(${inv.user_id})" style="display:block; margin-top:2px; background:none; border:none; color:#60a5fa; font-size:0.7rem; cursor:pointer; text-decoration:underline; padding:0;">View Financial Overview</button>
            </td>
            <td>
                <div style="font-weight:600; color:#e2e8f0;">${escapeAdminUi(inv.name)}</div>
                <small style="color:#64748b;">Cycles: ${completedCycles} / ${duration} Days</small>
            </td>
            <td style="font-weight:700; color:#f8fafc;">${formatUSD(amount)}</td>
            <td style="color:#34d399; font-weight:700;">+${roi.toFixed(2)}% / day</td>
            <td><span style="padding:0.25rem 0.6rem; border-radius:99px; font-size:0.72rem; font-weight:700; ${badgeStyle}">${escapeAdminUi(inv.status)}</span></td>
            <td style="font-size:0.78rem; color:#94a3b8;">${escapeAdminUi(inv.start_date || '—')}</td>
            <td style="text-align:right;">
                <div style="display:flex; justify-content:flex-end; gap:0.35rem; flex-wrap:wrap;">
                    ${inv.status === 'Active' ? `
                        <button type="button" onclick="changeAdminInvestmentStatus(${inv.id}, 'Hold')" style="background:rgba(245,158,11,0.15); color:#fbbf24; border:1px solid rgba(245,158,11,0.3); padding:0.3rem 0.65rem; border-radius:6px; font-size:0.72rem; font-weight:600; cursor:pointer;">Hold</button>
                        <button type="button" onclick="changeAdminInvestmentStatus(${inv.id}, 'Suspended')" style="background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3); padding:0.3rem 0.65rem; border-radius:6px; font-size:0.72rem; font-weight:600; cursor:pointer;">Suspend</button>
                    ` : inv.status === 'Hold' || inv.status === 'Suspended' ? `
                        <button type="button" onclick="changeAdminInvestmentStatus(${inv.id}, 'Active')" style="background:rgba(16,185,129,0.15); color:#34d399; border:1px solid rgba(16,185,129,0.3); padding:0.3rem 0.65rem; border-radius:6px; font-size:0.72rem; font-weight:600; cursor:pointer;">Resume</button>
                    ` : ''}
                    <button type="button" onclick="openEditInvestmentModal(${invJson})" style="background:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid rgba(59,130,246,0.3); padding:0.3rem 0.65rem; border-radius:6px; font-size:0.72rem; font-weight:600; cursor:pointer;">Edit</button>
                    <button type="button" onclick="adminDeleteInvestment(${inv.id})" style="background:rgba(239,68,68,0.1); color:#ef4444; border:1px solid rgba(239,68,68,0.25); padding:0.3rem 0.65rem; border-radius:6px; font-size:0.72rem; font-weight:600; cursor:pointer;">Delete</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

async function changeAdminInvestmentStatus(investmentId, newStatus) {
    if (!confirm(`Are you sure you want to change investment #${investmentId} status to "${newStatus}"? This will trigger an email notification to the user.`)) return;
    try {
        const result = await adminRequest('/admin/investments/update-status', {
            method: 'POST',
            body: JSON.stringify({ investmentId, status: newStatus })
        });
        alert(result.message || 'Investment status updated.');
        await loadAdminInvestments();
    } catch (e) {
        alert(e.message || 'Failed to update investment status.');
    }
}

function openEditInvestmentModal(inv) {
    const modal = document.getElementById('edit-investment-modal');
    if (!modal) return;
    document.getElementById('edit-inv-id').value = inv.id;
    document.getElementById('edit-inv-name').value = inv.name || '';
    document.getElementById('edit-inv-amount').value = inv.amount || '';
    document.getElementById('edit-inv-roi').value = inv.daily_profit_pct || '';
    document.getElementById('edit-inv-duration').value = inv.duration_days || 1;
    document.getElementById('edit-inv-status').value = inv.status || 'Active';
    document.getElementById('edit-inv-start-date').value = inv.start_date || '';
    modal.style.display = 'flex';
}

function closeEditInvestmentModal() {
    const modal = document.getElementById('edit-investment-modal');
    if (modal) modal.style.display = 'none';
}

async function submitEditInvestment() {
    const investmentId = document.getElementById('edit-inv-id').value;
    const amount = document.getElementById('edit-inv-amount').value;
    const dailyProfitPct = document.getElementById('edit-inv-roi').value;
    const durationDays = document.getElementById('edit-inv-duration').value;
    const status = document.getElementById('edit-inv-status').value;
    const startDate = document.getElementById('edit-inv-start-date').value;

    try {
        const result = await adminRequest('/admin/investments/edit', {
            method: 'POST',
            body: JSON.stringify({ investmentId, amount, dailyProfitPct, durationDays, status, startDate })
        });
        alert(result.message || 'Investment updated successfully.');
        closeEditInvestmentModal();
        await loadAdminInvestments();
    } catch (e) {
        alert(e.message || 'Failed to update investment.');
    }
}

async function adminDeleteInvestment(investmentId) {
    if (!confirm(`Are you sure you want to permanently delete investment #${investmentId}? An email notification will be dispatched to the user.`)) return;
    try {
        const result = await adminRequest('/admin/investments/delete', {
            method: 'POST',
            body: JSON.stringify({ investmentId })
        });
        alert(result.message || 'Investment deleted.');
        await loadAdminInvestments();
    } catch (e) {
        alert(e.message || 'Failed to delete investment.');
    }
}

async function openUserFinancialOverviewModal(userId) {
    const modal = document.getElementById('user-financial-modal');
    if (!modal) return;
    modal.style.display = 'flex';

    document.getElementById('user-fin-modal-name').textContent = 'Loading user financial overview...';
    document.getElementById('user-fin-modal-email').textContent = '';
    document.getElementById('user-fin-deposited').textContent = '$0.00';
    document.getElementById('user-fin-active').textContent = '$0.00';
    document.getElementById('user-fin-earnings').textContent = '$0.00';
    document.getElementById('user-fin-balance').textContent = '$0.00';
    document.getElementById('user-fin-withdrawn').textContent = '$0.00';
    document.getElementById('user-fin-investments-list').innerHTML = '<div style="color:#718096; padding:1rem; text-align:center;">Loading...</div>';
    document.getElementById('user-fin-tx-list').innerHTML = '<div style="color:#718096; padding:1rem; text-align:center;">Loading...</div>';

    try {
        const data = await adminRequest(`/admin/user-financial-overview?user_id=${userId}`);
        const user = data.user || {};
        document.getElementById('user-fin-modal-name').textContent = `${user.name || 'User'} (ID #${user.id})`;
        document.getElementById('user-fin-modal-email').textContent = `${user.email || ''} · Ref: ${user.referral_code || 'N/A'} · Status: ${user.account_status || 'Active'}`;
        document.getElementById('user-fin-deposited').textContent = formatUSD(data.totalDeposits || 0);
        document.getElementById('user-fin-active').textContent = formatUSD(data.activeCapital || 0);
        document.getElementById('user-fin-earnings').textContent = formatUSD(Number(user.earnings) || 0);
        document.getElementById('user-fin-balance').textContent = formatUSD(Number(user.balance) || 0);
        document.getElementById('user-fin-withdrawn').textContent = formatUSD(data.totalWithdrawals || 0);

        const invs = Array.isArray(data.investments) ? data.investments : [];
        if (!invs.length) {
            document.getElementById('user-fin-investments-list').innerHTML = '<div style="color:#64748b; font-size:0.8rem;">No investments found for this user.</div>';
        } else {
            document.getElementById('user-fin-investments-list').innerHTML = invs.map(inv => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:0.6rem 0.75rem; background:rgba(15,25,43,0.6); border:1px solid rgba(126,156,205,0.12); border-radius:8px; margin-bottom:0.4rem;">
                    <div>
                        <strong style="color:#f1f5fb; font-size:0.82rem;">${escapeAdminUi(inv.name)}</strong>
                        <small style="display:block; color:#64748b; font-size:0.68rem;">Started: ${escapeAdminUi(inv.start_date)} · ROI: +${Number(inv.daily_profit_pct).toFixed(2)}%</small>
                    </div>
                    <div style="text-align:right;">
                        <strong style="color:#34d399; font-size:0.85rem;">${formatUSD(Number(inv.amount))}</strong>
                        <span style="display:block; font-size:0.65rem; color:#94a3b8;">${escapeAdminUi(inv.status)}</span>
                    </div>
                </div>
            `).join('');
        }

        const txs = Array.isArray(data.transactions) ? data.transactions : [];
        if (!txs.length) {
            document.getElementById('user-fin-tx-list').innerHTML = '<div style="color:#64748b; font-size:0.8rem;">No transaction history available.</div>';
        } else {
            document.getElementById('user-fin-tx-list').innerHTML = txs.map(tx => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0.75rem; background:rgba(3,9,18,0.4); border-bottom:1px solid rgba(126,156,205,0.08);">
                    <div>
                        <strong style="color:#e2e8f0; font-size:0.78rem;">${escapeAdminUi(tx.type)}</strong>
                        <small style="display:block; color:#64748b; font-size:0.65rem;">Ref: ${escapeAdminUi(tx.ref)} · ${escapeAdminUi(tx.date)}</small>
                    </div>
                    <div style="text-align:right;">
                        <strong style="color:${tx.type === 'Withdrawal' ? '#fb7185' : '#34d399'}; font-size:0.82rem;">${tx.type === 'Withdrawal' ? '-' : '+'}${formatUSD(Number(tx.amount))}</strong>
                        <span style="display:block; font-size:0.65rem; color:#94a3b8;">${escapeAdminUi(tx.status)}</span>
                    </div>
                </div>
            `).join('');
        }
    } catch (e) {
        document.getElementById('user-fin-modal-name').textContent = 'Error loading user data';
        alert(e.message || 'Unable to load user financial overview.');
    }
}

function closeUserFinancialModal() {
    const modal = document.getElementById('user-financial-modal');
    if (modal) modal.style.display = 'none';
}
