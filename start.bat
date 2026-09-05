@echo off
title Voice Changer App Launcher
echo.
echo ╔═══════════════════════════════════════════════╗
echo ║      Voice Changer App — Starting Up...       ║
echo ╚═══════════════════════════════════════════════╝
echo.

:: Check for Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Please install Python 3.10+ from https://www.python.org
    pause
    exit /b 1
)

:: Check for Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install Node.js 18+ from https://nodejs.org
    pause
    exit /b 1
)

:: Start backend server
echo [1/2] Starting backend server on http://localhost:8000 ...
cd /d "%~dp0backend"
start /b "Backend" cmd /c ".\venv\Scripts\activate && python -m uvicorn main:app --host 0.0.0.0 --port 8000 2>&1"
cd /d "%~dp0"

:: Wait for backend to start
echo Waiting for backend to be ready...
timeout /t 3 /nobreak >nul

:: Start frontend dev server
echo [2/2] Starting frontend on http://localhost:5173 ...
cd /d "%~dp0frontend"
start /b "Frontend" cmd /c "npm run dev 2>&1"
cd /d "%~dp0"

:: Wait and open browser
timeout /t 4 /nobreak >nul
echo.
echo ✅ App is running!
echo.
echo   Frontend: http://localhost:5173
echo   Backend:  http://localhost:8000
echo   API Docs: http://localhost:8000/docs
echo.
echo Press Ctrl+C or close this window to stop both servers.
echo.
start http://localhost:5173

:: Keep window open
pause
