#!/bin/bash

# Thai Verbatim Transcriber - Quick Start
# Run this one command to start everything!

echo "🎙️  Thai Verbatim Transcriber"
echo "==============================="
echo ""

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    npm install
fi

if [ ! -d "backend/node_modules" ]; then
    echo "📦 Installing backend dependencies..."
    cd backend && npm install && cd ..
fi

echo ""
echo "🚀 Starting servers..."
echo ""
echo "✨ Frontend: http://localhost:5173"
echo "✨ Backend:  ws://localhost:3000"
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

# Start backend in background
(cd backend && npm start) &
BACKEND_PID=$!

# Wait for both processes
wait
