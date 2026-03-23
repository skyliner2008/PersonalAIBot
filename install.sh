#!/usr/bin/env bash
# ============================================================
#   PersonalAIBotV2 — One-File Standalone Installer (Linux/macOS)
#
#   Usage: Download ONLY this file, run it, done.
#     curl -fsSL https://raw.githubusercontent.com/skyliner2008/PersonalAIBotV2/main/install.sh | bash
#   Or:
#     wget -qO install.sh https://raw.githubusercontent.com/skyliner2008/PersonalAIBotV2/main/install.sh
#     chmod +x install.sh && ./install.sh
#
#   It will: Install Git/Node/Python/Build Tools → Clone repo
#            → npm install → build → generate .env → launch
# ============================================================

set -euo pipefail

REPO_URL="https://github.com/skyliner2008/PersonalAIBotV2.git"
REPO_NAME="PersonalAIBotV2"
INSTALLER_DIR="$(pwd)"
NEED_RELOGIN=0
STEP=0
TOTAL_STEPS=9

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; GRAY='\033[0;90m'
WHITE='\033[1;37m'; NC='\033[0m'

ok()   { echo -e "  ${GREEN}[OK]${NC} $1"; }
warn() { echo -e "  ${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "  ${RED}[ERROR]${NC} $1"; exit 1; }
info() { echo -e "  ${CYAN}[INFO]${NC} $1"; }
dl()   { echo -e "  ${MAGENTA}[DOWNLOAD]${NC} $1"; }

step() {
    STEP=$((STEP + 1))
    echo ""
    echo -e "${WHITE}[${STEP}/${TOTAL_STEPS}] $1${NC}"
}

# ============================================================
# Banner
# ============================================================
echo ""
echo -e "${CYAN}  ╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}  ║                                                          ║${NC}"
echo -e "${CYAN}  ║   PersonalAIBotV2 — One-Click Installer                  ║${NC}"
echo -e "${CYAN}  ║                                                          ║${NC}"
echo -e "${CYAN}  ║   This single file will:                                 ║${NC}"
echo -e "${CYAN}  ║     1. Install Git, Node.js, Python, build tools         ║${NC}"
echo -e "${CYAN}  ║     2. Download the latest project from GitHub            ║${NC}"
echo -e "${CYAN}  ║     3. Install dependencies and build everything          ║${NC}"
echo -e "${CYAN}  ║     4. Auto-generate secure configuration                 ║${NC}"
echo -e "${CYAN}  ║     5. Launch the system                                  ║${NC}"
echo -e "${CYAN}  ║                                                          ║${NC}"
echo -e "${CYAN}  ╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Detect OS & package manager
OS="unknown"
PKG=""
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
elif [ -f /etc/debian_version ]; then
    OS="debian"; PKG="sudo apt-get install -y"
elif [ -f /etc/redhat-release ] || [ -f /etc/fedora-release ]; then
    OS="redhat"; PKG="sudo dnf install -y"
elif [ -f /etc/arch-release ]; then
    OS="arch"; PKG="sudo pacman -S --noconfirm"
fi
info "Detected: $OS ($OSTYPE)"

# ============================================================
# [1/9] Git
# ============================================================
step "Checking Git..."

if command -v git &>/dev/null; then
    ok "$(git --version)"
else
    dl "Installing Git..."
    case $OS in
        macos)  xcode-select --install 2>/dev/null || true; command -v brew &>/dev/null && brew install git ;;
        debian) sudo apt-get update -qq && $PKG git ;;
        redhat) $PKG git ;;
        arch)   $PKG git ;;
        *)      err "Cannot install Git on this OS. Install manually: https://git-scm.com/" ;;
    esac
    command -v git &>/dev/null || err "Git installation failed."
    ok "$(git --version) installed"
fi

# ============================================================
# [2/9] Node.js (via nvm)
# ============================================================
step "Checking Node.js..."

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

install_nvm_node() {
    dl "Installing nvm + Node.js LTS..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    source "$NVM_DIR/nvm.sh"
    nvm install --lts
    nvm use --lts
    NEED_RELOGIN=1
}

if command -v node &>/dev/null; then
    NODE_VER=$(node -v)
    NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_MAJOR" -ge 18 ]; then
        ok "Node.js $NODE_VER"
        ok "npm $(npm -v)"
    else
        warn "Node.js $NODE_VER too old (need v18+)"
        install_nvm_node
        ok "Node.js $(node -v)"
    fi
else
    install_nvm_node
    ok "Node.js $(node -v)"
    ok "npm $(npm -v)"
fi

# ============================================================
# [3/9] Python + Build Tools
# ============================================================
step "Checking Python & build tools..."

if command -v python3 &>/dev/null; then
    ok "$(python3 --version)"
elif command -v python &>/dev/null; then
    ok "$(python --version)"
else
    dl "Installing Python..."
    case $OS in
        macos)  command -v brew &>/dev/null && brew install python3 || warn "Install Python from python.org" ;;
        debian) sudo apt-get update -qq && $PKG python3 python3-pip ;;
        redhat) $PKG python3 python3-pip ;;
        arch)   $PKG python python-pip ;;
    esac
    command -v python3 &>/dev/null && ok "$(python3 --version)" || warn "Python not installed. Native modules may fail."
fi

# Build essentials
case $OS in
    macos)
        xcode-select -p &>/dev/null && ok "Xcode CLI Tools found" || { dl "Installing Xcode CLI Tools..."; xcode-select --install 2>/dev/null || true; } ;;
    debian)
        dpkg -l build-essential &>/dev/null 2>&1 && ok "build-essential found" || { dl "Installing build-essential..."; sudo apt-get update -qq; $PKG build-essential; ok "build-essential installed"; } ;;
    redhat)
        rpm -q gcc-c++ &>/dev/null && ok "C++ compiler found" || { dl "Installing dev tools..."; sudo dnf groupinstall -y "Development Tools" 2>/dev/null || $PKG gcc-c++ make; ok "Build tools installed"; } ;;
    arch)
        $PKG base-devel 2>/dev/null || true; ok "base-devel available" ;;
esac

# ============================================================
# [4/9] Download Project from GitHub
# ============================================================
step "Downloading latest project from GitHub..."

PROJECT_DIR="$INSTALLER_DIR/$REPO_NAME"

# Case 1: Running from inside project directory
if [ -f "server/package.json" ]; then
    PROJECT_DIR="$(pwd)"
    info "Running from within project folder. Checking for updates..."
    git pull --ff-only 2>/dev/null && ok "System is up to date" || warn "Git pull skipped (detached HEAD or local changes)."
# Case 2: Subfolder exists — pull latest
elif [ -f "$PROJECT_DIR/server/package.json" ]; then
    info "Project folder exists. Pulling latest..."
    cd "$PROJECT_DIR"
    git pull --ff-only 2>/dev/null && ok "Updated to latest" || warn "Git pull failed. Continuing with existing files."
# Case 3: Fresh clone
else
    dl "Cloning $REPO_URL ..."
    cd "$INSTALLER_DIR"
    git clone "$REPO_URL" "$REPO_NAME" || err "Failed to clone. Check your internet connection."
    cd "$PROJECT_DIR"
    ok "Project downloaded"
fi

cd "$PROJECT_DIR"

# ============================================================
# [5/9] Generate Secure .env
# ============================================================
step "Configuring environment..."

if [ -f "server/.env" ]; then
    ok "server/.env exists"
    # Patch missing keys
    node -e "
    const crypto=require('crypto'),fs=require('fs'),p='server/.env';
    let c=fs.readFileSync(p,'utf-8');
    const keys={ENCRYPTION_KEY:64,JWT_SECRET:64,CRED_SECRET:64,SOCKET_AUTH_TOKEN:64};
    let changed=false;
    for(const[k,len]of Object.entries(keys)){
        const re=new RegExp('^'+k+'\\s*=\\s*(.*)$','m');
        const m=c.match(re);
        if(!m||m[1].length<16||m[1].includes('change-me')||m[1].includes('your-')){
            const v=crypto.randomBytes(len/2).toString('hex');
            if(m){c=c.replace(re,k+'='+v)}else{c+='\n'+k+'='+v}
            changed=true;console.log('  [PATCHED] '+k)
        }
    }
    if(changed)fs.writeFileSync(p,c,'utf-8');
    else console.log('  [OK] All security keys present')
    "
else
    info "Creating server/.env with secure keys..."
    node -e "
    const crypto=require('crypto');
    const g=()=>crypto.randomBytes(32).toString('hex');
    const env=[
        '# PersonalAIBotV2 Server Configuration',
        '# Auto-generated by install.sh on '+new Date().toISOString().split('T')[0],
        '','PORT=3000','NODE_ENV=development','LOG_LEVEL=info','HTTP_CONSOLE_MODE=errors',
        '','ENCRYPTION_KEY='+g(),'JWT_SECRET='+g(),'CRED_SECRET='+g(),'SOCKET_AUTH_TOKEN='+g(),
        '','HEADLESS=true','SLOW_MO=0',
        '','# API keys and bot tokens: configure via Dashboard at http://localhost:3000'
    ].join('\n');
    require('fs').writeFileSync('server/.env',env);
    console.log('  [CREATED] server/.env with secure keys')
    "
fi

[ ! -f "dashboard/.env" ] && [ -f "dashboard/.env.example" ] && cp dashboard/.env.example dashboard/.env && ok "dashboard/.env created"

# ============================================================
# [6/9] Install Server Dependencies
# ============================================================
step "Installing server dependencies..."
cd server

npm install 2>&1 || {
    warn "Retrying with --legacy-peer-deps..."
    npm install --legacy-peer-deps 2>&1 || err "Server npm install failed! Check that build-essential/python3 are installed."
}
ok "Server dependencies installed"

# Rebuild native modules (better-sqlite3, node-pty) for current Node.js version
info "Rebuilding native modules for Node.js $(node -v)..."
npm rebuild 2>&1 && ok "Native modules rebuilt" || warn "npm rebuild had warnings"

info "Installing Playwright browser..."
npx playwright install chromium --with-deps >/dev/null 2>&1 && ok "Playwright ready" || warn "Playwright had issues"

# ============================================================
# [7/9] Build Server
# ============================================================
step "Building server..."
npm run build 2>&1 || err "Server build failed (TypeScript error)."
ok "Server built"

# ============================================================
# [8/9] Install & Build Dashboard
# ============================================================
step "Installing & building dashboard..."
cd ../dashboard

npm install 2>&1 || err "Dashboard npm install failed!"
ok "Dashboard dependencies installed"

npm run build 2>&1 || err "Dashboard build failed!"
ok "Dashboard built"

# ============================================================
# [9/9] Initialize Data Folders
# ============================================================
step "Initializing data folders..."
cd ../server
npm run init-folders 2>/dev/null || { mkdir -p ../data ../uploads 2>/dev/null; }
ok "Ready"
cd ..

# ============================================================
# DONE!
# ============================================================
echo ""
echo -e "${GREEN}  ╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}  ║                                                          ║${NC}"
echo -e "${GREEN}  ║          INSTALLATION COMPLETE!                          ║${NC}"
echo -e "${GREEN}  ║                                                          ║${NC}"
echo -e "${GREEN}  ╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${WHITE}How to use:${NC}"
echo -e "  ${CYAN}1.${NC} cd $PROJECT_DIR && ${WHITE}npm run dev${NC} (in server/)"
echo -e "  ${CYAN}2.${NC} Open ${WHITE}http://localhost:3000${NC} in your browser"
echo -e "  ${CYAN}3.${NC} Go to ${WHITE}Dashboard Settings${NC} to add API keys"
echo -e "  ${GRAY}   (Gemini, OpenAI, etc. — all via Dashboard, not .env)${NC}"
echo ""

if [ "$NEED_RELOGIN" -eq 1 ]; then
    echo -e "  ${YELLOW}[!] nvm was freshly installed.${NC}"
    echo -e "  ${YELLOW}    If 'node' is not found later, run: ${WHITE}source ~/.bashrc${NC}"
    echo ""
fi

echo -e "  ${GRAY}Security keys auto-generated in server/.env${NC}"
echo -e "  ${GRAY}Project location: $PROJECT_DIR${NC}"
echo ""

read -p "  Launch the system now? (Y/n): " LAUNCH
if [[ "${LAUNCH:-Y}" != "n" && "${LAUNCH:-Y}" != "N" ]]; then
    echo ""
    echo -e "  ${GREEN}Starting PersonalAIBotV2...${NC}"
    echo ""
    cd "$PROJECT_DIR/server"
    npm run dev
fi
