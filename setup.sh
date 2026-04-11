#!/bin/bash
set -e

echo ""
echo "╔══════════════════════════════════╗"
echo "║   FinanceOS — Setup              ║"
echo "╚══════════════════════════════════╝"
echo ""

# ── Check OS ──────────────────────────────────────────────
OS="$(uname -s)"
if [ "$OS" != "Darwin" ] && [ "$OS" != "Linux" ]; then
  echo "❌ Only macOS and Linux are supported"
  exit 1
fi

# ── Check Homebrew (Mac only) ─────────────────────────────
if [ "$OS" = "Darwin" ]; then
  if ! command -v brew &>/dev/null; then
    echo "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi
fi

# ── Check Python 3.12+ ────────────────────────────────────
if ! command -v python3 &>/dev/null; then
  echo "❌ Python 3.12+ required"
  echo "   Mac: brew install python@3.12"
  echo "   Linux: sudo apt install python3.12"
  exit 1
fi

PY_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PY_MAJOR=$(echo $PY_VERSION | cut -d. -f1)
PY_MINOR=$(echo $PY_VERSION | cut -d. -f2)
if [ "$PY_MAJOR" -lt 3 ] || ([ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 12 ]); then
  echo "❌ Python 3.12+ required (found $PY_VERSION)"
  exit 1
fi
echo "✅ Python $PY_VERSION"

# ── Check Node 18+ ────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "❌ Node.js 18+ required"
  echo "   Mac: brew install node@20"
  echo "   Linux: https://nodejs.org"
  exit 1
fi
NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 18+ required (found v$NODE_VERSION)"
  exit 1
fi
echo "✅ Node $(node --version)"

# ── Check SQLCipher ───────────────────────────────────────
if ! command -v sqlcipher &>/dev/null; then
  echo "Installing SQLCipher..."
  if [ "$OS" = "Darwin" ]; then
    brew install sqlcipher
  else
    sudo apt-get install -y sqlcipher libsqlcipher-dev
  fi
fi
echo "✅ SQLCipher $(sqlcipher --version | head -1)"

# ── Check uv ─────────────────────────────────────────────
if ! command -v uv &>/dev/null; then
  echo "Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.cargo/bin:$PATH"
fi
echo "✅ uv $(uv --version)"

# ── Backend setup ─────────────────────────────────────────
echo ""
echo "Setting up backend..."
cd backend
uv sync
if [ ! -f .env ]; then
  cp .env.example .env
  echo "⚠️  Created backend/.env from template"
fi
cd ..
echo "✅ Backend dependencies installed"

# ── Frontend setup ────────────────────────────────────────
echo ""
echo "Setting up frontend..."
cd frontend
npm install --silent
cd ..
echo "✅ Frontend dependencies installed"

# ── Done ─────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════╗"
echo "║   Setup complete! ✅             ║"
echo "╚══════════════════════════════════╝"
echo ""
echo "To run the app:"
echo ""
echo "  Terminal 1 (backend):"
echo "    cd backend"
echo "    uv run uvicorn main:app --reload --port 8000"
echo ""
echo "  Terminal 2 (frontend):"
echo "    cd frontend"
echo "    npm run dev"
echo ""
echo "  Then open: http://localhost:3000"
echo ""
echo "To move your data to a new machine:"
echo "  Copy backend/finance.db to the same location on the new machine"
echo ""
