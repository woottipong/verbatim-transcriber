#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🎙️  Thai Verbatim Transcriber${NC}"
echo -e "${BLUE}================================${NC}\n"

# Install frontend dependencies
echo -e "${GREEN}📦 Installing frontend dependencies...${NC}"
cd frontend && npm install && cd ..

# Install backend dependencies (Go)
echo -e "${GREEN}📦 Installing Go backend dependencies...${NC}"
cd backend-go && go mod download && cd ..

echo -e "\n${GREEN}✅ Installation complete!${NC}\n"

# Start both servers
echo -e "${BLUE}🚀 Starting servers...${NC}\n"

# Function to handle cleanup
cleanup() {
    echo -e "\n${BLUE}Stopping servers...${NC}"
    kill $FRONTEND_PID $BACKEND_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT

# Start frontend (Vite)
echo -e "${GREEN}▶️  Starting Frontend on http://localhost:5173${NC}"
(cd frontend && npm run dev) &
FRONTEND_PID=$!

# Start backend (Go)
echo -e "${GREEN}▶️  Starting Backend on ws://localhost:3000${NC}"
(cd backend-go && go run main.go) &
BACKEND_PID=$!

echo -e "\n${GREEN}✨ Both servers running!${NC}"
echo -e "${BLUE}Frontend:${NC} http://localhost:5173"
echo -e "${BLUE}Backend:${NC}  ws://localhost:3000 (Go + Fiber)"
echo -e "\n${BLUE}Press Ctrl+C to stop both servers${NC}\n"

# Wait for both processes
wait
