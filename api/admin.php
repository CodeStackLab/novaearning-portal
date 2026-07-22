<?php
// api/admin.php

function handleAdmin($action, $subaction, $pdo, $body) {
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit();
    $userId = authenticateToken();
    requireAdmin($pdo, $userId);

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        if ($action === 'overview') {
            $stmt = $pdo->query("SELECT COUNT(*) as uCount FROM users WHERE role = 'user'");
            $totalUsers = $stmt->fetch()['uCount'];

            $stmt = $pdo->query("SELECT SUM(amount) as dSum FROM deposits WHERE status = 'Confirmed'");
            $totalDeposits = $stmt->fetch()['dSum'];

            $stmt = $pdo->query("SELECT COUNT(*) as wCount FROM transactions WHERE type = 'Withdrawal' AND status = 'Pending'");
            $pendingWithdrawals = $stmt->fetch()['wCount'];

            $stmt = $pdo->query("SELECT SUM(amount) as iSum FROM investments WHERE status = 'Active'");
            $activeInvestmentsSum = $stmt->fetch()['iSum'];

            $stmt = $pdo->query("SELECT COUNT(DISTINCT user_id) as activeUsers FROM investments WHERE status = 'Active'");
            $activeUsersCount = $stmt->fetch()['activeUsers'];

            $cronLastRun = $pdo->query("SELECT value FROM settings WHERE `key` = 'cron_last_run'")->fetchColumn() ?: null;
            $cronHealthy = $cronLastRun && (time() - strtotime($cronLastRun . ' UTC') < 3600);
            sendJson([
                'users' => (int)$totalUsers,
                'deposits' => (float)$totalDeposits,
                'pendingWithdrawals' => (int)$pendingWithdrawals,
                'activeInvestments' => (float)$activeInvestmentsSum,
                'activeUsers' => (int)$activeUsersCount,
                'cronLastRun' => $cronLastRun,
                'cronHealthy' => (bool)$cronHealthy
            ]);
        }

        if ($action === 'users') {
            $stmt = $pdo->query("SELECT id, name, email, balance, earnings, role, account_status AS status, referral_code, referred_by FROM users WHERE role = 'user' ORDER BY id DESC");
            sendJson($stmt->fetchAll());
        }

        if ($action === 'plans') {
            $stmt = $pdo->query('SELECT id, name, price, daily_profit_pct AS roi, duration_days, image_url AS img, is_active FROM plans ORDER BY id');
            sendJson($stmt->fetchAll());
        }

        if ($action === 'deposits') {
            $stmt = $pdo->query('SELECT deposits.*, users.name as user_name, users.email as user_email FROM deposits LEFT JOIN users ON deposits.user_id = users.id ORDER BY deposits.id DESC');
            sendJson($stmt->fetchAll());
        }

        if ($action === 'payouts') {
            $stmt = $pdo->query("SELECT transactions.*, users.name as user_name, users.email as user_email FROM transactions JOIN users ON transactions.user_id = users.id WHERE transactions.type = 'Withdrawal' ORDER BY transactions.id DESC");
            sendJson($stmt->fetchAll());
        }

        if ($action === 'commissions') {
            $stmt = $pdo->query("SELECT transactions.*, users.name as user_name, users.email as user_email FROM transactions JOIN users ON transactions.user_id = users.id WHERE transactions.type = 'Referral Bonus' ORDER BY transactions.id DESC");
            sendJson($stmt->fetchAll());
        }

        if ($action === 'settings' && $subaction === 'referrals') {
            sendJson([
                'firstDepositBonusPct' => getNumericSetting($pdo, 'referral_first_deposit_bonus_pct', 5, 0, 100),
                'depositCommissionPct' => getNumericSetting($pdo, 'referral_deposit_commission_pct', 5, 0, 100),
                'dailyCommissionPct' => getNumericSetting($pdo, 'referral_daily_commission_pct', 10, 0, 100)
            ]);
        }

        if ($action === 'tickets') {
            $stmt = $pdo->query('SELECT tickets.*, users.name as user_name, users.email as user_email FROM tickets JOIN users ON tickets.user_id = users.id ORDER BY tickets.id DESC');
            sendJson($stmt->fetchAll());
        }

        if ($action === 'audit-log') {
            ensurePlatformFeatureTables($pdo);
            $stmt = $pdo->query('SELECT admin_audit_log.*, users.name AS admin_name FROM admin_audit_log LEFT JOIN users ON users.id = admin_audit_log.admin_id ORDER BY admin_audit_log.id DESC LIMIT 250');
            sendJson($stmt->fetchAll());
        }

        if ($action === 'settings' && $subaction === 'smtp') {
            $keys = ['smtp_host', 'smtp_port', 'smtp_encryption', 'smtp_username', 'smtp_password', 'smtp_from_email', 'smtp_from_name'];
            $placeholders = implode(',', array_fill(0, count($keys), '?'));
            $stmt = $pdo->prepare("SELECT `key`, value FROM settings WHERE `key` IN ($placeholders)");
            $stmt->execute($keys);
            $stored = [];
            foreach ($stmt->fetchAll() as $row) $stored[$row['key']] = $row['value'];

            $smtpUsername = $stored['smtp_username'] ?? 'admin@novaearning.com';
            $smtpFromEmail = $stored['smtp_from_email'] ?? 'admin@novaearning.com';
            $legacyMailbox = strcasecmp($smtpUsername, 'contact@novaearning.com') === 0;
            if ($legacyMailbox) {
                $smtpUsername = 'admin@novaearning.com';
                $smtpFromEmail = 'admin@novaearning.com';
            }

            sendJson([
                'host' => $stored['smtp_host'] ?? '',
                'port' => (int)($stored['smtp_port'] ?? 587),
                'encryption' => $stored['smtp_encryption'] ?? 'tls',
                'username' => $smtpUsername,
                'fromEmail' => $smtpFromEmail,
                'fromName' => $stored['smtp_from_name'] ?? 'NOVA',
                'passwordConfigured' => !$legacyMailbox && !empty($stored['smtp_password'])
            ]);
        }

        if ($action === 'settings' && $subaction === 'notifications') {
            $keys = ['admin_email_notifications', 'admin_email_deposit_notifications', 'admin_email_withdrawal_notifications', 'admin_email_investment_notifications', 'admin_email_commission_notifications', 'admin_email_support_notifications'];
            $placeholders = implode(',', array_fill(0, count($keys), '?'));
            $stmt = $pdo->prepare("SELECT `key`, value FROM settings WHERE `key` IN ($placeholders)");
            $stmt->execute($keys);
            $result = array_fill_keys($keys, true);
            foreach ($stmt->fetchAll() as $row) $result[$row['key']] = $row['value'] !== '0';
            sendJson($result);
        }
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        if ($action === 'settings' && $subaction === 'referrals') {
            $values = [
                'referral_first_deposit_bonus_pct' => $body['firstDepositBonusPct'] ?? null,
                'referral_deposit_commission_pct' => $body['depositCommissionPct'] ?? null,
                'referral_daily_commission_pct' => $body['dailyCommissionPct'] ?? null
            ];
            foreach ($values as $value) {
                if (!is_numeric($value) || (float)$value < 0 || (float)$value > 100) {
                    sendJson(['message' => 'Each referral percentage must be between 0 and 100.'], 400);
                }
            }
            $stmt = $pdo->prepare('INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)');
            $pdo->beginTransaction();
            try {
                foreach ($values as $key => $value) $stmt->execute([$key, number_format((float)$value, 2, '.', '')]);
                $pdo->commit();
                auditAdminAction($pdo, $userId, 'referral.percentages.updated', 'settings', 'referrals', $values);
                sendJson(['message' => 'Referral percentages updated successfully.']);
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                sendJson(['message' => 'Unable to update referral percentages.'], 500);
            }
        }

        if ($action === 'plans') {
            $operation = strtolower(trim($body['operation'] ?? ''));
            $planId = (int)($body['id'] ?? 0);
            if ($operation === 'delete') {
                if ($planId < 1) sendJson(['message' => 'Valid plan ID required.'], 400);
                $stmt = $pdo->prepare('UPDATE plans SET is_active = 0 WHERE id = ?');
                $stmt->execute([$planId]);
                auditAdminAction($pdo, $userId, 'plan.disabled', 'plan', $planId);
                sendJson(['message' => 'Plan removed from the catalogue.']);
            }

            $name = trim($body['name'] ?? '');
            $price = (float)($body['price'] ?? 0);
            $roi = (float)($body['roi'] ?? 2.5);
            $durationDays = (int)($body['durationDays'] ?? 1);
            $image = trim($body['image'] ?? '');
            if ($name === '' || strlen($name) > 120 || $price <= 0 || $price > 1000000 || $roi <= 0 || $roi > 100 || $durationDays < 1 || $durationDays > 365) {
                sendJson(['message' => 'Enter a valid name, price, return rate, and duration.'], 400);
            }
            if (strpos($image, 'data:') === 0) {
                $uploadError = '';
                $image = saveValidatedBase64Image($image, 'plan', $uploadError, 3145728);
                if (!$image) sendJson(['message' => $uploadError], 400);
            } elseif ($image !== '' && !preg_match('#^(?:https://|/|images/)#i', $image)) {
                sendJson(['message' => 'Plan image must be HTTPS or a local image path.'], 400);
            }

            try {
                if ($operation === 'update' && $planId > 0) {
                    $stmt = $pdo->prepare('UPDATE plans SET name = ?, price = ?, daily_profit_pct = ?, duration_days = ?, image_url = ?, is_active = 1 WHERE id = ?');
                    $stmt->execute([$name, $price, $roi, $durationDays, $image, $planId]);
                    auditAdminAction($pdo, $userId, 'plan.updated', 'plan', $planId, ['name' => $name, 'price' => $price]);
                    sendJson(['message' => 'Plan updated and published.']);
                }
                $stmt = $pdo->prepare('INSERT INTO plans (name, price, daily_profit_pct, duration_days, image_url) VALUES (?, ?, ?, ?, ?)');
                $stmt->execute([$name, $price, $roi, $durationDays, $image]);
                auditAdminAction($pdo, $userId, 'plan.created', 'plan', $pdo->lastInsertId(), ['name' => $name, 'price' => $price]);
                sendJson(['message' => 'Plan created and published.']);
            } catch (PDOException $e) {
                if ((int)($e->errorInfo[1] ?? 0) === 1062) sendJson(['message' => 'A plan with this name already exists.'], 409);
                sendJson(['message' => 'Unable to save the plan.'], 500);
            }
        }

        if ($action === 'settings' && $subaction === 'smtp-test') {
            $config = loadSmtpConfiguration($pdo);
            foreach (['host', 'username', 'fromEmail', 'fromName', 'encryption'] as $field) {
                if (array_key_exists($field, $body)) $config[$field] = trim((string)$body[$field]);
            }
            if (array_key_exists('port', $body)) $config['port'] = (int)$body['port'];
            if (!empty($body['password'])) $config['password'] = (string)$body['password'];

            if (!in_array(strtolower($config['encryption'] ?? ''), ['tls', 'ssl', 'none'], true)) {
                sendJson(['message' => 'Select a valid SMTP encryption method.'], 400);
            }
            $error = '';
            if (!testSmtpConfiguration($config, $error)) {
                sendJson(['message' => $error ?: 'SMTP connection test failed.'], 422);
            }
            sendJson(['message' => 'SMTP connection and authentication succeeded.']);
        }

        if ($action === 'settings' && $subaction === 'smtp') {
            $host = strtolower(trim($body['host'] ?? ''));
            $port = (int)($body['port'] ?? 0);
            $encryption = strtolower(trim($body['encryption'] ?? 'tls'));
            $username = trim($body['username'] ?? '');
            $password = (string)($body['password'] ?? '');
            $fromEmail = trim($body['fromEmail'] ?? '');
            $fromName = trim($body['fromName'] ?? 'NOVA');

            if ($host === '' || $port < 1 || $port > 65535 || !in_array($encryption, ['tls', 'ssl', 'none'], true)) {
                sendJson(['message' => 'Valid SMTP host, port, and encryption are required'], 400);
            }
            if ($fromEmail === '' || !filter_var($fromEmail, FILTER_VALIDATE_EMAIL)) {
                sendJson(['message' => 'A valid sender email address is required'], 400);
            }
            if ($username !== '' && !filter_var($username, FILTER_VALIDATE_EMAIL) && strlen($username) < 3) {
                sendJson(['message' => 'SMTP username is invalid'], 400);
            }
            if (in_array($host, ['smtp.ionos.com', 'smtp.ionos.co.uk'], true) && !filter_var($username, FILTER_VALIDATE_EMAIL)) {
                sendJson(['message' => 'IONOS requires the full mailbox email address as SMTP username.'], 400);
            }

            $currentUsernameStmt = $pdo->prepare("SELECT value FROM settings WHERE `key` = 'smtp_username' LIMIT 1");
            $currentUsernameStmt->execute();
            $currentUsername = (string)$currentUsernameStmt->fetchColumn();
            if ($password === '' && $currentUsername !== '' && strcasecmp($currentUsername, $username) !== 0) {
                sendJson(['message' => 'Enter the mailbox password when changing the SMTP username.'], 400);
            }
            $savedPasswordStmt = $pdo->prepare("SELECT value FROM settings WHERE `key` = 'smtp_password' LIMIT 1");
            $savedPasswordStmt->execute();
            if ($password === '' && !(string)$savedPasswordStmt->fetchColumn()) {
                sendJson(['message' => 'Enter the admin mailbox password to complete SMTP setup.'], 400);
            }

            $values = [
                'smtp_host' => $host,
                'smtp_port' => (string)$port,
                'smtp_encryption' => $encryption,
                'smtp_username' => $username,
                'smtp_from_email' => $fromEmail,
                'smtp_from_name' => $fromName ?: 'NOVA'
            ];
            if ($password !== '') {
                $key = hash('sha256', JWT_SECRET, true);
                $iv = random_bytes(12);
                $tag = '';
                $ciphertext = openssl_encrypt($password, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
                if ($ciphertext === false) sendJson(['message' => 'Unable to protect SMTP password'], 500);
                $values['smtp_password'] = 'enc:v1:' . base64_encode($iv . $tag . $ciphertext);
            }

            $pdo->beginTransaction();
            try {
                $stmt = $pdo->prepare('INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)');
                foreach ($values as $keyName => $value) $stmt->execute([$keyName, $value]);
                $pdo->commit();
                sendJson(['message' => 'SMTP configuration saved securely.']);
            } catch (Exception $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                sendJson(['message' => 'Unable to save SMTP configuration'], 500);
            }
        }

        if ($action === 'settings' && $subaction === 'notifications') {
            $keys = ['admin_email_notifications', 'admin_email_deposit_notifications', 'admin_email_withdrawal_notifications', 'admin_email_investment_notifications', 'admin_email_commission_notifications', 'admin_email_support_notifications'];
            $stmt = $pdo->prepare('INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)');
            $pdo->beginTransaction();
            try {
                foreach ($keys as $key) $stmt->execute([$key, !empty($body[$key]) ? '1' : '0']);
                $pdo->commit();
                sendJson(['message' => 'Email notification preferences saved.']);
            } catch (Exception $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                sendJson(['message' => 'Unable to save notification preferences.'], 500);
            }
        }

        if ($action === 'users' && $subaction === 'balance') {
            $targetUserId = $body['userId'] ?? null;
            $newBalance = $body['newBalance'] ?? null;

            if ($targetUserId === null || $newBalance === null || !is_numeric($newBalance) || $newBalance < 0) {
                sendJson(['message' => 'Valid user ID and non-negative balance are required'], 400);
            }

            $stmt = $pdo->prepare('SELECT balance FROM users WHERE id = ?'); $stmt->execute([$targetUserId]); $beforeBalance = (float)($stmt->fetch()['balance'] ?? 0);
            $stmt = $pdo->prepare('UPDATE users SET balance = ? WHERE id = ?');
            $stmt->execute([(float)$newBalance, $targetUserId]);
            recordBalanceLedger($pdo, $targetUserId, 'ADMIN-' . $userId . '-' . time(), 'admin_adjustment', (float)$newBalance - $beforeBalance, $beforeBalance, 'Administrative balance adjustment');
            auditAdminAction($pdo, $userId, 'user.balance.updated', 'user', $targetUserId, ['newBalance' => (float)$newBalance]);
            sendJson(['message' => 'User balance updated successfully.']);
        }

        if ($action === 'users' && $subaction === 'create') {
            $name = trim($body['name'] ?? '');
            $email = strtolower(trim($body['email'] ?? ''));
            $password = (string)($body['password'] ?? '');
            if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 8) sendJson(['message' => 'Name, valid email, and password of at least 8 characters are required.'], 400);
            $code = strtoupper(substr(preg_replace('/[^A-Za-z]/', '', $name), 0, 4)) . random_int(1000, 9999);
            try {
                $stmt = $pdo->prepare("INSERT INTO users (name,email,username,password,balance,earnings,active_investments,role,referral_code) VALUES (?,?,?,?,0,0,0,'user',?)");
                $stmt->execute([$name, $email, $email, password_hash($password, PASSWORD_BCRYPT), $code]);
                $newId = (int)$pdo->lastInsertId();
                auditAdminAction($pdo, $userId, 'user.created', 'user', $newId, ['email' => $email]);
                sendJson(['message' => 'User account created successfully.']);
            } catch (PDOException $e) {
                if ((int)($e->errorInfo[1] ?? 0) === 1062) sendJson(['message' => 'Email or referral code already exists.'], 409);
                sendJson(['message' => 'Unable to create user.'], 500);
            }
        }

        if ($action === 'users' && $subaction === 'profile') {
            $targetUserId = (int)($body['userId'] ?? 0);
            $name = trim($body['name'] ?? '');
            $email = strtolower(trim($body['email'] ?? ''));
            $newPassword = (string)($body['password'] ?? '');
            $status = trim((string)($body['status'] ?? 'Active'));

            if ($targetUserId < 1 || $name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                sendJson(['message' => 'Valid user, name, and email are required.'], 400);
            }
            if (!in_array($status, ['Active', 'Suspended', 'Hold', 'Under Review'], true)) {
                sendJson(['message' => 'Select a valid account status.'], 400);
            }
            $stmt = $pdo->prepare('SELECT id, role FROM users WHERE id = ?');
            $stmt->execute([$targetUserId]);
            $target = $stmt->fetch();
            if (!$target) sendJson(['message' => 'User not found.'], 404);
            if ($target['role'] === 'admin') {
                sendJson(['message' => 'Admin email cannot be changed from Manage Users.'], 403);
            }
            $stmt = $pdo->prepare('SELECT id FROM users WHERE email = ? AND id != ?');
            $stmt->execute([$email, $targetUserId]);
            if ($stmt->fetch()) sendJson(['message' => 'This email address is already in use.'], 409);

            if ($newPassword !== '') {
                if (strlen($newPassword) < 6) sendJson(['message' => 'Password must be at least 6 characters.'], 400);
                $stmt = $pdo->prepare('UPDATE users SET name = ?, email = ?, username = ?, password = ?, account_status = ? WHERE id = ? AND role = ?');
                $stmt->execute([$name, $email, $email, password_hash($newPassword, PASSWORD_BCRYPT), $status, $targetUserId, 'user']);
            } else {
                $stmt = $pdo->prepare('UPDATE users SET name = ?, email = ?, username = ?, account_status = ? WHERE id = ? AND role = ?');
                $stmt->execute([$name, $email, $email, $status, $targetUserId, 'user']);
            }
            auditAdminAction($pdo, $userId, 'user.profile.updated', 'user', $targetUserId, ['email' => $email, 'status' => $status]);
            sendJson(['message' => 'User profile and login email updated successfully.']);
        }

        if ($action === 'users' && $subaction === 'alert') {
            $targetUserId = (int)($body['userId'] ?? 0);
            $subject = trim((string)($body['subject'] ?? ''));
            $message = trim((string)($body['message'] ?? ''));
            if ($targetUserId < 1 || $subject === '' || $message === '' || strlen($subject) > 180 || strlen($message) > 5000) {
                sendJson(['message' => 'Valid user, subject, and message are required.'], 400);
            }
            $stmt = $pdo->prepare("SELECT id FROM users WHERE id = ? AND role = 'user'");
            $stmt->execute([$targetUserId]);
            if (!$stmt->fetch()) sendJson(['message' => 'User not found.'], 404);
            $emailSent = notifyUserById($pdo, $targetUserId, $subject, '<p>' . nl2br(htmlspecialchars($message)) . '</p>', 'support');
            auditAdminAction($pdo, $userId, 'user.alert.sent', 'user', $targetUserId, ['subject' => $subject, 'emailSent' => $emailSent]);
            sendJson(['message' => $emailSent ? 'Alert delivered in-app and by email.' : 'Alert delivered in-app. Email delivery was unavailable.']);
        }

        if ($action === 'users' && $subaction === 'delete') {
            $targetUserId = (int)($body['userId'] ?? 0);
            if ($targetUserId < 1) sendJson(['message' => 'Valid user ID required.'], 400);
            $stmt = $pdo->prepare("SELECT id, email FROM users WHERE id = ? AND role = 'user'");
            $stmt->execute([$targetUserId]);
            $target = $stmt->fetch();
            if (!$target) sendJson(['message' => 'User not found or protected.'], 404);
            try {
                $stmt = $pdo->prepare("DELETE FROM users WHERE id = ? AND role = 'user'");
                $stmt->execute([$targetUserId]);
                if (!$stmt->rowCount()) sendJson(['message' => 'User could not be deleted.'], 409);
                auditAdminAction($pdo, $userId, 'user.deleted', 'user', $targetUserId, ['email' => $target['email']]);
                sendJson(['message' => 'User account and associated records deleted.']);
            } catch (PDOException $e) {
                sendJson(['message' => 'User has protected linked records and cannot be deleted. Suspend the account instead.'], 409);
            }
        }

        if ($action === 'deposits' && $subaction === 'verify') {
            $depositId = $body['depositId'] ?? null;
            $act = $body['action'] ?? null;

            if (!$depositId || !in_array($act, ['Approve', 'Reject'])) {
                sendJson(['message' => 'Valid deposit ID and action are required'], 400);
            }

            $stmt = $pdo->prepare('SELECT * FROM deposits WHERE id = ?');
            $stmt->execute([$depositId]);
            $deposit = $stmt->fetch();

            if (!$deposit) sendJson(['message' => 'Deposit not found'], 404);
            if ($deposit['status'] !== 'Pending') sendJson(['message' => 'Already verified'], 400);

            $newStatus = $act === 'Approve' ? 'Confirmed' : 'Failed';
            
            $pdo->beginTransaction();
            try {
                $stmt = $pdo->prepare("UPDATE deposits SET status = ? WHERE id = ? AND status = 'Pending'");
                $stmt->execute([$newStatus, $depositId]);
                if ($stmt->rowCount() !== 1) throw new Exception('Deposit was already processed');

                $stmt = $pdo->prepare('UPDATE transactions SET status = ? WHERE ref = ?');
                $stmt->execute([$newStatus, $deposit['txn_id']]);

                if ($act === 'Approve') {
                    // Always credit the user's balance
                    $stmt = $pdo->prepare('UPDATE users SET balance = balance + ? WHERE id = ?');
                    $stmt->execute([$deposit['amount'], $deposit['user_id']]);

                    // If a plan was selected with the deposit, create an active investment
                    if ($deposit['plan_name']) {
                        $dateStr = date('M j, Y h:i A');
                        $nowMs = time() * 1000;
                        $pStmt = $pdo->prepare('SELECT daily_profit_pct, duration_days FROM plans WHERE name = ? AND is_active = 1 LIMIT 1');
                        $pStmt->execute([$deposit['plan_name']]);
                        $pInfo = $pStmt->fetch();
                        $roiVal = $pInfo ? (float)$pInfo['daily_profit_pct'] : 2.5;
                        $durVal = $pInfo ? (int)$pInfo['duration_days'] : 1;

                        $stmt = $pdo->prepare('INSERT INTO investments (user_id, name, amount, daily_profit_pct, duration_days, status, start_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
                        $stmt->execute([$deposit['user_id'], $deposit['plan_name'], $deposit['amount'], $roiVal, $durVal, 'Active', $dateStr, $nowMs]);
                    }

                    // Configurable first-deposit reward and referrer commission.
                    $stmt = $pdo->prepare('SELECT referred_by FROM users WHERE id = ?');
                    $stmt->execute([$deposit['user_id']]);
                    $user = $stmt->fetch();

                    $firstDepositBonusPct = getNumericSetting($pdo, 'referral_first_deposit_bonus_pct', 5, 0, 100);
                    $depositCommissionPct = getNumericSetting($pdo, 'referral_deposit_commission_pct', 5, 0, 100);
                    if ($user && $user['referred_by'] && $firstDepositBonusPct > 0) {
                        $stmt = $pdo->prepare("SELECT COUNT(*) FROM deposits WHERE user_id = ? AND status = 'Confirmed'");
                        $stmt->execute([$deposit['user_id']]);
                        if ((int)$stmt->fetchColumn() === 1) {
                            $firstDepositBonusAmt = (float)$deposit['amount'] * ($firstDepositBonusPct / 100);
                            $firstBonusRef = 'FIRST-BONUS-' . (int)$depositId;
                            $stmt = $pdo->prepare('UPDATE users SET balance = balance + ? WHERE id = ?');
                            $stmt->execute([$firstDepositBonusAmt, $deposit['user_id']]);
                            $stmt = $pdo->prepare('INSERT INTO transactions (user_id, date, type, amount, ref, status) VALUES (?, ?, ?, ?, ?, ?)');
                            $stmt->execute([$deposit['user_id'], date('M j, Y h:i A'), 'First Deposit Bonus', $firstDepositBonusAmt, $firstBonusRef, 'Confirmed']);
                        }
                    }

                    if ($user && $user['referred_by'] && $depositCommissionPct > 0) {
                        $referralBonusAmt = $deposit['amount'] * ($depositCommissionPct / 100);
                        $stmt = $pdo->prepare('UPDATE users SET balance = balance + ? WHERE id = ?');
                        $stmt->execute([$referralBonusAmt, $user['referred_by']]);

                        $dateStr = date('M j, Y h:i A');
                        $refCode = 'REF-DEP-' . strtoupper(substr(md5(uniqid()), 0, 6));
                        $stmt = $pdo->prepare('INSERT INTO transactions (user_id, date, type, amount, ref, status) VALUES (?, ?, ?, ?, ?, ?)');
                        $stmt->execute([$user['referred_by'], $dateStr, 'Referral Bonus', $referralBonusAmt, $refCode, 'Confirmed']);

                        $bonusText = number_format($referralBonusAmt, 2);
                        notifyAdmins($pdo, $depositCommissionPct . '% Referral Commission Credited', "<p>A {$depositCommissionPct}% referral commission of <strong>\${$bonusText}</strong> was automatically credited to Referrer User ID #{$user['referred_by']}.</p>", 'commission');
                    }
                }
                $pdo->commit();
                auditAdminAction($pdo, $userId, 'deposit.' . strtolower($newStatus), 'deposit', $depositId, ['amount' => (float)$deposit['amount'], 'userId' => $deposit['user_id']]);
                if ($act === 'Approve') {
                    $stmt = $pdo->prepare('SELECT balance FROM users WHERE id = ?'); $stmt->execute([$deposit['user_id']]); $current = (float)($stmt->fetch()['balance'] ?? 0);
                    recordBalanceLedger($pdo, $deposit['user_id'], $deposit['txn_id'], 'deposit_credit', (float)$deposit['amount'], $current - (float)$deposit['amount'], 'Confirmed deposit');
                }
                if ($act === 'Approve' && !empty($user['referred_by']) && isset($referralBonusAmt, $refCode)) {
                    $stmt = $pdo->prepare('SELECT balance FROM users WHERE id = ?'); $stmt->execute([$user['referred_by']]); $current = (float)($stmt->fetch()['balance'] ?? 0);
                    recordBalanceLedger($pdo, $user['referred_by'], $refCode, 'referral_bonus', $referralBonusAmt, $current - $referralBonusAmt, 'Deposit referral bonus');
                }
                if ($act === 'Approve' && isset($firstDepositBonusAmt, $firstBonusRef)) {
                    $stmt = $pdo->prepare('SELECT balance FROM users WHERE id = ?'); $stmt->execute([$deposit['user_id']]); $current = (float)($stmt->fetch()['balance'] ?? 0);
                    recordBalanceLedger($pdo, $deposit['user_id'], $firstBonusRef, 'first_deposit_bonus', $firstDepositBonusAmt, $current - $firstDepositBonusAmt, 'Referral code bonus after first deposit');
                }
                $amountText = number_format((float)$deposit['amount'], 2);
                $safeRef = htmlspecialchars($deposit['txn_id']);
                notifyUserById($pdo, $deposit['user_id'], $act === 'Approve' ? 'Deposit confirmed' : 'Deposit rejected', "<p>Your deposit of <strong>\${$amountText}</strong> has been <strong>" . strtolower($newStatus) . "</strong>.</p><p><strong>Reference:</strong> {$safeRef}</p>", 'deposit');
                if ($act === 'Approve' && !empty($user['referred_by']) && isset($referralBonusAmt)) {
                    $bonusText = number_format($referralBonusAmt, 2);
                    notifyUserById($pdo, $user['referred_by'], 'Referral commission credited', "<p>A {$depositCommissionPct}% referral commission of <strong>\${$bonusText}</strong> was automatically added to your balance.</p>", 'referral');
                }
                if ($act === 'Approve' && isset($firstDepositBonusAmt, $firstDepositBonusPct)) {
                    notifyUserById($pdo, $deposit['user_id'], 'First deposit bonus credited', '<p>Your ' . $firstDepositBonusPct . '% referral-code bonus of <strong>$' . number_format($firstDepositBonusAmt, 2) . '</strong> was added after your first approved deposit.</p>', 'referral');
                }
                $response = ['message' => "Deposit successfully " . strtolower($act) . "d."];
                if ($act === 'Approve') {
                    $stmt = $pdo->prepare('SELECT balance FROM users WHERE id = ?');
                    $stmt->execute([$deposit['user_id']]);
                    $response['newBalance'] = (float)($stmt->fetchColumn() ?: 0);
                    $response['message'] = 'Deposit approved. User available balance is now $' . number_format($response['newBalance'], 2) . '.';
                }
                sendJson($response);
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                error_log('Deposit verification failed for #' . $depositId . ': ' . $e->getMessage());
                sendJson(['message' => 'Deposit verification failed. No partial balance update was applied.'], 500);
            }
        }

        if ($action === 'deposits' && $subaction === 'manual-create') {
            $targetUserId = (int)($body['userId'] ?? 0);
            $amount = (float)($body['amount'] ?? 0);
            $planName = !empty($body['planName']) ? trim($body['planName']) : null;

            if ($targetUserId <= 0 || $amount <= 0) {
                sendJson(['message' => 'Please select a valid user and non-zero amount.'], 400);
            }

            $dateStr = date('M j, Y h:i A');
            $depCode = 'MANUAL-DEP-' . strtoupper(substr(md5(uniqid()), 0, 6));

            $pdo->beginTransaction();
            try {
                // 1. Insert deposit record
                $stmt = $pdo->prepare('INSERT INTO deposits (user_id, date, amount, txn_id, plan_name, status) VALUES (?, ?, ?, ?, ?, ?)');
                $stmt->execute([$targetUserId, $dateStr, $amount, $depCode, $planName, 'Confirmed']);

                // 2. Credit user balance
                $stmt = $pdo->prepare('UPDATE users SET balance = balance + ? WHERE id = ?');
                $stmt->execute([$amount, $targetUserId]);

                // 3. Create investment if plan selected
                if ($planName) {
                    $nowMs = time() * 1000;
                    $pStmt = $pdo->prepare('SELECT daily_profit_pct, duration_days FROM plans WHERE name = ? AND is_active = 1 LIMIT 1');
                    $pStmt->execute([$planName]);
                    $pInfo = $pStmt->fetch();
                    $roiVal = $pInfo ? (float)$pInfo['daily_profit_pct'] : 2.5;
                    $durVal = $pInfo ? (int)$pInfo['duration_days'] : 1;

                    $stmt = $pdo->prepare('INSERT INTO investments (user_id, name, amount, daily_profit_pct, duration_days, status, start_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
                    $stmt->execute([$targetUserId, $planName, $amount, $roiVal, $durVal, 'Active', $dateStr, $nowMs]);
                }

                // 4. Log transaction
                $stmt = $pdo->prepare('INSERT INTO transactions (user_id, date, type, amount, ref, status) VALUES (?, ?, ?, ?, ?, ?)');
                $stmt->execute([$targetUserId, $dateStr, 'Deposit', $amount, $depCode, 'Confirmed']);

                // 5. Configurable first-deposit reward and referral commission
                $rStmt = $pdo->prepare('SELECT referred_by FROM users WHERE id = ?');
                $rStmt->execute([$targetUserId]);
                $uInfo = $rStmt->fetch();
                $firstDepositBonusPct = getNumericSetting($pdo, 'referral_first_deposit_bonus_pct', 5, 0, 100);
                $depositCommissionPct = getNumericSetting($pdo, 'referral_deposit_commission_pct', 5, 0, 100);
                if ($uInfo && $uInfo['referred_by'] && $firstDepositBonusPct > 0) {
                    $stmt = $pdo->prepare("SELECT COUNT(*) FROM deposits WHERE user_id = ? AND status = 'Confirmed'");
                    $stmt->execute([$targetUserId]);
                    if ((int)$stmt->fetchColumn() === 1) {
                        $firstBonus = $amount * ($firstDepositBonusPct / 100);
                        $stmt = $pdo->prepare('UPDATE users SET balance = balance + ? WHERE id = ?');
                        $stmt->execute([$firstBonus, $targetUserId]);
                        $stmt = $pdo->prepare('INSERT INTO transactions (user_id, date, type, amount, ref, status) VALUES (?, ?, ?, ?, ?, ?)');
                        $stmt->execute([$targetUserId, $dateStr, 'First Deposit Bonus', $firstBonus, 'FIRST-BONUS-' . $depCode, 'Confirmed']);
                    }
                }
                if ($uInfo && $uInfo['referred_by'] && $depositCommissionPct > 0) {
                    $refBonus = $amount * ($depositCommissionPct / 100);
                    $stmt = $pdo->prepare('UPDATE users SET balance = balance + ? WHERE id = ?');
                    $stmt->execute([$refBonus, $uInfo['referred_by']]);

                    $refCode = 'REF-DEP-' . strtoupper(substr(md5(uniqid()), 0, 6));
                    $stmt = $pdo->prepare('INSERT INTO transactions (user_id, date, type, amount, ref, status) VALUES (?, ?, ?, ?, ?, ?)');
                    $stmt->execute([$uInfo['referred_by'], $dateStr, 'Referral Bonus', $refBonus, $refCode, 'Confirmed']);

                    $bonusText = number_format($refBonus, 2);
                    notifyAdmins($pdo, $depositCommissionPct . '% Referral Commission Credited', "<p>A {$depositCommissionPct}% commission of <strong>\${$bonusText}</strong> was credited to Referrer User ID #{$uInfo['referred_by']}.</p>", 'commission');
                }

                $pdo->commit();
                sendJson(['message' => 'Manual deposit of $' . number_format($amount, 2) . ' successfully credited!']);
            } catch (Exception $e) {
                $pdo->rollBack();
                sendJson(['message' => 'Failed to create manual deposit.'], 500);
            }
        }

        if ($action === 'commissions' && $subaction === 'revoke') {
            $transactionId = $body['transactionId'] ?? null;
            if (!$transactionId) sendJson(['message' => 'Valid transaction ID required'], 400);

            $stmt = $pdo->prepare('SELECT * FROM transactions WHERE id = ? AND type = ?');
            $stmt->execute([$transactionId, 'Referral Bonus']);
            $tx = $stmt->fetch();

            if (!$tx) sendJson(['message' => 'Commission not found'], 404);
            if ($tx['status'] !== 'Confirmed') sendJson(['message' => 'Only confirmed commissions can be revoked'], 400);

            $pdo->beginTransaction();
            try {
                // Update transaction status
                $stmt = $pdo->prepare("UPDATE transactions SET status = 'Revoked' WHERE id = ? AND status = 'Confirmed'");
                $stmt->execute([$transactionId]);
                if ($stmt->rowCount() !== 1) throw new Exception('Commission was already processed');

                // Deduct from user balance (greastest of 0 or balance - amount)
                $stmt = $pdo->prepare('UPDATE users SET balance = GREATEST(0, balance - ?) WHERE id = ?');
                $stmt->execute([$tx['amount'], $tx['user_id']]);

                $pdo->commit();
                auditAdminAction($pdo, $userId, 'commission.revoked', 'transaction', $transactionId, ['amount' => (float)$tx['amount'], 'userId' => $tx['user_id']]);

                notifyUserById($pdo, $tx['user_id'], 'Commission Revoked', "<p>A referral commission of <strong>\$" . number_format($tx['amount'], 2) . "</strong> has been revoked from your account.</p>", 'referral');

                sendJson(['message' => 'Commission successfully revoked and deducted from user balance.']);
            } catch (Exception $e) {
                $pdo->rollBack();
                sendJson(['message' => 'Server error'], 500);
            }
        }

        if ($action === 'payouts' && $subaction === 'verify') {
            $transactionId = $body['transactionId'] ?? null;
            if (!$transactionId) sendJson(['message' => 'Valid transaction ID required'], 400);

            $stmt = $pdo->prepare('SELECT * FROM transactions WHERE id = ? AND type = ?');
            $stmt->execute([$transactionId, 'Withdrawal']);
            $tx = $stmt->fetch();

            if (!$tx) sendJson(['message' => 'Withdrawal not found'], 404);
            if ($tx['status'] !== 'Pending') sendJson(['message' => 'Already processed'], 400);

            $stmt = $pdo->prepare("UPDATE transactions SET status = ? WHERE id = ? AND status = 'Pending'");
            $stmt->execute(['Confirmed', $transactionId]);
            if ($stmt->rowCount() !== 1) sendJson(['message' => 'Withdrawal was already processed'], 409);
            auditAdminAction($pdo, $userId, 'withdrawal.confirmed', 'transaction', $transactionId, ['amount' => (float)$tx['amount'], 'userId' => $tx['user_id']]);
            $amountText = number_format((float)$tx['amount'], 2);
            notifyUserById($pdo, $tx['user_id'], 'Withdrawal completed', "<p>Your withdrawal of <strong>\${$amountText}</strong> has been approved and marked completed.</p><p><strong>Reference:</strong> " . htmlspecialchars($tx['ref']) . '</p>', 'withdrawal');
            sendJson(['message' => 'Withdrawal successfully approved and completed.']);
        }

        if ($action === 'tickets' && $subaction === 'reply') {
            $targetUserId = $body['userId'] ?? null;
            $reply = $body['reply'] ?? '';
            $screenshotBase64 = $body['screenshotBase64'] ?? '';

            if (!$targetUserId || (!$reply && !$screenshotBase64)) {
                sendJson(['message' => 'User ID and reply are required'], 400);
            }

            $savedImagePath = null;
            if ($screenshotBase64) {
                $uploadError = '';
                $savedImagePath = saveValidatedBase64Image($screenshotBase64, 'support', $uploadError);
                if (!$savedImagePath) sendJson(['message' => $uploadError], 400);
            }

            $dateStr = date('M j, Y h:i A');
            $ticketId = "#" . rand(10000, 99999);

            $stmt = $pdo->prepare('INSERT INTO tickets (user_id, title, ticket_id, date, status, message, admin_reply, admin_image_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            $stmt->execute([$targetUserId, 'Support Reply', $ticketId, $dateStr, 'Open', '', $reply, $savedImagePath]);

            // Notify User via Email
            $uStmt = $pdo->prepare('SELECT name, email FROM users WHERE id = ?');
            $uStmt->execute([$targetUserId]);
            $targetUser = $uStmt->fetch();

            if ($targetUser && !empty($targetUser['email'])) {
                $emailSubject = "New Reply from Nova Support {$ticketId}";
                $emailBody = "<h2>Support Reply from Nova</h2>" .
                             "<p>Hi <strong>" . htmlspecialchars($targetUser['name']) . "</strong>,</p>" .
                             "<p>You have received a reply from Nova Support team:</p>" .
                             "<blockquote style='background:#f4f4f4; padding: 12px; border-left:4px solid #0070f3;'>" . nl2br(htmlspecialchars($reply)) . "</blockquote>" .
                             "<p>Log in to your Nova Portal dashboard to view full chat history.</p>";
                if (notificationEnabled($pdo, 'user', 'support')) sendSmtpEmail($targetUser['email'], $targetUser['name'], $emailSubject, $emailBody, $pdo);
            }

            sendJson(['message' => 'Reply sent successfully.']);
        }

        if ($action === 'tickets' && $subaction === 'toggle-status') {
            $targetUserId = $body['userId'] ?? null;
            $status = $body['status'] ?? null;

            if (!$targetUserId || !$status) sendJson(['message' => 'User ID and status are required'], 400);

            $stmt = $pdo->prepare('UPDATE tickets SET status = ? WHERE user_id = ?');
            $stmt->execute([$status, $targetUserId]);
            sendJson(['message' => "Support thread status set to $status."]);
        }

        if ($action === 'settings' && $subaction === 'tron-address') {
            $address = trim($body['address'] ?? '');
            if (!preg_match('/^T[1-9A-HJ-NP-Za-km-z]{33}$/', $address)) {
                sendJson(['message' => 'A valid TRON TRC20 address is required.'], 400);
            }

            $stmt = $pdo->prepare("INSERT INTO settings (`key`, value) VALUES ('tron_deposit_address', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)");
            $stmt->execute([$address]);
            sendJson(['message' => 'TRON deposit address updated successfully.']);
        }

        if ($action === 'settings' && $subaction === 'change-email-request') {
            $currentPassword = $body['currentPassword'] ?? '';
            $newEmail = trim($body['newEmail'] ?? '');
            if (!$currentPassword || !$newEmail) sendJson(['message' => 'Password and new email are required.'], 400);
            if (!filter_var($newEmail, FILTER_VALIDATE_EMAIL)) sendJson(['message' => 'Invalid email address.'], 400);

            // Verify current admin password
            $stmt = $pdo->prepare('SELECT name, password FROM users WHERE id = ? AND role = "admin"');
            $stmt->execute([$userId]);
            $adminUser = $stmt->fetch();
            if (!$adminUser || !password_verify($currentPassword, $adminUser['password'])) {
                sendJson(['message' => 'Current password is incorrect.'], 403);
            }

            // Check if new email is already in use
            $stmt = $pdo->prepare('SELECT id FROM users WHERE email = ?');
            $stmt->execute([$newEmail]);
            if ($stmt->fetch()) sendJson(['message' => 'Email address is already in use.'], 400);

            // Generate OTP
            $otp = (string)random_int(100000, 999999);
            $tokenHash = password_hash($otp, PASSWORD_DEFAULT);
            $stmt = $pdo->prepare('INSERT INTO email_change_tokens (user_id, new_email, token_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))');
            $stmt->execute([$userId, $newEmail, $tokenHash]);

            // Send OTP
            $subject = "Admin Email Change Verification - Nova Portal";
            $bodyHtml = "<div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;'>" .
                        "<h2 style='color: #0070f3;'>Admin Email Verification</h2>" .
                        "<p>Hi <strong>" . htmlspecialchars($adminUser['name']) . "</strong>,</p>" .
                        "<p>You requested to change your Admin account email. Here is your 6-digit OTP verification code:</p>" .
                        "<div style='background: #f0f7ff; padding: 15px; text-align: center; border-radius: 6px; margin: 20px 0;'>" .
                        "<span style='font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #0047a0;'>" . $otp . "</span></div>" .
                        "<p style='color: #666; font-size: 14px;'>This code will expire in 15 minutes. If you did not request this, please secure your admin account immediately.</p>" .
                        "</div>";
            sendSmtpEmail($newEmail, $adminUser['name'], $subject, $bodyHtml, $pdo);
            sendJson(['message' => 'OTP sent to your new admin email address.']);
        }

        if ($action === 'settings' && $subaction === 'change-email-verify') {
            $otp = trim($body['otp'] ?? '');
            $newEmail = trim($body['newEmail'] ?? '');
            if (!$otp || !$newEmail) sendJson(['message' => 'OTP and new email are required.'], 400);

            // Find valid token
            $stmt = $pdo->prepare('SELECT id, token_hash, attempts FROM email_change_tokens WHERE user_id = ? AND new_email = ? AND expires_at > NOW() AND used_at IS NULL ORDER BY id DESC LIMIT 1');
            $stmt->execute([$userId, $newEmail]);
            $token = $stmt->fetch();
            if (!$token) sendJson(['message' => 'Invalid or expired OTP request.'], 400);

            if ($token['attempts'] >= 5) sendJson(['message' => 'Too many failed attempts. Please request a new OTP.'], 429);

            if (!password_verify($otp, $token['token_hash'])) {
                $pdo->prepare('UPDATE email_change_tokens SET attempts = attempts + 1 WHERE id = ?')->execute([$token['id']]);
                sendJson(['message' => 'Incorrect OTP code.'], 400);
            }

            // Check email uniqueness again
            $stmt = $pdo->prepare('SELECT id FROM users WHERE email = ?');
            $stmt->execute([$newEmail]);
            if ($stmt->fetch()) sendJson(['message' => 'Email address is already in use.'], 400);

            // Update email
            $stmt = $pdo->prepare('UPDATE users SET email = ? WHERE id = ? AND role = "admin"');
            $stmt->execute([$newEmail, $userId]);
            
            // Mark token used
            $pdo->prepare('UPDATE email_change_tokens SET used_at = NOW() WHERE id = ?')->execute([$token['id']]);

            auditAdminAction($pdo, $userId, 'settings.email_change', 'admin', $userId, ['new_email' => $newEmail]);
            sendJson(['message' => 'Admin email address updated successfully!']);
        }
    }

    sendJson(['message' => 'Invalid Admin Action'], 404);
}
?>
