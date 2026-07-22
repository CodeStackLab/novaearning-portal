<?php
// api/auth.php

function handleAuth($action, $subaction, $pdo, $body) {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        sendJson(['message' => 'Method not allowed'], 405);
    }

    if ($action === 'login') {
        $email = $body['email'] ?? '';
        $password = $body['password'] ?? '';

        if (!$email || !$password) {
            sendJson(['message' => 'Email and password are required'], 400);
        }
        enforceLoginRateLimit($pdo, $email);

        $stmt = $pdo->prepare('SELECT * FROM users WHERE email = ? OR username = ? OR (role = "admin" AND ? IN ("admin@novaearning.com", "admin@nova.com", "novadmin"))');
        $stmt->execute([$email, $email, $email]);
        $user = $stmt->fetch();

        $isValid = false;
        if ($user) {
            $isValid = password_verify($password, $user['password']);
        }

        if (!$user || !$isValid) {
            recordFailedLogin($pdo, $email);
            sendJson(['message' => 'Invalid credentials'], 401);
        }

        $accountStatus = $user['account_status'] ?? 'Active';
        if ($user['role'] !== 'admin' && $accountStatus !== 'Active') {
            $message = $accountStatus === 'Suspended'
                ? 'Your account is suspended. Please contact support.'
                : 'Your account is currently ' . strtolower($accountStatus) . '. Please contact support.';
            sendJson(['message' => $message], 403);
        }

        clearFailedLogins($pdo, $email);
        recordLoginActivity($pdo, $user['id']);
        $token = generateJWT(['userId' => $user['id']]);
        sendJson([
            'token' => $token,
            'user' => [
                'id' => $user['id'],
                'name' => $user['name'],
                'email' => $user['email'],
                'role' => $user['role']
            ]
        ]);
    }

    if ($action === 'register') {
        if ($subaction === 'send-otp') {
            $email = strtolower(trim($body['email'] ?? ''));
            $name = trim($body['name'] ?? 'User');

            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                sendJson(['message' => 'A valid email is required'], 400);
            }

            $stmt = $pdo->prepare('SELECT id FROM users WHERE email = ?');
            $stmt->execute([$email]);
            if ($stmt->fetch()) {
                sendJson(['message' => 'Email address is already registered. Please sign in.'], 400);
            }

            ensurePlatformFeatureTables($pdo);
            $pdo->exec("DELETE FROM registration_otps WHERE expires_at < NOW()");
            $stmt = $pdo->prepare('SELECT COUNT(*) FROM registration_otps WHERE email = ? AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)');
            $stmt->execute([$email]);
            if ((int)$stmt->fetchColumn() >= 5) {
                sendJson(['message' => 'Too many OTP requests. Please wait 15 minutes.'], 429);
            }

            $otp = (string)random_int(100000, 999999);
            $otpHash = password_hash($otp, PASSWORD_DEFAULT);

            $stmt = $pdo->prepare('INSERT INTO registration_otps (email, otp_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))');
            $stmt->execute([$email, $otpHash]);

            $subject = "Your Registration Verification Code - Nova Portal";
            $bodyHtml = "<div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;'>" .
                        "<h2 style='color: #0070f3;'>Nova Portal Registration Verification</h2>" .
                        "<p>Hi <strong>" . htmlspecialchars($name) . "</strong>,</p>" .
                        "<p>Thank you for signing up with Nova Portal! Use the 6-digit code below to complete your registration:</p>" .
                        "<div style='background: #f0f7ff; padding: 15px; text-align: center; border-radius: 6px; margin: 20px 0;'>" .
                        "<span style='color: #0070f3; letter-spacing: 6px; font-size: 32px; font-weight: bold;'>" . $otp . "</span>" .
                        "</div>" .
                        "<p>This code expires in 10 minutes. If you did not initiate this registration, please ignore this email.</p>" .
                        "</div>";

            if (!sendSmtpEmail($email, $name, $subject, $bodyHtml, $pdo)) {
                sendJson(['message' => 'Unable to send verification OTP. Please check your email and try again.'], 503);
            }

            sendJson(['message' => 'Verification OTP sent to your email. It expires in 10 minutes.']);
        }

        $name = trim($body['name'] ?? '');
        $email = strtolower(trim($body['email'] ?? ''));
        $password = $body['password'] ?? '';
        $referralCode = trim($body['referralCode'] ?? '');
        $otp = trim($body['otp'] ?? '');

        if (!$name || !$email || !$password) {
            sendJson(['message' => 'Name, email, and password are required'], 400);
        }

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            sendJson(['message' => 'Valid email address is required'], 400);
        }

        if (!preg_match('/^\d{6}$/', $otp)) {
            sendJson(['message' => '6-digit email verification OTP is required'], 400);
        }

        $stmt = $pdo->prepare('SELECT id FROM users WHERE email = ?');
        $stmt->execute([$email]);
        if ($stmt->fetch()) {
            sendJson(['message' => 'Email address is already registered'], 400);
        }

        ensurePlatformFeatureTables($pdo);
        $stmt = $pdo->prepare('SELECT id, otp_hash, attempts FROM registration_otps WHERE email = ? AND expires_at >= NOW() ORDER BY id DESC LIMIT 1');
        $stmt->execute([$email]);
        $otpRecord = $stmt->fetch();

        if (!$otpRecord || (int)$otpRecord['attempts'] >= 5 || !password_verify($otp, $otpRecord['otp_hash'])) {
            if ($otpRecord) {
                $stmt = $pdo->prepare('UPDATE registration_otps SET attempts = attempts + 1 WHERE id = ?');
                $stmt->execute([$otpRecord['id']]);
            }
            sendJson(['message' => 'Invalid or expired 6-digit verification code.'], 400);
        }

        $stmt = $pdo->prepare('DELETE FROM registration_otps WHERE email = ?');
        $stmt->execute([$email]);

        $referrerId = null;
        $startBalance = 0.00;

        if ($referralCode !== '') {
            $stmt = $pdo->prepare('SELECT id FROM users WHERE referral_code = ?');
            $stmt->execute([$referralCode]);
            $referrer = $stmt->fetch();
            if ($referrer) {
                $referrerId = $referrer['id'];
            } else {
                sendJson(['message' => 'Invalid referral code'], 400);
            }
        }

        $cleanName = strtoupper(substr(preg_replace('/[^A-Za-z]/', '', $name), 0, 4));
        if (strlen($cleanName) < 2) $cleanName = 'NOVA';
        $myReferralCode = $cleanName . rand(1000, 9999);
        $hashedPassword = password_hash($password, PASSWORD_BCRYPT);

        $stmt = $pdo->prepare('INSERT INTO users (name, email, username, password, balance, earnings, active_investments, role, referred_by, referral_code) VALUES (?, ?, ?, ?, ?, 0.0, 0.0, ?, ?, ?)');
        $stmt->execute([$name, $email, $email, $hashedPassword, $startBalance, 'user', $referrerId, $myReferralCode]);
        $newUserId = $pdo->lastInsertId();

        if ($referrerId) {
            notifyUserById($pdo, $referrerId, 'You have a new referral', '<p><strong>' . htmlspecialchars($name) . '</strong> joined Nova using your referral code.</p><p>You will receive referral commission when eligible activity is completed.</p>', 'referral');
        }

        $token = generateJWT(['userId' => $newUserId]);

        $welcomeSubject = "Welcome to Nova Portal!";
        $welcomeBody = "<h2>Welcome to Nova Portal!</h2>" .
                       "<p>Hi <strong>" . htmlspecialchars($name) . "</strong>,</p>" .
                       "<p>Your email has been verified and your account is now active!</p>" .
                       "<p>Your Referral Code: <strong>" . htmlspecialchars($myReferralCode) . "</strong></p>" .
                       "<p>Log in to your dashboard to manage investments and track daily earnings.</p>";
        sendSmtpEmail($email, $name, $welcomeSubject, $welcomeBody, $pdo);

        sendJson([
            'token' => $token,
            'user' => ['id' => $newUserId, 'name' => $name, 'email' => $email, 'role' => 'user']
        ]);
    }

    if ($action === 'change-password') {
        $userId = authenticateToken();
        $oldPassword = $body['oldPassword'] ?? '';
        $newPassword = $body['newPassword'] ?? '';

        if (!$oldPassword || !$newPassword) {
            sendJson(['message' => 'Current password and new password are required'], 400);
        }

        $stmt = $pdo->prepare('SELECT password FROM users WHERE id = ?');
        $stmt->execute([$userId]);
        $user = $stmt->fetch();

        if (!$user || !password_verify($oldPassword, $user['password'])) {
            sendJson(['message' => 'Incorrect current password'], 400);
        }

        $hashedPassword = password_hash($newPassword, PASSWORD_BCRYPT);
        $stmt = $pdo->prepare('UPDATE users SET password = ? WHERE id = ?');
        $stmt->execute([$hashedPassword, $userId]);

        sendJson(['message' => 'Password updated successfully!']);
    }

    if ($action === 'forgot-password') {
        if ($subaction === 'send-otp') {
            $email = trim($body['email'] ?? '');
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) sendJson(['message' => 'A valid email is required'], 400);

            $stmt = $pdo->prepare('SELECT id, name FROM users WHERE email = ?');
            $stmt->execute([$email]);
            $user = $stmt->fetch();
            if (!$user) sendJson(['message' => 'Email address not found'], 404);

            $pdo->exec("DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR used_at IS NOT NULL");
            $stmt = $pdo->prepare('SELECT COUNT(*) FROM password_reset_tokens WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)');
            $stmt->execute([$user['id']]);
            if ((int)$stmt->fetchColumn() >= 3) sendJson(['message' => 'Too many reset requests. Please wait 15 minutes.'], 429);

            $otp = (string)random_int(100000, 999999);
            $tokenHash = password_hash($otp, PASSWORD_DEFAULT);
            $stmt = $pdo->prepare('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))');
            $stmt->execute([$user['id'], $tokenHash]);
            $tokenId = (int)$pdo->lastInsertId();

            // Send real OTP email via IONOS SMTP
            $subject = "Your Password Reset OTP - Nova Portal";
            $bodyHtml = "<div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;'>" .
                        "<h2 style='color: #0070f3;'>Nova Portal Password Reset</h2>" .
                        "<p>Hi <strong>" . htmlspecialchars($user['name'] ?? 'User') . "</strong>,</p>" .
                        "<p>You requested to reset your password. Here is your 6-digit OTP verification code:</p>" .
                        "<div style='background: #f0f7ff; padding: 15px; text-align: center; border-radius: 6px; margin: 20px 0;'>" .
                        "<span style='color: #0070f3; letter-spacing: 6px; font-size: 32px; font-weight: bold;'>" . $otp . "</span>" .
                        "</div>" .
                        "<p>Enter this OTP on the password reset page to set a new password.</p>" .
                        "<p style='color: #888; font-size: 12px; margin-top: 30px;'>If you did not request this password reset, please ignore this email.</p>" .
                        "</div>";

            if (!sendSmtpEmail($email, $user['name'] ?? 'User', $subject, $bodyHtml, $pdo)) {
                $stmt = $pdo->prepare('DELETE FROM password_reset_tokens WHERE id = ?');
                $stmt->execute([$tokenId]);
                sendJson(['message' => 'Unable to send the reset email. Please contact support or try again later.'], 503);
            }

            sendJson(['message' => 'A 6-digit code was sent. It expires in 10 minutes.']);
        }

        if ($subaction === 'verify') {
            $email = trim($body['email'] ?? '');
            $otpCode = trim($body['otpCode'] ?? '');
            if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !preg_match('/^\d{6}$/', $otpCode)) sendJson(['message' => 'Enter a valid email and 6-digit code.'], 400);
            $stmt = $pdo->prepare('SELECT id FROM users WHERE email = ?');
            $stmt->execute([$email]);
            $user = $stmt->fetch();
            if (!$user) sendJson(['message' => 'Invalid or expired reset code.'], 400);
            $stmt = $pdo->prepare('SELECT id, token_hash, attempts FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL AND expires_at >= NOW() ORDER BY id DESC LIMIT 1');
            $stmt->execute([$user['id']]);
            $reset = $stmt->fetch();
            if (!$reset || (int)$reset['attempts'] >= 5 || !password_verify($otpCode, $reset['token_hash'])) {
                if ($reset) { $stmt = $pdo->prepare('UPDATE password_reset_tokens SET attempts = attempts + 1 WHERE id = ?'); $stmt->execute([$reset['id']]); }
                sendJson(['message' => 'Invalid or expired reset code.'], 400);
            }
            sendJson(['message' => 'Code verified.']);
        }

        if ($subaction === 'reset') {
            $email = trim($body['email'] ?? '');
            $otpCode = trim($body['otpCode'] ?? '');
            $newPassword = $body['newPassword'] ?? '';

            if (!$email || !preg_match('/^\d{6}$/', $otpCode) || strlen($newPassword) < 8) sendJson(['message' => 'Enter the 6-digit code and a password of at least 8 characters.'], 400);

            $stmt = $pdo->prepare('SELECT id FROM users WHERE email = ?');
            $stmt->execute([$email]);
            $user = $stmt->fetch();
            if (!$user) sendJson(['message' => 'Email address not found'], 404);

            $stmt = $pdo->prepare('SELECT id, token_hash, attempts FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL AND expires_at >= NOW() ORDER BY id DESC LIMIT 1');
            $stmt->execute([$user['id']]);
            $reset = $stmt->fetch();
            if (!$reset || (int)$reset['attempts'] >= 5) sendJson(['message' => 'The reset code is invalid or expired. Request a new code.'], 400);
            if (!password_verify($otpCode, $reset['token_hash'])) {
                $stmt = $pdo->prepare('UPDATE password_reset_tokens SET attempts = attempts + 1 WHERE id = ?');
                $stmt->execute([$reset['id']]);
                sendJson(['message' => 'The reset code is invalid or expired.'], 400);
            }

            $hashedPassword = password_hash($newPassword, PASSWORD_BCRYPT);
            $pdo->beginTransaction();
            try {
                $stmt = $pdo->prepare('UPDATE users SET password = ? WHERE id = ?');
                $stmt->execute([$hashedPassword, $user['id']]);
                $stmt = $pdo->prepare('UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL');
                $stmt->execute([$user['id']]);
                $pdo->commit();
            } catch (Exception $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                sendJson(['message' => 'Unable to reset the password.'], 500);
            }

            sendJson(['message' => 'Password reset successfully! You can now log in with your new password.']);
        }
    }

    sendJson(['message' => 'Invalid Auth Action'], 404);
}
?>
