#!/bin/bash

set -e

echo "🚀 Starting LiveKit Transcription System"
echo "=========================================="
echo ""

# 1. Start LiveKit Server
echo "📦 Starting LiveKit Server..."
cd livekit
docker-compose up -d
echo "✅ LiveKit Server running on ws://localhost:7880"
cd ..
echo ""

# 2. Start Backend (in background)
echo "🔧 Starting Backend Server..."
cd backend-go
go run main.go > /tmp/backend.log 2>&1 &
BACKEND_PID=$!
echo "✅ Backend Server running on http://localhost:3000 (PID: $BACKEND_PID)"
cd ..
echo ""

# Wait for backend to be ready
echo "⏳ Waiting for backend to be ready..."
sleep 3

# Check backend health
if curl -s http://localhost:3000/health > /dev/null; then
  echo "✅ Backend is healthy"
else
  echo "❌ Backend failed to start. Check logs: tail /tmp/backend.log"
  exit 1
fi
echo ""

# 3. Show Agent startup instructions
echo "🤖 Agent Setup"
echo "------------------------------"
echo "To start the ASR agent, run in a new terminal:"
echo ""
echo "  cd backend-go/agent"
echo "  export \$(cat .env | xargs)"
echo "  go run main.go"
echo ""

# 4. Show frontend startup instructions
echo "🎨 Frontend Setup"
echo "------------------------------"
echo "To start the frontend, run in a new terminal:"
echo ""
echo "  cd frontend"
echo "  npm run dev"
echo ""
echo "Then open: http://localhost:5173/livekit-test.html"
echo ""

# 5. Show how to stop
echo "🛑 To Stop All Services"
echo "------------------------------"
echo "  # Stop backend"
echo "  kill $BACKEND_PID"
echo ""
echo "  # Stop LiveKit"
echo "  cd livekit && docker-compose down"
echo ""

# 6. Show status summary
echo "📊 Status Summary"
echo "------------------------------"
echo "LiveKit Server:  http://localhost:7880"
echo "Backend API:     http://localhost:3000"
echo "Token Endpoint:  http://localhost:3000/livekit/token"
echo "Health Check:    http://localhost:3000/health"
echo "Providers:      http://localhost:3000/providers"
echo ""
echo "✅ System ready! Follow the instructions above to start the agent and frontend."
