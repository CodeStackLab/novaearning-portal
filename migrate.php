<?php
// migrate.php
require_once 'config.php';

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

    // Re-enable foreign key checks
    $pdo->exec("SET FOREIGN_KEY_CHECKS=1;");

    // Ensure Admin credentials: email = admin@novaearning.com, password = admin123
    $adminHash = password_hash('admin123', PASSWORD_BCRYPT);
    $stmt = $pdo->prepare("UPDATE users SET email = 'admin@novaearning.com', password = ? WHERE role = 'admin'");
    $stmt->execute([$adminHash]);

    echo "<p style='color: green; font-size: 16px;'><strong>✓ Success! All database tables and initial seed data have been created in IONOS MySQL!</strong></p>";
    echo "<ul>";
    echo "<li>users (with admin & demo user)</li>";
    echo "<li>deposits</li>";
    echo "<li>investments</li>";
    echo "<li>transactions</li>";
    echo "<li>tickets</li>";
    echo "<li>settings</li>";
    echo "</ul>";

} catch (PDOException $e) {
    echo "<p style='color: red;'><strong>Database Error:</strong> " . htmlspecialchars($e->getMessage()) . "</p>";
}

echo "</div>";
?>
