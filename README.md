# Nova Portal - PHP/MySQL Backend

This project has been successfully migrated from Node.js (SQLite) to a raw PHP (MySQL 8.0) backend. This architecture is fully compatible with standard Shared Hosting (e.g., IONOS, Hostinger) and provides a secure, fast, and scalable environment.

## 💻 Local Development Setup (Using Laragon / XAMPP)

Follow these steps to clone and run this project on a new PC:

1. **Install Local Server**: Download and install [Laragon](https://laragon.org/download/) (Recommended) or XAMPP.
2. **Start Services**: Open Laragon and click **"Start All"** to start the Apache server and MySQL database.
3. **Clone Repository**: 
   - Open your terminal in the `C:\laragon\www\` directory.
   - Run: `git clone https://github.com/CodeStackLab/napp-vjgp-online.git`
   - This will create a folder at `C:\laragon\www\napp-vjgp-online`.
   
### 🗄️ Database Setup (CRITICAL STEP)
Because this is a PHP/MySQL project, you MUST import the database manually on the new PC. The `database.sql` file contains the entire structure and default admin/test users.

4. **Import Database**:
   - Open your local database manager (e.g., HeidiSQL in Laragon or phpMyAdmin).
   - Create a new empty database named **`nova_portal`**.
   - Select the `nova_portal` database and click **Import**.
   - Choose the **`database.sql`** file located in this repository folder and execute it.
   - *Result: All your tables and default users are now ready!*

5. **Configuration**:
   - Open the `config.php` file in the root directory.
   - Ensure the database credentials match your local setup:
     ```php
     define('DB_HOST', 'localhost');
     define('DB_NAME', 'nova_portal'); 
     define('DB_USER', 'root'); // Default Laragon/XAMPP user
     define('DB_PASS', '');     // Default Laragon/XAMPP password (empty)
     ```
6. **Run**: 
   - Open your browser and navigate to: `http://localhost/napp-vjgp-online/`

## 🚀 Live Server Deployment (Shared Hosting)

1. **Create Database**: Go to your web hosting control panel (e.g., IONOS) and create a new MySQL 8.0 database. Note down the Database Name, Username, and Password.
2. **Import Database**: Open phpMyAdmin on your hosting panel and import the `database.sql` file exactly like you did on local.
3. **Upload Files**: You can deploy the code via Git (`git clone` or `git pull` via SSH) or upload the ZIP file directly to your `public_html` directory via File Manager/FTP.
4. **Update config.php**: Edit `config.php` on the live server with the real Database Name, Username, and Password you created in Step 1.
5. **Setup Cron Job**:
   - For the daily investment returns to compound automatically, set up a Cron Job in your hosting panel.
   - **Command:** `/usr/local/bin/php /path/to/your/public_html/cron.php`
   - **Schedule:** Run every 1 minute (`* * * * *`).

## 📁 Project Structure

- `api/`: Contains all the raw PHP backend endpoint files (`auth.php`, `user.php`, `deposits.php`, etc.)
- `api/index.php`: The main router that directs API calls (e.g., `/api/auth/login`) to the correct file.
- `api/.htaccess`: Handles Apache URL rewriting to make the API URLs clean.
- `public/`: Frontend assets (CSS, JS, Images). All your vanilla JS lives here.
- `config.php`: Global database configuration and JWT helper functions.
- `cron.php`: The script responsible for calculating 2.5% daily compound interest.
- `migrate.php`: A helper script for adding new database columns in the future without overwriting data.
- `database.sql`: The entire MySQL schema to easily spin up the tables.
