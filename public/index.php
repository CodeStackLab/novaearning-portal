<?php
$requestUri = $_SERVER['REQUEST_URI'] ?? '/';
// Strip query string for path matching
$parsedUrl = parse_url($requestUri, PHP_URL_PATH);
$path = trim($parsedUrl, '/');

// Handle API requests
if (strpos($path, 'api') === 0) {
    $apiPath = preg_replace('#^api/?#', '', $path);
    $_GET['request'] = $apiPath;
    require_once __DIR__ . '/api/index.php';
    exit;
}

switch ($path) {
    case 'dashboard':
    case 'user-dashboard':
        require_once 'dashboard.html';
        break;

    case 'admin':
    case 'admin-dashboard':
        require_once 'admin.html';
        break;

    case 'login':
        require_once 'login.html';
        break;

    case 'investments':
        require_once 'investments.html';
        break;

    case 'help':
        require_once 'help.html';
        break;

    case '':
        require_once 'login.html';
        break;

    default:
        if (file_exists($path)) {
            return false; // serve requested resource as-is
        }
        if (file_exists($path . '.html')) {
            require_once $path . '.html';
            break;
        }
        require_once 'login.html';
        break;
}
?>
