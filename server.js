const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 80;
const JWT_SECRET = 'nova-super-secret-key-2026';

// Increase payload limit to support base64 uploads
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));
app.use(cors());

// Ensure database and uploads directories exist
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Connect to SQLite Database
const dbPath = path.join(dbDir, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initializeDatabase();
    }
});

// Helper database functions to use Promises
function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Database Initialization & Seeding
async function initializeDatabase() {
    try {
        // 1. Create Users Table
        await dbRun(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                balance REAL DEFAULT 0.0,
                earnings REAL DEFAULT 0.0,
                active_investments REAL DEFAULT 0.0,
                role TEXT DEFAULT 'user',
                referred_by INTEGER DEFAULT NULL,
                referral_code TEXT UNIQUE,
                username TEXT UNIQUE,
                FOREIGN KEY (referred_by) REFERENCES users(id)
            )
        `);

        // Ensure referral columns exist (for older SQLite databases)
        try {
            await dbRun('ALTER TABLE users ADD COLUMN referred_by INTEGER DEFAULT NULL');
        } catch (e) {
            // Ignore if column already exists
        }
        try {
            await dbRun('ALTER TABLE users ADD COLUMN referral_code TEXT');
        } catch (e) {
            // Ignore if column already exists
        }
        try {
            await dbRun('ALTER TABLE users ADD COLUMN username TEXT');
        } catch (e) {
            // Ignore if column already exists
        }

        // 2. Create Deposits Table
        await dbRun(`
            CREATE TABLE IF NOT EXISTS deposits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                date TEXT NOT NULL,
                amount REAL NOT NULL,
                txn_id TEXT UNIQUE NOT NULL,
                screenshot_path TEXT,
                plan_name TEXT,
                status TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        // Ensure screenshot_path and plan_name columns exist in deposits (for older databases)
        try {
            await dbRun('ALTER TABLE deposits ADD COLUMN screenshot_path TEXT');
        } catch (e) {
            // Ignore if column already exists
        }
        try {
            await dbRun('ALTER TABLE deposits ADD COLUMN plan_name TEXT');
        } catch (e) {
            // Ignore if column already exists
        }


        // 3. Create Investments Table
        await dbRun(`
            CREATE TABLE IF NOT EXISTS investments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                name TEXT NOT NULL,
                amount REAL NOT NULL,
                daily_profit_pct REAL NOT NULL,
                duration_days INTEGER NOT NULL,
                status TEXT NOT NULL,
                start_date TEXT NOT NULL,
                created_at INTEGER,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        // Ensure created_at column exists in investments (for older databases)
        try {
            await dbRun('ALTER TABLE investments ADD COLUMN created_at INTEGER');
        } catch (e) {
            // Ignore if column already exists
        }

        // 4. Create Transactions Table
        await dbRun(`
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                date TEXT NOT NULL,
                type TEXT NOT NULL,
                amount REAL NOT NULL,
                ref TEXT UNIQUE NOT NULL,
                status TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        // 5. Create Tickets Table
        await dbRun(`
            CREATE TABLE IF NOT EXISTS tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                title TEXT NOT NULL,
                ticket_id TEXT UNIQUE NOT NULL,
                date TEXT NOT NULL,
                status TEXT NOT NULL,
                message TEXT NOT NULL,
                admin_reply TEXT DEFAULT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        console.log('SQLite tables initialized successfully.');

        // Seed default user John Doe if not exists
        const testUser = await dbGet('SELECT * FROM users WHERE email = ?', ['john.doe@example.com']);
        if (!testUser) {
            const hashedPassword = await bcrypt.hash('password123', 10);
            await dbRun(
                'INSERT INTO users (name, email, username, password, balance, earnings, active_investments, role, referral_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                ['John Doe', 'john.doe@example.com', 'johndoe', hashedPassword, 350.00, 45.50, 0.00, 'user', 'JOHN8888']
            );
            
            const seededUser = await dbGet('SELECT id FROM users WHERE email = ?', ['john.doe@example.com']);
            const userId = seededUser.id;

            // Seed historical deposits
            await dbRun(
                'INSERT INTO deposits (user_id, date, amount, txn_id, screenshot_path, status) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, 'May 12, 2024 10:45 AM', 100.00, 'TXN7F3E8D9C2A1B4F2C9E8', '/uploads/sample_receipt.png', 'Confirmed']
            );
            await dbRun(
                'INSERT INTO deposits (user_id, date, amount, txn_id, screenshot_path, status) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, 'May 10, 2024 02:30 PM', 50.00, 'TXN5A6B7C8D9E0F1A2B3C4', '/uploads/sample_receipt.png', 'Confirmed']
            );

            // Seed historical transactions
            await dbRun(
                'INSERT INTO transactions (user_id, date, type, amount, ref, status) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, 'May 12, 2024 10:45 AM', 'Deposit', 100.00, 'TXN7F3E8D9C2A1B4F2C9E8', 'Confirmed']
            );
            await dbRun(
                'INSERT INTO transactions (user_id, date, type, amount, ref, status) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, 'May 10, 2024 02:30 PM', 'Deposit', 50.00, 'TXN5A6B7C8D9E0F1A2B3C4', 'Confirmed']
            );

            // Seed ticket
            await dbRun(
                'INSERT INTO tickets (user_id, title, ticket_id, date, status, message, admin_reply) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [userId, 'Deposit not reflecting', '#47291', 'May 8, 2024', 'Resolved', 'My deposit from May 8 has not been credited to my balance yet. Please verify.', 'Apologies for the delay. Your transaction has now been verified and credited.']
            );

            console.log('Seeded database with default user John Doe.');
        }

        // Seed default Admin if not exists
        const adminUser = await dbGet('SELECT * FROM users WHERE email = ?', ['admin@nova.com']);
        if (!adminUser) {
            const hashedAdminPassword = await bcrypt.hash('admin123', 10);
            await dbRun(
                'INSERT INTO users (name, email, username, password, balance, earnings, active_investments, role, referral_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                ['Nova Admin', 'admin@nova.com', 'novadmin', hashedAdminPassword, 0.00, 0.00, 0.00, 'admin', 'ADMIN9999']
            );
            console.log('Seeded database with default admin user: admin@nova.com');
        }

        // Seed demo admin ("admin" / "admin123") if not exists
        const demoAdmin = await dbGet('SELECT * FROM users WHERE email = ?', ['admin']);
        if (!demoAdmin) {
            const hashedAdminPassword = await bcrypt.hash('admin123', 10);
            await dbRun(
                'INSERT INTO users (name, email, username, password, balance, earnings, active_investments, role, referral_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                ['Demo Admin', 'admin', 'admin', hashedAdminPassword, 0.00, 0.00, 0.00, 'admin', 'ADMIN7777']
            );
            console.log('Seeded database with demo admin: admin');
        }

        // Seed demo user ("user" / "user123") if not exists
        const demoUser = await dbGet('SELECT * FROM users WHERE email = ?', ['user']);
        if (!demoUser) {
            const hashedUserPassword = await bcrypt.hash('user123', 10);
            await dbRun(
                'INSERT INTO users (name, email, username, password, balance, earnings, active_investments, role, referral_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                ['Demo User', 'user', 'user', hashedUserPassword, 1000.00, 150.00, 0.00, 'user', 'USER7777']
            );
            
            const seededUser = await dbGet('SELECT id FROM users WHERE email = ?', ['user']);
            const userId = seededUser.id;

            // Seed historical deposits and transactions for the demo user
            await dbRun(
                'INSERT INTO deposits (user_id, date, amount, txn_id, screenshot_path, status) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, 'May 12, 2024 10:45 AM', 500.00, 'TXNDEMO123456', '/uploads/sample_receipt.png', 'Confirmed']
            );
            await dbRun(
                'INSERT INTO transactions (user_id, date, type, amount, ref, status) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, 'May 12, 2024 10:45 AM', 'Deposit', 500.00, 'TXNDEMO123456', 'Confirmed']
            );
            console.log('Seeded database with demo user: user');
        }

    } catch (e) {
        console.error('Initialization error:', e);
    }
}

// Authentication Middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Authorization token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid or expired token' });
        }
        req.userId = decoded.userId;
        next();
    });
}

// Admin role check middleware
async function requireAdmin(req, res, next) {
    try {
        const user = await dbGet('SELECT role FROM users WHERE id = ?', [req.userId]);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied: Admin role required' });
        }
        next();
    } catch (e) {
        res.status(500).json({ message: 'Server verification error' });
    }
}

// Helper: Generate Unique Referral Code
function generateReferralCode(name) {
    const cleanName = name.replace(/[^A-Za-z]/g, '').substring(0, 4).toUpperCase();
    const randDigits = Math.floor(1000 + Math.random() * 9000);
    return `${cleanName}${randDigits}`;
}

// REST APIs
// 1. Login
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Email/Username and password are required' });
    }

    try {
        const user = await dbGet('SELECT * FROM users WHERE email = ? OR username = ?', [email, email]);
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
});

// 2. Register User (with Referral Code verification & $5 Sign-up Bonus)
app.post('/api/auth/register', async (req, res) => {
    const { name, email, username, password, referralCode } = req.body;

    if (!name || !email || !username || !password) {
        return res.status(400).json({ message: 'Name, email, username, and password are required' });
    }

    try {
        const userExists = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
        if (userExists) {
            return res.status(400).json({ message: 'Email already registered' });
        }

        const usernameExists = await dbGet('SELECT id FROM users WHERE username = ?', [username]);
        if (usernameExists) {
            return res.status(400).json({ message: 'Username already registered' });
        }

        let referrerId = null;
        let startBalance = 0.00;

        // Check if referral code is provided and valid
        if (referralCode && referralCode.trim() !== '') {
            const referrer = await dbGet('SELECT id FROM users WHERE referral_code = ?', [referralCode.trim()]);
            if (referrer) {
                referrerId = referrer.id;
                startBalance = 5.00; // Credited $5 bonus to the new user!
            } else {
                return res.status(400).json({ message: 'Invalid referral code' });
            }
        }

        const myReferralCode = generateReferralCode(name);
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await dbRun(
            'INSERT INTO users (name, email, username, password, balance, earnings, active_investments, role, referred_by, referral_code) VALUES (?, ?, ?, ?, ?, 0.0, 0.0, ?, ?, ?)',
            [name, email, username, hashedPassword, startBalance, 'user', referrerId, myReferralCode]
        );

        const newUserId = result.lastID;

        // If referral code was valid, insert the sign-up bonus transaction for the user
        if (startBalance > 0) {
            const dateStr = new Date().toLocaleString('en-US', { 
                month: 'short', 
                day: 'numeric', 
                year: 'numeric', 
                hour: '2-digit', 
                minute: '2-digit', 
                hour12: true 
            });
            await dbRun(
                'INSERT INTO transactions (user_id, date, type, amount, ref, status) VALUES (?, ?, ?, ?, ?, ?)',
                [newUserId, dateStr, 'Referral Bonus', 5.00, 'REF-BONUS-' + Math.random().toString(36).substring(2, 8).toUpperCase(), 'Confirmed']
            );
        }

        const token = jwt.sign({ userId: newUserId }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: newUserId, name, email, role: 'user' } });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server registration error' });
    }
});

// 3. Change Password API
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
        return res.status(400).json({ message: 'Current password and new password are required' });
    }

    try {
        const user = await dbGet('SELECT password FROM users WHERE id = ?', [req.userId]);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const validPassword = await bcrypt.compare(oldPassword, user.password);
        if (!validPassword) {
            return res.status(400).json({ message: 'Incorrect current password' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await dbRun('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.userId]);

        res.json({ message: 'Password updated successfully!' });
    } catch (e) {
        res.status(500).json({ message: 'Server password reset error' });
    }
});

// 4. Forgot Password API (Unified public mock/interactive endpoint)
app.post('/api/auth/forgot-password', async (req, res) => {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
        return res.status(400).json({ message: 'Email and new password are required' });
    }

    try {
        const user = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
        if (!user) {
            return res.status(404).json({ message: 'Email address not found' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await dbRun('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, user.id]);

        res.json({ message: 'Password reset successfully! You can now log in.' });
    } catch (e) {
        res.status(500).json({ message: 'Server reset error' });
    }
});

// Update User Password API
app.post('/api/user/password', authenticateToken, async (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    try {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await dbRun('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.userId]);
        res.json({ message: 'Password updated successfully' });
    } catch (error) {
        console.error('Password update error:', error);
        res.status(500).json({ message: 'Server error updating password' });
    }
});

// 5. User Profile API
app.get('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const user = await dbGet('SELECT id, name, email, balance, earnings, role, referral_code, referred_by FROM users WHERE id = ?', [req.userId]);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const activeInvestmentsSum = await dbGet('SELECT SUM(amount) as activeSum FROM investments WHERE user_id = ? AND status = ?', [req.userId, 'Active']);
        const activeTotal = activeInvestmentsSum.activeSum || 0.00;

        // Referral stats
        const refCountRow = await dbGet('SELECT COUNT(*) as refCount FROM users WHERE referred_by = ?', [req.userId]);
        const totalReferrals = refCountRow.refCount || 0;

        const activeRefRow = await dbGet(`
            SELECT COUNT(DISTINCT user_id) as activeRefCount 
            FROM investments 
            JOIN users ON investments.user_id = users.id 
            WHERE users.referred_by = ? AND investments.status = 'Active'
        `, [req.userId]);
        const activeReferralsCount = activeRefRow.activeRefCount || 0;

        const comSumRow = await dbGet("SELECT SUM(amount) as comSum FROM transactions WHERE user_id = ? AND type = 'Referral Bonus'", [req.userId]);
        const totalComEarned = comSumRow.comSum || 0.00;

        const signupsRows = await dbAll('SELECT id, name, email FROM users WHERE referred_by = ? ORDER BY id DESC LIMIT 5', [req.userId]);

        res.json({
            ...user,
            active_investments: activeTotal,
            referralsStats: {
                totalReferrals,
                activeReferralsCount,
                totalComEarned,
                signups: signupsRows
            }
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server profile fetch error' });
    }
});

// 6. Get User Deposits
app.get('/api/deposits', authenticateToken, async (req, res) => {
    try {
        const deposits = await dbAll('SELECT * FROM deposits WHERE user_id = ? ORDER BY id DESC', [req.userId]);
        res.json(deposits);
    } catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
});

// 7. Submit User Deposit with Base64 Screenshot Upload
app.post('/api/deposits', authenticateToken, async (req, res) => {
    const { amount, screenshotBase64, txnId, planName } = req.body;

    if (!amount || isNaN(amount) || amount <= 0 || !screenshotBase64) {
        return res.status(400).json({ message: 'Valid amount and screenshot file are required' });
    }

    const dateStr = new Date().toLocaleString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: true 
    });

    try {
        // Parse and save base64 screenshot receipt to file
        const matches = screenshotBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches) {
            return res.status(400).json({ message: 'Invalid screenshot file format' });
        }

        const type = matches[1];
        const buffer = Buffer.from(matches[2], 'base64');
        const ext = type.split('/')[1] || 'png';
        
        const fileName = `receipt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${ext}`;
        const relativePath = `/uploads/${fileName}`;
        const fullSavePath = path.join(uploadsDir, fileName);

        fs.writeFileSync(fullSavePath, buffer);

        const finalTxnCode = txnId || ("TX" + Date.now().toString().slice(-6) + Math.random().toString(36).substring(2, 6).toUpperCase());

        // Insert pending deposit referencing receipt and planName
        await dbRun(
            'INSERT INTO deposits (user_id, date, amount, txn_id, screenshot_path, plan_name, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [req.userId, dateStr, amount, finalTxnCode, relativePath, planName || null, 'Pending']
        );

        // Insert transaction record
        await dbRun(
            'INSERT INTO transactions (user_id, date, type, amount, ref, status) VALUES (?, ?, ?, ?, ?, ?)',
            [req.userId, dateStr, 'Deposit', amount, finalTxnCode, 'Pending']
        );

        res.json({ message: 'Deposit submitted with screenshot. Verification pending admin review.' });

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server receipt upload error' });
    }
});

// 8. Get User Investments
app.get('/api/investments', authenticateToken, async (req, res) => {
    try {
        const investments = await dbAll('SELECT * FROM investments WHERE user_id = ? ORDER BY id DESC', [req.userId]);
        res.json(investments);
    } catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
});

// 9. Buy Investment Plan (flat $100 price * quantity)
app.post('/api/investments', authenticateToken, async (req, res) => {
    const { name, quantity } = req.body;
    const qtyVal = parseInt(quantity) || 1;

    if (!name || qtyVal <= 0) {
        return res.status(400).json({ message: 'Invalid plan purchase parameters' });
    }

    const singlePlanPrice = 100.00;
    const totalCost = singlePlanPrice * qtyVal;

    try {
        const user = await dbGet('SELECT balance FROM users WHERE id = ?', [req.userId]);
        if (user.balance < totalCost) {
            return res.status(400).json({ message: 'Insufficient balance' });
        }

        const dateStr = new Date().toLocaleString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit', 
            hour12: true 
        });

        const randomRef = "INV" + Math.random().toString(36).substring(2, 10).toUpperCase();

        // Deduct balance
        await dbRun('UPDATE users SET balance = balance - ? WHERE id = ?', [totalCost, req.userId]);

        const nowMs = Date.now();

        // Insert Investment record (flat 2.5% daily, 1 day duration)
        await dbRun(
            'INSERT INTO investments (user_id, name, amount, daily_profit_pct, duration_days, status, start_date, created_at) VALUES (?, ?, ?, 2.5, 1, ?, ?, ?)',
            [req.userId, `${name} (x${qtyVal})`, totalCost, 'Active', dateStr, nowMs]
        );

        // Log transaction
        await dbRun(
            'INSERT INTO transactions (user_id, date, type, amount, ref, status) VALUES (?, ?, ?, ?, ?, ?)',
            [req.userId, dateStr, 'Investment', totalCost, randomRef, 'Confirmed']
        );

        res.json({ message: `Successfully purchased ${qtyVal} plan(s) for ${name}!` });
    } catch (e) {
        res.status(500).json({ message: 'Server purchase plan error' });
    }
});

// 10. Get User Transactions
app.get('/api/transactions', authenticateToken, async (req, res) => {
    try {
        const transactions = await dbAll('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC', [req.userId]);
        res.json(transactions);
    } catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
});

// 11. Payout Withdrawal (min $100)
app.post('/api/withdrawals', authenticateToken, async (req, res) => {
    const { address, amount } = req.body;
    const withdrawAmt = parseFloat(amount);

    if (!address || isNaN(withdrawAmt) || withdrawAmt < 100) {
        return res.status(400).json({ message: 'Valid address and amount (minimum $100) are required' });
    }

    try {
        const user = await dbGet('SELECT balance FROM users WHERE id = ?', [req.userId]);
        if (user.balance < withdrawAmt) {
            return res.status(400).json({ message: 'Insufficient balance' });
        }

        const dateStr = new Date().toLocaleString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit', 
            hour12: true 
        });

        const randomRef = "WD" + Math.random().toString(36).substring(2, 10).toUpperCase();

        await dbRun('UPDATE users SET balance = balance - ? WHERE id = ?', [withdrawAmt, req.userId]);

        await dbRun(
            'INSERT INTO transactions (user_id, date, type, amount, ref, status) VALUES (?, ?, ?, ?, ?, ?)',
            [req.userId, dateStr, 'Withdrawal', withdrawAmt, randomRef, 'Pending']
        );

        res.json({ message: 'Withdrawal request submitted successfully.' });
    } catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
});

// 12. Get User Support Tickets
app.get('/api/tickets', authenticateToken, async (req, res) => {
    try {
        const tickets = await dbAll('SELECT * FROM tickets WHERE user_id = ? ORDER BY id DESC', [req.userId]);
        res.json(tickets);
    } catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
});

// 13. Submit Support Ticket
app.post('/api/tickets', authenticateToken, async (req, res) => {
    const { title, message } = req.body;

    if (!title || !message) {
        return res.status(400).json({ message: 'Subject and message are required' });
    }

    const dateStr = new Date().toLocaleString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric'
    });

    const ticketId = "#" + Math.floor(10000 + Math.random() * 90000);

    try {
        await dbRun(
            'INSERT INTO tickets (user_id, title, ticket_id, date, status, message) VALUES (?, ?, ?, ?, ?, ?)',
            [req.userId, title, ticketId, dateStr, 'Pending', message]
        );
        res.json({ message: 'Support ticket submitted.' });
    } catch (e) {
        res.status(500).json({ message: 'Server error' });
    }
});


// ==========================================
// ADMIN DASHBOARD PORTAL ENDPOINTS
// ==========================================

// 1. Admin overview metrics
app.get('/api/admin/overview', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const totalUsers = await dbGet('SELECT COUNT(*) as uCount FROM users WHERE role = ?', ['user']);
        const totalDeposits = await dbGet('SELECT SUM(amount) as dSum FROM deposits WHERE status = ?', ['Confirmed']);
        const pendingWithdrawals = await dbGet('SELECT COUNT(*) as wCount FROM transactions WHERE type = ? AND status = ?', ['Withdrawal', 'Pending']);
        const activeInvestmentsSum = await dbGet('SELECT SUM(amount) as iSum FROM investments WHERE status = ?', ['Active']);

        res.json({
            users: totalUsers.uCount || 0,
            deposits: totalDeposits.dSum || 0.0,
            pendingWithdrawals: pendingWithdrawals.wCount || 0,
            activeInvestments: activeInvestmentsSum.iSum || 0.0
        });
    } catch (e) {
        res.status(500).json({ message: 'Server admin overview query error' });
    }
});

// 2. Manage Users (List users)
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const users = await dbAll('SELECT id, name, email, balance, earnings, role, referral_code, referred_by FROM users ORDER BY id DESC');
        res.json(users);
    } catch (e) {
        res.status(500).json({ message: 'Server admin users query error' });
    }
});

// 3. Edit User Balance
app.post('/api/admin/users/balance', authenticateToken, requireAdmin, async (req, res) => {
    const { userId, newBalance } = req.body;

    if (userId === undefined || newBalance === undefined || isNaN(newBalance) || newBalance < 0) {
        return res.status(400).json({ message: 'Valid user ID and non-negative balance are required' });
    }

    try {
        await dbRun('UPDATE users SET balance = ? WHERE id = ?', [parseFloat(newBalance), userId]);
        res.json({ message: 'User balance updated successfully.' });
    } catch (e) {
        res.status(500).json({ message: 'Server admin update balance error' });
    }
});

// 4. Verify Deposits (List deposits with screenshots)
app.get('/api/admin/deposits', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const deposits = await dbAll(`
            SELECT deposits.*, users.name as user_name, users.email as user_email 
            FROM deposits 
            JOIN users ON deposits.user_id = users.id 
            ORDER BY deposits.id DESC
        `);
        res.json(deposits);
    } catch (e) {
        res.status(500).json({ message: 'Server admin deposits query error' });
    }
});

// 5. Verify Deposit Action (Approve/Reject) with 10% Referrer Award Credit
app.post('/api/admin/deposits/verify', authenticateToken, requireAdmin, async (req, res) => {
    const { depositId, action } = req.body; // action: 'Approve' or 'Reject'

    if (!depositId || !['Approve', 'Reject'].includes(action)) {
        return res.status(400).json({ message: 'Valid deposit ID and action (Approve/Reject) are required' });
    }

    try {
        const deposit = await dbGet('SELECT * FROM deposits WHERE id = ?', [depositId]);
        if (!deposit) {
            return res.status(404).json({ message: 'Deposit record not found' });
        }

        if (deposit.status !== 'Pending') {
            return res.status(400).json({ message: 'Deposit is already verified' });
        }

        const newStatus = action === 'Approve' ? 'Confirmed' : 'Failed';

        // Update deposit status
        await dbRun('UPDATE deposits SET status = ? WHERE id = ?', [newStatus, depositId]);
        
        // Update transaction status
        await dbRun('UPDATE transactions SET status = ? WHERE ref = ?', [newStatus, deposit.txn_id]);

        if (action === 'Approve') {
            if (deposit.plan_name) {
                // It's a product deposit! Create investment directly.
                const dateStr = new Date().toLocaleString('en-US', { 
                    month: 'short', day: 'numeric', year: 'numeric', 
                    hour: '2-digit', minute: '2-digit', hour12: true 
                });
                const nowMs = Date.now();
                await dbRun(
                    'INSERT INTO investments (user_id, name, amount, daily_profit_pct, duration_days, status, start_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [deposit.user_id, deposit.plan_name, deposit.amount, 2.5, 1, 'Active', dateStr, nowMs]
                );
            } else {
                // Standard deposit, add amount to user's balance
                await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [deposit.amount, deposit.user_id]);
            }

            // Check if user was referred by someone
            const user = await dbGet('SELECT referred_by FROM users WHERE id = ?', [deposit.user_id]);
            if (user && user.referred_by !== null) {
                // Referrer gets 10% of the deposit amount!
                const referralBonusAmt = deposit.amount * 0.10;
                
                await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [referralBonusAmt, user.referred_by]);

                const dateStr = new Date().toLocaleString('en-US', { 
                    month: 'short', 
                    day: 'numeric', 
                    year: 'numeric', 
                    hour: '2-digit', 
                    minute: '2-digit', 
                    hour12: true 
                });
                
                // Add Referral Bonus transaction logs for Referrer
                await dbRun(
                    'INSERT INTO transactions (user_id, date, type, amount, ref, status) VALUES (?, ?, ?, ?, ?, ?)',
                    [user.referred_by, dateStr, 'Referral Bonus', referralBonusAmt, 'REF-DEP-' + Math.random().toString(36).substring(2, 8).toUpperCase(), 'Confirmed']
                );
            }
        }

        res.json({ message: `Deposit successfully ${action === 'Approve' ? 'approved' : 'rejected'}.` });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server admin verify deposit error' });
    }
});

// 6. Manage Payouts (List withdrawal transactions)
app.get('/api/admin/payouts', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const payouts = await dbAll(`
            SELECT transactions.*, users.name as user_name, users.email as user_email 
            FROM transactions 
            JOIN users ON transactions.user_id = users.id 
            WHERE transactions.type = ? 
            ORDER BY transactions.id DESC
        `, ['Withdrawal']);
        res.json(payouts);
    } catch (e) {
        res.status(500).json({ message: 'Server admin payouts query error' });
    }
});

// 7. Verify Payout Action
app.post('/api/admin/payouts/verify', authenticateToken, requireAdmin, async (req, res) => {
    const { transactionId } = req.body;

    if (!transactionId) {
        return res.status(400).json({ message: 'Valid transaction ID is required' });
    }

    try {
        const tx = await dbGet('SELECT * FROM transactions WHERE id = ? AND type = ?', [transactionId, 'Withdrawal']);
        if (!tx) {
            return res.status(404).json({ message: 'Withdrawal transaction record not found' });
        }

        if (tx.status !== 'Pending') {
            return res.status(400).json({ message: 'Withdrawal is already processed' });
        }

        await dbRun('UPDATE transactions SET status = ? WHERE id = ?', ['Confirmed', transactionId]);
        res.json({ message: 'Withdrawal successfully approved and completed.' });
    } catch (e) {
        res.status(500).json({ message: 'Server admin verify payout error' });
    }
});

// 8. Support Tickets
app.get('/api/admin/tickets', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const tickets = await dbAll(`
            SELECT tickets.*, users.name as user_name, users.email as user_email 
            FROM tickets 
            JOIN users ON tickets.user_id = users.id 
            ORDER BY tickets.id DESC
        `);
        res.json(tickets);
    } catch (e) {
        res.status(500).json({ message: 'Server admin tickets query error' });
    }
});

// 9. Reply Support Ticket
app.post('/api/admin/tickets/reply', authenticateToken, requireAdmin, async (req, res) => {
    const { ticketId, reply } = req.body;

    if (!ticketId || !reply) {
        return res.status(400).json({ message: 'Valid ticket ID and reply message are required' });
    }

    try {
        const ticket = await dbGet('SELECT * FROM tickets WHERE id = ?', [ticketId]);
        if (!ticket) {
            return res.status(404).json({ message: 'Ticket record not found' });
        }

        await dbRun('UPDATE tickets SET admin_reply = ?, status = ? WHERE id = ?', [reply, 'Resolved', ticketId]);
        res.json({ message: 'Reply sent and ticket resolved.' });
    } catch (e) {
        res.status(500).json({ message: 'Server admin ticket reply error' });
    }
});


// Background Worker: Compound film plan profits in database (every 15s)
// Flat 2.5% daily profit for all active investments.
// Referrer gets 10% commission of the referred user's plan payouts.
// Auto-completes plans after exactly 24 hours, returning the principal to the user's balance.
setInterval(async () => {
    try {
        const activeInvestments = await dbAll('SELECT * FROM investments WHERE status = ?', ['Active']);
        const now = Date.now();
        for (const inv of activeInvestments) {
            const durationMs = (inv.duration_days || 1) * 24 * 60 * 60 * 1000;
            const elapsed = now - (inv.created_at || now);

            if (elapsed >= durationMs) {
                // Plan matured! Return the principal and complete the plan.
                await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [inv.amount, inv.user_id]);
                await dbRun('UPDATE investments SET status = ? WHERE id = ?', ['Completed', inv.id]);

                const dateStr = new Date().toLocaleString('en-US', { 
                    month: 'short', 
                    day: 'numeric', 
                    year: 'numeric', 
                    hour: '2-digit', 
                    minute: '2-digit', 
                    hour12: true 
                });
                const refCode = 'MATURED-' + inv.id;
                await dbRun(
                    'INSERT INTO transactions (user_id, date, type, amount, ref, status) VALUES (?, ?, ?, ?, ?, ?)',
                    [inv.user_id, dateStr, 'Payout', inv.amount, refCode, 'Confirmed']
                );
            } else {
                // Plan active, compound 2.5% daily profit
                const ratePer15Sec = (2.5 / 100) / (24 * 60 * 4); // flat 2.5% daily divided by intervals
                const userPayout = inv.amount * ratePer15Sec;

                if (userPayout > 0) {
                    // 1. Credit User balance
                    await dbRun('UPDATE users SET balance = balance + ?, earnings = earnings + ? WHERE id = ?', [userPayout, userPayout, inv.user_id]);

                    // 2. Check for Referrer logic (10% earnings commission)
                    const user = await dbGet('SELECT referred_by FROM users WHERE id = ?', [inv.user_id]);
                    if (user && user.referred_by !== null) {
                        const commissionBonus = userPayout * 0.10;
                        
                        // Credit Referrer
                        await dbRun('UPDATE users SET balance = balance + ?, earnings = earnings + ? WHERE id = ?', [commissionBonus, commissionBonus, user.referred_by]);
                    }
                }
            }
        }
    } catch (err) {
        console.error('Error executing profit compounding background tasks:', err.message);
    }
}, 15000);

// Root Route: Serve Home Page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve static assets from public folder
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0 }));

// Clean HTML URL Routes
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/user-dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/admin-dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/investments', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'investments.html'));
});

// Fallback: Redirect standard requests to login
app.get('*', (req, res) => {
    res.redirect('/login');
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
