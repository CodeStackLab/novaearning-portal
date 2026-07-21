# Nova Portal - Complete System Architecture & Setup Documentation

> **Last Updated**: July 20, 2026  
> **Status**: 100% Live & Operational on IONOS Production Hosting

---

## 1. Project Overview & Infrastructure

- **Live Production URL**: [https://novaearning.com](https://novaearning.com)
- **Hosting Provider**: IONOS Webhosting Plus
- **Connected Domain Directory**: `/novaearning/`
- **GitHub Repository**: `CodeStackLab/novaearning-portal`
- **Primary Branch**: `main`

---

## 2. Server & SFTP Configuration

- **Server / Host**: `access-5020930432.webspace-host.com`
- **Port**: `22`
- **Protocol**: SFTP + SSH
- **User Name**: Stored in the hosting account and GitHub Actions secrets
- **Password**: Never store in source control; rotate it in IONOS if exposed
- **GitHub Secrets configured**:
  - `IONOS_SFTP_HOST`: configured
  - `IONOS_SFTP_PORT`: `22`
  - `IONOS_SFTP_USER`: configured
  - `IONOS_SFTP_PASSWORD`: configured as an encrypted repository secret

---

## 3. Database Configuration (IONOS MySQL 8.0)

- **Host name**: `db5020969176.hosting-data.io`
- **Port**: `3306`
- **Database Name**: Stored in the protected server configuration
- **User name**: Stored in the protected server configuration
- **Password**: Never store in documentation or source control
- **Type & Version**: MySQL 8.0

### Automatic Migration Script
- **Endpoint**: `https://novaearning.com/migrate.php`
- **File**: `migrate.php`
- **Function**: Executes `database.sql` to create/update the required tables and seed a missing administrator. It never resets an existing production password.

---

## 4. Admin & Demo User Credentials

- **Main Admin Email**: `admin@novaearning.com`
- **Main Admin Password**: Managed privately by the administrator; never document it
- **Admin Panel Direct URL**: [https://novaearning.com/admin.html](https://novaearning.com/admin.html)

- Demo credentials are not maintained in production documentation.

---

## 5. SMTP Email System & Configuration

- **Primary Admin & Sender Email**: `admin@novaearning.com`
- **SMTP Host**: `smtp.ionos.com`
- **SMTP Port**: `587`
- **Encryption**: `TLS`
- **SMTP Username**: `admin@novaearning.com`
- **From Name**: `Nova Support`
- **SMTP Password**: Enter the `admin@novaearning.com` IONOS mailbox password in Admin Panel → SMTP Settings. It is encrypted in the database and must not be stored in this document or source control.

### Email Features Integrated:
1. **Support Tickets & Live Chat**:
   - User posts message ➔ Email notification sent to `admin@novaearning.com`.
   - Admin replies in Admin Panel ➔ Email notification sent to User's registered email.
2. **Forgot Password OTP**:
   - User/Admin requests password reset ➔ Real 6-Digit OTP code sent via SMTP (`api/auth.php`).
3. **User Registration**:
   - Automatic Welcome email sent upon new account creation.

---

## 6. Automated GitHub CI/CD Pipeline

- **Workflow File**: `.github/workflows/deploy-ionos.yml`
- **Automated Flow**:
  - Triggers automatically on every `git push origin main`.
  - Bundles `public/`, `public/.htaccess`, `api/`, `api/.htaccess`, `config.php`, `migrate.php`, `database.sql` into `dist/`.
  - Uses `sshpass` + `sftp` to upload changed files to `/novaearning/` directory on IONOS.

---

## 7. Routing & Server Configuration (`.htaccess`)

- **Root `.htaccess`** (`public/.htaccess`):
  - Routes `/api/*` to `/api/index.php`.
  - Routes `/admin` and `/admin-dashboard` to `/admin.html`.
  - Routes `/dashboard` to `/dashboard.html`.
- **API `.htaccess`** (`api/.htaccess`):
  - Handles direct endpoint parameter mapping (`index.php?request=$1`).

---

## 8. Instructions for AI Assistant (How to Resume Work Tomorrow)

When starting a new session tomorrow:
1. Read this `PROJECT_SETUP_DOCUMENTATION.md` file to restore full context.
2. The codebase is tracked on GitHub branch `main`. Any code edit pushed with `git push origin main` will auto-deploy to IONOS in ~15 seconds.
3. Database changes should be updated in `database.sql` and `migrate.php`.
