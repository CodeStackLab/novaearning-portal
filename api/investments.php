<?php
// api/investments.php

function handleInvestments($action, $pdo, $body) {
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit();
    $userId = authenticateToken();

    if ($_SERVER['REQUEST_METHOD'] === 'GET' && !$action) {
        $stmt = $pdo->prepare('SELECT * FROM investments WHERE user_id = ? ORDER BY id DESC');
        $stmt->execute([$userId]);
        sendJson($stmt->fetchAll());
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && !$action) {
        $name = $body['name'] ?? '';
        $quantity = isset($body['quantity']) ? (int)$body['quantity'] : 1;

        if (!$name || $quantity <= 0) {
            sendJson(['message' => 'Invalid plan purchase parameters'], 400);
        }

        $singlePlanPrice = 100.00;
        $totalCost = $singlePlanPrice * $quantity;

        $stmt = $pdo->prepare('SELECT name, email, balance FROM users WHERE id = ?');
        $stmt->execute([$userId]);
        $user = $stmt->fetch();

        if (!$user || $user['balance'] < $totalCost) {
            sendJson(['message' => 'Insufficient balance'], 400);
        }

        $dateStr = date('M j, Y h:i A');
        $randomRef = "INV" . strtoupper(substr(md5(uniqid()), 0, 8));
        $nowMs = time() * 1000;

        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare('UPDATE users SET balance = balance - ? WHERE id = ?');
            $stmt->execute([$totalCost, $userId]);

            $stmt = $pdo->prepare('INSERT INTO investments (user_id, name, amount, daily_profit_pct, duration_days, status, start_date, created_at) VALUES (?, ?, ?, 2.5, 1, ?, ?, ?)');
            $stmt->execute([$userId, "$name (x$quantity)", $totalCost, 'Active', $dateStr, $nowMs]);

            $stmt = $pdo->prepare('INSERT INTO transactions (user_id, date, type, amount, ref, status) VALUES (?, ?, ?, ?, ?, ?)');
            $stmt->execute([$userId, $dateStr, 'Investment', $totalCost, $randomRef, 'Confirmed']);

            $pdo->commit();
            recordBalanceLedger($pdo, $userId, $randomRef, 'investment_purchase', -$totalCost, (float)$user['balance'], "$name investment purchase");
            $costText = number_format($totalCost, 2);
            $safeName = htmlspecialchars($name);
            $safeRef = htmlspecialchars($randomRef);
            notifyUserById($pdo, $userId, 'Investment activated', "<p>Your <strong>{$safeName}</strong> investment (quantity {$quantity}) is active.</p><p><strong>Amount:</strong> \${$costText}<br><strong>Reference:</strong> {$safeRef}</p>", 'investment');
            notifyAdmins($pdo, 'New investment activated', "<p><strong>" . htmlspecialchars($user['name'] ?: 'User') . "</strong> activated {$quantity} × <strong>{$safeName}</strong>.</p><p><strong>Amount:</strong> \${$costText}<br><strong>Reference:</strong> {$safeRef}</p>", 'investment');
            sendJson(['message' => "Successfully purchased $quantity plan(s) for $name!"]);
        } catch (Exception $e) {
            $pdo->rollBack();
            sendJson(['message' => 'Server purchase plan error'], 500);
        }
    }

    sendJson(['message' => 'Invalid Investments Action'], 404);
}
?>
