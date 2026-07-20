<?php
// config.php
session_start(); // We will use sessions for admin/user states if needed, though JWT is preferred for API

// Database Configuration (IONOS MySQL)
define('DB_HOST', 'db5020969176.hosting-data.io');
define('DB_NAME', 'dbs15918036');
define('DB_USER', 'dbu2389530');
define('DB_PASS', 'DB@9129881899');

// JWT Secret Key (Keep this secret!)
define('JWT_SECRET', 'nova-super-secret-key-2026');

// SMTP Configuration (if using PHPMailer later, or just simple mail)
define('SMTP_HOST', 'smtp.gmail.com');
define('SMTP_PORT', 465);
define('SMTP_USER', '');
define('SMTP_PASS', '');

// Connect to Database using PDO
try {
    $pdo = new PDO("mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4", DB_USER, DB_PASS);
    // Set the PDO error mode to exception
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    // Set default fetch mode to associative array
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
} catch(PDOException $e) {
    die(json_encode(["message" => "Database connection failed: " . $e->getMessage()]));
}

// Lightweight JSON response helper
function sendJson($data, $statusCode = 200) {
    http_response_code($statusCode);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

// Very basic JWT Implementation in PHP to avoid external dependencies
function generateJWT($payload) {
    $header = json_encode(['typ' => 'JWT', 'alg' => 'HS256']);
    $payload['iat'] = time();
    $payload['exp'] = time() + (7 * 24 * 60 * 60); // 7 days
    $payloadJson = json_encode($payload);

    $base64UrlHeader = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($header));
    $base64UrlPayload = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($payloadJson));

    $signature = hash_hmac('sha256', $base64UrlHeader . "." . $base64UrlPayload, JWT_SECRET, true);
    $base64UrlSignature = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($signature));

    return $base64UrlHeader . "." . $base64UrlPayload . "." . $base64UrlSignature;
}

function verifyJWT($token) {
    $parts = explode('.', $token);
    if (count($parts) !== 3) return false;

    $header = $parts[0];
    $payload = $parts[1];
    $signatureProvided = $parts[2];

    $signature = hash_hmac('sha256', $header . "." . $payload, JWT_SECRET, true);
    $base64UrlSignature = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($signature));

    if (hash_equals($base64UrlSignature, $signatureProvided)) {
        $payloadData = json_decode(base64_decode(str_replace(['-', '_'], ['+', '/'], $payload)), true);
        if (isset($payloadData['exp']) && $payloadData['exp'] < time()) {
            return false; // Expired
        }
        return $payloadData;
    }
    return false;
}

function getAuthHeader() {
    if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
        return $_SERVER['HTTP_AUTHORIZATION'];
    }
    if (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        return $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    }
    if (function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        if (isset($headers['Authorization'])) return $headers['Authorization'];
        if (isset($headers['authorization'])) return $headers['authorization'];
    }
    return '';
}

function authenticateToken() {
    $authHeader = getAuthHeader();
    
    if (preg_match('/Bearer\s(\S+)/', $authHeader, $matches)) {
        $token = $matches[1];
        $decoded = verifyJWT($token);
        if ($decoded && isset($decoded['userId'])) {
            return $decoded['userId'];
        }
    }
    sendJson(['message' => 'Authorization token required or invalid'], 401);
}

function requireAdmin($pdo, $userId) {
    $stmt = $pdo->prepare('SELECT role FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $user = $stmt->fetch();
    if (!$user || $user['role'] !== 'admin') {
        sendJson(['message' => 'Access denied: Admin role required'], 403);
    }
}
?>
