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

## 2. Server & SFTP Credentials

- **Server / Host**: `access-5020930432.webspace-host.com`
- **Port**: `22`
- **Protocol**: SFTP + SSH
- **User Name**: `su547455`
- **Password**: `Easy@9129881899`
- **GitHub Secrets configured**:
  - `IONOS_SFTP_HOST`: `access-5020930432.webspace-host.com`
  - `IONOS_SFTP_PORT`: `22`
  - `IONOS_SFTP_USER`: `su547455`
  - `IONOS_SFTP_PASSWORD`: `Easy@9129881899`

---

## 3. Database Configuration (IONOS MySQL 8.0)

- **Host name**: `db5020969176.hosting-data.io`
- **Port**: `3306`
- **Database Name**: `dbs15918036`
- **User name**: `dbu2389530`
- **Password**: `DB@9129881899`
- **Type & Version**: MySQL 8.0

### Automatic Migration Script
- **Endpoint**: `https://novaearning.com/migrate.php`
- **File**: `migrate.php`
- **Function**: Executes `database.sql` to automatically create/update all tables (`users`, `deposits`, `investments`, `transactions`, `tickets`, `settings`) and ensures `admin@novaearning.com` with password `admin123` is set up.

---

## 4. Admin & Demo User Credentials

- **Main Admin Email**: `admin@novaearning.com`
- **Main Admin Password**: `admin123`
- **Admin Panel Direct URL**: [https://novaearning.com/admin.html](https://novaearning.com/admin.html)

- **Demo Admin Email**: `admin@mail.com`
- **Demo Admin Password**: `admin123`

- **Demo User Email**: `user@mail.com`
- **Demo User Password**: `user123`

---

## 5. SMTP Email System & Configuration

- **Contact Email**: `contact@novaearning.com`
- **SMTP Host**: `smtp.ionos.com`
- **SMTP Port**: `587`
- **Encryption**: `TLS`
- **SMTP Username**: `contact@novaearning.com`
- **From Name**: `Nova Support`

### Email Features Integrated:
1. **Support Tickets & Live Chat**:
   - User posts message ➔ Email notification sent to `contact@novaearning.com`.
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
