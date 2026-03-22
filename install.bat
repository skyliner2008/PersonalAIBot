@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ==========================================================
echo   PersonalAIBotV2 - Complete System Setup ^& Diagnostis
echo   Checking prerequisites and bootstrapping environment...
echo ==========================================================
echo.

:: ==========================================
:: [0/8] Auto-Download / Repository Check
:: ==========================================
echo [0/8] Checking for project files...

if exist "server\package.json" (
    echo   [OK] Project files found in current directory.
) else (
    echo   [WARN] Project files NOT found!
    echo   [INFO] Attempting to download PersonalAIBotV2 from GitHub...
    
    where git >nul 2>nul
    if !errorlevel! neq 0 (
        echo   [ERROR] Git is NOT installed.
        echo   Git is REQUIRED to download the project automatically.
        echo   Download Git from: https://git-scm.com/
        pause
        exit /b 1
    )
    
    if exist "PersonalAIBotV2\server\package.json" (
        echo   [INFO] Found existing PersonalAIBotV2 folder. Switching into it...
        cd PersonalAIBotV2
    ) else (
        echo   Cloning repository...
        call git clone https://github.com/skyliner2008/PersonalAIBotV2.git
        if !errorlevel! neq 0 (
            echo   [ERROR] Failed to download repository from GitHub.
            pause
            exit /b 1
        )
        cd PersonalAIBotV2
    )
    echo   [OK] Switched to project directory.
)

:: ==========================================
:: [1/8] System Prerequisites Check
:: ==========================================
echo.
echo [1/8] Checking system prerequisites...

:: Node.js Check
where node >nul 2>nul
if !errorlevel! neq 0 (
    echo   [ERROR] Node.js is NOT installed.
    echo   This project requires Node.js v18 or newer.
    echo   Please download and install it from: https://nodejs.org/
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo   [OK] Node.js !NODE_VER! found.

:: NPM Check
where npm >nul 2>nul
if !errorlevel! neq 0 (
    echo   [ERROR] npm is NOT installed.
    pause
    exit /b 1
)
echo   [OK] npm found.

:: Git Check
where git >nul 2>nul
if !errorlevel! neq 0 (
    echo   [WARN] Git is NOT installed.
    echo   You won't be able to easily pull future updates.
    echo   Download Git from: https://git-scm.com/
) else (
    echo   [OK] Git found.
)

:: Python Check (Required for native node-gyp builds like sqlite3, node-pty)
where python >nul 2>nul
if !errorlevel! neq 0 (
    echo   [WARN] Python is NOT installed!
    echo   Python is REQUIRED to build native C++ modules ^(like SQLite3 and node-pty^).
    echo   If npm install fails in the next steps, please install Python from the Microsoft Store or python.org
    echo.
) else (
    for /f "tokens=*" %%v in ('python --version 2^>^&1') do set PY_VER=%%v
    echo   [OK] !PY_VER! found.
)

:: ==========================================
:: [2/8] Environment Setup (.env files)
:: ==========================================
echo.
echo [2/8] Configuring Environment variables...

if exist "server\.env" (
    echo   [OK] server\.env already exists.
) else (
    if exist "server\.env.example" (
        copy "server\.env.example" "server\.env" >nul
        echo   [CREATED] server\.env ^(copied from .env.example^).
        echo   [!] MAKE SURE to edit server\.env and add your API keys later!
    ) else (
        echo   [WARN] server\.env.example not found! Skipping...
    )
)

if exist "dashboard\.env" (
    echo   [OK] dashboard\.env already exists.
) else (
    if exist "dashboard\.env.example" (
        copy "dashboard\.env.example" "dashboard\.env" >nul
        echo   [CREATED] dashboard\.env ^(copied from .env.example^).
    )
)

:: ==========================================
:: [3/8] Install Server Dependencies
:: ==========================================
echo.
echo [3/8] Installing Server Dependencies...
cd server

echo   Running npm install...
call npm install
if !errorlevel! neq 0 (
    echo   [ERROR] npm install failed in server!
    echo   Tip: If "node-gyp" or "sqlite3" failed to build, you might need C++ build tools.
    echo   Run: npm install --global windows-build-tools 
    echo   Or install Visual Studio Community with "Desktop development with C++"
    pause
    exit /b 1
)
echo   [OK] Server dependencies installed.

:: Install Playwright Chromium for Limitless web tools
echo   Installing Playwright Chromium...
call npx playwright install chromium --with-deps
if !errorlevel! neq 0 (
    echo   [WARN] Playwright browser installation encountered issues. Web tools may fail.
)

:: ==========================================
:: [4/8] Build Server (TypeScript Compile Check)
:: ==========================================
echo.
echo [4/8] Building Server (Validating Syntax)...
echo   Running npm run build...
call npm run build
if !errorlevel! neq 0 (
    echo   [ERROR] Server build failed! There is a TypeScript compilation error.
    pause
    exit /b 1
)
echo   [OK] Server built successfully.

:: ==========================================
:: [5/8] Install Dashboard Dependencies
:: ==========================================
echo.
echo [5/8] Installing Dashboard Dependencies...
cd ../dashboard

echo   Running npm install...
call npm install
if !errorlevel! neq 0 (
    echo   [ERROR] npm install failed in dashboard!
    pause
    exit /b 1
)
echo   [OK] Dashboard dependencies installed.

:: ==========================================
:: [6/8] Build Dashboard
:: ==========================================
echo.
echo [6/8] Building Dashboard (React/Vite compiled)...
echo   Running npm run build...
call npm run build
if !errorlevel! neq 0 (
    echo   [ERROR] Dashboard build failed!
    pause
    exit /b 1
)
echo   [OK] Dashboard built successfully.

:: ==========================================
:: [7/8] Initialize Data Folders
:: ==========================================
echo.
echo [7/8] Initializing system folders...
cd ../server
call npm run init-folders
if !errorlevel! neq 0 (
    echo   [ERROR] Folder initialization failed!
    pause
    exit /b 1
)
echo   [OK] System folders initialized.
cd ..

:: ==========================================
:: Setup Complete
:: ==========================================
echo.
echo ==========================================================
echo   INSTALLATION COMPLETE!
echo   PersonalAIBotV2 is fully configured and ready to run.
echo ==========================================================
echo.
echo Next Steps:
echo 1. Open 'server/.env' in a text editor and add your API Keys (e.g. GEMINI_API_KEY).
echo 2. Double-click 'start_unified.bat' to launch the System!
echo 3. Open http://localhost:5173 to view the Control Dashboard.
echo.
pause
