@echo off
echo ============================================
echo    Arena Royale Server Launcher
echo ============================================
echo.

cd /d "%~dp0"

REM Check if virtual environment exists
if not exist "venv\Scripts\activate.bat" (
    echo Virtual environment not found!
    echo Creating virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo Failed to create virtual environment.
        pause
        exit /b 1
    )
)

REM Activate virtual environment
echo Activating virtual environment...
call venv\Scripts\activate.bat

REM Install/update requirements
echo Checking dependencies...
pip install -r requirements.txt flask --quiet

REM Start the server
echo.
echo Starting server...
echo.
python server.py

REM Keep window open if server crashes
pause
