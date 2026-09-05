@echo off
echo Stopping Voice Changer Backend (Port 8000) and Engine (Port 18888)

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000" ^| findstr "LISTENING"') do (
    echo Killing PID %%a (Backend)
    taskkill /F /PID %%a 2>nul
)

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":18888" ^| findstr "LISTENING"') do (
    echo Killing PID %%a (Sidecar Engine)
    taskkill /F /PID %%a 2>nul
)

echo Cleanup complete.
