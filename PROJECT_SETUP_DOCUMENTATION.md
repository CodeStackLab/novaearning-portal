# Nova Portal - Complete System Architecture & Setup Documentation

> **Last Updated**: July 22, 2026
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
  - `IONOS_REMOTE_PATH`: production web root (for the current shared-hosting setup this is `/novaearning/`; the workflow safely uses `/novaearning/` when omitted)

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
- **SMTP Host**: `smtp.ionos.co.uk`
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
  - Can also be started manually from GitHub → Actions → Deploy production to IONOS → Run workflow.
  - Validates JavaScript and every deployed PHP entry point before upload. A validation failure stops deployment.
  - Validates that all required SFTP secrets exist without printing their values.
  - Bundles `public/`, `.htaccess`, `api/`, `config.php`, `cron.php`, `migrate.php`, `database.sql`, and this documentation into `dist/`.
  - Uses SFTP to upload the package to `IONOS_REMOTE_PATH`.
  - Calls the protected production commission scheduler as a post-deployment smoke test.

### One-time GitHub configuration

Open GitHub repository → **Settings → Secrets and variables → Actions** and add:

1. `IONOS_SFTP_HOST` = `access-5020930432.webspace-host.com`
2. `IONOS_SFTP_PORT` = `22`
3. `IONOS_SFTP_USER` = the IONOS SFTP account username
4. `IONOS_SFTP_PASSWORD` = the IONOS SFTP account password
5. `IONOS_REMOTE_PATH` = `/novaearning/` (confirm the connected-domain folder in IONOS before changing this)

Then open **Actions**, enable workflows if GitHub asks, and manually run **Deploy production to IONOS** once. After it succeeds, every push to `main` deploys automatically. Verify each deployment from the workflow run summary and `https://novaearning.com/admin.html`.

### Normal deployment commands

```bash
git add .
git commit -m "Describe the production change"
git push origin main
```

Do not store a GitHub token in the remote URL. The safe remote is:

```bash
git remote set-url origin https://github.com/CodeStackLab/novaearning-portal.git
```

If a token was previously embedded in a remote URL or log, revoke it immediately in GitHub → Settings → Developer settings → Personal access tokens, then create a replacement only if needed.

### Database changes

Deploying uploads `database.sql` and `migrate.php`, but the SFTP workflow does **not** automatically execute the browser migration because it requires authenticated admin access. For an actual schema change, update both files, deploy, then run `migrate.php` with an admin JWT or use an authorized CLI migration. The post-deployment `cron.php` request is a scheduler smoke test, not a general database migration.

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
