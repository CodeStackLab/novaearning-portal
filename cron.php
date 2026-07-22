<?php
// Run every few minutes. Earnings are credited once per completed 24-hour cycle.
require_once 'config.php';

// HTTP scheduler requests must prove they came from the deployment account.
// Direct CLI cron jobs remain supported by IONOS control-panel scheduling.
if (PHP_SAPI !== 'cli') {
    $authFile = __DIR__ . '/cron-auth.php';
    $providedToken = $_SERVER['HTTP_X_NOVA_CRON_TOKEN'] ?? '';
    if (!is_file($authFile)) {
        http_response_code(503);
        exit('Cron authentication is not configured.');
    }
    require $authFile;
    if (!defined('NOVA_CRON_TOKEN_HASH') || $providedToken === '' || !hash_equals(NOVA_CRON_TOKEN_HASH, hash('sha256', $providedToken))) {
        http_response_code(403);
        exit('Forbidden');
    }
}

// Prevent overlapping scheduler runs and repair installations that stored
// millisecond timestamps in a 32-bit INT column.
$cronLock = (int)$pdo->query("SELECT GET_LOCK('nova_commission_cron', 0)")->fetchColumn();
if ($cronLock !== 1) exit('Cron is already running.');
$createdAtColumn = $pdo->query("SHOW COLUMNS FROM investments LIKE 'created_at'")->fetch();
if ($createdAtColumn && stripos((string)$createdAtColumn['Type'], 'bigint') !== 0) {
    $pdo->exec('ALTER TABLE investments MODIFY created_at BIGINT NULL');
}
$pdo->exec("UPDATE investments SET created_at = UNIX_TIMESTAMP(STR_TO_DATE(start_date, '%b %e, %Y %h:%i %p')) * 1000 WHERE created_at IS NULL OR created_at <= 2147483647");

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

    // Notify before every 24-hour earning cycle. The scheduler runs every five
    // minutes and the event log guarantees each milestone is delivered once.
    $nextCycle = (int)floor($elapsed / $dayMs) + 1;
    if ($nextCycle <= $durationDays) {
        $remainingMs = ($nextCycle * $dayMs) - $elapsed;
        $reminders = [
            ['key' => '3h', 'label' => 'About 3 hours', 'max' => 3 * 60 * 60 * 1000, 'min' => 30 * 60 * 1000],
            ['key' => '30m', 'label' => '30 minutes', 'max' => 30 * 60 * 1000, 'min' => 10 * 60 * 1000],
            ['key' => '10m', 'label' => '10 minutes', 'max' => 10 * 60 * 1000, 'min' => 0]
        ];
        foreach ($reminders as $reminder) {
            if ($remainingMs > $reminder['max'] || $remainingMs <= $reminder['min']) continue;
            $eventKey = 'cycle-' . $nextCycle . '-reminder-' . $reminder['key'];
            if (claimInvestmentEvent($pdo, $inv['id'], $eventKey)) {
                $commissionEstimate = (float)$inv['amount'] * ((float)$inv['daily_profit_pct'] / 100);
                notifyUserById(
                    $pdo,
                    $inv['user_id'],
                    $reminder['label'] . ' until your commission',
                    '<p>Your investment <strong>' . htmlspecialchars($inv['name']) . '</strong> is close to completing earning cycle <strong>' . $nextCycle . ' of ' . $durationDays . '</strong>.</p>'
                    . '<p>Estimated commission: <strong>$' . number_format($commissionEstimate, 2) . '</strong>.</p>'
                    . '<p>The commission will be credited automatically after the complete 24-hour cycle.</p>',
                    'reminder'
                );
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
            $dailyReferralPct = getNumericSetting($pdo, 'referral_daily_commission_pct', 10, 0, 100);
            $referralCommission = $commission * ($dailyReferralPct / 100);
            if ($referrerId && $referralCommission > 0) {
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
            notifyAdmins($pdo, 'Investment completed', '<p>Investment <strong>#' . (int)$inv['id'] . '</strong> completed all ' . $durationDays . ' earning cycles.</p><p><strong>$' . number_format((float)$inv['amount'], 2) . '</strong> principal was returned to User ID #' . (int)$inv['user_id'] . '.</p>', 'investment');
        } catch (Exception $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            releaseInvestmentEvent($pdo, $inv['id'], 'matured');
            error_log('Investment maturity failed for ' . $inv['id'] . ': ' . $e->getMessage());
        }
    }
}

$stmt = $pdo->prepare("INSERT INTO settings (`key`, value) VALUES ('cron_last_run', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)");
$stmt->execute([gmdate('Y-m-d H:i:s')]);
$pdo->query("SELECT RELEASE_LOCK('nova_commission_cron')");

echo 'Cron executed successfully at ' . date('Y-m-d H:i:s');
?>
