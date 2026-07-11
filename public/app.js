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
    if (addrInput) {
        addrInput.select();
        addrInput.setSelectionRange(0, 99999);
        
        navigator.clipboard.writeText(addrInput.value)
            .then(() => {
                showToast("TRON (TRC20) wallet address copied!");
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

    tbody.innerHTML = deposits.map(dep => `
        <tr>
            <td>${dep.date}</td>
            <td style="font-weight: 700; color: #f8fafc;">$${dep.amount.toFixed(2)}</td>
            <td>
                ${dep.screenshot_path ? `<a href="${dep.screenshot_path}" target="_blank" style="color: #3b82f6; text-decoration: underline; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem;"><span class="material-symbols-outlined" style="font-size: 1rem;">image</span>View Screenshot</a>` : `<span style="color: #64748b; font-size: 0.8rem;">No screenshot</span>`}
            </td>
            <td>
                <span class="status-badge-lbl ${dep.status.toLowerCase()}">${dep.status}</span>
            </td>
        </tr>
    `).join('');
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
        btn.style.backgroundColor = '#10b981'; // Green CTA button
        btn.setAttribute('onclick', "window.location.href='/login'");
    });
}
