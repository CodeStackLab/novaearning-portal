<?php
// api/withdrawals.php

function handleWithdrawals($action, $pdo, $body) {
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit();
    $userId = authenticateToken();

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && !$action) {
        $address = $body['address'] ?? '';
        $amount = $body['amount'] ?? 0;
        $withdrawAmt = (float)$amount;

        if (!$address || $withdrawAmt < 20) {
            sendJson(['message' => 'Valid address and amount (minimum $20) are required'], 400);
        }

        $stmt = $pdo->prepare('SELECT name, email, balance FROM users WHERE id = ?');
        $stmt->execute([$userId]);
        $user = $stmt->fetch();

        if (!$user || $user['balance'] < $withdrawAmt) {
            sendJson(['message' => 'Insufficient balance'], 400);
        }

        $dateStr = date('M j, Y h:i A');
        $randomRef = "WD" . strtoupper(substr(md5(uniqid()), 0, 8));
        $fee = $withdrawAmt * 0.02;
        $netPayout = $withdrawAmt - $fee;

        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare('UPDATE users SET balance = balance - ? WHERE id = ?');
            $stmt->execute([$withdrawAmt, $userId]);

            $stmt = $pdo->prepare('INSERT INTO transactions (user_id, date, type, amount, ref, status, wallet_address) VALUES (?, ?, ?, ?, ?, ?, ?)');
            $stmt->execute([$userId, $dateStr, 'Withdrawal', $withdrawAmt, $randomRef, 'Pending', $address]);

            $pdo->commit();
            $amountText = number_format($withdrawAmt, 2);
            $netText = number_format($netPayout, 2);
            $safeRef = htmlspecialchars($randomRef);
            notifyUserById($pdo, $userId, 'Withdrawal request received', "<p>Your withdrawal request for <strong>\${$amountText}</strong> is pending review.</p><p>Net payout after the 2% fee: <strong>\${$netText}</strong>.</p><p><strong>Reference:</strong> {$safeRef}</p>", 'withdrawal');
            notifyAdmins($pdo, 'New withdrawal awaiting approval', "<p><strong>" . htmlspecialchars($user['name'] ?: 'User') . "</strong> requested a withdrawal of <strong>\${$amountText}</strong>.</p><p><strong>Reference:</strong> {$safeRef}</p><p>Please review it in Manage Payouts.</p>", 'withdrawal');
            sendJson(['message' => "Withdrawal request for $" . number_format($withdrawAmt, 2) . " submitted. A 2% fee ($" . number_format($fee, 2) . ") applies. Net payout will be $" . number_format($netPayout, 2) . "."]);
        } catch (Exception $e) {
            $pdo->rollBack();
            sendJson(['message' => 'Server error'], 500);
        }
    }

    sendJson(['message' => 'Invalid Withdrawals Action'], 404);
}
?>
