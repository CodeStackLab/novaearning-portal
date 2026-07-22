<?php
// migrate.php
require_once 'config.php';

if (PHP_SAPI !== 'cli') {
    // If running via browser, allow execution if a specific key is provided or if no users exist
    // Check if users table exists and has admins
    $adminExists = false;
    try {
        $stmt = $pdo->query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
        if ($stmt && $stmt->fetch()) {
            $adminExists = true;
        }
    } catch (Exception $e) {
        // Table doesn't exist yet
    }

    if ($adminExists) {
        // Require token via header or query string
        $token = '';
        if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
            if (preg_match('/Bearer\s(\S+)/', $_SERVER['HTTP_AUTHORIZATION'], $matches)) {
                $token = $matches[1];
            }
        } elseif (isset($_GET['token'])) {
            $token = $_GET['token'];
        }
        
        $decoded = null;
        if ($token) {
            $decoded = verifyJWT($token);
        }

        if (!$decoded || !isset($decoded['userId'])) {
            // Provide a simple HTML form to paste the token if accessed directly via browser
            die("
            <div style='font-family: Arial; max-width: 500px; margin: 50px auto; text-align: center;'>
                <h2>Migration Requires Admin Access</h2>
                <p>Please enter your Admin JWT Token to run the migration.</p>
                <form method='GET'>
                    <input type='text' name='token' placeholder='Paste token here...' style='width: 100%; padding: 10px; margin-bottom: 10px;'>
                    <button type='submit' style='padding: 10px 20px; background: #0070f3; color: white; border: none; border-radius: 5px;'>Run Migration</button>
                </form>
                <p style='font-size: 12px; color: #666;'>You can find your token in your browser's Developer Tools -> Application -> Local Storage -> nova_token.</p>
            </div>
            ");
        }
        
        // Verify user is actually admin
        $stmt = $pdo->prepare('SELECT role FROM users WHERE id = ?');
        $stmt->execute([$decoded['userId']]);
        $user = $stmt->fetch();
        if (!$user || $user['role'] !== 'admin') {
            die("Access denied: Admin role required");
        }
    }
}

header('Content-Type: text/html; charset=utf-8');
echo "<div style='font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; border: 1px solid #ccc; border-radius: 8px;'>";
echo "<h2 style='color: #333;'>Nova Portal - Automatic Database Setup</h2>";

try {
    $sqlPath = __DIR__ . '/database.sql';
    if (!file_exists($sqlPath)) {
        die("<p style='color: red;'><strong>Error:</strong> database.sql file not found.</p></div>");
    }

    $sql = file_get_contents($sqlPath);
    if (empty(trim($sql))) {
        die("<p style='color: red;'><strong>Error:</strong> database.sql file is empty.</p></div>");
    }

    // Disable foreign key checks
    $pdo->exec("SET FOREIGN_KEY_CHECKS=0;");

    // Execute multi-statement SQL
    $pdo->exec($sql);

    // Forward-compatible production upgrades for installations created before these columns/tables existed.
    $pdo->exec("DELETE FROM password_reset_tokens WHERE expires_at < DATE_SUB(NOW(), INTERVAL 1 DAY) OR used_at IS NOT NULL");
    $pdo->exec("UPDATE settings SET value = 'admin@novaearning.com' WHERE `key` IN ('smtp_username', 'smtp_from_email') AND LOWER(value) = 'contact@novaearning.com'");
    $pdo->exec("UPDATE settings SET value = 'smtp.ionos.co.uk' WHERE `key` = 'smtp_host' AND LOWER(value) = 'smtp.ionos.com'");

    // Re-enable foreign key checks
    $pdo->exec("SET FOREIGN_KEY_CHECKS=1;");

    // database.sql creates a missing seed admin; never reset an existing production password.

    echo "<p style='color: green; font-size: 16px;'><strong>✓ Success! All database tables and initial seed data have been created in IONOS MySQL!</strong></p>";
    echo "<ul>";
    echo "<li>users (with admin & demo user)</li>";
    echo "<li>deposits</li>";
    echo "<li>investments</li>";
    echo "<li>transactions</li>";
    echo "<li>tickets</li>";
    echo "<li>settings</li>";
    echo "<li>plans and secure password reset tokens</li>";
    echo "</ul>";

} catch (PDOException $e) {
    echo "<p style='color: red;'><strong>Database Error:</strong> " . htmlspecialchars($e->getMessage()) . "</p>";
}

echo "</div>";
?>
