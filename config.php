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

function decryptSmtpPassword($value) {
    if (strpos((string)$value, 'enc:v1:') !== 0) return (string)$value;
    $packed = base64_decode(substr($value, 7), true);
    if ($packed === false || strlen($packed) < 29) return '';
    $iv = substr($packed, 0, 12);
    $tag = substr($packed, 12, 16);
    $ciphertext = substr($packed, 28);
    $key = hash('sha256', JWT_SECRET, true);
    $plain = openssl_decrypt($ciphertext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
    return $plain === false ? '' : $plain;
}

function loadSmtpConfiguration($pdo = null) {
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
            if (!empty($settings['smtp_password'])) $password = decryptSmtpPassword($settings['smtp_password']);
            if (!empty($settings['smtp_from_email'])) $fromEmail = $settings['smtp_from_email'];
            if (!empty($settings['smtp_from_name'])) $fromName = $settings['smtp_from_name'];
            if (!empty($settings['smtp_encryption'])) $encryption = $settings['smtp_encryption'];
        } catch (Exception $e) {}
    }

    return compact('host', 'port', 'username', 'password', 'fromEmail', 'fromName', 'encryption');
}

function smtpReadResponse($socket) {
    $response = '';
    while (($line = fgets($socket, 1024)) !== false) {
        $response .= $line;
        if (strlen($line) < 4 || $line[3] !== '-') break;
    }
    return $response;
}

function smtpResponseCode($response) {
    return (int)substr(trim((string)$response), 0, 3);
}

function smtpCommand($socket, $command, $expectedCodes, &$error) {
    if ($command !== null && fwrite($socket, $command . "\r\n") === false) {
        $error = 'Unable to write to the SMTP server.';
        return false;
    }
    $response = smtpReadResponse($socket);
    $code = smtpResponseCode($response);
    if (!in_array($code, (array)$expectedCodes, true)) {
        $error = $code === 535
            ? 'SMTP authentication failed (code 535). Check the full mailbox address and mailbox password; do not use the IONOS account password.'
            : 'SMTP server rejected the request (code ' . ($code ?: 'unknown') . ').';
        return false;
    }
    return true;
}

function openSmtpConnection($config, &$error) {
    $host = trim($config['host'] ?? '');
    $port = (int)($config['port'] ?? 0);
    $encryption = strtolower($config['encryption'] ?? 'tls');
    $username = (string)($config['username'] ?? '');
    $password = (string)($config['password'] ?? '');
    if ($host === '' || $port < 1 || $port > 65535) {
        $error = 'SMTP host or port is invalid.';
        return false;
    }
    if ($username === '' || $password === '') {
        $error = 'SMTP username and password are required.';
        return false;
    }

    $target = ($encryption === 'ssl' ? 'ssl://' : '') . $host;
    $socket = @fsockopen($target, $port, $errno, $errstr, 10);
    if (!$socket) {
        $error = 'Could not connect to the SMTP server (' . $errno . ').';
        return false;
    }
    stream_set_timeout($socket, 10);
    if (!smtpCommand($socket, null, [220], $error)) { fclose($socket); return false; }

    $clientName = preg_replace('/[^a-z0-9.-]/i', '', gethostname() ?: 'localhost') ?: 'localhost';
    if (!smtpCommand($socket, 'EHLO ' . $clientName, [250], $error)) { fclose($socket); return false; }

    if ($encryption === 'tls') {
        if (!smtpCommand($socket, 'STARTTLS', [220], $error)) { fclose($socket); return false; }
        if (!@stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            $error = 'TLS negotiation failed. Check the encryption and port.';
            fclose($socket);
            return false;
        }
        if (!smtpCommand($socket, 'EHLO ' . $clientName, [250], $error)) { fclose($socket); return false; }
    }

    if (!smtpCommand($socket, 'AUTH LOGIN', [334], $error) ||
        !smtpCommand($socket, base64_encode($username), [334], $error) ||
        !smtpCommand($socket, base64_encode($password), [235], $error)) {
        fclose($socket);
        return false;
    }
    return $socket;
}

function testSmtpConfiguration($config, &$error) {
    $socket = openSmtpConnection($config, $error);
    if (!$socket) return false;
    @fwrite($socket, "QUIT\r\n");
    @smtpReadResponse($socket);
    fclose($socket);
    return true;
}

// SMTP Email Helper Function (IONOS & Generic SMTP)
function sendSmtpEmail($toEmail, $toName, $subject, $bodyHtml, $pdo = null) {
    $config = loadSmtpConfiguration($pdo);
    extract($config);

    $headers = "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: text/html; charset=UTF-8\r\n";
    $headers .= "From: {$fromName} <{$fromEmail}>\r\n";
    $headers .= "Reply-To: {$fromEmail}\r\n";
    $headers .= "X-Mailer: PHP/" . phpversion();

    if (!empty($username) && !empty($password)) {
        $error = '';
        $socket = openSmtpConnection($config, $error);
        if ($socket) {
            $safeFrom = str_replace(["\r", "\n"], '', $fromEmail);
            $safeTo = str_replace(["\r", "\n"], '', $toEmail);
            $safeName = str_replace(["\r", "\n"], '', $toName);
            $safeSubject = str_replace(["\r", "\n"], '', $subject);
            if (smtpCommand($socket, "MAIL FROM: <{$safeFrom}>", [250], $error) &&
                smtpCommand($socket, "RCPT TO: <{$safeTo}>", [250, 251], $error) &&
                smtpCommand($socket, 'DATA', [354], $error)) {
                $safeBody = preg_replace('/(^|\r\n|\n)\./', '$1..', $bodyHtml);
                $mailData = "To: {$safeName} <{$safeTo}>\r\nFrom: {$fromName} <{$safeFrom}>\r\nSubject: {$safeSubject}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n{$safeBody}\r\n.";
                if (smtpCommand($socket, $mailData, [250], $error)) {
                    @fwrite($socket, "QUIT\r\n");
                    fclose($socket);
                    return true;
                }
            }
            fclose($socket);
        }
    }

    return @mail($toEmail, $subject, $bodyHtml, $headers);
}

function novaEmailBody($heading, $contentHtml) {
    return '<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;background:#07101f;color:#e5edf8;padding:28px;border-radius:14px">'
        . '<div style="color:#e8c66a;font-size:22px;font-weight:700;margin-bottom:20px">NOVA</div>'
        . '<h2 style="margin:0 0 14px;color:#fff">' . htmlspecialchars($heading) . '</h2>'
        . '<div style="line-height:1.65;color:#bdc9da">' . $contentHtml . '</div>'
        . '<p style="margin-top:24px;font-size:12px;color:#718096">This is an automatic account notification.</p></div>';
}

function ensurePlatformFeatureTables($pdo) {
    $pdo->exec("CREATE TABLE IF NOT EXISTS in_app_notifications (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, category VARCHAR(40) NOT NULL,
        title VARCHAR(180) NOT NULL, message TEXT NOT NULL, action_url VARCHAR(255) DEFAULT NULL,
        is_read TINYINT(1) NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_notification_user (user_id, is_read, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS admin_audit_log (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, admin_id INT NOT NULL, action VARCHAR(100) NOT NULL,
        target_type VARCHAR(50) DEFAULT NULL, target_id VARCHAR(100) DEFAULT NULL, details TEXT DEFAULT NULL,
        ip_address VARCHAR(64) DEFAULT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_created (created_at), INDEX idx_audit_admin (admin_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS balance_ledger (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, transaction_ref VARCHAR(255) NOT NULL,
        entry_type VARCHAR(60) NOT NULL, amount DECIMAL(15,2) NOT NULL, balance_before DECIMAL(15,2) NOT NULL,
        balance_after DECIMAL(15,2) NOT NULL, description VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY unique_ledger_ref_type (transaction_ref, entry_type),
        INDEX idx_ledger_user (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS login_activity (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, ip_address VARCHAR(64) DEFAULT NULL,
        user_agent VARCHAR(255) DEFAULT NULL, login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_login_user (user_id, login_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS auth_attempts (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, identifier_hash CHAR(64) NOT NULL, ip_address VARCHAR(64) NOT NULL,
        attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_auth_attempt (identifier_hash, ip_address, attempted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS registration_otps (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(191) NOT NULL,
        otp_hash VARCHAR(255) NOT NULL, attempts INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, expires_at TIMESTAMP NOT NULL,
        INDEX idx_reg_otp_email (email, expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

function recordLoginActivity($pdo, $userId) {
    try {
        ensurePlatformFeatureTables($pdo);
        $stmt = $pdo->prepare('INSERT INTO login_activity (user_id, ip_address, user_agent) VALUES (?, ?, ?)');
        $stmt->execute([$userId, $_SERVER['REMOTE_ADDR'] ?? null, substr($_SERVER['HTTP_USER_AGENT'] ?? 'Unknown device', 0, 255)]);
        $pruneStmt = $pdo->prepare('DELETE FROM login_activity WHERE user_id = ? AND id NOT IN (SELECT id FROM (SELECT id FROM login_activity WHERE user_id = ? ORDER BY id DESC LIMIT 4) AS tmp)');
        $pruneStmt->execute([$userId, $userId]);
    } catch (Exception $e) { error_log('Login activity failed: ' . $e->getMessage()); }
}

function enforceLoginRateLimit($pdo, $identifier) {
    ensurePlatformFeatureTables($pdo);
    $hash = hash('sha256', strtolower(trim($identifier)));
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $stmt = $pdo->prepare('SELECT COUNT(*) AS attempts FROM auth_attempts WHERE identifier_hash = ? AND ip_address = ? AND attempted_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)');
    $stmt->execute([$hash, $ip]);
    if ((int)($stmt->fetch()['attempts'] ?? 0) >= 8) sendJson(['message' => 'Too many login attempts. Please wait 15 minutes and try again.'], 429);
}

function recordFailedLogin($pdo, $identifier) {
    try { $stmt = $pdo->prepare('INSERT INTO auth_attempts (identifier_hash, ip_address) VALUES (?, ?)'); $stmt->execute([hash('sha256', strtolower(trim($identifier))), $_SERVER['REMOTE_ADDR'] ?? 'unknown']); } catch (Exception $e) {}
}

function clearFailedLogins($pdo, $identifier) {
    try { $stmt = $pdo->prepare('DELETE FROM auth_attempts WHERE identifier_hash = ? AND ip_address = ?'); $stmt->execute([hash('sha256', strtolower(trim($identifier))), $_SERVER['REMOTE_ADDR'] ?? 'unknown']); } catch (Exception $e) {}
}

function createInAppNotification($pdo, $userId, $category, $title, $message, $actionUrl = null) {
    try {
        ensurePlatformFeatureTables($pdo);
        $cleanMsg = preg_replace('/<\/(p|div|li)>\s*/i', ' ', $message);
        $cleanMsg = preg_replace('/<br\s*\/?>/i', ' | ', $cleanMsg);
        $cleanMsg = trim(preg_replace('/\s+/', ' ', strip_tags($cleanMsg)));
        $stmt = $pdo->prepare('INSERT INTO in_app_notifications (user_id, category, title, message, action_url) VALUES (?, ?, ?, ?, ?)');
        $stmt->execute([$userId, $category, $title, $cleanMsg, $actionUrl]);
    } catch (Exception $e) { error_log('In-app notification failed: ' . $e->getMessage()); }
}

function auditAdminAction($pdo, $adminId, $action, $targetType = null, $targetId = null, $details = null) {
    try {
        ensurePlatformFeatureTables($pdo);
        $stmt = $pdo->prepare('INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)');
        $stmt->execute([$adminId, $action, $targetType, (string)$targetId, $details ? json_encode($details) : null, $_SERVER['REMOTE_ADDR'] ?? null]);
    } catch (Exception $e) { error_log('Admin audit failed: ' . $e->getMessage()); }
}

function recordBalanceLedger($pdo, $userId, $reference, $entryType, $amount, $balanceBefore, $description = null) {
    try {
        ensurePlatformFeatureTables($pdo);
        $after = (float)$balanceBefore + (float)$amount;
        $stmt = $pdo->prepare('INSERT IGNORE INTO balance_ledger (user_id, transaction_ref, entry_type, amount, balance_before, balance_after, description) VALUES (?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([$userId, $reference, $entryType, $amount, $balanceBefore, $after, $description]);
    } catch (Exception $e) { error_log('Balance ledger failed: ' . $e->getMessage()); }
}

function ensureUserNotificationPreferencesTable($pdo) {
    $pdo->exec("CREATE TABLE IF NOT EXISTS user_notification_preferences (
        user_id INT NOT NULL,
        event_key VARCHAR(50) NOT NULL,
        enabled TINYINT(1) NOT NULL DEFAULT 1,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, event_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

function notificationEnabled($pdo, $audience, $event = 'general', $userId = null) {
    $keys = [$audience . '_email_notifications'];
    if ($audience === 'admin' && $event !== 'general') $keys[] = 'admin_email_' . $event . '_notifications';
    try {
        $placeholders = implode(',', array_fill(0, count($keys), '?'));
        $stmt = $pdo->prepare("SELECT `key`, value FROM settings WHERE `key` IN ($placeholders)");
        $stmt->execute($keys);
        $values = [];
        foreach ($stmt->fetchAll() as $row) $values[$row['key']] = $row['value'];
        foreach ($keys as $key) {
            if (isset($values[$key]) && $values[$key] === '0') return false;
        }
    } catch (Exception $e) {}
    if ($audience === 'user' && $userId && $event !== 'general') {
        try {
            ensureUserNotificationPreferencesTable($pdo);
            $stmt = $pdo->prepare('SELECT enabled FROM user_notification_preferences WHERE user_id = ? AND event_key = ?');
            $stmt->execute([$userId, $event]);
            $preference = $stmt->fetch();
            if ($preference && (int)$preference['enabled'] === 0) return false;
        } catch (Exception $e) {}
    }
    return true;
}

function notifyUserById($pdo, $userId, $subject, $contentHtml, $event = 'general') {
    createInAppNotification($pdo, $userId, $event, $subject, $contentHtml, '#notifications');
    if (!notificationEnabled($pdo, 'user', $event, $userId)) return false;
    try {
        $stmt = $pdo->prepare('SELECT name, email FROM users WHERE id = ?');
        $stmt->execute([$userId]);
        $user = $stmt->fetch();
        if (!$user || !filter_var($user['email'], FILTER_VALIDATE_EMAIL)) return false;
        return sendSmtpEmail($user['email'], $user['name'] ?: 'Nova User', $subject, novaEmailBody($subject, $contentHtml), $pdo);
    } catch (Exception $e) {
        error_log('Nova user email notification failed: ' . $e->getMessage());
        return false;
    }
}

function notifyAdmins($pdo, $subject, $contentHtml, $event = 'general') {
    if (!notificationEnabled($pdo, 'admin', $event)) return false;
    $sent = false;
    try {
        $stmt = $pdo->query("SELECT name, email FROM users WHERE role = 'admin'");
        $admins = $stmt->fetchAll();
        if (!$admins) $admins = [['name' => 'Nova Admin', 'email' => defined('SITE_EMAIL') ? SITE_EMAIL : 'contact@novaearning.com']];
        foreach ($admins as $admin) {
            if (!filter_var($admin['email'], FILTER_VALIDATE_EMAIL)) continue;
            $sent = sendSmtpEmail($admin['email'], $admin['name'] ?: 'Nova Admin', $subject, novaEmailBody($subject, $contentHtml), $pdo) || $sent;
        }
    } catch (Exception $e) {
        error_log('Nova admin email notification failed: ' . $e->getMessage());
    }
    return $sent;
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
