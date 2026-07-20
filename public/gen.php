<?php
require_once '../config.php';

$adminPass = password_hash('admin123', PASSWORD_BCRYPT);
$userPass = password_hash('user123', PASSWORD_BCRYPT);

$pdo->exec("UPDATE users SET password = '$adminPass' WHERE role = 'admin'");
$pdo->exec("UPDATE users SET password = '$userPass' WHERE role = 'user'");

echo json_encode([
    'status' => 'passwords_updated_successfully',
    'admin_email' => 'admin@nova.com',
    'admin_password' => 'admin123',
    'user_email' => 'user@mail.com',
    'user_password' => 'user123'
]);
?>
