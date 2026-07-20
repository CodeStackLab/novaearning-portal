<?php
// cron.php
// Setup a cron job on your shared hosting to call this file every 1 minute.
// Example: * * * * * /usr/local/bin/php /home/username/public_html/cron.php

require_once 'config.php';

// Fetch all active investments
$stmt = $pdo->query("SELECT * FROM investments WHERE status = 'Active'");
$activeInvestments = $stmt->fetchAll();

$now = time() * 1000;

foreach ($activeInvestments as $inv) {
    $durationMs = ($inv['duration_days'] ?: 1) * 24 * 60 * 60 * 1000;
    $createdAt = $inv['created_at'] ?: $now;
    $elapsed = $now - $createdAt;

    if ($elapsed >= $durationMs) {
        // Plan matured! Return the principal and complete the plan.
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare('UPDATE users SET balance = balance + ? WHERE id = ?');
            $stmt->execute([$inv['amount'], $inv['user_id']]);

            $stmt = $pdo->prepare('UPDATE investments SET status = ? WHERE id = ?');
            $stmt->execute(['Completed', $inv['id']]);

            $dateStr = date('M j, Y h:i A');
            $refCode = 'MATURED-' . $inv['id'];
            
            $stmt = $pdo->prepare('INSERT INTO transactions (user_id, date, type, amount, ref, status) VALUES (?, ?, ?, ?, ?, ?)');
            $stmt->execute([$inv['user_id'], $dateStr, 'Payout', $inv['amount'], $refCode, 'Confirmed']);
            
            $pdo->commit();
            $amountText = number_format((float)$inv['amount'], 2);
            notifyUserById($pdo, $inv['user_id'], 'Investment matured', "<p>Your <strong>" . htmlspecialchars($inv['name']) . "</strong> investment has completed.</p><p><strong>\${$amountText}</strong> principal was returned to your balance.</p><p><strong>Reference:</strong> " . htmlspecialchars($refCode) . '</p>');
        } catch (Exception $e) {
            $pdo->rollBack();
            // Log error
        }
    } else {
        // Plan active, compound 2.5% daily profit
        // Since this script runs every 1 minute instead of 15 seconds, we multiply the rate
        // rate per 1 minute = (2.5 / 100) / (24 * 60)
        $ratePer1Minute = (2.5 / 100) / (24 * 60);
        $userPayout = $inv['amount'] * $ratePer1Minute;

        if ($userPayout > 0) {
            $pdo->beginTransaction();
            try {
                $stmt = $pdo->prepare('UPDATE users SET balance = balance + ?, earnings = earnings + ? WHERE id = ?');
                $stmt->execute([$userPayout, $userPayout, $inv['user_id']]);

                // Check for Referrer logic (10% earnings commission)
                $stmt = $pdo->prepare('SELECT referred_by FROM users WHERE id = ?');
                $stmt->execute([$inv['user_id']]);
                $user = $stmt->fetch();

                if ($user && $user['referred_by']) {
                    $commissionBonus = $userPayout * 0.10;
                    $stmt = $pdo->prepare('UPDATE users SET balance = balance + ?, earnings = earnings + ? WHERE id = ?');
                    $stmt->execute([$commissionBonus, $commissionBonus, $user['referred_by']]);
                }
                $pdo->commit();
            } catch (Exception $e) {
                $pdo->rollBack();
            }
        }
    }
}
echo "Cron executed successfully at " . date('Y-m-d H:i:s');
?>
