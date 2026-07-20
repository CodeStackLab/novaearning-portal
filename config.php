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

// SMTP Configuration (IONOS Email)
define('SMTP_HOST', 'smtp.ionos.com');
define('SMTP_PORT', 587);
define('SMTP_USER', 'contact@novaearning.com');
define('SMTP_PASS', '');
define('SITE_EMAIL', 'contact@novaearning.com');

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

// SMTP Email Helper Function (IONOS & Generic SMTP)
function sendSmtpEmail($toEmail, $toName, $subject, $bodyHtml, $pdo = null) {
    $host = defined('SMTP_HOST') ? SMTP_HOST : 'smtp.ionos.com';
    $port = defined('SMTP_PORT') ? (int)SMTP_PORT : 587;
    $username = defined('SMTP_USER') ? SMTP_USER : 'contact@novaearning.com';
    $password = defined('SMTP_PASS') ? SMTP_PASS : '';
    $fromEmail = defined('SITE_EMAIL') ? SITE_EMAIL : 'contact@novaearning.com';
    $fromName = 'Nova Support';
    $encryption = 'tls';

    if ($pdo) {
        try {
            $stmt = $pdo->query("SELECT `key`, value FROM settings WHERE `key` LIKE 'smtp_%'");
            $settings = [];
            foreach ($stmt->fetchAll() as $row) {
                $settings[$row['key']] = $row['value'];
            }
            if (!empty($settings['smtp_host'])) $host = $settings['smtp_host'];
            if (!empty($settings['smtp_port'])) $port = (int)$settings['smtp_port'];
            if (!empty($settings['smtp_username'])) $username = $settings['smtp_username'];
            if (!empty($settings['smtp_password'])) $password = $settings['smtp_password'];
            if (!empty($settings['smtp_from_email'])) $fromEmail = $settings['smtp_from_email'];
            if (!empty($settings['smtp_from_name'])) $fromName = $settings['smtp_from_name'];
            if (!empty($settings['smtp_encryption'])) $encryption = $settings['smtp_encryption'];
        } catch (Exception $e) {}
    }

    $headers = "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: text/html; charset=UTF-8\r\n";
    $headers .= "From: {$fromName} <{$fromEmail}>\r\n";
    $headers .= "Reply-To: {$fromEmail}\r\n";
    $headers .= "X-Mailer: PHP/" . phpversion();

    if (!empty($username) && !empty($password)) {
        try {
            $socketHost = ($encryption === 'ssl' ? 'ssl://' : '') . $host;
            $socket = @fsockopen($socketHost, $port, $errno, $errstr, 8);
            if ($socket) {
                fgets($socket, 512);
                fputs($socket, "EHLO " . gethostname() . "\r\n");
                fgets($socket, 512);

                if ($encryption === 'tls') {
                    fputs($socket, "STARTTLS\r\n");
                    fgets($socket, 512);
                    stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
                    fputs($socket, "EHLO " . gethostname() . "\r\n");
                    fgets($socket, 512);
                }

                fputs($socket, "AUTH LOGIN\r\n");
                fgets($socket, 512);
                fputs($socket, base64_encode($username) . "\r\n");
                fgets($socket, 512);
                fputs($socket, base64_encode($password) . "\r\n");
                $authRes = fgets($socket, 512);

                if (strpos($authRes, '235') !== false) {
                    fputs($socket, "MAIL FROM: <{$fromEmail}>\r\n");
                    fgets($socket, 512);
                    fputs($socket, "RCPT TO: <{$toEmail}>\r\n");
                    fgets($socket, 512);
                    fputs($socket, "DATA\r\n");
                    fgets($socket, 512);

                    $mailData = "To: {$toName} <{$toEmail}>\r\n";
                    $mailData .= "From: {$fromName} <{$fromEmail}>\r\n";
                    $mailData .= "Subject: {$subject}\r\n";
                    $mailData .= "MIME-Version: 1.0\r\n";
                    $mailData .= "Content-Type: text/html; charset=UTF-8\r\n\r\n";
                    $mailData .= $bodyHtml . "\r\n.\r\n";

                    fputs($socket, $mailData);
                    fgets($socket, 512);
                    fputs($socket, "QUIT\r\n");
                    fclose($socket);
                    return true;
                }
                fclose($socket);
            }
        } catch (Exception $e) {}
    }

    return @mail($toEmail, $subject, $bodyHtml, $headers);
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
