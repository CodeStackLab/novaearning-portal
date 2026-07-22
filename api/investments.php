<?php
// api/investments.php

function handleInvestments($action, $pdo, $body) {
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit();
    if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'plans') {
        header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
        header('Pragma: no-cache');
        $stmt = $pdo->query('SELECT id, name, price, daily_profit_pct AS roi, duration_days, image_url AS img FROM plans WHERE is_active = 1 ORDER BY id');
        sendJson($stmt->fetchAll());
    }
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

        if ($quantity > 100) sendJson(['message' => 'Quantity is too large.'], 400);
        $stmt = $pdo->prepare('SELECT id, name, price, daily_profit_pct, duration_days FROM plans WHERE name = ? AND is_active = 1');
        $stmt->execute([$name]);
        $plan = $stmt->fetch();
        if (!$plan) sendJson(['message' => 'This investment plan is unavailable.'], 404);
        $singlePlanPrice = (float)$plan['price'];
        $totalCost = $singlePlanPrice * $quantity;

        $dateStr = date('M j, Y h:i A');
        $randomRef = "INV" . strtoupper(substr(md5(uniqid()), 0, 8));
        $nowMs = time() * 1000;

        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare('SELECT name, email, balance FROM users WHERE id = ? FOR UPDATE');
            $stmt->execute([$userId]);
            $user = $stmt->fetch();
            if (!$user || (float)$user['balance'] < $totalCost) {
                $pdo->rollBack();
                sendJson(['message' => 'Insufficient balance'], 400);
            }
            $stmt = $pdo->prepare('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?');
            $stmt->execute([$totalCost, $userId, $totalCost]);
            if ($stmt->rowCount() !== 1) throw new Exception('Balance changed during purchase');

            $stmt = $pdo->prepare('INSERT INTO investments (user_id, name, amount, daily_profit_pct, duration_days, status, start_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            $stmt->execute([$userId, $plan['name'] . " (x$quantity)", $totalCost, $plan['daily_profit_pct'], $plan['duration_days'], 'Active', $dateStr, $nowMs]);

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
