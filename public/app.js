// Client-side Application Logic for CineInvest & TRONINVEST connecting to Node.js Express APIs

const API_BASE = '/api';
let selectedDepositAmount = 50.00;

// Format Currency Helper
function formatUSD(amount) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
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
    const authApp = document.getElementById('authenticated-app');
    const loginCont = document.getElementById('login-container');
    if (authApp && loginCont) {
        authApp.style.display = 'none';
        loginCont.style.display = 'flex';
    } else {
        window.location.href = '/login';
    }
}

// Switch tabs inside dashboard
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

        // Initialize dynamic panels on first switch
        if (tabId === 'invest' && typeof filterDashboardPlans === 'function') {
            filterDashboardPlans(typeof dbCurrentFilter !== 'undefined' ? dbCurrentFilter : 'all');
        }
        if (tabId === 'myinvestments' && typeof renderDummyMyInvestments === 'function') {
            renderDummyMyInvestments();
        }
    }
}

// Fetch and load all panels data
async function fetchAllDashboardData() {
    if (!localStorage.getItem('nova_token')) return;

    try {
        const profile = await apiRequest('/user/profile');
        
        // Render user card info
        const userAvatar = document.querySelector('.user-avatar-circle');
        if (userAvatar && profile.name) {
            const initials = profile.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
            userAvatar.textContent = initials;
        }
        const userNameLabel = document.querySelector('.user-name-label');
        if (userNameLabel && profile.name) {
            userNameLabel.textContent = profile.name;
        }
        
        // Render profile metrics
        const balanceHeader = document.getElementById('user-balance-header');
        if (balanceHeader) balanceHeader.textContent = `Balance: ${formatUSD(profile.balance)}`;
        
        const dbTotalBalance = document.getElementById('db-total-balance');
        if (dbTotalBalance) dbTotalBalance.textContent = formatUSD(profile.balance);
        
        const dbTotalEarnings = document.getElementById('db-total-earnings');
        if (dbTotalEarnings) dbTotalEarnings.textContent = formatUSD(profile.earnings);
        
        const dbActiveInvestments = document.getElementById('db-active-investments');
        if (dbActiveInvestments) dbActiveInvestments.textContent = formatUSD(profile.active_investments);

        const dbReferralCode = document.getElementById('db-referral-code');
        if (dbReferralCode && profile.referral_code) {
            dbReferralCode.textContent = profile.referral_code;
        }

        const referralLinkInput = document.getElementById('referral-link-input');
        if (referralLinkInput && profile.referral_code) {
            referralLinkInput.value = `${window.location.origin}/login?ref=${profile.referral_code}`;
        }

        if (profile.referralsStats) {
            const listItems = document.querySelectorAll('#panel-referrals .db-list-box .db-list-item');
            if (listItems.length >= 3) {
                const totalRefVal = listItems[0].querySelector('.db-item-primary');
                if (totalRefVal) totalRefVal.textContent = `${profile.referralsStats.totalReferrals} users`;

                const activeRefVal = listItems[1].querySelector('.db-item-primary');
                if (activeRefVal) activeRefVal.textContent = `${profile.referralsStats.activeReferralsCount} users`;

                const totalComVal = listItems[2].querySelector('.db-item-primary');
                if (totalComVal) totalComVal.textContent = formatUSD(profile.referralsStats.totalComEarned);
            }

            const latestSignupsContainer = document.querySelector('#panel-referrals .recent-deposits-section:nth-child(2) .db-list-box');
            if (latestSignupsContainer && profile.referralsStats.signups) {
                if (profile.referralsStats.signups.length === 0) {
                    latestSignupsContainer.innerHTML = '<li class="db-list-item"><span style="color:#64748b; font-size:0.85rem;">No referrals signed up yet.</span></li>';
                } else {
                    latestSignupsContainer.innerHTML = profile.referralsStats.signups.map(s => `
                        <li class="db-list-item">
                            <div>
                                <div class="db-item-primary">${s.name}</div>
                                <div class="db-item-sec">${s.email}</div>
                            </div>
                        </li>
                    `).join('');
                }
            }
        }

        // Fetch logs
        const deposits = await apiRequest('/deposits');
        renderDepositsTable(deposits);

        const investments = await apiRequest('/investments');
        renderInvestmentsTable(investments);

        const transactions = await apiRequest('/transactions');
        renderAllTransactionsTable(transactions);

        const tickets = await apiRequest('/tickets');
        renderTicketsTable(tickets);

    } catch (e) {
        console.error('Error fetching dashboard data:', e.message);
    }
}

// Initialize Application Routing & Listeners
document.addEventListener("DOMContentLoaded", async () => {
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
                hint.innerHTML = `✨ Deposit required for <strong>${planParam || 'Investment Plan'}</strong>: <strong>$${amtVal} USDT</strong>`;
            }
            showToast(`Auto-selected Deposit Amount: $${amtVal} USDT`);
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
    const logoutBtn = document.querySelector('.sidebar-item-link.logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logout();
        });
    }

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
        const logoutLink = profileDropdown.querySelector('.logout-action-btn');
        if (logoutLink) {
            logoutLink.addEventListener('click', (e) => {
                e.preventDefault();
                logout();
            });
        }
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

// Copy TRON address function
function copyWalletAddress() {
    const addrInput = document.getElementById('tron-wallet-address');
    const copyBtn = document.getElementById('copy-tron-btn');
    if (addrInput) {
        addrInput.select();
        addrInput.setSelectionRange(0, 99999);
        
        navigator.clipboard.writeText(addrInput.value)
            .then(() => {
                showToast("TRON (TRC20) wallet address copied!");
                if (copyBtn) {
                    const originalHTML = copyBtn.innerHTML;
                    copyBtn.style.backgroundColor = '#10b981';
                    copyBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 14px;">check</span><span>Copied!</span>`;
                    setTimeout(() => {
                        copyBtn.style.backgroundColor = '#3b82f6';
                        copyBtn.innerHTML = originalHTML;
                    }, 2000);
                }
            })
            .catch(() => {
                showToast("Failed to copy address.");
            });
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
        if (isNaN(amount) || amount < 10) {
            alert("Please enter a valid deposit amount of $10.00 or more.");
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
        await fetchAllDashboardData();
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

    if (isNaN(amount) || amount < 100) {
        alert("Minimum withdrawal limit is $100.00.");
        return;
    }

    try {
        await apiRequest('/withdrawals', {
            method: 'POST',
            body: JSON.stringify({
                address,
                amount
            })
        });

        addressInput.value = '';
        amountInput.value = '';
        
        showToast("Withdrawal request submitted! Processing...");
        await fetchAllDashboardData();
    } catch (e) {
        alert(e.message || 'Failed to submit withdrawal request.');
    }
}
// HTML Escape Helper
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// Send support message in chat panel
async function sendChatMessage() {
    const input = document.getElementById('chat-message-input');
    if (!input) return;
    const msg = input.value.trim();
    if (msg === '') return;

    try {
        input.disabled = true;
        const sendBtn = document.querySelector('.chat-send-btn');
        if (sendBtn) sendBtn.disabled = true;

        await apiRequest('/tickets', {
            method: 'POST',
            body: JSON.stringify({
                title: 'Support Query',
                message: msg
            })
        });

        input.value = '';
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
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#64748b;">No recent deposits found.</td></tr>`;
        return;
    }

    tbody.innerHTML = deposits.map(dep => {
        const isConfirmed = dep.status === 'Confirmed';
        const badgeBg = isConfirmed ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)';
        const badgeColor = isConfirmed ? '#10b981' : '#f59e0b';
        const badgeBorder = isConfirmed ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)';
        const formattedAmount = typeof dep.amount === 'number' ? `$${dep.amount}` : `$${dep.amount}`;
        return `
        <tr style="border-bottom: 1px solid #1e2538;">
            <td style="padding: 1rem 1.25rem; color: #cbd5e1; font-size: 0.85rem;">${dep.date || 'Today'}</td>
            <td style="padding: 1rem 1.25rem; font-weight: 700; color: #f8fafc; font-size: 0.85rem;">${formattedAmount}</td>
            <td style="padding: 1rem 1.25rem; color: #cbd5e1; font-size: 0.85rem; font-family: monospace;">${dep.txn_id || 'TXN7f3e8d9c2a1b4f...'}</td>
            <td style="padding: 1rem 1.25rem;">
                <span style="background-color: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}; padding: 0.25rem 0.75rem; border-radius: 99px; font-size: 0.75rem; font-weight: 600;">${dep.status}</span>
            </td>
        </tr>
    `;
    }).join('');
}

function renderAllTransactionsTable(transactions) {
    const tbody = document.getElementById('all-transactions-table-body');
    if (!tbody) return;

    if (transactions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#64748b;">No transactions logged.</td></tr>`;
        return;
    }

    tbody.innerHTML = transactions.map(tx => {
        let typeColor = "#3b82f6";
        if (tx.type === "Investment") typeColor = "#a855f7";
        if (tx.type === "Withdrawal") typeColor = "#ef4444";

        return `
            <tr>
                <td>${tx.date}</td>
                <td style="font-weight:600; color: ${typeColor};">${tx.type}</td>
                <td style="font-weight: 700; color: #f8fafc;">$${tx.amount.toFixed(2)}</td>
                <td class="deposit-tx-hash">${tx.ref.substring(0, 16)}...</td>
                <td>
                    <span class="status-badge-lbl ${tx.status.toLowerCase()}">${tx.status}</span>
                </td>
            </tr>
        `;
    }).join('');
}

function renderInvestmentsTable(investments) {
    const tbody = document.getElementById('my-investments-table-body');
    if (!tbody) return;

    if (investments.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #64748b;">No active investments found. Buy a plan to start.</td></tr>`;
        return;
    }

    tbody.innerHTML = investments.map(inv => `
        <tr>
            <td style="font-weight:600; color:#f8fafc;">${inv.name}</td>
            <td style="font-weight:700; color:#3b82f6;">$${inv.amount.toFixed(2)}</td>
            <td style="color:#10b981; font-weight:600;">+${inv.daily_profit_pct}% / day</td>
            <td>${inv.duration_days} Days</td>
            <td><span class="status-badge-lbl confirmed">${inv.status}</span></td>
        </tr>
    `).join('');
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
        let html = `
            <div class="chat-bubble-wrapper user">
                <div class="chat-bubble">
                    ${escapeHTML(ticket.message)}
                    <span class="chat-bubble-time">${ticket.date}</span>
                </div>
            </div>
        `;
        if (ticket.admin_reply) {
            html += `
                <div class="chat-bubble-wrapper support">
                    <div class="chat-bubble">
                        ${escapeHTML(ticket.admin_reply)}
                        <span class="chat-bubble-time">${ticket.date}</span>
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
let currentSelectedDepositAmount = 50;

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
    if (isNaN(parsed) || parsed < 10) {
        showToast("Please enter a valid amount of $10 or more.", "error");
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

async function submitNewDeposit() {
    const inputEl = document.getElementById('deposit-tx-hash-input');
    const screenshotEl = document.getElementById('deposit-screenshot-input');
    
    if (!inputEl || inputEl.value.trim() === "") {
        alert("Please enter your TRON (TRC20) Transaction ID.");
        return;
    }
    if (!screenshotEl || !screenshotEl.files || screenshotEl.files.length === 0) {
        alert("Please upload a screenshot of your payment.");
        return;
    }

    const txnId = inputEl.value.trim();
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
                    txnId: txnId,
                    screenshotBase64: base64Image,
                    planName: planName || null
                })
            });
            showToast("Deposit submitted! Waiting please for admin approval.");
            inputEl.value = "";
            screenshotEl.value = "";
            await fetchAllDashboardData();
        } catch (e) {
            console.error("Deposit error:", e);
            showToast(e.message || "Failed to submit deposit. Please try again.", "error");
        }
    };
    reader.readAsDataURL(file);
}

// ============================================================
// DYNAMIC INVEST PANEL — Category Filter + Pagination
// ============================================================

const ALL_INVESTMENT_PLANS = [
    { name: 'AMC Movie Ticket',     img: 'images/amc_theater.png',      price: 100, roi: 2.5, duration: '24 Hours', category: 'movies' },
    { name: 'Avengers: Endgame',    img: 'images/avengers_theme.png',   price: 100, roi: 2.5, duration: '24 Hours', category: 'movies' },
    { name: 'Movie Combo',          img: 'images/movie_combo.png',      price: 100, roi: 2.5, duration: '24 Hours', category: 'products' },
    { name: 'Netflix Gift Card',    img: 'images/netflix_card.png',     price: 100, roi: 2.5, duration: '24 Hours', category: 'giftcards' },
    { name: 'Spider-Man Ticket',    img: 'images/amc_theater.png',      price: 150, roi: 3.0, duration: '24 Hours', category: 'movies' },
    { name: 'Black Panther Plan',   img: 'images/avengers_theme.png',   price: 200, roi: 3.0, duration: '24 Hours', category: 'movies' },
    { name: 'Popcorn Combo Deal',   img: 'images/movie_combo.png',      price: 80,  roi: 2.5, duration: '24 Hours', category: 'products' },
    { name: 'Amazon Gift Card',     img: 'images/netflix_card.png',     price: 120, roi: 2.5, duration: '24 Hours', category: 'giftcards' },
    { name: 'Guardians Ticket',     img: 'images/amc_theater.png',      price: 100, roi: 2.5, duration: '24 Hours', category: 'movies' },
    { name: 'IMAX Experience',      img: 'images/avengers_theme.png',   price: 250, roi: 3.5, duration: '24 Hours', category: 'movies' },
    { name: 'Soda + Snack Pack',    img: 'images/movie_combo.png',      price: 60,  roi: 2.0, duration: '24 Hours', category: 'products' },
    { name: 'Google Play Card',     img: 'images/netflix_card.png',     price: 90,  roi: 2.5, duration: '24 Hours', category: 'giftcards' },
];

const DB_PLANS_PER_PAGE = 6;
let dbCurrentPage = 1;
let dbCurrentFilter = 'all';
let dbFilteredPlans = [...ALL_INVESTMENT_PLANS];

function filterDashboardPlans(filter) {
    dbCurrentFilter = filter;
    dbCurrentPage = 1;

    const customPlans = JSON.parse(localStorage.getItem('nova_custom_plans') || '[]');
    const allPlans = [...ALL_INVESTMENT_PLANS, ...customPlans.map(p => ({
        name: p.name, img: p.img || 'images/amc_theater.png',
        price: parseFloat(p.price) || 100, roi: parseFloat(p.roi) || 2.5,
        duration: '24 Hours', category: (p.category || 'movies').toLowerCase()
    }))];

    dbFilteredPlans = filter === 'all' ? allPlans : allPlans.filter(p => p.category === filter);

    ['all','movies','products','giftcards'].forEach(f => {
        const btn = document.getElementById('db-filter-' + f);
        if (btn) btn.classList.toggle('active', f === filter);
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
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:3rem; color:#64748b;">No plans found in this category.</div>`;
    } else {
        grid.innerHTML = pagePlans.map((plan, i) => `
            <div class="investment-card">
                <div class="investment-img-container">
                    <img src="${plan.img}" alt="${plan.name}" class="investment-img" onerror="this.src='images/amc_theater.png'">
                </div>
                <div class="investment-content">
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.5rem;">
                        <h3 class="investment-title font-display" style="font-size:1rem; margin:0;">${plan.name}</h3>
                        <span style="font-size:0.7rem; background:rgba(59,130,246,0.15); color:#60a5fa; border-radius:99px; padding:0.2rem 0.6rem; font-weight:600; text-transform:capitalize;">${plan.category}</span>
                    </div>
                    <div class="daily-profit-badge">Daily Profit ${plan.roi}%</div>
                    <div class="investment-meta-grid" style="margin-top:1rem;">
                        <div>
                            <div class="meta-item-label">Price</div>
                            <div class="meta-item-value highlight">$${plan.price.toFixed(2)}</div>
                        </div>
                        <div>
                            <div class="meta-item-label">Duration</div>
                            <div class="meta-item-value">${plan.duration}</div>
                        </div>
                        <div>
                            <div class="meta-item-label">Daily Earn</div>
                            <div class="meta-item-value" style="color:#10b981;">+$${(plan.price * plan.roi / 100).toFixed(2)}</div>
                        </div>
                        <div>
                            <div class="meta-item-label">Payout</div>
                            <div class="meta-item-value">$${(plan.price + plan.price * plan.roi / 100).toFixed(2)}</div>
                        </div>
                    </div>
                    <div style="display:flex; gap:0.5rem; margin-top:1rem; align-items:center;">
                        <div style="display:flex; align-items:center; gap:0.25rem; background:#0b0e14; border:1px solid #1e2538; border-radius:6px; padding:0.3rem 0.5rem; width:85px; flex-shrink:0;">
                            <span style="font-size:0.7rem; color:#64748b; font-weight:600;">Qty:</span>
                            <input type="number" id="db-qty-${start+i}" min="1" value="1" style="background:none; border:none; outline:none; color:#f1f5f9; font-weight:700; width:100%; text-align:center; font-size:0.85rem;">
                        </div>
                        <button onclick="handleDashboardBuyPlan('${plan.name.replace(/'/g,"\\'")}', ${plan.price}, 'db-qty-${start+i}')" style="background:#3b82f6; color:white; padding:0.5rem 1rem; border-radius:6px; font-size:0.8rem; font-weight:700; flex-grow:1; border:none; cursor:pointer;">Buy Plan</button>
                    </div>
                </div>
            </div>
        `).join('');
    }

    if (pageInfo) pageInfo.textContent = `Page ${dbCurrentPage} / ${totalPages}`;
    if (prevBtn) prevBtn.disabled = dbCurrentPage <= 1;
    if (nextBtn) nextBtn.disabled = dbCurrentPage >= totalPages;
}

function handleDashboardBuyPlan(planName, price, qtyId) {
    const qtyEl = document.getElementById(qtyId);
    const qty = parseInt(qtyEl ? qtyEl.value : '1') || 1;
    window.location.href = `/dashboard?tab=deposit&plan=${encodeURIComponent(planName)}&amount=${price * qty}`;
}

// ============================================================
// DUMMY INVESTMENTS FOR MY INVESTMENTS PAGE
// ============================================================

function renderDummyMyInvestments() {
    const tbody = document.getElementById('myinvestments-table-body');
    if (!tbody) return;

    const realPurchases = JSON.parse(localStorage.getItem('nova_user_investments') || '[]');
    const dummyData = [
        { name: 'AMC Movie Ticket',    amount: 100, roi: 2.5, status: 'Active',    hoursLeft: 18, progress: 0.25 },
        { name: 'Avengers: Endgame',   amount: 150, roi: 2.5, status: 'Active',    hoursLeft: 7,  progress: 0.71 },
        { name: 'Movie Combo',         amount: 80,  roi: 2.5, status: 'Completed', hoursLeft: 0,  progress: 1.0  },
        { name: 'Netflix Gift Card',   amount: 120, roi: 2.5, status: 'Completed', hoursLeft: 0,  progress: 1.0  },
    ];

    const investments = realPurchases.length > 0 ? realPurchases : dummyData;
    let totalPrincipal = 0, totalProfit = 0, completed = 0;

    tbody.innerHTML = investments.map(inv => {
        totalPrincipal += inv.amount;
        const daily = inv.amount * inv.roi / 100;
        totalProfit += daily;
        const isCompleted = inv.status === 'Completed' || inv.progress >= 1;
        if (isCompleted) completed++;
        const pct = Math.round((inv.progress || 0) * 100);
        const color = isCompleted ? '#10b981' : '#3b82f6';

        return `
            <tr style="border-bottom:1px solid #1e2538;">
                <td style="padding:1rem 1.25rem; color:#f8fafc; font-weight:700; font-size:0.88rem;">${inv.name}</td>
                <td style="padding:1rem 1.25rem; color:#f8fafc; font-weight:700;">$${inv.amount.toFixed(2)}</td>
                <td style="padding:1rem 1.25rem; color:#10b981; font-weight:700;">+${inv.roi}% ($${daily.toFixed(2)})</td>
                <td style="padding:1rem 1.25rem; color:#f8fafc; font-weight:700;">$${(inv.amount + daily).toFixed(2)}</td>
                <td style="padding:1rem 1.25rem;">
                    <div style="display:flex; flex-direction:column; gap:0.35rem; width:140px;">
                        <div style="display:flex; justify-content:space-between; font-size:0.72rem; color:#94a3b8;">
                            <span style="color:${color}; font-weight:600;">${isCompleted ? 'Completed' : 'Active'}</span>
                            <span>${isCompleted ? 'Done ✓' : (inv.hoursLeft || '?') + 'h left'}</span>
                        </div>
                        <div style="width:100%; height:6px; background:#1e2538; border-radius:4px; overflow:hidden;">
                            <div style="width:${pct}%; height:100%; background:linear-gradient(90deg,${color},${isCompleted ? '#34d399' : '#60a5fa'}); border-radius:4px;"></div>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Update summary metrics
    const metricsRow = document.querySelector('#panel-myinvestments .dashboard-metrics-row');
    if (metricsRow) {
        const vals = metricsRow.querySelectorAll('.metric-val');
        if (vals[0]) vals[0].textContent = `$${totalPrincipal.toFixed(2)}`;
        if (vals[1]) vals[1].textContent = `+$${totalProfit.toFixed(2)}`;
        if (vals[2]) vals[2].textContent = completed;
    }
}

// ============================================================
// GUEST REDIRECT — My Investments & Withdraw nav links
// ============================================================

(function setupGuestNavRedirects() {
    function doRedirectSetup() {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const role  = localStorage.getItem('role')  || sessionStorage.getItem('role');
        const isLoggedIn = !!(token && role === 'user');
        if (isLoggedIn) return; // logged-in users: no redirect

        const myInvLinks    = document.querySelectorAll('a[href*="my-investments"], a[href*="tab=myinvestments"]');
        const withdrawLinks = document.querySelectorAll('a[href*="withdraw"]');
        [...myInvLinks, ...withdrawLinks].forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                window.location.href = '/register';
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
        if (document.getElementById('myinvestments-table-body')) {
            renderDummyMyInvestments();
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryInit);
    } else {
        tryInit();
    }
})();
