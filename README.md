# CineInvest / TRONINVEST Portal

A fully responsive, modern web application for investment tracking and management. Built with a premium, dynamic UI featuring seamless Dark/Light mode, ambient glows, and responsive grid layouts.

## Features
- **Modern Premium UI/UX:** Glassmorphic design, smooth micro-animations, and dynamic gradient texts.
- **Dark & Light Mode:** Built-in seamless toggling between a sleek dark theme and a clean light theme using CSS custom properties.
- **Fully Responsive:** Mobile-first architecture with custom breakpoints to ensure perfection on desktops, tablets, and smartphones.
- **Secure Authentication:** User login built with `bcryptjs` and `jsonwebtoken`.
- **Database Backend:** SQLite integration for lightweight, server-side data persistence.
- **RESTful API:** Express.js backend handling user data and dashboard logic.

## Tech Stack
- **Frontend:** HTML5, CSS3, Vanilla JavaScript
- **Backend:** Node.js, Express.js
- **Database:** SQLite3
- **Tools:** Docker, Docker Compose, Nodemon

## Installation & Setup

### Prerequisites
- [Node.js](https://nodejs.org/) (v14 or higher)
- npm (Node Package Manager)
- [Docker](https://www.docker.com/) (optional, for containerized deployment)

### 1. Local Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/CodeStackLab/napp-vjgp-online.git
   cd napp-vjgp-online
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```
   The server will start at `http://localhost:8082` (or the port defined in your environment).

### 2. Docker Deployment (Recommended for Production)

If you have Docker and Docker Compose installed, you can spin up the complete environment easily.

1. **Build and start the container:**
   ```bash
   docker-compose up -d --build
   ```

2. **Stop the container:**
   ```bash
   docker-compose down
   ```

## Architecture

- **`server.js`**: Main entry point for the Node.js backend. Defines API routes and starts the Express server.
- **`public/`**: Contains all static assets (HTML, CSS, JS) served to the client.
  - `style.css`: The core design system and component styles.
  - `app.js` / `admin-app.js`: Client-side JavaScript handling UI interactions and API calls.
  - `index.html`, `login.html`, `investments.html`: Core views.

## License
MIT License
