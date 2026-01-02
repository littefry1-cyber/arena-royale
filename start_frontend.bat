@echo off
echo ============================================
echo    Arena Royale Frontend Launcher
echo ============================================
echo.

cd /d "%~dp0"

REM Check if virtual environment exists
if not exist ".venv\Scripts\activate.bat" (
    echo Virtual environment not found!
    echo Please run start_server.bat first to set up the environment.
    pause
    exit /b 1
)

REM Activate virtual environment
call .venv\Scripts\activate.bat

REM Start the frontend server
python frontend_server.py

REM Keep window open if server crashes
pause
