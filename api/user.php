<?php
// api/user.php

function handleUser($action, $subaction, $pdo, $body) {
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit();
    $userId = authenticateToken();

    if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'profile') {
        $stmt = $pdo->prepare('SELECT id, name, email, balance, earnings, role, referral_code, referred_by FROM users WHERE id = ?');
        $stmt->execute([$userId]);
        $user = $stmt->fetch();

        if (!$user) {
            sendJson(['message' => 'User not found'], 404);
        }

        $stmt = $pdo->prepare('SELECT SUM(amount) as activeSum FROM investments WHERE user_id = ? AND status = ?');
        $stmt->execute([$userId, 'Active']);
        $activeInvestmentsSum = $stmt->fetch();
        $activeTotal = $activeInvestmentsSum['activeSum'] ? (float)$activeInvestmentsSum['activeSum'] : 0.00;

        $stmt = $pdo->prepare('SELECT COUNT(*) as refCount FROM users WHERE referred_by = ?');
        $stmt->execute([$userId]);
        $refCountRow = $stmt->fetch();
        $totalReferrals = $refCountRow['refCount'] ? (int)$refCountRow['refCount'] : 0;

        $stmt = $pdo->prepare("SELECT COUNT(DISTINCT user_id) as activeRefCount FROM investments JOIN users ON investments.user_id = users.id WHERE users.referred_by = ? AND investments.status = 'Active'");
        $stmt->execute([$userId]);
        $activeRefRow = $stmt->fetch();
        $activeReferralsCount = $activeRefRow['activeRefCount'] ? (int)$activeRefRow['activeRefCount'] : 0;

        $stmt = $pdo->prepare("SELECT SUM(amount) as comSum FROM transactions WHERE user_id = ? AND type IN ('Referral Bonus', 'Referral Commission')");
        $stmt->execute([$userId]);
        $comSumRow = $stmt->fetch();
        $totalComEarned = $comSumRow['comSum'] ? (float)$comSumRow['comSum'] : 0.00;

        $stmt = $pdo->prepare("SELECT SUM(amount) as refActiveSum FROM investments JOIN users ON investments.user_id = users.id WHERE users.referred_by = ? AND investments.status = 'Active'");
        $stmt->execute([$userId]);
        $refActiveSumRow = $stmt->fetch();
        $refActiveTotal = $refActiveSumRow['refActiveSum'] ? (float)$refActiveSumRow['refActiveSum'] : 0.00;

        $todayProfit = ($activeTotal * 0.025) + ($refActiveTotal * 0.0025);

        $stmt = $pdo->prepare('SELECT id, name, email FROM users WHERE referred_by = ? ORDER BY id DESC LIMIT 5');
        $stmt->execute([$userId]);
        $signupsRows = $stmt->fetchAll();

        $user['active_investments'] = $activeTotal;
        $user['today_profit'] = $todayProfit;
        $user['referralsStats'] = [
            'totalReferrals' => $totalReferrals,
            'activeReferralsCount' => $activeReferralsCount,
            'totalComEarned' => $totalComEarned,
            'signups' => $signupsRows
        ];

        sendJson($user);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'password') {
        $currentPassword = $body['currentPassword'] ?? '';
        $newPassword = $body['newPassword'] ?? '';
        if ($currentPassword === '' || strlen($newPassword) < 8) {
            sendJson(['message' => 'Current password and a new password of at least 8 characters are required.'], 400);
        }
        $stmt = $pdo->prepare('SELECT password FROM users WHERE id = ?');
        $stmt->execute([$userId]);
        $user = $stmt->fetch();
        if (!$user || !password_verify($currentPassword, $user['password'])) sendJson(['message' => 'Current password is incorrect.'], 403);
        if (password_verify($newPassword, $user['password'])) sendJson(['message' => 'New password must be different.'], 400);
        $hashedPassword = password_hash($newPassword, PASSWORD_BCRYPT);
        $stmt = $pdo->prepare('UPDATE users SET password = ? WHERE id = ?');
        $stmt->execute([$hashedPassword, $userId]);
        notifyUserById($pdo, $userId, 'Password changed', '<p>Your Nova account password was changed successfully.</p><p>If this was not you, contact support immediately.</p>', 'support');
        sendJson(['message' => 'Password updated successfully']);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'change-email') {
        sendJson(['message' => 'Email changes are handled by support. Please create a support ticket.'], 403);
    }

    if ($action === 'notifications') {
        $keys = ['deposit', 'withdrawal', 'investment', 'commission', 'referral', 'reminder', 'support'];
        ensureUserNotificationPreferencesTable($pdo);
        if ($_SERVER['REQUEST_METHOD'] === 'GET') {
            $result = array_fill_keys($keys, true);
            $stmt = $pdo->prepare('SELECT event_key, enabled FROM user_notification_preferences WHERE user_id = ?');
            $stmt->execute([$userId]);
            foreach ($stmt->fetchAll() as $row) {
                if (array_key_exists($row['event_key'], $result)) $result[$row['event_key']] = (bool)$row['enabled'];
            }
            sendJson($result);
        }
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $stmt = $pdo->prepare('INSERT INTO user_notification_preferences (user_id, event_key, enabled) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)');
            $pdo->beginTransaction();
            try {
                foreach ($keys as $key) $stmt->execute([$userId, $key, !empty($body[$key]) ? 1 : 0]);
                $pdo->commit();
                sendJson(['message' => 'Your email preferences were saved.']);
            } catch (Exception $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                sendJson(['message' => 'Unable to save your email preferences.'], 500);
            }
        }
    }

    if ($action === 'notification-center') {
        ensurePlatformFeatureTables($pdo);
        if ($_SERVER['REQUEST_METHOD'] === 'GET') {
            $stmt = $pdo->prepare('SELECT id, category, title, message, action_url, is_read, created_at FROM in_app_notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50');
            $stmt->execute([$userId]);
            $items = $stmt->fetchAll();
            $unread = 0;
            foreach ($items as &$item) { $item['is_read'] = (bool)$item['is_read']; if (!$item['is_read']) $unread++; }
            sendJson(['items' => $items, 'unread' => $unread]);
        }
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $notificationId = (int)($body['notificationId'] ?? 0);
            if ($notificationId > 0) {
                $stmt = $pdo->prepare('UPDATE in_app_notifications SET is_read = 1 WHERE id = ? AND user_id = ?');
                $stmt->execute([$notificationId, $userId]);
            } else {
                $stmt = $pdo->prepare('UPDATE in_app_notifications SET is_read = 1 WHERE user_id = ?');
                $stmt->execute([$userId]);
            }
            sendJson(['message' => 'Notifications marked as read.']);
        }
    }

    if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'ledger') {
        ensurePlatformFeatureTables($pdo);
        $stmt = $pdo->prepare('SELECT transaction_ref, entry_type, amount, balance_before, balance_after, description, created_at FROM balance_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 250');
        $stmt->execute([$userId]);
        sendJson($stmt->fetchAll());
    }

    if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'login-activity') {
        ensurePlatformFeatureTables($pdo);
        $stmt = $pdo->prepare('SELECT ip_address, user_agent, login_at FROM login_activity WHERE user_id = ? ORDER BY id DESC LIMIT 20');
        $stmt->execute([$userId]);
        sendJson($stmt->fetchAll());
    }

    sendJson(['message' => 'Invalid User Action'], 404);
}
?>
