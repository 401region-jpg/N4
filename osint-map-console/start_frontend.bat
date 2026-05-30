@echo off
title OSINT Map Console — Frontend
cd /d "%~dp0frontend"

echo [*] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo [!] Node.js not found. Install Node.js 18+ from https://nodejs.org
    pause
    exit /b 1
)

echo [*] Installing npm packages...
npm install

echo [*] Starting Vite dev server on http://localhost:5173
echo [*] Press Ctrl+C to stop
echo.
npm run dev
pause
