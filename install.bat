@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>nul

:: ============================================================
::   PersonalAIBotV2 — One-File Standalone Installer (Windows)
::
::   Usage: Download ONLY this file, double-click, done.
::   It will: Install Git/Node/Python/Build Tools → Clone repo
::            → npm install → build → generate .env → launch
::
::   Target: Fresh Windows 10/11 with NOTHING pre-installed.
:: ============================================================

set "REPO_URL=https://github.com/skyliner2008/PersonalAIBotV2.git"
set "REPO_NAME=PersonalAIBotV2"
set "INSTALLER_DIR=%~dp0"
set "NEED_RESTART=0"
set "STEP=0"
set "TOTAL_STEPS=9"

:: Color helpers
set "PS_OK=Write-Host '  [OK]' -ForegroundColor Green -NoNewline; Write-Host"
set "PS_WARN=Write-Host '  [WARN]' -ForegroundColor Yellow -NoNewline; Write-Host"
set "PS_ERR=Write-Host '  [ERROR]' -ForegroundColor Red -NoNewline; Write-Host"
set "PS_INFO=Write-Host '  [INFO]' -ForegroundColor Cyan -NoNewline; Write-Host"
set "PS_DL=Write-Host '  [DOWNLOAD]' -ForegroundColor Magenta -NoNewline; Write-Host"

:: ============================================================
:: Banner
:: ============================================================
echo.
powershell -NoProfile -Command "Write-Host '  ╔══════════════════════════════════════════════════════════╗' -ForegroundColor Cyan"
powershell -NoProfile -Command "Write-Host '  ║                                                          ║' -ForegroundColor Cyan"
powershell -NoProfile -Command "Write-Host '  ║   PersonalAIBotV2 — One-Click Installer                  ║' -ForegroundColor Cyan"
powershell -NoProfile -Command "Write-Host '  ║                                                          ║' -ForegroundColor Cyan"
powershell -NoProfile -Command "Write-Host '  ║   This single file will:                                 ║' -ForegroundColor Cyan"
powershell -NoProfile -Command "Write-Host '  ║     1. Install Git, Node.js, Python, C++ Build Tools     ║' -ForegroundColor Cyan"
powershell -NoProfile -Command "Write-Host '  ║     2. Download the latest project from GitHub            ║' -ForegroundColor Cyan"
powershell -NoProfile -Command "Write-Host '  ║     3. Install dependencies and build everything          ║' -ForegroundColor Cyan"
powershell -NoProfile -Command "Write-Host '  ║     4. Auto-generate secure configuration                 ║' -ForegroundColor Cyan"
powershell -NoProfile -Command "Write-Host '  ║     5. Launch the system                                  ║' -ForegroundColor Cyan"
powershell -NoProfile -Command "Write-Host '  ║                                                          ║' -ForegroundColor Cyan"
powershell -NoProfile -Command "Write-Host '  ╚══════════════════════════════════════════════════════════╝' -ForegroundColor Cyan"
echo.

:: ============================================================
:: Request Admin privileges (needed for software installers)
:: ============================================================
net session >nul 2>nul
if !errorlevel! neq 0 (
    powershell -NoProfile -Command "Write-Host '  Requesting Administrator privileges...' -ForegroundColor Yellow"
    powershell -NoProfile -Command "Start-Process cmd -ArgumentList '/c cd /d \"%INSTALLER_DIR%\" && \"%~f0\"' -Verb RunAs"
    exit /b 0
)

:: ============================================================
:: [1/9] Check & Install Git
:: ============================================================
set /a STEP+=1
echo.
powershell -NoProfile -Command "Write-Host '[!STEP!/!TOTAL_STEPS!] Checking Git...' -ForegroundColor White"

where git >nul 2>nul
if !errorlevel! neq 0 (
    powershell -NoProfile -Command "%PS_DL% ' Git not found. Installing...'"

    :: Try winget first (cleanest)
    where winget >nul 2>nul
    if !errorlevel! equ 0 (
        powershell -NoProfile -Command "%PS_INFO% ' Using winget to install Git...'"
        winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements >nul 2>nul
    )

    :: Check if winget succeeded
    set "PATH=!PATH!;C:\Program Files\Git\cmd"
    where git >nul 2>nul
    if !errorlevel! neq 0 (
        :: Fallback: direct download
        powershell -NoProfile -Command "%PS_INFO% ' Downloading Git installer...'"
        powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.2/Git-2.47.1.2-64-bit.exe' -OutFile '%TEMP%\git-install.exe' -UseBasicParsing"
        if exist "%TEMP%\git-install.exe" (
            powershell -NoProfile -Command "%PS_INFO% ' Installing Git silently...'"
            "%TEMP%\git-install.exe" /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /COMPONENTS="icons,ext\reg\shellhere,assoc,assoc_sh"
            del "%TEMP%\git-install.exe" 2>nul
            set "PATH=!PATH!;C:\Program Files\Git\cmd"
        )
    )

    where git >nul 2>nul
    if !errorlevel! neq 0 (
        powershell -NoProfile -Command "%PS_ERR% ' Git installation failed. Please install from https://git-scm.com/ then re-run.'"
        pause
        exit /b 1
    )
    set "NEED_RESTART=1"
)
for /f "tokens=*" %%v in ('git --version 2^>nul') do set "GIT_VER=%%v"
powershell -NoProfile -Command "%PS_OK% ' !GIT_VER!'"

:: ============================================================
:: [2/9] Check & Install Node.js LTS
:: ============================================================
set /a STEP+=1
echo.
powershell -NoProfile -Command "Write-Host '[!STEP!/!TOTAL_STEPS!] Checking Node.js...' -ForegroundColor White"

where node >nul 2>nul
if !errorlevel! neq 0 (
    powershell -NoProfile -Command "%PS_DL% ' Node.js not found. Installing LTS...'"

    where winget >nul 2>nul
    if !errorlevel! equ 0 (
        winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements >nul 2>nul
    )

    set "PATH=!PATH!;C:\Program Files\nodejs"
    where node >nul 2>nul
    if !errorlevel! neq 0 (
        :: Fallback: download MSI
        powershell -NoProfile -Command "%PS_INFO% ' Downloading Node.js installer...'"
        powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi' -OutFile '%TEMP%\node-install.msi' -UseBasicParsing"
        if exist "%TEMP%\node-install.msi" (
            powershell -NoProfile -Command "%PS_INFO% ' Installing Node.js silently...'"
            msiexec /i "%TEMP%\node-install.msi" /qn /norestart
            del "%TEMP%\node-install.msi" 2>nul
            set "PATH=!PATH!;C:\Program Files\nodejs"
        )
    )

    where node >nul 2>nul
    if !errorlevel! neq 0 (
        powershell -NoProfile -Command "%PS_ERR% ' Node.js installation failed. Please install from https://nodejs.org/ then re-run.'"
        pause
        exit /b 1
    )
    set "NEED_RESTART=1"
)

for /f "tokens=*" %%v in ('node -v') do set "NODE_VER=%%v"
:: Validate version >= 18
for /f "tokens=1 delims=v." %%a in ("!NODE_VER!") do set "NODE_MAJOR=%%a"
if !NODE_MAJOR! LSS 18 (
    powershell -NoProfile -Command "%PS_ERR% ' Node.js v18+ required, found !NODE_VER!. Please update from https://nodejs.org/'"
    pause
    exit /b 1
)
powershell -NoProfile -Command "%PS_OK% ' Node.js !NODE_VER!'"
for /f "tokens=*" %%v in ('npm -v 2^>nul') do set "NPM_VER=%%v"
powershell -NoProfile -Command "%PS_OK% ' npm !NPM_VER!'"

:: ============================================================
:: [3/9] Check & Install Python + C++ Build Tools
:: ============================================================
set /a STEP+=1
echo.
powershell -NoProfile -Command "Write-Host '[!STEP!/!TOTAL_STEPS!] Checking Python ^& C++ Build Tools...' -ForegroundColor White"

:: Python — check it actually works (Windows has a fake 'python' alias that opens MS Store)
set "PYTHON_OK=0"
where python >nul 2>nul
if !errorlevel! equ 0 (
    for /f "tokens=*" %%v in ('python --version 2^>^&1') do set "PY_VER=%%v"
    echo !PY_VER! | findstr /i "Python 3\." >nul 2>nul
    if !errorlevel! equ 0 (
        set "PYTHON_OK=1"
        powershell -NoProfile -Command "%PS_OK% ' !PY_VER!'"
    )
)
if !PYTHON_OK! equ 0 (
    powershell -NoProfile -Command "%PS_DL% ' Python not found. Installing...'"
    where winget >nul 2>nul
    if !errorlevel! equ 0 (
        winget install --id Python.Python.3.12 -e --source winget --accept-package-agreements --accept-source-agreements >nul 2>nul
        set "PATH=!PATH!;%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts"
        set "NEED_RESTART=1"
    )
    where python >nul 2>nul
    if !errorlevel! equ 0 (
        powershell -NoProfile -Command "%PS_OK% ' Python installed'"
    ) else (
        powershell -NoProfile -Command "%PS_WARN% ' Could not auto-install Python. Native modules may fail.'"
        powershell -NoProfile -Command "%PS_INFO% ' Install from: https://python.org'"
    )
)

:: C++ Build Tools (for better-sqlite3, node-pty)
set "HAS_BUILD_TOOLS=0"
where cl >nul 2>nul && set "HAS_BUILD_TOOLS=1"
if !HAS_BUILD_TOOLS! equ 0 (
    if exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC" set "HAS_BUILD_TOOLS=1"
    if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC" set "HAS_BUILD_TOOLS=1"
)

if !HAS_BUILD_TOOLS! equ 0 (
    powershell -NoProfile -Command "%PS_DL% ' C++ Build Tools not found. Installing (this may take 5-10 min)...'"
    where winget >nul 2>nul
    if !errorlevel! equ 0 (
        winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" --accept-package-agreements --accept-source-agreements >nul 2>nul
    ) else (
        powershell -NoProfile -Command "%PS_INFO% ' Downloading VS Build Tools installer...'"
        powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://aka.ms/vs/17/release/vs_buildtools.exe' -OutFile '%TEMP%\vs_buildtools.exe' -UseBasicParsing"
        if exist "%TEMP%\vs_buildtools.exe" (
            "%TEMP%\vs_buildtools.exe" --wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended
            del "%TEMP%\vs_buildtools.exe" 2>nul
        )
    )
    set "NEED_RESTART=1"
    powershell -NoProfile -Command "%PS_OK% ' Build Tools installation initiated'"
) else (
    powershell -NoProfile -Command "%PS_OK% ' C++ Build Tools found'"
)

:: ============================================================
:: [4/9] Download Project from GitHub
:: ============================================================
set /a STEP+=1
echo.
powershell -NoProfile -Command "Write-Host '[!STEP!/!TOTAL_STEPS!] Downloading latest project from GitHub...' -ForegroundColor White"

:: Determine install location: same folder as this script
set "PROJECT_DIR=%INSTALLER_DIR%%REPO_NAME%"

:: Case 1: Already inside the project directory (install.bat is in the repo root)
if exist "%INSTALLER_DIR%server\package.json" (
    set "PROJECT_DIR=%INSTALLER_DIR%"
    powershell -NoProfile -Command "%PS_INFO% ' Running from within project folder. Checking for updates...'"
    cd /d "!PROJECT_DIR!"
    call git pull --ff-only 2>nul
    if !errorlevel! equ 0 (
        powershell -NoProfile -Command "%PS_OK% ' System is up to date'"
    ) else (
        powershell -NoProfile -Command "%PS_WARN% ' Git pull skipped (detached HEAD or local changes).'"
    )
    goto :project_ready
)

:: Case 2: Project subfolder exists — pull latest
if exist "!PROJECT_DIR!\server\package.json" (
    powershell -NoProfile -Command "%PS_INFO% ' Project folder exists. Pulling latest changes...'"
    cd /d "!PROJECT_DIR!"
    call git pull --ff-only 2>nul
    if !errorlevel! equ 0 (
        powershell -NoProfile -Command "%PS_OK% ' Updated to latest version'"
    ) else (
        powershell -NoProfile -Command "%PS_WARN% ' Git pull failed (local changes?). Continuing with existing files.'"
    )
    goto :project_ready
)

:: Case 3: Fresh clone
powershell -NoProfile -Command "%PS_DL% ' Cloning %REPO_URL% ...'"
cd /d "%INSTALLER_DIR%"
call git clone "%REPO_URL%" "%REPO_NAME%"
if !errorlevel! neq 0 (
    powershell -NoProfile -Command "%PS_ERR% ' Failed to clone repository from GitHub.'"
    powershell -NoProfile -Command "%PS_INFO% ' Check your internet connection and try again.'"
    pause
    exit /b 1
)
cd /d "!PROJECT_DIR!"
powershell -NoProfile -Command "%PS_OK% ' Project downloaded successfully'"

:project_ready

:: ============================================================
:: [5/9] Generate Secure Environment Configuration
:: ============================================================
set /a STEP+=1
echo.
powershell -NoProfile -Command "Write-Host '[!STEP!/!TOTAL_STEPS!] Configuring environment...' -ForegroundColor White"

if exist "server\.env" (
    powershell -NoProfile -Command "%PS_OK% ' server\.env exists (keeping existing config)'"

    :: Patch missing/placeholder security keys
    :: We use a whitelist of keys to ensure they are present and secure.
    :: SOCKET_AUTH_TOKEN is now included.
    node -e "const crypto=require('crypto'),fs=require('fs'),p='server/.env';let c=fs.readFileSync(p,'utf-8');const keys={ENCRYPTION_KEY:64,JWT_SECRET:64,CRED_SECRET:64,SOCKET_AUTH_TOKEN:64};let changed=false;for(const[k,len]of Object.entries(keys)){const re=new RegExp('^'+k+'\\s*=\\s*(.*)$','m');const m=c.match(re);if(!m||m[1].length<16||m[1].includes('change-me')||m[1].includes('your-')){const v=crypto.randomBytes(len/2).toString('hex');if(m){c=c.replace(re,k+'='+v)}else{c+='\n'+k+'='+v}changed=true;console.log('  [PATCHED] '+k)}}if(changed)fs.writeFileSync(p,c,'utf-8');else console.log('  [OK] All security keys present')"
) else (
    powershell -NoProfile -Command "%PS_INFO% ' Creating server\.env with auto-generated secure keys...'"
    node -e "const crypto=require('crypto');const g=()=>crypto.randomBytes(32).toString('hex');const env=['# PersonalAIBotV2 Server Configuration','# Auto-generated by install.bat on '+new Date().toISOString().split('T')[0],'','PORT=3000','NODE_ENV=development','LOG_LEVEL=info','HTTP_CONSOLE_MODE=errors','','# Security Keys (auto-generated)','ENCRYPTION_KEY='+g(),'JWT_SECRET='+g(),'CRED_SECRET='+g(),'SOCKET_AUTH_TOKEN='+g(),'','HEADLESS=false','SLOW_MO=0','','# API keys and bot tokens are stored in the database.','# Configure them via Dashboard after launch: http://localhost:3000'].join('\n');require('fs').writeFileSync('server/.env',env);console.log('  [CREATED] server\.env with secure keys')"
)

:: Dashboard .env
if not exist "dashboard\.env" (
    if exist "dashboard\.env.example" (
        copy "dashboard\.env.example" "dashboard\.env" >nul 2>nul
        powershell -NoProfile -Command "%PS_OK% ' dashboard\.env created'"
    )
)

:: ============================================================
:: [6/9] Install Server Dependencies
:: ============================================================
set /a STEP+=1
echo.
powershell -NoProfile -Command "Write-Host '[!STEP!/!TOTAL_STEPS!] Installing server dependencies...' -ForegroundColor White"
cd server

call npm install 2>&1
if !errorlevel! neq 0 (
    powershell -NoProfile -Command "%PS_WARN% ' First attempt failed. Retrying with --legacy-peer-deps...'"
    call npm install --legacy-peer-deps 2>&1
    if !errorlevel! neq 0 (
        powershell -NoProfile -Command "%PS_ERR% ' Server npm install failed!'"
        powershell -NoProfile -Command "%PS_INFO% ' Common fix: Close this window, install Visual Studio Build Tools, then re-run.'"
        pause
        exit /b 1
    )
)
powershell -NoProfile -Command "%PS_OK% ' Server dependencies installed'"

:: Rebuild native modules (better-sqlite3, node-pty) for current Node.js version
powershell -NoProfile -Command "%PS_INFO% ' Rebuilding native modules for Node.js !NODE_VER!...'"
call npm rebuild 2>&1
if !errorlevel! equ 0 (
    powershell -NoProfile -Command "%PS_OK% ' Native modules rebuilt'"
) else (
    powershell -NoProfile -Command "%PS_WARN% ' npm rebuild had warnings (may still work)'"
)

:: Playwright Chromium
powershell -NoProfile -Command "%PS_INFO% ' Installing Playwright browser...'"
call npx playwright install chromium --with-deps >nul 2>&1
if !errorlevel! equ 0 (
    powershell -NoProfile -Command "%PS_OK% ' Playwright Chromium ready'"
) else (
    powershell -NoProfile -Command "%PS_WARN% ' Playwright had issues. Web automation tools may not work.'"
)

:: ============================================================
:: [7/9] Build Server (TypeScript)
:: ============================================================
set /a STEP+=1
echo.
powershell -NoProfile -Command "Write-Host '[!STEP!/!TOTAL_STEPS!] Building server...' -ForegroundColor White"

call npm run build 2>&1
if !errorlevel! neq 0 (
    powershell -NoProfile -Command "%PS_ERR% ' Server build failed (TypeScript error).'"
    pause
    exit /b 1
)
powershell -NoProfile -Command "%PS_OK% ' Server built'"

:: ============================================================
:: [8/9] Install & Build Dashboard
:: ============================================================
set /a STEP+=1
echo.
powershell -NoProfile -Command "Write-Host '[!STEP!/!TOTAL_STEPS!] Installing ^& building dashboard...' -ForegroundColor White"
cd ..\dashboard

call npm install 2>&1
if !errorlevel! neq 0 (
    powershell -NoProfile -Command "%PS_ERR% ' Dashboard npm install failed!'"
    pause
    exit /b 1
)

call npm run build 2>&1
if !errorlevel! neq 0 (
    powershell -NoProfile -Command "%PS_ERR% ' Dashboard build failed!'"
    pause
    exit /b 1
)
powershell -NoProfile -Command "%PS_OK% ' Dashboard built'"

:: ============================================================
:: [9/9] Initialize Data Folders
:: ============================================================
set /a STEP+=1
echo.
powershell -NoProfile -Command "Write-Host '[!STEP!/!TOTAL_STEPS!] Initializing data folders...' -ForegroundColor White"
cd ..\server

call npm run init-folders 2>nul
if !errorlevel! neq 0 (
    if not exist "..\data" mkdir "..\data"
    if not exist "..\uploads" mkdir "..\uploads"
)
powershell -NoProfile -Command "%PS_OK% ' Ready'"
cd ..

:: ============================================================
:: DONE!
:: ============================================================
echo.
powershell -NoProfile -Command "Write-Host '' "
powershell -NoProfile -Command "Write-Host '  ╔══════════════════════════════════════════════════════════╗' -ForegroundColor Green"
powershell -NoProfile -Command "Write-Host '  ║                                                          ║' -ForegroundColor Green"
powershell -NoProfile -Command "Write-Host '  ║          INSTALLATION COMPLETE!                          ║' -ForegroundColor Green"
powershell -NoProfile -Command "Write-Host '  ║                                                          ║' -ForegroundColor Green"
powershell -NoProfile -Command "Write-Host '  ╚══════════════════════════════════════════════════════════╝' -ForegroundColor Green"
echo.
powershell -NoProfile -Command "Write-Host '  How to use:' -ForegroundColor White"
powershell -NoProfile -Command "Write-Host '  1. Run start.bat in the %REPO_NAME% folder' -ForegroundColor Cyan"
powershell -NoProfile -Command "Write-Host '  2. Open http://localhost:3000 in your browser' -ForegroundColor Cyan"
powershell -NoProfile -Command "Write-Host '  3. Go to Dashboard Settings to add your API keys' -ForegroundColor Cyan"
powershell -NoProfile -Command "Write-Host '     (Gemini, OpenAI, etc. — all via Dashboard, not .env)' -ForegroundColor Gray"
echo.

if !NEED_RESTART! equ 1 (
    powershell -NoProfile -Command "Write-Host '  [!] Some tools were freshly installed.' -ForegroundColor Yellow"
    powershell -NoProfile -Command "Write-Host '      If you see errors, close ALL terminals and' -ForegroundColor Yellow"
    powershell -NoProfile -Command "Write-Host '      open a NEW one before running start.bat' -ForegroundColor Yellow"
    echo.
)

powershell -NoProfile -Command "Write-Host '  Security keys have been auto-generated in server\.env' -ForegroundColor Gray"
powershell -NoProfile -Command "Write-Host '  Project location: !PROJECT_DIR!' -ForegroundColor Gray"
echo.

set /p "LAUNCH=  Launch the system now? (Y/n): "
if /I "!LAUNCH!" neq "n" (
    echo.
    powershell -NoProfile -Command "Write-Host '  Starting PersonalAIBotV2...' -ForegroundColor Green"
    echo.
    if exist "start.bat" (
        call start.bat
    ) else (
        cd server
        call npm run dev
    )
)

endlocal
