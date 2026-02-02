#!/bin/bash

# Thai Verbatim Transcriber - Quick Start
# Run this one command to start everything!

echo "🎙️  Thai Verbatim Transcriber (Go Backend)"
echo "==========================================="
echo ""

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    npm install
fi

# Check if Go is installed
if ! command -v go &> /dev/null; then
    echo "❌ Go is not installed. Please install Go 1.22 or later."
    echo "   Visit: https://go.dev/doc/install"
    exit 1
fi

# Install Go dependencies if needed
if [ ! -f "backend-go/go.sum" ]; then
    echo "📦 Installing Go backend dependencies..."
    cd backend-go && go mod download && cd ..
fi

echo ""
echo "🚀 Starting servers..."
echo ""
echo "✨ Frontend: http://localhost:5173"
echo "✨ Backend:  ws://localhost:3000 (Go + Fiber)"
echo ""
echo "Press Ctrl+C to stop both servers"
echo ""

# Trap to cleanup processes
cleanup() {
    echo ""
    echo "🛑 Stopping servers..."
    kill $FRONTEND_PID $BACKEND_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Start frontend in background
npm run dev &
FRONTEND_PID=$!

# Start Go backend in background
(cd backend-go && go run main.go) &
BACKEND_PID=$!

# Wait for both processes
wait
