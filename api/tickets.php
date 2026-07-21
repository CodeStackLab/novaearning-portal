<?php
// api/tickets.php

function handleTickets($action, $pdo, $body) {
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit();
    $userId = authenticateToken();

    if ($_SERVER['REQUEST_METHOD'] === 'GET' && !$action) {
        $stmt = $pdo->prepare('SELECT * FROM tickets WHERE user_id = ? ORDER BY id DESC');
        $stmt->execute([$userId]);
        sendJson($stmt->fetchAll());
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && !$action) {
        $title = $body['title'] ?? 'Support Query';
        $message = $body['message'] ?? '';
        $screenshotBase64 = $body['screenshotBase64'] ?? '';

        if (!$message) {
            sendJson(['message' => 'Message is required'], 400);
        }

        $savedImagePath = null;
        if ($screenshotBase64) {
            $uploadError = '';
            $savedImagePath = saveValidatedBase64Image($screenshotBase64, 'support', $uploadError);
            if (!$savedImagePath) sendJson(['message' => $uploadError], 400);
        }

        $dateStr = date('M j, Y h:i A');
        $ticketId = "#" . rand(10000, 99999);

        try {
            $stmt = $pdo->prepare('UPDATE tickets SET status = ? WHERE user_id = ?');
            $stmt->execute(['Open', $userId]);

            $stmt = $pdo->prepare('INSERT INTO tickets (user_id, title, ticket_id, date, status, message, image_path) VALUES (?, ?, ?, ?, ?, ?, ?)');
            $stmt->execute([$userId, $title, $ticketId, $dateStr, 'Open', $message, $savedImagePath]);

            $uStmt = $pdo->prepare('SELECT name, email FROM users WHERE id = ?');
            $uStmt->execute([$userId]);
            $userInfo = $uStmt->fetch();
            $userName = $userInfo ? $userInfo['name'] : 'User';
            $userEmail = $userInfo ? $userInfo['email'] : '';

            $emailSubject = "New Support Message {$ticketId} from {$userName}";
            $emailBody = "<h2>New Support Ticket Message</h2>" .
                         "<p><strong>Ticket ID:</strong> {$ticketId}</p>" .
                         "<p><strong>User:</strong> " . htmlspecialchars($userName) . " ({$userEmail})</p>" .
                         "<p><strong>Subject:</strong> " . htmlspecialchars($title) . "</p>" .
                         "<p><strong>Message:</strong></p>" .
                         "<blockquote style='background:#f4f4f4; padding: 12px; border-left:4px solid #0070f3;'>" . nl2br(htmlspecialchars($message)) . "</blockquote>";

            notifyAdmins($pdo, $emailSubject, $emailBody, 'support');
            notifyUserById($pdo, $userId, "Support request received {$ticketId}", '<p>We received your support message and will reply as soon as possible.</p><p><strong>Subject:</strong> ' . htmlspecialchars($title) . '</p>', 'support');

            sendJson(['message' => 'Support ticket submitted.']);
        } catch (Exception $e) {
            sendJson(['message' => 'Server error'], 500);
        }
    }

    sendJson(['message' => 'Invalid Tickets Action'], 404);
}
?>
