// Client-side Application Logic for CineInvest & TRONINVEST connecting to Node.js Express APIs

const API_BASE = '/api';
let selectedDepositAmount = 100.00;
let transactionLimits = { minimumDeposit: 100, minimumWithdrawal: 50 };

// Copy to Clipboard Utility
function copyToClipboard(text, message = "Copied to clipboard!") {
    navigator.clipboard.writeText(text)
        .then(() => showToast(message))
        .catch(() => showToast("Failed to copy."));
}

// Format Currency Helper
function formatUSD(amount) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

async function refreshDashboard(button) {
    if (button) button.classList.add('is-loading');
    try {
        await fetchAllDashboardData();
        showToast('Dashboard refreshed!');
    } finally {
        if (button) button.classList.remove('is-loading');
    }
}

async function shareDashboardReferral() {
    const code = document.getElementById('db-referral-code')?.textContent?.trim();
    if (!code || code === '-') return showToast('Referral code is still loading.');
    const url = `${window.location.origin}/login?ref=${encodeURIComponent(code)}`;
    if (navigator.share) {
        try {
            await navigator.share({ title: 'Join Nova', text: `Join Nova with my referral code ${code}`, url });
            return;
        } catch (error) {
            if (error.name === 'AbortError') return;
        }
    }
    copyToClipboard(url, 'Referral link copied!');
}

function updateWithdrawalPreview() {
    const amount = Math.max(0, parseFloat(document.getElementById('withdraw-amount-val')?.value) || 0);
    const fee = amount * 0.02;
    const feeEl = document.getElementById('withdraw-fee-preview');
    const totalEl = document.getElementById('withdraw-total-preview');
    if (feeEl) feeEl.textContent = amount ? `- ${formatUSD(fee)}` : '—';
    if (totalEl) totalEl.textContent = amount ? formatUSD(amount - fee) : '—';
}

async function loadTransactionLimits() {
    try {
        const limits = await apiRequest('/settings/transaction-limits');
        transactionLimits.minimumDeposit = Number(limits.minimumDeposit) || 100;
        transactionLimits.minimumWithdrawal = Number(limits.minimumWithdrawal) || 50;
        const depositInput = document.getElementById('custom-deposit-amount');
        if (depositInput) {
            depositInput.min = String(transactionLimits.minimumDeposit);
            if ((parseFloat(depositInput.value) || 0) < transactionLimits.minimumDeposit) depositInput.value = String(transactionLimits.minimumDeposit);
            currentSelectedDepositAmount = parseFloat(depositInput.value);
        }
        const depositHelp = document.getElementById('deposit-minimum-help');
        if (depositHelp) depositHelp.textContent = `Minimum deposit: ${formatUSD(transactionLimits.minimumDeposit)} USDT.`;
        const withdrawalInput = document.getElementById('withdraw-amount-val');
        if (withdrawalInput) {
            withdrawalInput.min = String(transactionLimits.minimumWithdrawal);
            withdrawalInput.placeholder = `Min. ${formatUSD(transactionLimits.minimumWithdrawal)} (2% Fee applies)`;
        }
    } catch (error) {
        console.error('Unable to load transaction limits:', error.message);
    }
}

// Fetch helper with token injection
async function apiRequest(endpoint, options = {}) {
    const token = localStorage.getItem('nova_token');
    
    // Set headers
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

// Authentication Logic
async function handleLoginSubmit(event) {
    event.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
        const data = await apiRequest('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });

        localStorage.setItem('nova_token', data.token);
        showToast(`Welcome back, ${data.user.name}!`);
        
        // Show app and load data
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('authenticated-app').style.display = 'flex';
        
        await fetchAllDashboardData();
    } catch (e) {
        alert(e.message || 'Login failed. Please check credentials.');
    }
}

function logout() {
    localStorage.removeItem('nova_token');
    localStorage.removeItem('nova_role');
    window.location.href = '/login.html';
}

// Switch tabs inside dashboard
function switchTab(tabId) {
    if (!document.getElementById(`panel-${tabId}`)) tabId = 'dashboard';
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

        if (tabId === 'notifications') loadNotificationCenter();
        if (tabId === 'email-preferences') loadUserNotificationSettings();
        if (tabId === 'referrals') loadReferralProgramSettings();

        // Set hash link URL quietly
        window.history.pushState(null, null, `#${tabId}`);
        window.scrollTo({ top: 0, behavior: 'smooth' });

        // Initialize dynamic panels on first switch
        if (tabId === 'invest' && typeof filterDashboardPlans === 'function') {
            filterDashboardPlans(typeof dbCurrentFilter !== 'undefined' ? dbCurrentFilter : 'all');
        }
        if (tabId === 'myinvestments') renderMyInvestments(dashboardInvestments);
        if (tabId === 'financial') renderFinancialOverview(financialPeriod);
    }
}

async function loadReferralProgramSettings() {
    try {
        const response = await fetch('/api/settings/referral-program', { cache: 'no-store' });
        if (!response.ok) return;
        const settings = await response.json();
        const values = {
            'ref-first-bonus-pct': settings.firstDepositBonusPct,
            'ref-deposit-commission-pct': settings.depositCommissionPct,
            'ref-daily-commission-pct': settings.dailyCommissionPct
        };
        Object.entries(values).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element && Number.isFinite(Number(value))) element.textContent = Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
        });
    } catch (error) {
        console.error('Unable to load referral percentages:', error.message);
    }
}

const userNotificationEvents = ['deposit', 'withdrawal', 'investment', 'commission', 'referral', 'reminder', 'support'];
let dashboardInvestments = [];
let dashboardTransactions = [];
let financialPeriod = 'monthly';
let financialCustomStart = null;
let financialCustomEnd = null;
let myInvestmentsPage = 1;
const MY_INVESTMENTS_PER_PAGE = 5;

function escapeUi(value) {
    const node = document.createElement('div');
    node.textContent = String(value ?? '');
    return node.innerHTML;
}

async function loadNotificationCenter() {
    if (!localStorage.getItem('nova_token')) return;
    try {
        const result = await apiRequest('/user/notification-center');
        const badge = document.getElementById('header-notification-count');
        if (badge) { badge.textContent = result.unread > 99 ? '99+' : result.unread; badge.hidden = !result.unread; }
        const list = document.getElementById('notification-inbox-list');
        if (!list) return;
        if (!result.items?.length) {
            list.innerHTML = '<div class="notification-inbox-empty"><span class="material-symbols-outlined">notifications_none</span><strong>You are all caught up</strong><small>New account alerts will appear here.</small></div>';
            return;
        }
        list.innerHTML = result.items.map(item => `<button type="button" class="notification-inbox-item ${item.is_read ? '' : 'unread'}" onclick="markNotificationRead(${Number(item.id)})"><span class="notification-category-icon material-symbols-outlined">${item.category === 'withdrawal' ? 'payments' : item.category === 'deposit' ? 'account_balance_wallet' : item.category === 'support' ? 'support_agent' : item.category === 'referral' ? 'group_add' : 'notifications'}</span><span><strong>${escapeUi(item.title)}</strong><small>${escapeUi(item.message)}</small><time>${escapeUi(item.created_at)}</time></span></button>`).join('');
    } catch (error) { console.error('Notification center:', error.message); }
}

async function markNotificationRead(notificationId) {
    await apiRequest('/user/notification-center', { method: 'POST', body: JSON.stringify({ notificationId }) });
    await loadNotificationCenter();
}

async function markAllNotificationsRead() {
    try {
        await apiRequest('/user/notification-center', { method: 'POST', body: JSON.stringify({ notificationId: 0 }) });
        await loadNotificationCenter();
        showToast("All notifications marked as read!");
    } catch (e) {
        console.error('Mark all read error:', e);
        showToast(e.message || "Unable to mark notifications as read", "error");
    }
}

async function loadLoginActivity() {
    const list = document.getElementById('login-activity-list'); if (!list) return;
    try {
        const rows = await apiRequest('/user/login-activity');
        const latest4 = (rows || []).slice(0, 4);
        list.innerHTML = latest4.length ? latest4.map(row => `<article class="audit-log-item"><span class="material-symbols-outlined">devices</span><div><strong>${escapeUi(row.user_agent || 'Unknown device')}</strong><small>IP: ${escapeUi(row.ip_address || 'Unavailable')}</small><time>${escapeUi(row.login_at)}</time></div></article>`).join('') : '<div class="notification-inbox-empty">No login activity recorded yet.</div>';
    } catch (error) { list.innerHTML = `<div class="notification-inbox-empty">${escapeUi(error.message)}</div>`; }
}

async function loadUserNotificationSettings() {
    if (!document.getElementById('user-notification-form')) return;
    try {
        const settings = await apiRequest('/user/notifications');
        userNotificationEvents.forEach(key => {
            const input = document.getElementById(`user-notify-${key}`);
            if (input) input.checked = settings[key] !== false;
        });
    } catch (error) {
        showToast(error.message || 'Unable to load notification preferences');
    }
}

async function saveUserNotificationSettings(event) {
    event.preventDefault();
    const button = document.getElementById('user-notification-save-btn');
    const payload = {};
    userNotificationEvents.forEach(key => payload[key] = Boolean(document.getElementById(`user-notify-${key}`)?.checked));
    if (button) button.disabled = true;
    try {
        const result = await apiRequest('/user/notifications', { method: 'POST', body: JSON.stringify(payload) });
        showToast(result.message || 'Your notification preferences were saved');
    } catch (error) {
        showToast(error.message || 'Unable to save notification preferences');
    } finally {
        if (button) button.disabled = false;
    }
}

// Fetch and load all panels data
async function fetchAllDashboardData() {
    if (!localStorage.getItem('nova_token')) return;

    try {
        const profile = await apiRequest('/user/profile');
        
        // Render user card info
        const userNameLabel = document.querySelector('.user-name-label');
        if (userNameLabel && profile.name) {
            userNameLabel.textContent = profile.name;
        }
        
        const dbUserName = document.getElementById('db-user-name');
        if (dbUserName && profile.name) {
            dbUserName.textContent = profile.name;
        }

        const dbAccountId = document.getElementById('db-account-id');
        if (dbAccountId && profile.id) {
            dbAccountId.textContent = `#${String(profile.id).padStart(4, '0')}`;
        }
        
        // Render profile metrics
        const balanceHeader = document.getElementById('user-balance-header');
        if (balanceHeader) balanceHeader.textContent = `Balance: ${formatUSD(profile.balance)}`;
        
        const dbTotalBalance = document.getElementById('db-total-balance');
        if (dbTotalBalance) dbTotalBalance.textContent = formatUSD(profile.balance);

        const withdrawAvailable = document.getElementById('withdraw-available-balance');
        if (withdrawAvailable) withdrawAvailable.textContent = formatUSD(profile.balance);
        
        const dbTodayProfit = document.getElementById('db-today-profit');
        if (dbTodayProfit) dbTodayProfit.textContent = formatUSD(profile.today_profit || 0.00);
        
        const dbTotalEarned = document.getElementById('db-total-earned');
        if (dbTotalEarned) dbTotalEarned.textContent = formatUSD(profile.earnings || 0.00);

        const dbReferralCode = document.getElementById('db-referral-code');
        if (dbReferralCode && profile.referral_code) {
            dbReferralCode.textContent = profile.referral_code;
        }

        const referralLinkInput = document.getElementById('referral-link-input');
        if (referralLinkInput && profile.referral_code) {
            referralLinkInput.value = `${window.location.origin}/login?ref=${profile.referral_code}`;
        }

        if (profile.referralsStats) {
            const listItems = document.querySelectorAll('#panel-referrals .db-grid-half .recent-deposits-section:first-child .db-list-item');
            if (listItems.length >= 3) {
                const totalRefVal = listItems[0].querySelector('.db-item-primary');
                if (totalRefVal) totalRefVal.textContent = `${profile.referralsStats.totalReferrals} users`;

                const activeRefVal = listItems[1].querySelector('.db-item-primary');
                if (activeRefVal) activeRefVal.textContent = `${profile.referralsStats.activeReferralsCount} users`;

                const totalComVal = listItems[2].querySelector('.db-item-primary');
                if (totalComVal) totalComVal.textContent = formatUSD(profile.referralsStats.totalComEarned);
            }

            const latestSignupsContainer = document.getElementById('db-referral-signups-list');
            if (latestSignupsContainer && profile.referralsStats.signups) {
                if (profile.referralsStats.signups.length === 0) {
                    latestSignupsContainer.innerHTML = '<li style="text-align: center; color: #64748b; font-size: 0.85rem; padding: 1rem 0;">No referred users yet.</li>';
                } else {
                    latestSignupsContainer.innerHTML = profile.referralsStats.signups.map(s => `
                        <li class="db-list-item" style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 0.5rem; border-bottom: 1px solid #1e2538;">
                            <div>
                                <div class="db-item-primary" style="font-weight: 700; color: #f8fafc; font-size: 0.85rem;">${s.name}</div>
                                <div class="db-item-sec" style="color: #94a3b8; font-size: 0.75rem;">${s.email}</div>
                            </div>
                        </li>
                    `).join('');
                }
            }
        }

        // Fetch account activity together so a rendering issue in one section can
        // never prevent the Transactions or Withdrawal Status panels from loading.
        const [deposits, investments, transactions] = await Promise.all([
            apiRequest('/deposits'),
            apiRequest('/investments'),
            apiRequest('/transactions')
        ]);
        dashboardInvestments = Array.isArray(investments) ? investments : [];
        dashboardTransactions = Array.isArray(transactions) ? transactions : [];

        renderDepositsTable(deposits);
        renderAllTransactionsTable(transactions);
        renderWithdrawalStatus(transactions);
        renderInvestmentsTable(investments);
        renderMyInvestments(dashboardInvestments);
        renderFinancialOverview(financialPeriod);
        if (typeof renderActiveInvestmentsTracking === 'function') {
            renderActiveInvestmentsTracking(investments);
        }

        // Compute total deposits and withdrawals sums
        const totalDepositsSum = deposits
            .filter(d => d.status === 'Confirmed')
            .reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);

        const totalWithdrawalsSum = transactions
            .filter(tx => tx.type === 'Withdrawal' && tx.status === 'Confirmed')
            .reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);

        const dbTotalReferrals = document.getElementById('db-total-referrals');
        if (dbTotalReferrals) {
            dbTotalReferrals.textContent = profile.referralsStats ? profile.referralsStats.totalReferrals : 0;
        }

        const dbTotalDeposits = document.getElementById('db-total-deposits');
        if (dbTotalDeposits) {
            dbTotalDeposits.textContent = formatUSD(totalDepositsSum);
        }

        const dbTotalWithdrawals = document.getElementById('db-total-withdrawals');
        if (dbTotalWithdrawals) {
            dbTotalWithdrawals.textContent = formatUSD(totalWithdrawalsSum);
        }

        const tickets = await apiRequest('/tickets');
        renderTicketsTable(tickets);

        // Render dynamic SVG earnings chart
        renderSVGChart(profile.balance);
    } catch (e) {
        console.error('Error fetching dashboard data:', e.message);
    }
}

// Initialize Application Routing & Listeners
document.addEventListener("DOMContentLoaded", async () => {
    document.getElementById('withdraw-amount-val')?.addEventListener('input', updateWithdrawalPreview);
    await loadTransactionLimits();
    // 1. Session Auth check
    const token = localStorage.getItem('nova_token');
    const role = localStorage.getItem('nova_role');
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab');
    const hash = window.location.hash.substring(1);
    const activeTab = tabParam || hash || 'dashboard';

    const isGuestInvestTab = (!token || role !== 'user') && activeTab === 'invest';

    if (!isGuestInvestTab && (!token || role !== 'user')) {
        logout();
        return;
    }
    
    if (isGuestInvestTab) {
        enableGuestMode();
    } else {
        try {
            await fetchAllDashboardData();
            fetchUserTronAddress();
            loadNotificationCenter();
        } catch (e) {
            console.error("Dashboard initial load failed:", e);
        }
    }

    // 2. Setup hash router or query param router
    switchTab(activeTab);

    // If purchase plan specified in url params
    const planParam = urlParams.get('plan');
    if (planParam && activeTab === 'invest') {
        highlightPlan(planParam);
    }
    const amtParam = urlParams.get('amount');
    if (amtParam && activeTab === 'deposit') {
        const amtVal = parseFloat(amtParam);
        if (!isNaN(amtVal) && amtVal > 0) {
            currentSelectedDepositAmount = amtVal;
            const hint = document.getElementById('deposit-selected-hint');
            if (hint) {
                hint.innerHTML = `✨ Deposit required for <strong style="color:#a855f7;">${planParam || 'Investment Plan'}</strong>: <strong>$${amtVal} USDT</strong>`;
            }
            
            const customInput = document.getElementById('custom-amount-input');
            if (customInput) customInput.value = amtVal;

            // Optional: visually highlight the custom card by default to show a custom amount is selected
            const cards = document.querySelectorAll('.amount-card-opt');
            cards.forEach(c => {
                c.classList.remove('active-card');
                c.style.borderColor = '#1e2538';
                const btn = c.querySelector('.amount-select-btn');
                if (btn && btn.textContent !== 'Custom') {
                    btn.style.backgroundColor = 'rgba(168, 85, 247, 0.1)';
                    btn.style.color = '#a855f7';
                    btn.textContent = 'Select';
                }
            });
            const customBtn = document.getElementById('custom-amt-btn');
            if (customBtn) customBtn.textContent = `$${amtVal}`;
        }
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
    const logoutBtns = document.querySelectorAll('.sidebar-item-link.logout');
    logoutBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            logout();
        });
    });

    // 5. Periodic polling to keep dashboard metrics, pending deposits, and compounding plan earnings synced in real-time
    setInterval(async () => {
        if (localStorage.getItem('nova_token')) {
            await fetchAllDashboardData();
        }
    }, 5000); // Poll every 5 seconds

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
        const mobileDrawerTrigger = document.getElementById('mobile-drawer-trigger');
        if (mobileDrawerTrigger) {
            mobileDrawerTrigger.addEventListener('click', toggleSidebar);
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

    // User Profile Dropdown logic
    const profileBtn = document.getElementById('user-profile-menu-btn');
    const profileDropdown = document.getElementById('profile-dropdown-menu');
    if (profileBtn && profileDropdown) {
        profileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            profileDropdown.classList.toggle('show');
        });

        document.addEventListener('click', () => {
            profileDropdown.classList.remove('show');
        });

        // Logout action button click
        const logoutLinks = profileDropdown.querySelectorAll('.logout-action-btn');
        logoutLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                logout();
            });
        });
    }
});

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

// Selection logic for deposit amount options
function selectDepositAmount(amount, cardElement) {
    selectedDepositAmount = amount;
    
    // Toggle active state in UI cards
    const cards = document.querySelectorAll('.amount-card-opt');
    cards.forEach(card => card.classList.remove('active'));
    cardElement.classList.add('active');
    
    showToast(`Selected Deposit Amount: $${amount}`);
}

async function fetchUserTronAddress() {
    try {
        const res = await fetch('/api/settings/tron-address');
        const data = await res.json();
        if (data.address) {
            const addrInput = document.getElementById('tron-wallet-address');
            if (addrInput) addrInput.value = data.address;
        }
    } catch (err) {
        console.error('Failed to fetch user TRON address:', err);
    }
}

// Copy TRON address function
function copyWalletAddress() {
    const addrInput = document.getElementById('tron-wallet-address');
    const copyBtn = document.getElementById('copy-tron-btn');
    if (!addrInput) return;

    addrInput.select();
    addrInput.setSelectionRange(0, 99999);

    const handleSuccess = () => {
        showToast("TRON (TRC20) wallet address copied!");
        if (copyBtn) {
            copyBtn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
            copyBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 18px;">check</span><span>Copied!</span>`;
            setTimeout(() => {
                copyBtn.style.background = 'linear-gradient(135deg, #3b82f6, #2563eb)';
                copyBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 18px;">content_copy</span><span>Copy TRON Address</span>`;
            }, 2500);
        }
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(addrInput.value)
            .then(handleSuccess)
            .catch(() => {
                try {
                    document.execCommand('copy');
                    handleSuccess();
                } catch (e) {
                    showToast("TRON address selected. Please press Copy.", "info");
                }
            });
    } else {
        try {
            document.execCommand('copy');
            handleSuccess();
        } catch (e) {
            showToast("TRON address selected. Please press Copy.", "info");
        }
    }
}

// Custom deposit modal logic
function openCustomAmountModal() {
    const modal = document.getElementById('custom-amount-modal');
    if (modal) modal.classList.add('active');
}

function closeCustomAmountModal() {
    const modal = document.getElementById('custom-amount-modal');
    if (modal) modal.classList.remove('active');
}

function applyCustomAmount() {
    const customInput = document.getElementById('custom-amount-val');
    if (customInput) {
        const amount = parseFloat(customInput.value);
        if (isNaN(amount) || amount < transactionLimits.minimumDeposit) {
            alert(`Please enter a valid deposit amount of ${formatUSD(transactionLimits.minimumDeposit)} or more.`);
            return;
        }
        
        selectedDepositAmount = amount;
        
        // Remove selection from standard amount cards
        const cards = document.querySelectorAll('.amount-card-opt');
        cards.forEach(card => card.classList.remove('active'));
        
        // Update custom button text to show custom selection
        const customBtn = document.querySelector('.custom-amt-btn');
        if (customBtn) customBtn.textContent = `Custom: $${amount}`;
        
        closeCustomAmountModal();
        showToast(`Selected Custom Deposit: $${amount}`);
    }
}

// Submit payment transaction hash to Express API
async function submitDepositTx() {
    const txInput = document.getElementById('tx-hash-input');
    if (!txInput || txInput.value.trim() === '') {
        alert("Please enter your TRON transaction hash or ID to submit.");
        return;
    }

    const txHash = txInput.value.trim();

    try {
        await apiRequest('/deposits', {
            method: 'POST',
            body: JSON.stringify({
                amount: selectedDepositAmount,
                txnId: txHash
            })
        });

        txInput.value = '';
        showToast("Transaction submitted! Verification in progress...");
        
        // Refresh tables immediately
        await fetchAllDashboardData();
    } catch (e) {
        alert(e.message || 'Failed to submit deposit.');
    }
}

// Purchase an investment plan via Express API
async function purchasePlan(name, inputId) {
    const qtyInput = document.getElementById(inputId);
    const quantity = qtyInput ? parseInt(qtyInput.value) || 1 : 1;

    if (quantity <= 0) {
        alert('Please enter a valid quantity.');
        return;
    }

    if (!confirm(`Are you sure you want to buy ${quantity} plan(s) for "${name}" for $${(100 * quantity).toFixed(2)}?`)) {
        return;
    }

    try {
        const response = await apiRequest('/investments', {
            method: 'POST',
            body: JSON.stringify({
                name,
                quantity
            })
        });

        showToast(response.message || `Successfully purchased plan: ${name}!`);
        myInvestmentsPage = 1;
        await fetchAllDashboardData();
        switchTab('myinvestments');
    } catch (e) {
        alert(e.message || 'Failed to purchase plan.');
    }
}

// Request payout withdrawal via Express API
async function requestWithdrawal() {
    const addressInput = document.getElementById('withdraw-wallet-addr');
    const amountInput = document.getElementById('withdraw-amount-val');

    if (!addressInput || !amountInput) return;

    const address = addressInput.value.trim();
    const amount = parseFloat(amountInput.value);

    if (address === '') {
        alert("Please enter your destination TRON wallet address (TRC20).");
        return;
    }

    if (isNaN(amount) || amount < transactionLimits.minimumWithdrawal) {
        alert(`Minimum withdrawal limit is ${formatUSD(transactionLimits.minimumWithdrawal)}.`);
        return;
    }

    try {
        const response = await apiRequest('/withdrawals', {
            method: 'POST',
            body: JSON.stringify({
                address,
                amount
            })
        });

        addressInput.value = '';
        amountInput.value = '';
        
        showToast(response.message || "Withdrawal request submitted — waiting for admin approval.");
        await fetchAllDashboardData();
    } catch (e) {
        alert(e.message || 'Failed to submit withdrawal request.');
    }
}

function renderWithdrawalStatus(transactions) {
    const container = document.getElementById('withdrawal-status-list');
    if (!container) return;
    const withdrawals = (Array.isArray(transactions) ? transactions : [])
        .filter(transaction => transaction.type === 'Withdrawal')
        .slice(0, 4);
    if (withdrawals.length === 0) {
        container.innerHTML = '<div class="withdrawal-status-empty">No withdrawal requests yet.</div>';
        return;
    }
    container.innerHTML = withdrawals.map(withdrawal => {
        const status = String(withdrawal.status || 'Pending');
        const pending = status === 'Pending';
        const confirmed = status === 'Confirmed';
        const statusLabel = pending ? 'Waiting for admin approval' : (confirmed ? 'Withdrawal successful' : status);
        const statusClass = pending ? 'pending' : (confirmed ? 'confirmed' : 'rejected');
        return `<article class="withdrawal-status-item">
            <span class="withdrawal-status-icon material-symbols-outlined">${pending ? 'schedule' : (confirmed ? 'check_circle' : 'cancel')}</span>
            <span class="withdrawal-status-details"><strong>${formatUSD(withdrawal.amount)}</strong><small>${escapeUi(withdrawal.date || '')} · ID: ${escapeUi(withdrawal.ref || '—')}</small></span>
            <span class="withdrawal-status-badge ${statusClass}">${escapeUi(statusLabel)}</span>
        </article>`;
    }).join('');
}
// HTML Escape Helper
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

let selectedChatImageBase64 = null;

function handleChatImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        selectedChatImageBase64 = e.target.result;
        document.getElementById('chat-image-preview-thumb').src = selectedChatImageBase64;
        document.getElementById('chat-image-preview-box').style.display = 'flex';
    };
    reader.readAsDataURL(file);
}

function clearChatImageSelection() {
    selectedChatImageBase64 = null;
    document.getElementById('chat-screenshot-file').value = '';
    document.getElementById('chat-image-preview-box').style.display = 'none';
}

// Send support message in chat panel
async function sendChatMessage() {
    const input = document.getElementById('chat-message-input');
    if (!input) return;
    const msg = input.value.trim();
    if (msg === '' && !selectedChatImageBase64) return;

    try {
        input.disabled = true;
        const sendBtn = document.querySelector('.chat-send-btn');
        if (sendBtn) sendBtn.disabled = true;

        await apiRequest('/tickets', {
            method: 'POST',
            body: JSON.stringify({
                title: 'Support Query',
                message: msg,
                screenshotBase64: selectedChatImageBase64
            })
        });

        input.value = '';
        clearChatImageSelection();
        await fetchAllDashboardData();
    } catch (e) {
        alert(e.message || 'Failed to send message.');
    } finally {
        input.disabled = false;
        const sendBtn = document.querySelector('.chat-send-btn');
        if (sendBtn) sendBtn.disabled = false;
        input.focus();
    }
}

// Render dynamic tables
function renderDepositsTable(deposits) {
    const tbody = document.getElementById('recent-deposits-table-body');
    if (!tbody) return;

    if (deposits.length === 0) {
        tbody.innerHTML = `<tr class="recent-deposits-empty-row"><td colspan="4"><span class="material-symbols-outlined">account_balance_wallet</span><strong>No recent deposits</strong><small>Your submitted deposits will appear here.</small></td></tr>`;
        return;
    }

    tbody.innerHTML = deposits.map(dep => {
        const isConfirmed = dep.status === 'Confirmed';
        const badgeBg = isConfirmed ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)';
        const badgeColor = isConfirmed ? '#10b981' : '#f59e0b';
        const badgeBorder = isConfirmed ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)';
        const formattedAmount = typeof dep.amount === 'number' ? `$${dep.amount}` : `$${dep.amount}`;
        const planStr = dep.plan_name ? `<span style="color:#a855f7; font-weight:600;">${dep.plan_name}</span>` : 'Custom Deposit';
        
        return `
        <tr style="border-bottom: 1px solid #1e2538;">
            <td data-label="Date" style="padding: 1rem 1.25rem; color: #cbd5e1; font-size: 0.85rem;">${dep.date || 'Today'}</td>
            <td data-label="Amount" style="padding: 1rem 1.25rem; font-weight: 700; color: #f8fafc; font-size: 0.85rem;">${formattedAmount}</td>
            <td data-label="Transaction ID" class="deposit-tx-hash" style="padding: 1rem 1.25rem; color: #cbd5e1; font-size: 0.85rem; font-family: monospace; white-space: nowrap;">
                <span>${dep.txn_id || 'TXN7f3e8d9c2a1b4f...'}</span>
                <button onclick="copyToClipboard('${dep.txn_id || ''}')" style="background: none; border: none; color: #3b82f6; cursor: pointer; display: inline-flex; align-items: center; vertical-align: middle; padding: 0; margin-left: 0.35rem;" title="Copy Transaction ID">
                    <span class="material-symbols-outlined" style="font-size: 13px;">content_copy</span>
                </button>
            </td>
            <td data-label="Status" style="padding: 1rem 1.25rem;">
                <span style="background-color: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}; padding: 0.25rem 0.75rem; border-radius: 99px; font-size: 0.75rem; font-weight: 600;">${dep.status}</span>
            </td>
        </tr>
    `;
    }).join('');
}

function renderAllTransactionsTable(transactions) {
    const tbody = document.getElementById('all-transactions-table-body');
    const tableWrap = document.querySelector('.transactions-table-wrap');
    const emptyState = document.getElementById('transactions-empty-state');
    if (!tbody) return;

    const filtered = Array.isArray(transactions) ? transactions : [];

    if (filtered.length === 0) {
        tbody.innerHTML = '';
        if (tableWrap) {
            tableWrap.hidden = true;
            tableWrap.style.display = 'none';
        }
        if (emptyState) {
            emptyState.hidden = false;
            emptyState.style.display = 'grid';
        }
        return;
    }

    if (tableWrap) {
        tableWrap.hidden = false;
        tableWrap.style.display = 'block';
    }
    if (emptyState) {
        emptyState.hidden = true;
        emptyState.style.display = 'none';
    }

    tbody.innerHTML = filtered.map(tx => {
        let typeColor = "#3b82f6";
        if (tx.type === "Investment") typeColor = "#a855f7";
        if (tx.type === "Withdrawal") typeColor = "#ef4444";
        if (/commission|referral|profit|earning/i.test(tx.type || '')) typeColor = "#22c55e";

        const numericAmount = Math.abs(Number(tx.amount) || 0);
        const isDebit = tx.type === 'Withdrawal' || tx.type === 'Investment';
        const amountText = `${isDebit ? '-' : ''}$${numericAmount.toFixed(2)}`;
        const amountColor = isDebit ? '#f47d8b' : '#f8fafc';
        const date = String(tx.date || '—');
        const type = String(tx.type || 'Transaction');
        const reference = String(tx.ref || 'Pending');
        const status = String(tx.status || 'Pending');
        const statusClass = status.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
        const encodedReference = encodeURIComponent(reference);

        return `
            <tr>
                <td data-label="Date">${escapeUi(date)}</td>
                <td data-label="Type" style="font-weight:600; color: ${typeColor};">${escapeUi(type)}</td>
                <td data-label="Amount" style="font-weight: 700; color: ${amountColor};">${amountText}</td>
                <td data-label="Reference" class="deposit-tx-hash" style="font-family: monospace; white-space: nowrap;">
                    <span title="${escapeUi(reference)}">${escapeUi(reference.substring(0, 16))}${reference.length > 16 ? '...' : ''}</span>
                    <button onclick="copyToClipboard(decodeURIComponent('${encodedReference}'))" style="background: none; border: none; color: #3b82f6; cursor: pointer; display: inline-flex; align-items: center; vertical-align: middle; padding: 0; margin-left: 0.35rem;" title="Copy Full Reference">
                        <span class="material-symbols-outlined" style="font-size: 13px;">content_copy</span>
                    </button>
                </td>
                <td data-label="Status">
                    <span class="status-badge-lbl ${statusClass}">${escapeUi(status)}</span>
                </td>
            </tr>
        `;
    }).join('');
}

async function downloadAccountStatement() {
    try {
        const rows = await apiRequest('/user/ledger');
        const csv = [['Date','Type','Reference','Amount','Balance Before','Balance After','Description'], ...rows.map(row => [row.created_at,row.entry_type,row.transaction_ref,row.amount,row.balance_before,row.balance_after,row.description || ''])]
            .map(cols => cols.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = `nova-statement-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(url);
        showToast('Statement downloaded');
    } catch (error) { showToast(error.message || 'Unable to download statement'); }
}

function renderInvestmentsTable(investments) {
    const tbody = document.getElementById('my-investments-table-body');
    if (!tbody) return;

    const allInvestments = Array.isArray(investments) ? investments : [];

    if (allInvestments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="padding:1.5rem;text-align:center;color:#718096;">No investments yet.</td></tr>';
        return;
    }

    tbody.innerHTML = allInvestments.map(inv => `
        <tr>
            <td style="font-weight:600; color:#f8fafc;">${escapeUi(inv.name || 'Investment')}</td>
            <td style="font-weight:700; color:#3b82f6;">${formatUSD(inv.amount)}</td>
            <td style="color:#10b981; font-weight:600;">+${Number(inv.daily_profit_pct || 0).toFixed(2)}% / day</td>
            <td>${Number(inv.duration_days || 0)} Days</td>
            <td><span class="status-badge-lbl confirmed">${escapeUi(inv.status || 'Active')}</span></td>
        </tr>
    `).join('');
}

function renderActiveInvestmentsTracking(investments) {
    const tbody = document.getElementById('active-investments-tbody');
    if (!tbody) return;

    const active = (Array.isArray(investments) ? investments : []).filter(inv => inv.status === 'Active');

    if (!active.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:1.5rem;color:#94a3b8">No active investments yet.</td></tr>';
        return;
    }

    tbody.innerHTML = active.map(inv => {
        const investmentAmount = Number(inv.amount) || 0;
        const dailyProfitPct = Number(inv.daily_profit_pct) || 0;
        const estReturns = investmentAmount * (dailyProfitPct / 100);
        const cycleMs = 24 * 60 * 60 * 1000;
        const elapsed = Math.max(0, Date.now() - Number(inv.created_at || Date.now()));
        const cycleProgress = Math.min(1, (elapsed % cycleMs) / cycleMs);
        const remaining = Math.max(0, cycleMs - (elapsed % cycleMs));
        const hours = Math.floor(remaining / 3600000);
        const minutes = Math.floor((remaining % 3600000) / 60000);
        return `
        <tr style="border-bottom: 1px solid #1e2538;">
            <td data-label="Investment plan" style="padding: 1rem 1.25rem; font-weight:600; color:#f8fafc;">${escapeUi(inv.name || 'Investment')}</td>
            <td data-label="Amount" style="padding: 1rem 1.25rem; font-weight:700; color:#3b82f6;">${formatUSD(investmentAmount)}</td>
            <td data-label="Daily ROI" style="padding: 1rem 1.25rem; color:#10b981; font-weight:600;">+${dailyProfitPct.toFixed(2)}% / day</td>
            <td data-label="Est. return" style="padding: 1rem 1.25rem; color:#10b981; font-weight:700;">+$${estReturns.toFixed(2)}</td>
            <td data-label="Status" style="padding: 1rem 1.25rem;"><div class="investment-cycle"><span><b>${hours}h ${minutes}m</b> to next credit</span><i><em style="width:${Math.round(cycleProgress * 100)}%"></em></i></div></td>
        </tr>
        `;
    }).join('');
}

function renderTicketsTable(tickets) {
    const container = document.getElementById('chat-messages-container');
    if (!container) return;

    if (tickets.length === 0) {
        container.innerHTML = `
            <div class="chat-empty-state">
                <span class="material-symbols-outlined chat-empty-icon">support_agent</span>
                <div class="chat-empty-text font-display">Hello! Welcome to Nova Support. How can we help you today? Send a message below to start chatting.</div>
            </div>
        `;
        return;
    }

    // Chronological order: oldest messages first
    const sortedTickets = [...tickets].reverse();

    container.innerHTML = sortedTickets.map(ticket => {
        let userImageHtml = '';
        if (ticket.image_path) {
            const imagePath = escapeUi(ticket.image_path);
            userImageHtml = `<a href="${imagePath}" target="_blank" rel="noopener"><img src="${imagePath}" alt="Your attachment" style="max-width:100%;border-radius:8px;margin-top:.5rem;display:block;"></a>`;
        }

        let html = '';
        if (ticket.message) {
            html += `
                <div class="chat-bubble-wrapper user">
                    <div class="chat-bubble">
                        ${escapeHTML(ticket.message)}
                        ${userImageHtml}
                        <span class="chat-bubble-time">${escapeUi(ticket.date || '')}</span>
                    </div>
                </div>
            `;
        } else if (userImageHtml) {
            html += `
                <div class="chat-bubble-wrapper user">
                    <div class="chat-bubble" style="padding: 0.5rem;">
                        ${userImageHtml}
                        <span class="chat-bubble-time">${escapeUi(ticket.date || '')}</span>
                    </div>
                </div>
            `;
        }

        let adminImageHtml = '';
        if (ticket.admin_image_path) {
            const adminImagePath = escapeUi(ticket.admin_image_path);
            adminImageHtml = `<a href="${adminImagePath}" target="_blank" rel="noopener"><img src="${adminImagePath}" alt="Support attachment" style="max-width:100%;border-radius:8px;margin-top:.5rem;display:block;"></a>`;
        }

        if (ticket.admin_reply) {
            html += `
                <div class="chat-bubble-wrapper support">
                    <div class="chat-bubble">
                        ${escapeHTML(ticket.admin_reply)}
                        ${adminImageHtml}
                        <span class="chat-bubble-time">${escapeUi(ticket.date || '')}</span>
                    </div>
                </div>
            `;
        } else if (adminImageHtml) {
            html += `
                <div class="chat-bubble-wrapper support">
                    <div class="chat-bubble" style="padding: 0.5rem;">
                        ${adminImageHtml}
                        <span class="chat-bubble-time">${escapeUi(ticket.date || '')}</span>
                    </div>
                </div>
            `;
        }
        return html;
    }).join('');

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
}

function highlightPlan(planName) {
    setTimeout(() => {
        const boxes = document.querySelectorAll('.deposit-step-box');
        boxes.forEach(box => {
            if (box.textContent.toLowerCase().includes(planName.toLowerCase())) {
                box.style.borderColor = "#3b82f6";
                box.style.boxShadow = "0 0 15px rgba(59, 130, 246, 0.2)";
                box.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    }, 100);
}

function enableGuestMode() {
    document.body.classList.add('guest-mode');
    
    // Hide all sidebar menu items except "Investment Plans" (invest)
    const sidebarItems = document.querySelectorAll('.dashboard-sidebar ul li');
    sidebarItems.forEach(item => {
        const link = item.querySelector('a');
        if (link && link.getAttribute('data-tab') !== 'invest') {
            item.style.display = 'none';
        }
    });

    // Replace header user profile dropdown with a beautiful Register/Sign In CTA button
    const headerRight = document.querySelector('.header-right-user');
    if (headerRight) {
        headerRight.innerHTML = `
            <a href="/login" class="form-btn-db" style="background-color: #3b82f6; text-decoration: none; display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1.25rem; font-size: 0.85rem; font-weight: 600; border-radius: 8px; color: white;">
                <span class="material-symbols-outlined" style="font-size: 1.1rem;">login</span>
                <span>Register / Sign In</span>
            </a>
        `;
    }

    // Change all Buy Plan buttons to "Login to Invest"
    const buyButtons = document.querySelectorAll('#panel-invest button');
    buyButtons.forEach(btn => {
        btn.textContent = 'Login to Invest';
        btn.setAttribute('onclick', "window.location.href='/login'");
    });
}

// Daily Check-In Claim Function
function claimDailyCheckin() {
    const btn = document.getElementById('claim-checkin-btn');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = '🎉 Claimed $0.50 Today!';
    btn.style.background = '#0F172A';
    btn.style.border = '1px solid #10B981';
    btn.style.color = '#10B981';

    const todayPill = document.querySelector('.checkin-day-pill.today');
    if (todayPill) {
        todayPill.classList.remove('today');
        todayPill.classList.add('claimed');
        const rewardSpan = todayPill.querySelector('.checkin-day-reward');
        if (rewardSpan) rewardSpan.textContent = '+$0.50 ✓';
    }

    alert("🎉 Congratulations! You claimed your Day 3 check-in bonus of $0.50! Your 7-day streak continues.");
}

// =========================================================
// DEPOSIT PANEL INTERACTIVE LOGIC (EXACT SCREENSHOT MATCH)
// =========================================================
let currentSelectedDepositAmount = 100;

function selectDepositAmountCard(cardEl, amount) {
    currentSelectedDepositAmount = amount;
    
    // Reset all deposit cards
    const allCards = document.querySelectorAll('#panel-deposit .amount-card-opt');
    allCards.forEach(card => {
        card.style.borderColor = '#1e2538';
        const badge = card.querySelector('.card-check-badge');
        if (badge) badge.style.display = 'none';
        const btn = card.querySelector('.amount-select-btn');
        if (btn) {
            btn.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
            btn.style.color = '#3b82f6';
        }
    });

    // Highlight clicked card
    if (cardEl) {
        cardEl.style.borderColor = '#3b82f6';
        const badge = cardEl.querySelector('.card-check-badge');
        if (badge) badge.style.display = 'flex';
        const btn = cardEl.querySelector('.amount-select-btn');
        if (btn) {
            btn.style.backgroundColor = '#3b82f6';
            btn.style.color = 'white';
        }
    }

    const hint = document.getElementById('deposit-selected-hint');
    if (hint) {
        hint.innerHTML = `Select an amount or enter a custom amount to deposit. Selected: <strong>$${amount}</strong>`;
    }
    showToast(`Selected Deposit Amount: $${amount}`);
}

function openCustomDepositPrompt() {
    const modal = document.getElementById('custom-amount-modal');
    if (modal) modal.style.display = 'flex';
}

function closeCustomAmountModal() {
    const modal = document.getElementById('custom-amount-modal');
    if (modal) modal.style.display = 'none';
}

function applyCustomAmount() {
    const input = document.getElementById('custom-amount-input');
    if (!input) return;
    const parsed = parseFloat(input.value);
    if (isNaN(parsed) || parsed < transactionLimits.minimumDeposit) {
        showToast(`Please enter a valid amount of ${formatUSD(transactionLimits.minimumDeposit)} or more.`, "error");
        return;
    }
    
    currentSelectedDepositAmount = parsed;
    closeCustomAmountModal();
    
    // Remove active styling from preset cards
    const allCards = document.querySelectorAll('#panel-deposit .amount-card-opt');
    allCards.forEach(card => {
        card.style.borderColor = '#1e2538';
        const badge = card.querySelector('.card-check-badge');
        if (badge) badge.style.display = 'none';
        const btn = card.querySelector('.amount-select-btn');
        if (btn) {
            btn.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
            btn.style.color = '#3b82f6';
        }
    });

    const hint = document.getElementById('deposit-selected-hint');
    if (hint) {
        hint.innerHTML = `Select an amount or enter a custom amount to deposit. Selected Custom Amount: <strong>$${parsed}</strong>`;
    }
    showToast(`Custom Deposit Selected: $${parsed}`);
}

function updateDepositAmount(val) {
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed > 0) {
        currentSelectedDepositAmount = parsed;
    }
}

async function submitNewDeposit() {
    const customAmtEl = document.getElementById('custom-deposit-amount');
    if (customAmtEl && customAmtEl.value) {
        const parsedAmt = parseFloat(customAmtEl.value);
        if (!isNaN(parsedAmt) && parsedAmt > 0) {
            currentSelectedDepositAmount = parsedAmt;
        }
    }

    if (!Number.isFinite(currentSelectedDepositAmount) || currentSelectedDepositAmount < transactionLimits.minimumDeposit) {
        showToast(`Minimum deposit is ${formatUSD(transactionLimits.minimumDeposit)}.`, 'error');
        return;
    }

    const screenshotEl = document.getElementById('deposit-screenshot-input');
    if (!screenshotEl || !screenshotEl.files || screenshotEl.files.length === 0) {
        showToast("Please upload a screenshot of your payment to proceed.", "error");
        return;
    }

    const file = screenshotEl.files[0];
    
    // Convert file to Base64
    const reader = new FileReader();
    reader.onload = async function(e) {
        const base64Image = e.target.result;
        
        // Extract planName if user came from a product
        const urlParams = new URLSearchParams(window.location.search);
        let planName = urlParams.get('plan');
        // Check hash just in case
        if (!planName) {
            const hashParts = window.location.hash.split('?');
            if (hashParts.length > 1) {
                const hashParams = new URLSearchParams(hashParts[1]);
                planName = hashParams.get('plan');
            }
        }

        try {
            await apiRequest('/deposits', {
                method: 'POST',
                body: JSON.stringify({
                    amount: currentSelectedDepositAmount,
                    screenshotBase64: base64Image,
                    planName: planName || null
                })
            });
            // Show successful deposit modal
            const successModal = document.getElementById('deposit-success-modal');
            if (successModal) {
                successModal.style.display = 'flex';
            }
            screenshotEl.value = "";
            const statusText = document.getElementById('upload-status-text');
            if (statusText) {
                statusText.textContent = 'Drag & drop screenshot here, or click to browse';
                statusText.style.color = '#cbd5e1';
            }
            await fetchAllDashboardData();
        } catch (e) {
            console.error("Deposit error:", e);
            showToast(e.message || "Failed to submit deposit. Please try again.", "error");
        }
    };
    reader.readAsDataURL(file);
}

function closeDepositSuccessModal() {
    const successModal = document.getElementById('deposit-success-modal');
    if (successModal) {
        successModal.style.display = 'none';
    }
}

function handleFileSelect(input) {
    const statusText = document.getElementById('upload-status-text');
    if (statusText) {
        if (input.files && input.files[0]) {
            const fileName = input.files[0].name;
            statusText.textContent = `Uploading image...`;
            statusText.style.color = '#3b82f6';
            if (typeof showToast === 'function') showToast('Uploading payment screenshot...', 'info');

            setTimeout(() => {
                statusText.innerHTML = `✓ Image Uploaded Successfully:<br><strong style="color: #10b981;">${escapeUi(fileName)}</strong>`;
                statusText.style.color = '#10b981';
                if (typeof showToast === 'function') showToast(`Your payment screenshot has been uploaded successfully!`);
            }, 400);
        } else {
            statusText.textContent = 'Drag & drop screenshot here, or click to browse';
            statusText.style.color = '#cbd5e1';
        }
    }
}

// ============================================================
// DYNAMIC INVEST PANEL — Category Filter + Pagination
// ============================================================

let ALL_INVESTMENT_PLANS = [
    { name: 'AMC Movie Ticket',     img: 'images/amc_theater.png',      price: 100, roi: 2.5, duration: '24 Hours' },
    { name: 'Avengers Movie Plan',   img: 'images/avengers_theme.png',   price: 150, roi: 2.5, duration: '24 Hours' },
    { name: 'Netflix Gift Card',    img: 'images/netflix_card.png',     price: 100, roi: 2.5, duration: '24 Hours' },
    { name: 'Amazon Gift Card',     img: 'images/netflix_card.png',      price: 200, roi: 2.5, duration: '24 Hours' }
];

const DB_PLANS_PER_PAGE = 6;
let dbCurrentPage = 1;
let dbCurrentFilter = 'all';
let dbFilteredPlans = [...ALL_INVESTMENT_PLANS];

let dbSearchQuery = '';

async function filterDashboardPlans(filter) {
    dbCurrentFilter = filter || 'all';
    dbCurrentPage = 1;

    try {
        const serverPlans = await apiRequest('/investments/plans');
        ALL_INVESTMENT_PLANS = serverPlans.map(p => ({
            id: p.id,
            name: p.name,
            img: p.img || 'images/amc_theater.png',
            price: Number(p.price),
            roi: Number(p.roi),
            duration: `${Number(p.duration_days)} day(s)`
        }));
    } catch (error) {
        showToast(error.message || 'Unable to load investment plans');
    }
    applyDashboardFilters();
}

function filterDashboardPlansCategory(category, element) {
    dbCurrentFilter = category;
    dbCurrentPage = 1;
    if (element) {
        document.querySelectorAll('.invest-chip').forEach(chip => chip.classList.remove('active'));
        element.classList.add('active');
    }
    applyDashboardFilters();
}

function filterInvestmentsBySearch(query) {
    dbSearchQuery = (query || '').toLowerCase().trim();
    dbCurrentPage = 1;
    applyDashboardFilters();
}

function applyDashboardFilters() {
    dbFilteredPlans = ALL_INVESTMENT_PLANS.filter(plan => {
        const matchesCategory = (dbCurrentFilter === 'all') ||
            (dbCurrentFilter === 'movies' && (plan.name.toLowerCase().includes('movie') || plan.name.toLowerCase().includes('amc') || plan.name.toLowerCase().includes('avengers'))) ||
            (dbCurrentFilter === 'cards' && (plan.name.toLowerCase().includes('card') || plan.name.toLowerCase().includes('gift') || plan.name.toLowerCase().includes('netflix') || plan.name.toLowerCase().includes('amazon')));
        
        const matchesSearch = !dbSearchQuery || plan.name.toLowerCase().includes(dbSearchQuery);
        return matchesCategory && matchesSearch;
    });

    renderDashboardPlansPage();
}

function changeDashboardPage(direction) {
    const totalPages = Math.max(1, Math.ceil(dbFilteredPlans.length / DB_PLANS_PER_PAGE));
    dbCurrentPage = Math.min(Math.max(1, dbCurrentPage + direction), totalPages);
    renderDashboardPlansPage();
}

function renderDashboardPlansPage() {
    const grid = document.getElementById('db-investments-grid');
    const pageInfo = document.getElementById('db-page-info');
    const prevBtn = document.getElementById('db-prev-btn');
    const nextBtn = document.getElementById('db-next-btn');
    if (!grid) return;

    const totalPages = Math.max(1, Math.ceil(dbFilteredPlans.length / DB_PLANS_PER_PAGE));
    const start = (dbCurrentPage - 1) * DB_PLANS_PER_PAGE;
    const pagePlans = dbFilteredPlans.slice(start, start + DB_PLANS_PER_PAGE);

    if (pagePlans.length === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:3.5rem 1.5rem; color:#94a3b8; background:rgba(15,23,42,0.4); border:1px dashed rgba(255,255,255,0.1); border-radius:18px;">
            <span class="material-symbols-outlined" style="font-size:40px; color:#64748b; margin-bottom:0.6rem; display:block;">search_off</span>
            <strong style="color:#f1f5f9; display:block; font-size:1.1rem; margin-bottom:0.2rem;">No matching investment plans</strong>
            <span style="font-size:0.88rem; color:#64748b;">Try searching for different keywords or select 'All Plans'.</span>
        </div>`;
    } else {
        grid.innerHTML = pagePlans.map((plan, i) => {
            const dailyProfitUsd = (plan.price * (plan.roi / 100)).toFixed(2);
            const totalPayoutUsd = (plan.price + (plan.price * (plan.roi / 100))).toFixed(2);
            const isPopular = i === 0 || plan.name.includes('Avengers');
            const isHot = plan.name.includes('AMC') || plan.price >= 200;

            return `
            <article class="investment-card db-investment-card">
                <div class="investment-img-container">
                    <img src="${plan.img}" alt="${plan.name}" class="investment-img" onerror="this.src='images/amc_theater.png'">
                    <div class="card-badge-overlay">
                        <span class="card-roi-pill"><span class="material-symbols-outlined" style="font-size:14px;">trending_up</span> +${plan.roi}% Daily</span>
                        ${isPopular ? '<span class="card-tag-pill hot">🔥 Popular</span>' : (isHot ? '<span class="card-tag-pill hot">⚡ High Yield</span>' : '<span class="card-tag-pill hot">🛡️ Protected</span>')}
                    </div>
                </div>
                <div class="investment-content">
                    <div class="db-investment-heading">
                        <h3 class="investment-title font-display">${plan.name}</h3>
                    </div>
                    
                    <!-- Financial Metrics 2x2 Grid -->
                    <div class="investment-metrics-grid">
                        <div class="metric-cell">
                            <span class="metric-label">Min Deposit</span>
                            <span class="metric-value highlight">$${plan.price.toFixed(2)}</span>
                        </div>
                        <div class="metric-cell">
                            <span class="metric-label">Daily Profit</span>
                            <span class="metric-value profit">+$${dailyProfitUsd}</span>
                        </div>
                        <div class="metric-cell">
                            <span class="metric-label">Cycle Duration</span>
                            <span class="metric-value">${plan.duration}</span>
                        </div>
                        <div class="metric-cell">
                            <span class="metric-label">24h Est. Payout</span>
                            <span class="metric-value payout">$${totalPayoutUsd}</span>
                        </div>
                    </div>

                    <!-- Progress Return Meter -->
                    <div class="plan-yield-meter">
                        <div class="yield-meter-info">
                            <span>100% Capital Safe</span>
                            <span>Auto Payout</span>
                        </div>
                        <div class="yield-meter-track">
                            <div class="yield-meter-bar" style="width: 100%;"></div>
                        </div>
                    </div>

                    <div class="db-investment-action">
                        <button class="db-buy-btn" onclick="openBuyPlanModal('${plan.name.replace(/'/g,"\\'")}', ${plan.price}, ${plan.roi})">
                            <span>Invest Now</span>
                            <span class="material-symbols-outlined">arrow_forward</span>
                        </button>
                    </div>
                </div>
            </article>
            `;
        }).join('');
    }

    if (pageInfo) pageInfo.textContent = `Page ${dbCurrentPage} / ${totalPages}`;
    if (prevBtn) prevBtn.disabled = dbCurrentPage <= 1;
    if (nextBtn) nextBtn.disabled = dbCurrentPage >= totalPages;
}

let currentBuyPlanName = '';
let currentBuyPlanPrice = 0;
let currentBuyPlanRoi = 2.5;

function openBuyPlanModal(planName, price, roi) {
    currentBuyPlanName = planName;
    currentBuyPlanPrice = parseFloat(price) || 0;
    currentBuyPlanRoi = parseFloat(roi) || 2.5;

    const modal = document.getElementById('buy-plan-modal');
    const titleEl = document.getElementById('buy-modal-title');
    const priceEl = document.getElementById('buy-modal-price-display');
    const qtyInput = document.getElementById('buy-modal-qty-input');
    const errorBox = document.getElementById('buy-modal-error-box');
    const confirmBtn = document.getElementById('buy-modal-confirm-btn');

    if (titleEl) titleEl.innerText = `Invest: ${planName}`;
    if (priceEl) priceEl.innerText = `$${currentBuyPlanPrice.toFixed(2)}`;
    if (qtyInput) qtyInput.value = '1';
    if (errorBox) errorBox.style.display = 'none';
    if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.style.opacity = '1';
    }

    updateBuyModalTotalCost();

    if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('active');
    }
}

function closeBuyPlanModal() {
    const modal = document.getElementById('buy-plan-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
    }
}

function setBuyModalQty(qty) {
    const qtyInput = document.getElementById('buy-modal-qty-input');
    if (!qtyInput) return;
    qtyInput.value = Math.max(1, parseInt(qty) || 1);
    updateBuyModalTotalCost();
}

function changeBuyModalQty(delta) {
    const qtyInput = document.getElementById('buy-modal-qty-input');
    if (!qtyInput) return;
    let val = parseInt(qtyInput.value) || 1;
    val = Math.max(1, val + delta);
    qtyInput.value = val;
    updateBuyModalTotalCost();
}

function updateBuyModalTotalCost() {
    const qtyInput = document.getElementById('buy-modal-qty-input');
    const totalEl = document.getElementById('buy-modal-total-display');
    const dailyProfitEl = document.getElementById('buy-modal-daily-profit-display');
    const estPayoutEl = document.getElementById('buy-modal-est-payout-display');
    const errorBox = document.getElementById('buy-modal-error-box');
    const confirmBtn = document.getElementById('buy-modal-confirm-btn');
    if (!qtyInput || !totalEl) return;

    let qty = parseInt(qtyInput.value) || 1;
    if (qty < 1) {
        qty = 1;
        qtyInput.value = '1';
    }

    const totalCost = currentBuyPlanPrice * qty;
    const estDailyProfit = totalCost * (currentBuyPlanRoi / 100);
    const estPayout = totalCost + estDailyProfit;

    totalEl.innerText = `$${totalCost.toFixed(2)}`;
    if (dailyProfitEl) dailyProfitEl.innerText = `+$${estDailyProfit.toFixed(2)} / day`;
    if (estPayoutEl) estPayoutEl.innerText = `$${estPayout.toFixed(2)}`;

    // Check balance
    const balanceEl = document.getElementById('db-total-balance');
    const balanceText = balanceEl ? balanceEl.textContent : '$0';
    const currentBalance = parseFloat(balanceText.replace(/[^0-9.-]+/g, "")) || 0;

    if (currentBalance < totalCost) {
        if (errorBox) {
            errorBox.innerHTML = `Insufficient balance ($${currentBalance.toFixed(2)} available). Please add funds using <a href="javascript:void(0)" onclick="closeBuyPlanModal(); switchTab('deposit')" style="color:#60a5fa; text-decoration:underline; font-weight:700;">Deposit Page</a>.`;
            errorBox.style.display = 'block';
        }
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.style.opacity = '0.5';
        }
    } else {
        if (errorBox) errorBox.style.display = 'none';
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.style.opacity = '1';
        }
    }
}

async function confirmBuyPlan() {
    const qtyInput = document.getElementById('buy-modal-qty-input');
    if (!qtyInput) return;
    const qty = parseInt(qtyInput.value) || 1;

    try {
        const response = await apiRequest('/investments', {
            method: 'POST',
            body: JSON.stringify({
                name: currentBuyPlanName,
                quantity: qty
            })
        });

        showToast(response.message || `Successfully purchased plan: ${currentBuyPlanName}!`);
        closeBuyPlanModal();
        myInvestmentsPage = 1;
        await fetchAllDashboardData();
        switchTab('myinvestments');
    } catch (e) {
        alert(e.message || 'Failed to purchase plan.');
    }
}


function renderMyInvestments(investments) {
    const container = document.getElementById('my-investments-list');
    if (!container) return;
    const rows = Array.isArray(investments) ? investments : [];
    const active = rows.filter(inv => inv.status === 'Active');
    const activePrincipal = active.reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);
    const dailyReturn = active.reduce((sum, inv) => sum + ((Number(inv.amount) || 0) * (Number(inv.daily_profit_pct) || 0) / 100), 0);
    document.getElementById('myinv-active-principal').textContent = formatUSD(activePrincipal);
    document.getElementById('myinv-daily-return').textContent = formatUSD(dailyReturn);
    document.getElementById('myinv-total-plans').textContent = String(rows.length);

    if (!rows.length) {
        const pagination = document.getElementById('my-investments-pagination');
        if (pagination) pagination.hidden = true;
        container.innerHTML = '<div class="financial-empty"><span class="material-symbols-outlined">account_balance</span><strong>No investments yet</strong><small>Choose an investment plan to start your first 24-hour earning cycle.</small><button type="button" onclick="switchTab(\'invest\')">Browse investment plans</button></div>';
        return;
    }

    const dayMs = 86400000;
    const totalPages = Math.max(1, Math.ceil(rows.length / MY_INVESTMENTS_PER_PAGE));
    myInvestmentsPage = Math.min(Math.max(1, myInvestmentsPage), totalPages);
    const visibleRows = rows.slice((myInvestmentsPage - 1) * MY_INVESTMENTS_PER_PAGE, myInvestmentsPage * MY_INVESTMENTS_PER_PAGE);
    container.innerHTML = visibleRows.map((inv, index) => {
        const amount = Number(inv.amount) || 0;
        const roi = Number(inv.daily_profit_pct) || 0;
        const duration = Math.max(1, Number(inv.duration_days) || 1);
        let started = Number(inv.created_at) || Date.parse(inv.start_date || '') || Date.now();
        if (started < 1000000000000) started *= 1000;
        const elapsed = Math.max(0, Date.now() - started);
        const completedCycles = Math.min(duration, Math.floor(elapsed / dayMs));
        const completed = inv.status === 'Completed';
        const cycleProgress = completed ? 100 : Math.min(100, Math.round(((elapsed % dayMs) / dayMs) * 100));
        const remaining = completed ? 0 : Math.max(0, dayMs - (elapsed % dayMs));
        const hours = Math.floor(remaining / 3600000);
        const minutes = Math.floor((remaining % 3600000) / 60000);
        return `<article class="my-investment-card tone-${((myInvestmentsPage - 1) * MY_INVESTMENTS_PER_PAGE + index) % 4}">
            <div class="my-investment-title"><span class="material-symbols-outlined">show_chart</span><div><small>Investment Plan · #${Number(inv.id) || '—'}</small><h2>${escapeUi(inv.name || 'Investment')}</h2></div><b class="status-badge-lbl ${completed ? 'confirmed' : 'active'}">${escapeUi(inv.status || 'Active')}</b></div>
            <div class="my-investment-values"><div><span>Principal</span><strong>${formatUSD(amount)}</strong></div><div><span>Daily ROI</span><strong>+${roi.toFixed(2)}%</strong></div><div><span>Daily commission</span><strong>${formatUSD(amount * roi / 100)}</strong></div><div><span>Cycles</span><strong>${completedCycles} / ${duration}</strong></div></div>
            <div class="my-investment-progress"><div><span>${completed ? 'Plan completed' : `${hours}h ${minutes}m until next commission`}</span><strong>${cycleProgress}%</strong></div><i><em style="width:${cycleProgress}%"></em></i></div>
            <footer><span>Started: ${escapeUi(inv.start_date || '—')}</span><span>Type: Fixed daily-return plan</span></footer>
        </article>`;
    }).join('');
    const pagination = document.getElementById('my-investments-pagination');
    if (pagination) pagination.hidden = rows.length <= MY_INVESTMENTS_PER_PAGE;
    const pageInfo = document.getElementById('myinv-page-info');
    if (pageInfo) pageInfo.textContent = `Page ${myInvestmentsPage} of ${totalPages}`;
    const previous = document.getElementById('myinv-prev');
    const next = document.getElementById('myinv-next');
    if (previous) previous.disabled = myInvestmentsPage <= 1;
    if (next) next.disabled = myInvestmentsPage >= totalPages;
}

function changeMyInvestmentsPage(direction) {
    const totalPages = Math.max(1, Math.ceil(dashboardInvestments.length / MY_INVESTMENTS_PER_PAGE));
    myInvestmentsPage = Math.min(totalPages, Math.max(1, myInvestmentsPage + Number(direction || 0)));
    renderMyInvestments(dashboardInvestments);
    document.getElementById('panel-myinvestments')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function financialStartDate(period) {
    const now = new Date();
    if (period === 'daily') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (period === 'weekly') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
    if (period === 'yearly') return new Date(now.getFullYear(), 0, 1).getTime();
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

function setFinancialPeriod(period) {
    if (!['daily', 'weekly', 'monthly', 'yearly'].includes(period)) return;
    financialPeriod = period;
    financialCustomStart = null;
    financialCustomEnd = null;
    const from = document.getElementById('financial-date-from');
    const to = document.getElementById('financial-date-to');
    if (from) from.value = '';
    if (to) to.value = '';
    renderFinancialOverview(period);
}

function applyFinancialCustomRange(event) {
    event?.preventDefault();
    const from = document.getElementById('financial-date-from')?.value;
    const to = document.getElementById('financial-date-to')?.value;
    if (!from || !to) { showToast('Please select both From and To dates.'); return; }
    const start = new Date(`${from}T00:00:00`).getTime();
    const end = new Date(`${to}T23:59:59.999`).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) { showToast('From date must be before To date.'); return; }
    financialCustomStart = start;
    financialCustomEnd = end;
    financialPeriod = 'custom';
    renderFinancialOverview('custom');
}

function clearFinancialCustomRange() {
    const from = document.getElementById('financial-date-from');
    const to = document.getElementById('financial-date-to');
    if (from) from.value = '';
    if (to) to.value = '';
    setFinancialPeriod('monthly');
}

function renderFinancialOverview(period = 'monthly') {
    const activity = document.getElementById('financial-activity-list');
    if (!activity) return;
    document.querySelectorAll('.financial-period-filter button').forEach(button => button.classList.toggle('active', button.dataset.period === period));
    const start = period === 'custom' && financialCustomStart !== null ? financialCustomStart : financialStartDate(period);
    const end = period === 'custom' && financialCustomEnd !== null ? financialCustomEnd : Date.now();
    const rows = dashboardTransactions.filter(tx => {
        const timestamp = Date.parse(String(tx.date || '').replace(' at ', ' '));
        return Number.isFinite(timestamp) && timestamp >= start && timestamp <= end && String(tx.status || '') === 'Confirmed';
    });
    const sumType = matcher => rows.filter(tx => matcher(String(tx.type || ''))).reduce((sum, tx) => sum + Math.abs(Number(tx.amount) || 0), 0);
    const totals = {
        deposits: sumType(type => type === 'Deposit'),
        invested: sumType(type => type === 'Investment'),
        commissions: sumType(type => /daily commission|profit|earning/i.test(type) && !/referral/i.test(type)),
        referrals: sumType(type => /referral/i.test(type)),
        withdrawals: sumType(type => type === 'Withdrawal')
    };
    const totalEarnings = totals.commissions + totals.referrals;
    const net = totals.deposits + totals.commissions + totals.referrals - totals.invested - totals.withdrawals;
    ['deposits', 'invested', 'commissions', 'referrals', 'withdrawals'].forEach(key => {
        const node = document.getElementById(`fin-${key}`); if (node) node.textContent = formatUSD(totals[key]);
    });
    const earningsNode = document.getElementById('fin-earnings');
    if (earningsNode) earningsNode.textContent = formatUSD(totalEarnings);
    const roiNode = document.getElementById('fin-roi');
    if (roiNode) roiNode.textContent = `${(totals.invested > 0 ? totalEarnings / totals.invested * 100 : 0).toFixed(2)}%`;
    const netNode = document.getElementById('fin-net');
    if (netNode) { netNode.textContent = `${net < 0 ? '-' : ''}${formatUSD(Math.abs(net))}`; netNode.classList.toggle('negative', net < 0); }
    const netLabel = document.getElementById('fin-net-label');
    if (netLabel) netLabel.textContent = net < 0 ? 'Net loss' : 'Net profit / cash flow';
    const activityCount = document.getElementById('fin-activity-count');
    if (activityCount) activityCount.textContent = `${rows.length} record${rows.length === 1 ? '' : 's'}`;
    const periodLabel = document.getElementById('financial-period-label');
    if (periodLabel) {
        const labels = { daily: 'Today', weekly: 'Last 7 days', monthly: 'Current month', yearly: 'Current year' };
        periodLabel.textContent = period === 'custom'
            ? `${new Date(start).toLocaleDateString()} – ${new Date(end).toLocaleDateString()}`
            : labels[period] || 'Current month';
    }

    const bars = document.getElementById('financial-breakdown-bars');
    const labels = [['Deposits','deposits'],['Invested','invested'],['Daily commissions','commissions'],['Referral earnings','referrals'],['Withdrawals','withdrawals']];
    const max = Math.max(1, ...Object.values(totals));
    bars.innerHTML = labels.map(([label,key]) => `<div class="financial-bar-row"><div><span>${label}</span><strong>${formatUSD(totals[key])}</strong></div><i><em class="${key}" style="width:${Math.round(totals[key] / max * 100)}%"></em></i></div>`).join('');

    activity.innerHTML = rows.length ? rows.slice(0, 8).map(tx => {
        const debit = tx.type === 'Investment' || tx.type === 'Withdrawal';
        return `<article class="financial-activity-row"><span class="material-symbols-outlined">${tx.type === 'Deposit' ? 'download' : tx.type === 'Withdrawal' ? 'upload' : /referral/i.test(tx.type) ? 'group' : 'paid'}</span><div><strong>${escapeUi(tx.type)}</strong><small>${escapeUi(tx.date)} · ${escapeUi(tx.ref || '—')}</small></div><b class="${debit ? 'debit' : 'credit'}">${debit ? '-' : '+'}${formatUSD(tx.amount)}</b></article>`;
    }).join('') : '<div class="financial-empty"><strong>No activity in this period</strong><small>Try another date range or make your first transaction.</small></div>';
}

// ============================================================
// GUEST REDIRECT — My Investments & Withdraw nav links
// ============================================================

(function setupGuestNavRedirects() {
    function doRedirectSetup() {
        const token = localStorage.getItem('nova_token');
        const role  = localStorage.getItem('nova_role');
        const isLoggedIn = !!(token && role === 'user');
        if (isLoggedIn) return; // logged-in users: no redirect

        const myInvLinks    = document.querySelectorAll('a[href*="my-investments"], a[href*="tab=myinvestments"]');
        const withdrawLinks = document.querySelectorAll('a[href*="withdraw"]');
        [...myInvLinks, ...withdrawLinks].forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                window.location.href = '/login';
            });
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', doRedirectSetup);
    } else {
        doRedirectSetup();
    }
})();

// ============================================================
// INIT ON PAGE LOAD
// ============================================================

(function initDashboardPanels() {
    function tryInit() {
        if (document.getElementById('db-investments-grid')) {
            filterDashboardPlans('all');
        }
        // Start simulated transaction notification feed
        startLiveTransactionsFeed();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryInit);
    } else {
        tryInit();
    }
})();

async function changeUserPassword(event) {
    if (event) event.preventDefault();
    const pwdInput = document.getElementById('profile-new-password');
    const currentInput = document.getElementById('profile-current-password');
    if (!pwdInput || !currentInput) return;
    const newPassword = pwdInput.value.trim();
    if (newPassword.length < 8) {
        alert("Password must be at least 8 characters long.");
        return;
    }
    
    try {
        await apiRequest('/user/password', {
            method: 'POST',
            body: JSON.stringify({ currentPassword: currentInput.value, newPassword })
        });
        showToast("Password updated successfully!");
        pwdInput.value = '';
        currentInput.value = '';
    } catch (e) {
        alert("Error: " + e.message);
    }
}

// ------------------------------------------------------------
// REFERRAL LINK — COPY TO CLIPBOARD
// ------------------------------------------------------------
function copyReferralLink() {
    const input = document.getElementById('referral-link-input');
    const btn = document.getElementById('copy-ref-btn');
    const link = input ? input.value.trim() : '';
    if (!link) { showToast('Referral link is loading, please wait.'); return; }
    navigator.clipboard.writeText(link)
        .then(() => {
            showToast('Referral link copied to clipboard!');
            if (btn) {
                const orig = btn.innerHTML;
                btn.style.background = '#10b981';
                btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:1rem;vertical-align:middle">check</span> Copied!';
                setTimeout(() => { btn.style.background = ''; btn.innerHTML = orig; }, 2200);
            }
        })
        .catch(() => showToast('Could not copy. Please copy manually.'));
}

// ------------------------------------------------------------
// CHANGE EMAIL MODAL (OTP-BASED)
// ------------------------------------------------------------
function openChangeEmailModal() {
    const modal = document.getElementById('change-email-modal');
    if (!modal) return;
    // Reset to step 1
    const s1 = document.getElementById('change-email-step-1');
    const s2 = document.getElementById('change-email-step-2');
    if (s1) s1.style.display = '';
    if (s2) s2.style.display = 'none';
    const cpwd = document.getElementById('ce-current-password');
    const nemail = document.getElementById('ce-new-email');
    const otp = document.getElementById('ce-otp-code');
    if (cpwd) cpwd.value = '';
    if (nemail) nemail.value = '';
    if (otp) otp.value = '';
    modal.removeAttribute('hidden');
    modal.setAttribute('aria-hidden', 'false');
    modal.style.display = 'flex';
}

function closeChangeEmailModal() {
    const modal = document.getElementById('change-email-modal');
    if (!modal) return;
    modal.setAttribute('hidden', '');
    modal.setAttribute('aria-hidden', 'true');
    modal.style.display = '';
}

async function sendChangeEmailOTP() {
    const currentPassword = document.getElementById('ce-current-password')?.value?.trim();
    const newEmail = document.getElementById('ce-new-email')?.value?.trim();
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
        await apiRequest('/user/change-email/request', {
            method: 'POST',
            body: JSON.stringify({ currentPassword, newEmail })
        });
        // Move to step 2
        const s1 = document.getElementById('change-email-step-1');
        const s2 = document.getElementById('change-email-step-2');
        if (s1) s1.style.display = 'none';
        if (s2) s2.style.display = '';
        showToast('OTP sent to your new email address!');
    } catch (e) {
        showToast('Error: ' + (e.message || 'Could not send OTP.'));
    }
}

async function verifyChangeEmailOTP() {
    const otp = document.getElementById('ce-otp-code')?.value?.trim();
    const newEmail = document.getElementById('ce-new-email')?.value?.trim();
    if (!otp || otp.length < 4) {
        showToast('Please enter the OTP code from your email.');
        return;
    }
    try {
        await apiRequest('/user/change-email/verify', {
            method: 'POST',
            body: JSON.stringify({ otp, newEmail })
        });
        showToast('Email address updated successfully!');
        closeChangeEmailModal();
    } catch (e) {
        showToast('Error: ' + (e.message || 'OTP verification failed.'));
    }
}

// ------------------------------------------------------------
// DYNAMIC SVG EARNINGS CHART PLOTTER
// ------------------------------------------------------------
function renderSVGChart(currentBalance) {
    const container = document.getElementById('earnings-svg-chart-container');
    if (!container) return;

    const balance = parseFloat(currentBalance) || 10.0;
    const dailyRate = 0.025;
    
    const data = [];
    for (let i = 0; i <= 7; i++) {
        data.push({
            day: `Day ${i}`,
            val: balance * Math.pow(1 + dailyRate, i)
        });
    }

    const minVal = data[0].val * 0.98;
    const maxVal = data[7].val * 1.02;
    const valRange = maxVal - minVal;

    const width = container.clientWidth || 600;
    const height = 180;
    const paddingLeft = 55;
    const paddingRight = 20;
    const paddingTop = 20;
    const paddingBottom = 30;

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;

    const getX = (idx) => paddingLeft + (idx / 7) * chartWidth;
    const getY = (val) => paddingTop + chartHeight - ((val - minVal) / valRange) * chartHeight;

    let pathD = `M ${getX(0)} ${getY(data[0].val)}`;
    let areaD = `M ${getX(0)} ${paddingTop + chartHeight} L ${getX(0)} ${getY(data[0].val)}`;

    for (let i = 1; i < data.length; i++) {
        const x = getX(i);
        const y = getY(data[i].val);
        const prevX = getX(i - 1);
        const prevY = getY(data[i - 1].val);
        const cpX1 = prevX + (x - prevX) / 2;
        const cpY1 = prevY;
        const cpX2 = prevX + (x - prevX) / 2;
        const cpY2 = y;
        
        pathD += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${x} ${y}`;
        areaD += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${x} ${y}`;
    }

    areaD += ` L ${getX(7)} ${paddingTop + chartHeight} Z`;

    let svg = `<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="chart-glow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.25"/>
                <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.00"/>
            </linearGradient>
        </defs>
    `;

    const gridRows = 4;
    for (let i = 0; i <= gridRows; i++) {
        const yVal = minVal + (i / gridRows) * valRange;
        const y = getY(yVal);
        svg += `
            <line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="4 4" />
            <text x="${paddingLeft - 10}" y="${y + 4}" fill="#64748b" font-size="9" font-weight="600" text-anchor="end">$${yVal.toFixed(2)}</text>
        `;
    }

    svg += `<path d="${areaD}" fill="url(#chart-glow)" />`;
    svg += `<path d="${pathD}" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" />`;

    data.forEach((d, idx) => {
        const x = getX(idx);
        const y = getY(d.val);
        svg += `
            <line x1="${x}" y1="${paddingTop}" x2="${x}" y2="${paddingTop + chartHeight}" stroke="rgba(255,255,255,0.02)" />
            <text x="${x}" y="${height - 10}" fill="#64748b" font-size="9" font-weight="600" text-anchor="middle">${d.day}</text>
            <circle cx="${x}" cy="${y}" r="4" fill="#111622" stroke="#3b82f6" stroke-width="2" />
        `;
    });

    svg += `</svg>`;
    container.innerHTML = svg;
}

// ------------------------------------------------------------
// SIMULATED LIVE TRANSACTIONS POPUP FEED
// ------------------------------------------------------------
function startLiveTransactionsFeed() {
    // Removed simulated toast logic
}

// Mobile-only PWA prompt. It intentionally lives on the authenticated user dashboard.
(function initDashboardPwaPrompt() {
    const banner = document.getElementById('dashboard-pwa-banner');
    const installButton = document.getElementById('dashboard-pwa-install');
    const laterButton = document.getElementById('dashboard-pwa-later');
    const help = document.getElementById('dashboard-pwa-help');
    if (!banner || !installButton || !laterButton) return;

    const snoozeKey = 'nova_pwa_dismissed';
    const installedKey = 'nova_pwa_installed';
    const snoozeMs = 24 * 60 * 60 * 1000;
    const isMobile = window.matchMedia('(max-width: 768px)').matches && /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    let deferredPrompt = null;
    let showTimer = null;

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
    }

    function hideBanner() {
        banner.classList.remove('show');
        banner.hidden = true;
    }

    function rememberInstalled() {
        localStorage.setItem(installedKey, '1');
        if (showTimer) clearTimeout(showTimer);
        hideBanner();
    }

    function showBanner() {
        if (!isMobile || isStandalone() || localStorage.getItem(installedKey) === '1') return;
        const dismissedAt = Number(localStorage.getItem(snoozeKey) || 0);
        if (dismissedAt && Date.now() - dismissedAt < snoozeMs) return;
        if (!deferredPrompt && !isIos) return;
        if (isIos && help) help.textContent = 'Tap Install, then use Share → Add to Home Screen.';
        banner.hidden = false;
        banner.classList.add('show');
    }

    if (!isMobile) return;
    if (isStandalone()) {
        rememberInstalled();
        return;
    }

    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        deferredPrompt = event;
    });
    window.addEventListener('appinstalled', rememberInstalled);

    installButton.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const choice = await deferredPrompt.userChoice;
            deferredPrompt = null;
            if (choice.outcome === 'accepted') rememberInstalled();
            else localStorage.setItem(snoozeKey, String(Date.now()));
            hideBanner();
            return;
        }
        if (isIos && help) help.textContent = 'In Safari tap Share, then “Add to Home Screen”.';
    });

    const closeButton = document.getElementById('dashboard-pwa-close');

    laterButton.addEventListener('click', () => {
        localStorage.setItem(snoozeKey, String(Date.now()));
        hideBanner();
    });

    if (closeButton) {
        closeButton.addEventListener('click', () => {
            localStorage.setItem(snoozeKey, String(Date.now()));
            hideBanner();
        });
    }

    showTimer = window.setTimeout(showBanner, 30000 + Math.random() * 10000);
})();
