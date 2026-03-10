#!/usr/bin/env bash

# Qinsa Reputation - Automated Environment Setup Scripts
# This script sets up the local development environment for the backend and frontend.

set -e

echo "================================================="
echo "Qinsa Reputation - Setting up environment..."
echo "================================================="

# 1. Setup Backend (.venv)
echo ""
echo "[1/4] Setting up Python virtual environment (Backend)..."
python3 -m venv .venv
source .venv/bin/activate

# Upgrade pip and install pip-tools if not present, then install requirements
echo "[2/4] Installing Python dependencies..."
pip install --upgrade pip
if [ -f "requirements.txt" ]; then
    pip install -r requirements.txt
else
    echo "⚠️  requirements.txt not found in root. Please ensure dependencies are configured."
fi

# 2. Setup Frontend (Node modules)
echo ""
echo "[3/4] Installing Node dependencies (Frontend)..."
if [ -d "demo-app" ]; then
    cd demo-app
    npm install
    cd ..
else
    echo "⚠️  demo-app directory not found."
fi

# 3. Setup Environment Variables
echo ""
echo "[4/4] Setting up environment variables..."
if [ ! -f ".env" ]; then
    if [ -f "env.example" ]; then
        cp env.example .env
        echo "✅ Created .env file from env.example."
        echo "⚠️  Please edit .env and fill in your API keys (Supabase, Gemini, etc.)."
    else
        echo "⚠️  No env.example found to copy."
    fi
else
    echo "✅ .env file already exists."
fi

echo ""
echo "================================================="
echo "✅ Setup complete!"
echo "You can now run the project locally using: ./startup.sh"
echo "================================================="
