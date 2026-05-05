#!/usr/bin/env bash
# AI Bot - One-Click Start (Linux/macOS)

cd "$(dirname "$0")"

START_MODE="compact"
DOCTOR_MODE=0

for arg in "$@"; do
  if [[ "$arg" == "--verbose" ]]; then
    START_MODE="verbose"
  elif [[ "$arg" == "--doctor" ]]; then
    DOCTOR_MODE=1
  fi
done

BUILD_LOG="/tmp/aibot-dashboard-build.log"

echo ""
echo "+------------------------------------------------------+"
echo "| AI Bot - One-Click Start                             |"
if [[ "$START_MODE" == "compact" ]]; then
  echo "| Mode: Compact (clean output)                         |"
else
  echo "| Mode: Verbose (full logs)                            |"
fi
echo "| Server + Dashboard (port 3000)                       |"
echo "+------------------------------------------------------+"
echo ""

if [[ "$START_MODE" == "compact" ]]; then
  export STARTUP_COMPACT=1
  export LOG_LEVEL="warn"
  export HTTP_CONSOLE_MODE="errors"
  export NO_COLOR=1
else
  export STARTUP_COMPACT=0
  if [[ -z "${LOG_LEVEL:-}" ]]; then
    export LOG_LEVEL="info"
  fi
fi

echo "[0/4] Running startup doctor checks..."
PREFLIGHT_FAIL=0

if command -v node >/dev/null 2>&1; then
  NODE_VERSION=$(node -v)
  echo "  [OK] Node $NODE_VERSION"
else
  echo "  [ERROR] Node.js not found in PATH"
  PREFLIGHT_FAIL=1
fi

if command -v npm >/dev/null 2>&1; then
  NPM_VERSION=$(npm -v)
  echo "  [OK] npm $NPM_VERSION"
else
  echo "  [ERROR] npm not found in PATH"
  PREFLIGHT_FAIL=1
fi

if [[ ! -f "server/package.json" ]]; then
  echo "  [ERROR] Missing server/package.json"
  PREFLIGHT_FAIL=1
fi
if [[ ! -f "dashboard/package.json" ]]; then
  echo "  [ERROR] Missing dashboard/package.json"
  PREFLIGHT_FAIL=1
fi

if [[ -f "server/.env" ]]; then
  echo "  [OK] server/.env found"
else
  echo "  [WARN] server/.env not found (copy from server/.env.example)"
fi

if [[ $PREFLIGHT_FAIL -ne 0 ]]; then
  echo "  [FATAL] Startup doctor found blocking issues"
  read -p "Press Enter to exit..."
  exit 1
fi

# Check port 3000
if command -v lsof >/dev/null 2>&1; then
  PORT_PID=$(lsof -t -i:3000 -sTCP:LISTEN 2>/dev/null | head -n 1)
elif command -v netstat >/dev/null 2>&1; then
  PORT_PID=$(netstat -nlp 2>/dev/null | grep ':3000 ' | awk '{print $7}' | cut -d'/' -f1 | head -n 1)
else
  PORT_PID=""
fi

if [[ -n "$PORT_PID" ]]; then
  PORT_PROC=$(ps -p "$PORT_PID" -o comm= 2>/dev/null || echo "unknown")
  echo "[INFO] Server already running on port 3000 (PID $PORT_PID $PORT_PROC)"
  echo ""
  echo "+------------------------------------------------------+"
  echo "| Status: Existing process is using port 3000          |"
  echo "| Open in browser: http://localhost:3000               |"
  echo "| To restart: kill -9 $PORT_PID                        |"
  echo "+------------------------------------------------------+"
  echo ""
  exit 0
fi

if [[ "$DOCTOR_MODE" == "1" ]]; then
  echo "  [OK] Doctor checks complete (no start requested)"
  echo ""
  exit 0
fi

echo "[1/4] Checking server dependencies..."
cd server
if [[ ! -d "node_modules" ]]; then
  echo "  Installing server packages..."
  if ! npm install; then
    echo "  [ERROR] npm install failed in server"
    read -p "Press Enter to exit..."
    exit 1
  fi
fi
echo "  [OK] Server dependencies ready"

echo "[2/4] Checking dashboard dependencies..."
cd ../dashboard
if [[ ! -d "node_modules" ]]; then
  echo "  Installing dashboard packages..."
  if ! npm install; then
    echo "  [ERROR] npm install failed in dashboard"
    read -p "Press Enter to exit..."
    exit 1
  fi
fi
echo "  [OK] Dashboard dependencies ready"

if [[ "$START_MODE" == "compact" ]]; then
  echo "[3/4] Building dashboard (quiet mode)..."
  if ! npm run build > "$BUILD_LOG" 2>&1; then
    echo "  [ERROR] Dashboard build failed"
    echo "  Last 30 lines:"
    tail -n 30 "$BUILD_LOG"
    echo "  Full log: $BUILD_LOG"
    read -p "Press Enter to exit..."
    exit 1
  fi

  BUILD_SUMMARY=$(grep "built in" "$BUILD_LOG" | tail -n 1 || true)
  if [[ -n "$BUILD_SUMMARY" ]]; then
    echo "  [OK] Dashboard build complete ($BUILD_SUMMARY)"
  else
    echo "  [OK] Dashboard build complete"
  fi
else
  echo "[3/4] Building dashboard..."
  if ! npm run build; then
    echo "  [ERROR] Dashboard build failed"
    read -p "Press Enter to exit..."
    exit 1
  fi
  echo "  [OK] Dashboard build complete"
fi

cd ../server
echo "cold_boot" > ../COLD_BOOT.flag
echo "[4/4] Starting server..."
echo ""
echo "+------------------------------------------------------+"
echo "| Open in browser: http://localhost:3000               |"
echo "| Webhook:        http://localhost:3000/webhook        |"
echo "| Health:         http://localhost:3000/health         |"
echo "| Keep this window open while the server is running    |"
if [[ "$START_MODE" == "compact" ]]; then
  echo "| Tip: use ./start.sh --verbose for full logs          |"
fi
echo "+------------------------------------------------------+"
echo ""

if [[ "$START_MODE" == "compact" ]]; then
  npm run --silent dev
else
  npm run dev
fi
