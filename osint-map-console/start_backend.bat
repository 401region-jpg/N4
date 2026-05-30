@echo off
title OSINT Map Console — Backend
cd /d "%~dp0backend"

echo [*] Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo [!] Python not found. Install Python 3.10+ from https://python.org
    pause
    exit /b 1
)

echo [*] Installing dependencies...
pip install -r requirements.txt --quiet

echo [*] Starting FastAPI on http://localhost:8000
echo [*] Press Ctrl+C to stop
echo.
uvicorn main:app --reload --port 8000 --host 127.0.0.1
pause
