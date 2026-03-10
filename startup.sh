#!/usr/bin/env bash

# Qinsa Reputation - Startup Script
# This script launches both the backend (FastAPI) and frontend (Vite) servers concurrently.

set -e

echo "Starting Backend (uvicorn) on port 8000..."
source .venv/bin/activate
cd pipeline || exit
uvicorn api:app --reload --port 8000 &
BACKEND_PID=$!
cd ..

echo "Starting Frontend (Vite) on port 5173..."
cd demo-app || exit
npm run dev &
FRONTEND_PID=$!
cd ..

echo "================================================="
echo "🚀 Servers are running!"
echo "Backend:  http://127.0.0.1:8000"
echo "Frontend: http://localhost:5173"
echo "Press Ctrl+C to stop both servers."
echo "================================================="

# Wait for Ctrl+C
trap "echo 'Stopping servers...'; kill $BACKEND_PID $FRONTEND_PID; exit 0" SIGINT SIGTERM
wait
