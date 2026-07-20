<?php
// api/deposits.php

function handleDeposits($action, $pdo, $body) {
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit();
    $userId = authenticateToken();

    if ($_SERVER['REQUEST_METHOD'] === 'GET' && !$action) {
        $stmt = $pdo->prepare('SELECT * FROM deposits WHERE user_id = ? ORDER BY id DESC');
        $stmt->execute([$userId]);
        sendJson($stmt->fetchAll());
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && !$action) {
        $amount = $body['amount'] ?? 0;
        $screenshotBase64 = $body['screenshotBase64'] ?? '';
        $txnId = $body['txnId'] ?? '';
        $planName = $body['planName'] ?? null;

        if (!is_numeric($amount) || $amount <= 0 || empty($screenshotBase64)) {
            sendJson(['message' => 'Valid amount and screenshot file are required'], 400);
        }

        $dateStr = date('M j, Y h:i A');

        if (preg_match('/^data:([A-Za-z-+\/]+);base64,(.+)$/', $screenshotBase64, $matches)) {
            $type = $matches[1];
            $base64Data = base64_decode($matches[2]);
            $ext = explode('/', $type)[1] ?? 'png';
            $fileName = 'receipt_' . time() . '_' . substr(md5(uniqid()), 0, 6) . '.' . $ext;
            
            // Ensure uploads directory exists
            $uploadsDir = '../public/uploads/';
            if (!is_dir($uploadsDir)) {
                mkdir($uploadsDir, 0755, true);
            }
            
            $fullSavePath = $uploadsDir . $fileName;
            file_put_contents($fullSavePath, $base64Data);
            $relativePath = '/uploads/' . $fileName;
        } else {
            sendJson(['message' => 'Invalid screenshot file format'], 400);
        }

        $finalTxnCode = $txnId ?: ("TX" . substr(time(), -6) . strtoupper(substr(md5(uniqid()), 0, 4)));

        $stmt = $pdo->prepare('INSERT INTO deposits (user_id, date, amount, txn_id, screenshot_path, plan_name, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([$userId, $dateStr, $amount, $finalTxnCode, $relativePath, $planName, 'Pending']);

        $stmt = $pdo->prepare('INSERT INTO transactions (user_id, date, type, amount, ref, status) VALUES (?, ?, ?, ?, ?, ?)');
        $stmt->execute([$userId, $dateStr, 'Deposit', $amount, $finalTxnCode, 'Pending']);

        $safeAmount = number_format((float)$amount, 2);
        $safeRef = htmlspecialchars($finalTxnCode);
        $safePlan = $planName ? '<p><strong>Plan:</strong> ' . htmlspecialchars($planName) . '</p>' : '';
        notifyUserById($pdo, $userId, 'Deposit received — pending review', "<p>We received your deposit of <strong>\${$safeAmount}</strong>.</p>{$safePlan}<p><strong>Reference:</strong> {$safeRef}</p><p>Status: Pending admin verification.</p>", 'deposit');
        notifyAdmins($pdo, 'New deposit awaiting approval', "<p>A user submitted a deposit of <strong>\${$safeAmount}</strong>.</p>{$safePlan}<p><strong>Reference:</strong> {$safeRef}</p><p>Please review it in Verify Deposits.</p>", 'deposit');

        sendJson(['message' => 'Deposit submitted with screenshot. Verification pending admin review.']);
    }

    sendJson(['message' => 'Invalid Deposits Action'], 404);
}
?>
