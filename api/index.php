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

require_once '../config.php';

$request = isset($_GET['request']) ? explode('/', trim($_GET['request'], '/')) : [];
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
        break;
    case 'test-users':
        $stmt = $pdo->query("SELECT id, name, email, username, role FROM users");
        sendJson($stmt->fetchAll());
        break;
    case 'admin':
        require_once 'admin.php';
        handleAdmin($action, $subaction, $pdo, $body);
        break;
    default:
        sendJson(['message' => 'API Endpoint Not Found'], 404);
}
?>
