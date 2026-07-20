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

            sendJson([
                'users' => (int)$totalUsers,
                'deposits' => (float)$totalDeposits,
                'pendingWithdrawals' => (int)$pendingWithdrawals,
                'activeInvestments' => (float)$activeInvestmentsSum,
                'activeUsers' => (int)$activeUsersCount
            ]);
        }

        if ($action === 'users') {
            $stmt = $pdo->query('SELECT id, name, email, balance, earnings, role, referral_code, referred_by FROM users ORDER BY id DESC');
            sendJson($stmt->fetchAll());
        }

        if ($action === 'deposits') {
            $stmt = $pdo->query('SELECT deposits.*, users.name as user_name, users.email as user_email FROM deposits JOIN users ON deposits.user_id = users.id ORDER BY deposits.id DESC');
            sendJson($stmt->fetchAll());
        }

        if ($action === 'payouts') {
            $stmt = $pdo->query("SELECT transactions.*, users.name as user_name, users.email as user_email FROM transactions JOIN users ON transactions.user_id = users.id WHERE transactions.type = 'Withdrawal' ORDER BY transactions.id DESC");
            sendJson($stmt->fetchAll());
        }

        if ($action === 'tickets') {
            $stmt = $pdo->query('SELECT tickets.*, users.name as user_name, users.email as user_email FROM tickets JOIN users ON tickets.user_id = users.id ORDER BY tickets.id DESC');
            sendJson($stmt->fetchAll());
        }

        if ($action === 'settings' && $subaction === 'smtp') {
            $keys = ['smtp_host', 'smtp_port', 'smtp_encryption', 'smtp_username', 'smtp_password', 'smtp_from_email', 'smtp_from_name'];
            $placeholders = implode(',', array_fill(0, count($keys), '?'));
            $stmt = $pdo->prepare("SELECT `key`, value FROM settings WHERE `key` IN ($placeholders)");
            $stmt->execute($keys);
            $stored = [];
            foreach ($stmt->fetchAll() as $row) $stored[$row['key']] = $row['value'];

            sendJson([
                'host' => $stored['smtp_host'] ?? '',
                'port' => (int)($stored['smtp_port'] ?? 587),
                'encryption' => $stored['smtp_encryption'] ?? 'tls',
                'username' => $stored['smtp_username'] ?? '',
                'fromEmail' => $stored['smtp_from_email'] ?? '',
                'fromName' => $stored['smtp_from_name'] ?? 'NOVA',
                'passwordConfigured' => !empty($stored['smtp_password'])
            ]);
        }
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        if ($action === 'settings' && $subaction === 'smtp') {
            $host = trim($body['host'] ?? '');
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

        if ($action === 'users' && $subaction === 'balance') {
            $targetUserId = $body['userId'] ?? null;
            $newBalance = $body['newBalance'] ?? null;

            if ($targetUserId === null || $newBalance === null || !is_numeric($newBalance) || $newBalance < 0) {
                sendJson(['message' => 'Valid user ID and non-negative balance are required'], 400);
            }

            $stmt = $pdo->prepare('UPDATE users SET balance = ? WHERE id = ?');
            $stmt->execute([(float)$newBalance, $targetUserId]);
            sendJson(['message' => 'User balance updated successfully.']);
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
                $stmt = $pdo->prepare('UPDATE deposits SET status = ? WHERE id = ?');
                $stmt->execute([$newStatus, $depositId]);

                $stmt = $pdo->prepare('UPDATE transactions SET status = ? WHERE ref = ?');
                $stmt->execute([$newStatus, $deposit['txn_id']]);

                if ($act === 'Approve') {
                    if ($deposit['plan_name']) {
                        $dateStr = date('M j, Y h:i A');
                        $nowMs = time() * 1000;
                        $stmt = $pdo->prepare('INSERT INTO investments (user_id, name, amount, daily_profit_pct, duration_days, status, start_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
                        $stmt->execute([$deposit['user_id'], $deposit['plan_name'], $deposit['amount'], 2.5, 1, 'Active', $dateStr, $nowMs]);
                    } else {
                        $stmt = $pdo->prepare('UPDATE users SET balance = balance + ? WHERE id = ?');
                        $stmt->execute([$deposit['amount'], $deposit['user_id']]);
                    }

                    $stmt = $pdo->prepare('SELECT referred_by FROM users WHERE id = ?');
                    $stmt->execute([$deposit['user_id']]);
                    $user = $stmt->fetch();

                    if ($user && $user['referred_by']) {
                        $referralBonusAmt = $deposit['amount'] * 0.10;
                        $stmt = $pdo->prepare('UPDATE users SET balance = balance + ? WHERE id = ?');
                        $stmt->execute([$referralBonusAmt, $user['referred_by']]);

                        $dateStr = date('M j, Y h:i A');
                        $refCode = 'REF-DEP-' . strtoupper(substr(md5(uniqid()), 0, 6));
                        $stmt = $pdo->prepare('INSERT INTO transactions (user_id, date, type, amount, ref, status) VALUES (?, ?, ?, ?, ?, ?)');
                        $stmt->execute([$user['referred_by'], $dateStr, 'Referral Bonus', $referralBonusAmt, $refCode, 'Confirmed']);
                    }
                }
                $pdo->commit();
                sendJson(['message' => "Deposit successfully " . strtolower($act) . "d."]);
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

            $stmt = $pdo->prepare('UPDATE transactions SET status = ? WHERE id = ?');
            $stmt->execute(['Confirmed', $transactionId]);
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
                if (preg_match('/^data:([A-Za-z-+\/]+);base64,(.+)$/', $screenshotBase64, $matches)) {
                    $type = $matches[1];
                    $base64Data = base64_decode($matches[2]);
                    $ext = explode('/', $type)[1] ?? 'png';
                    $fileName = 'support_' . time() . '_' . substr(md5(uniqid()), 0, 6) . '.' . $ext;
                    $uploadsDir = '../public/uploads/';
                    if (!is_dir($uploadsDir)) mkdir($uploadsDir, 0755, true);
                    $fullSavePath = $uploadsDir . $fileName;
                    file_put_contents($fullSavePath, $base64Data);
                    $savedImagePath = '/uploads/' . $fileName;
                }
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
                sendSmtpEmail($targetUser['email'], $targetUser['name'], $emailSubject, $emailBody, $pdo);
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
            $address = $body['address'] ?? '';
            if (!$address) sendJson(['message' => 'Address is required'], 400);

            $stmt = $pdo->prepare("INSERT INTO settings (`key`, value) VALUES ('tron_deposit_address', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)");
            $stmt->execute([$address]);
            sendJson(['message' => 'TRON deposit address updated successfully.']);
        }
    }

    sendJson(['message' => 'Invalid Admin Action'], 404);
}
?>
