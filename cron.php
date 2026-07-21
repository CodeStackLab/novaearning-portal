<?php
// Run every few minutes. Earnings are credited once per completed 24-hour cycle.
require_once 'config.php';

$pdo->exec("CREATE TABLE IF NOT EXISTS notification_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    investment_id INT NOT NULL,
    event_key VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_investment_event (investment_id, event_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

function claimInvestmentEvent($pdo, $investmentId, $eventKey) {
    try {
        $stmt = $pdo->prepare('INSERT INTO notification_log (investment_id, event_key) VALUES (?, ?)');
        $stmt->execute([$investmentId, $eventKey]);
        return true;
    } catch (PDOException $e) {
        if ((int)($e->errorInfo[1] ?? 0) === 1062) return false;
        throw $e;
    }
}

function releaseInvestmentEvent($pdo, $investmentId, $eventKey) {
    try {
        $stmt = $pdo->prepare('DELETE FROM notification_log WHERE investment_id = ? AND event_key = ?');
        $stmt->execute([$investmentId, $eventKey]);
    } catch (Exception $e) {}
}

$stmt = $pdo->query("SELECT * FROM investments WHERE status = 'Active'");
$activeInvestments = $stmt->fetchAll();
$nowMs = time() * 1000;
$dayMs = 24 * 60 * 60 * 1000;

foreach ($activeInvestments as $inv) {
    $createdAt = (int)($inv['created_at'] ?: $nowMs);
    $elapsed = max(0, $nowMs - $createdAt);
    $durationDays = max(1, (int)$inv['duration_days']);
    $completedCycles = min($durationDays, (int)floor($elapsed / $dayMs));

    // Professional reminders before the first 24-hour commission cycle.
    foreach ([19 => 5, 22 => 2] as $elapsedHour => $hoursLeft) {
        if ($elapsed >= $elapsedHour * 60 * 60 * 1000 && $elapsed < $dayMs) {
            $eventKey = 'first-cycle-reminder-' . $hoursLeft . 'h';
            if (claimInvestmentEvent($pdo, $inv['id'], $eventKey)) {
                notifyUserById($pdo, $inv['user_id'], "{$hoursLeft} hours until your daily commission", '<p>Your investment <strong>' . htmlspecialchars($inv['name']) . '</strong> is approaching its first completed 24-hour earning cycle.</p><p>Keep the investment active. Commission is credited only after the full cycle is completed and remains subject to your plan terms.</p>', 'reminder');
            }
        }
    }

    for ($cycle = 1; $cycle <= $completedCycles; $cycle++) {
        $eventKey = 'daily-commission-' . $cycle;
        if (!claimInvestmentEvent($pdo, $inv['id'], $eventKey)) continue;

        $commission = (float)$inv['amount'] * ((float)$inv['daily_profit_pct'] / 100);
        $refCode = 'DAILY-' . $inv['id'] . '-' . $cycle;
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare('UPDATE users SET balance = balance + ?, earnings = earnings + ? WHERE id = ?');
            $stmt->execute([$commission, $commission, $inv['user_id']]);
            $stmt = $pdo->prepare('INSERT IGNORE INTO transactions (user_id, date, type, amount, ref, status) VALUES (?, ?, ?, ?, ?, ?)');
            $stmt->execute([$inv['user_id'], date('M j, Y h:i A'), 'Daily Commission', $commission, $refCode, 'Confirmed']);

            $stmt = $pdo->prepare('SELECT referred_by FROM users WHERE id = ?');
            $stmt->execute([$inv['user_id']]);
            $user = $stmt->fetch();
            $referrerId = $user['referred_by'] ?? null;
            $referralCommission = $commission * 0.10;
            if ($referrerId) {
                $stmt = $pdo->prepare('UPDATE users SET balance = balance + ?, earnings = earnings + ? WHERE id = ?');
                $stmt->execute([$referralCommission, $referralCommission, $referrerId]);
                $stmt = $pdo->prepare('INSERT IGNORE INTO transactions (user_id, date, type, amount, ref, status) VALUES (?, ?, ?, ?, ?, ?)');
                $stmt->execute([$referrerId, date('M j, Y h:i A'), 'Referral Commission', $referralCommission, 'REF-' . $refCode, 'Confirmed']);
            }
            $pdo->commit();

            $stmt = $pdo->prepare('SELECT balance FROM users WHERE id = ?'); $stmt->execute([$inv['user_id']]); $currentBalance = (float)($stmt->fetch()['balance'] ?? 0);
            recordBalanceLedger($pdo, $inv['user_id'], $refCode, 'daily_commission', $commission, $currentBalance - $commission, '24-hour investment commission');
            if ($referrerId) {
                $stmt->execute([$referrerId]); $refCurrent = (float)($stmt->fetch()['balance'] ?? 0);
                recordBalanceLedger($pdo, $referrerId, 'REF-' . $refCode, 'referral_commission', $referralCommission, $refCurrent - $referralCommission, 'Referral earning commission');
            }

            $commissionText = number_format($commission, 2);
            notifyUserById($pdo, $inv['user_id'], 'Your daily commission was added', '<p>Your 24-hour earning cycle is complete.</p><p><strong>$' . $commissionText . '</strong> commission has been added to your balance.</p><p>Cycle ' . $cycle . ' of ' . $durationDays . ' completed.</p>', 'commission');
            notifyAdmins($pdo, 'Daily investment commission credited', '<p>Investment <strong>#' . (int)$inv['id'] . '</strong> completed earning cycle ' . $cycle . ' of ' . $durationDays . '.</p><p><strong>$' . $commissionText . '</strong> was credited automatically to the investor.</p>', 'commission');
            if ($referrerId) {
                notifyUserById($pdo, $referrerId, 'Referral commission was added', '<p>Your referral completed an earning cycle.</p><p><strong>$' . number_format($referralCommission, 2) . '</strong> was automatically added to your balance.</p>', 'referral');
            }
        } catch (Exception $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            releaseInvestmentEvent($pdo, $inv['id'], $eventKey);
            error_log('Daily commission failed for investment ' . $inv['id'] . ': ' . $e->getMessage());
        }
    }

    if ($elapsed >= $durationDays * $dayMs && claimInvestmentEvent($pdo, $inv['id'], 'matured')) {
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare('UPDATE users SET balance = balance + ? WHERE id = ?');
            $stmt->execute([$inv['amount'], $inv['user_id']]);
            $stmt = $pdo->prepare('UPDATE investments SET status = ? WHERE id = ? AND status = ?');
            $stmt->execute(['Completed', $inv['id'], 'Active']);
            $refCode = 'MATURED-' . $inv['id'];
            $stmt = $pdo->prepare('INSERT IGNORE INTO transactions (user_id, date, type, amount, ref, status) VALUES (?, ?, ?, ?, ?, ?)');
            $stmt->execute([$inv['user_id'], date('M j, Y h:i A'), 'Payout', $inv['amount'], $refCode, 'Confirmed']);
            $pdo->commit();
            $stmt = $pdo->prepare('SELECT balance FROM users WHERE id = ?'); $stmt->execute([$inv['user_id']]); $currentBalance = (float)($stmt->fetch()['balance'] ?? 0);
            recordBalanceLedger($pdo, $inv['user_id'], $refCode, 'principal_return', (float)$inv['amount'], $currentBalance - (float)$inv['amount'], 'Investment principal returned');
            notifyUserById($pdo, $inv['user_id'], 'Investment completed', '<p>Your <strong>' . htmlspecialchars($inv['name']) . '</strong> plan has completed successfully.</p><p><strong>$' . number_format((float)$inv['amount'], 2) . '</strong> principal was returned to your balance.</p>', 'investment');
        } catch (Exception $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            releaseInvestmentEvent($pdo, $inv['id'], 'matured');
            error_log('Investment maturity failed for ' . $inv['id'] . ': ' . $e->getMessage());
        }
    }
}

$stmt = $pdo->prepare("INSERT INTO settings (`key`, value) VALUES ('cron_last_run', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)");
$stmt->execute([gmdate('Y-m-d H:i:s')]);

echo 'Cron executed successfully at ' . date('Y-m-d H:i:s');
?>
