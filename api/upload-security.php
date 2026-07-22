<?php
function saveValidatedBase64Image($dataUrl, $prefix, &$error, $maxBytes = 5242880) {
    if (!preg_match('#^data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$#i', (string)$dataUrl, $matches)) {
        $error = 'Only JPG, PNG, or WEBP images are allowed.';
        return false;
    }
    $binary = base64_decode(preg_replace('/\s+/', '', $matches[2]), true);
    if ($binary === false || strlen($binary) < 32 || strlen($binary) > $maxBytes) {
        $error = 'The image is invalid or larger than 5 MB.';
        return false;
    }
    $detected = (new finfo(FILEINFO_MIME_TYPE))->buffer($binary);
    $extensions = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    if (!isset($extensions[$detected]) || @getimagesizefromstring($binary) === false) {
        $error = 'The uploaded file is not a valid image.';
        return false;
    }
    // The repository keeps assets in public/, while IONOS deploys the contents
    // of public/ directly into its document root. Always use the actual web
    // root so the returned /uploads/... URL resolves in both environments.
    $documentRoot = realpath($_SERVER['DOCUMENT_ROOT'] ?? '');
    $uploadsDir = $documentRoot && is_dir($documentRoot)
        ? rtrim($documentRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'uploads'
        : __DIR__ . '/../public/uploads';
    if (!is_dir($uploadsDir) && !mkdir($uploadsDir, 0755, true)) {
        $error = 'Unable to prepare image storage.';
        return false;
    }
    $fileName = preg_replace('/[^a-z0-9_-]/i', '', $prefix) . '_' . bin2hex(random_bytes(10)) . '.' . $extensions[$detected];
    if (file_put_contents($uploadsDir . '/' . $fileName, $binary, LOCK_EX) === false) {
        $error = 'Unable to save the image.';
        return false;
    }
    return '/uploads/' . $fileName;
}

function deleteValidatedUploadedImage($relativePath) {
    $fileName = basename((string)$relativePath);
    if (!preg_match('/^[a-z0-9_-]+\.(?:jpe?g|png|webp)$/i', $fileName)) return;
    $documentRoot = realpath($_SERVER['DOCUMENT_ROOT'] ?? '');
    $candidates = [];
    if ($documentRoot && is_dir($documentRoot)) $candidates[] = rtrim($documentRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . $fileName;
    $candidates[] = __DIR__ . '/../public/uploads/' . $fileName;
    foreach (array_unique($candidates) as $candidate) {
        if (is_file($candidate)) @unlink($candidate);
    }
}
