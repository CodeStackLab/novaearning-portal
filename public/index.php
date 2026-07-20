<?php
$requestUri = $_SERVER['REQUEST_URI'] ?? '/';
$parsedUrl = parse_url($requestUri, PHP_URL_PATH);
$path = trim($parsedUrl, '/');

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
