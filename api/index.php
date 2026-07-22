<?php
// api/index.php

// Handle CORS
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/upload-security.php';

// Upgrade installations that still reference the deleted legacy mailbox.
// Its saved password belongs to that mailbox, so it must never be reused for
// the primary admin mailbox.
try {
    $legacyMailbox = 'contact@novaearning.com';
    $adminMailbox = 'admin@novaearning.com';
    $legacyStmt = $pdo->prepare("SELECT value FROM settings WHERE `key` = 'smtp_username' LIMIT 1");
    $legacyStmt->execute();
    if (strcasecmp((string)$legacyStmt->fetchColumn(), $legacyMailbox) === 0) {
        $pdo->beginTransaction();
        $updateMailbox = $pdo->prepare("UPDATE settings SET value = ? WHERE `key` IN ('smtp_username', 'smtp_from_email') AND LOWER(value) = ?");
        $updateMailbox->execute([$adminMailbox, $legacyMailbox]);
        $pdo->exec("DELETE FROM settings WHERE `key` = 'smtp_password'");
        $pdo->commit();
    }
} catch (Throwable $smtpMigrationError) {
    if ($pdo->inTransaction()) $pdo->rollBack();
}

// Keep older installations compatible with account controls in Manage Users.
try {
    $statusColumn = $pdo->query("SHOW COLUMNS FROM users LIKE 'account_status'")->fetch();
    if (!$statusColumn) $pdo->exec("ALTER TABLE users ADD account_status VARCHAR(30) NOT NULL DEFAULT 'Active' AFTER role");
} catch (Throwable $accountStatusMigrationError) {
    error_log('Account status migration failed: ' . $accountStatusMigrationError->getMessage());
}

$request = isset($_GET['request']) ? explode('/', trim($_GET['request'], '/')) : [];
if (empty($request) || empty($request[0])) {
    $uriPath = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
    $uriPath = preg_replace('#^.*/api/?#i', '', $uriPath);
    $request = explode('/', trim($uriPath, '/'));
}

$endpoint = isset($request[0]) ? $request[0] : '';
$action = isset($request[1]) ? $request[1] : '';
$subaction = isset($request[2]) ? $request[2] : '';

// Parse JSON body
$json = file_get_contents('php://input');
$body = json_decode($json, true) ?? $_POST;

switch ($endpoint) {
    case 'auth':
        require_once 'auth.php';
        handleAuth($action, $subaction, $pdo, $body);
        break;
    case 'user':
        require_once 'user.php';
        handleUser($action, $subaction, $pdo, $body);
        break;
    case 'deposits':
        require_once 'deposits.php';
        handleDeposits($action, $pdo, $body);
        break;
    case 'investments':
        require_once 'investments.php';
        handleInvestments($action, $pdo, $body);
        break;
    case 'transactions':
        require_once 'transactions.php';
        handleTransactions($action, $pdo, $body);
        break;
    case 'withdrawals':
        require_once 'withdrawals.php';
        handleWithdrawals($action, $pdo, $body);
        break;
    case 'tickets':
        require_once 'tickets.php';
        handleTickets($action, $pdo, $body);
        break;
    case 'settings':
        if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'tron-address') {
            $stmt = $pdo->query("SELECT value FROM settings WHERE `key` = 'tron_deposit_address'");
            $row = $stmt->fetch();
            sendJson(['address' => $row ? $row['value'] : 'TQdJg7h5P6r8xkLyGk9Y8yq8eL5t3mZ6tX']);
        }
        if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'referral-program') {
            sendJson([
                'firstDepositBonusPct' => getNumericSetting($pdo, 'referral_first_deposit_bonus_pct', 5, 0, 100),
                'depositCommissionPct' => getNumericSetting($pdo, 'referral_deposit_commission_pct', 5, 0, 100),
                'dailyCommissionPct' => getNumericSetting($pdo, 'referral_daily_commission_pct', 10, 0, 100)
            ]);
        }
        break;
    case 'admin':
        require_once 'admin.php';
        handleAdmin($action, $subaction, $pdo, $body);
        break;
    default:
        sendJson(['message' => 'API Endpoint Not Found'], 404);
}
?>
