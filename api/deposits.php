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

        $uploadError = '';
        $relativePath = saveValidatedBase64Image($screenshotBase64, 'receipt', $uploadError);
        if (!$relativePath) sendJson(['message' => $uploadError], 400);

        $finalTxnCode = !empty($txnId) ? $txnId : ("DEP-" . strtoupper(substr(md5(uniqid(mt_rand(), true)), 0, 8)));
        if (!preg_match('/^[A-Za-z0-9_-]{6,120}$/', $finalTxnCode)) {
            @unlink(__DIR__ . '/../public' . $relativePath);
            sendJson(['message' => 'Enter a valid transaction reference (6–120 letters, numbers, dashes, or underscores).'], 400);
        }

        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare('INSERT INTO deposits (user_id, date, amount, txn_id, screenshot_path, plan_name, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
            $stmt->execute([$userId, $dateStr, $amount, $finalTxnCode, $relativePath, $planName, 'Pending']);
            $stmt = $pdo->prepare('INSERT INTO transactions (user_id, date, type, amount, ref, status) VALUES (?, ?, ?, ?, ?, ?)');
            $stmt->execute([$userId, $dateStr, 'Deposit', $amount, $finalTxnCode, 'Pending']);
            $pdo->commit();
        } catch (PDOException $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            @unlink(__DIR__ . '/../public' . $relativePath);
            if ((int)($e->errorInfo[1] ?? 0) === 1062) sendJson(['message' => 'This transaction reference was already submitted.'], 409);
            sendJson(['message' => 'Unable to submit the deposit.'], 500);
        }

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
