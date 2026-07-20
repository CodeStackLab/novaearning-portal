-- MySQL Schema for Nova Portal
-- Create database and tables

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    balance DECIMAL(15, 2) DEFAULT 0.0,
    earnings DECIMAL(15, 2) DEFAULT 0.0,
    active_investments DECIMAL(15, 2) DEFAULT 0.0,
    role VARCHAR(50) DEFAULT 'user',
    referred_by INT DEFAULT NULL,
    referral_code VARCHAR(255) UNIQUE,
    username VARCHAR(255) UNIQUE,
    FOREIGN KEY (referred_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS deposits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    date VARCHAR(255) NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    txn_id VARCHAR(255) UNIQUE NOT NULL,
    screenshot_path VARCHAR(255),
    plan_name VARCHAR(255),
    status VARCHAR(50) NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS investments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    name VARCHAR(255) NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    daily_profit_pct DECIMAL(5, 2) NOT NULL,
    duration_days INT NOT NULL,
    status VARCHAR(50) NOT NULL,
    start_date VARCHAR(255) NOT NULL,
    created_at INT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    date VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    ref VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) NOT NULL,
    wallet_address VARCHAR(255),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tickets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    title VARCHAR(255) NOT NULL,
    ticket_id VARCHAR(255) UNIQUE NOT NULL,
    date VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    admin_reply TEXT DEFAULT NULL,
    image_path VARCHAR(255),
    admin_image_path VARCHAR(255),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
    `key` VARCHAR(255) PRIMARY KEY,
    `value` TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed Settings
INSERT IGNORE INTO settings (`key`, `value`) VALUES ('tron_deposit_address', 'TQdJg7h5P6r8xkLyGk9Y8yq8eL5t3mZ6tX');

-- Seed Admin
INSERT IGNORE INTO users (name, email, username, password, role, referral_code) 
VALUES ('Nova Admin', 'admin@nova.com', 'novadmin', '$2a$10$wYm/w/Q9/kM/z7b7D/4.4.yO.7C6qM7oYp2hO6Hqg2u.w6b.aU/XG', 'admin', 'ADMIN9999'); 
-- Note: Password is 'admin123' bcrypt hashed

-- Seed Demo Admin
INSERT IGNORE INTO users (name, email, username, password, role, referral_code) 
VALUES ('Demo Admin', 'admin@mail.com', 'admin_demo', '$2a$10$wYm/w/Q9/kM/z7b7D/4.4.yO.7C6qM7oYp2hO6Hqg2u.w6b.aU/XG', 'admin', 'ADMIN7777');

-- Seed Demo User
INSERT IGNORE INTO users (name, email, username, password, balance, earnings, role, referral_code) 
VALUES ('Demo User', 'user@mail.com', 'user_demo', '$2y$10$YnZ5pM8Y5dK3Q4lO2yR9UODj4P0.b.238T4Xo7Z.G3L5H/w.6G.wK', 1000.00, 150.00, 'user', 'USER7777');
-- Note: Password is 'user123' bcrypt hashed
