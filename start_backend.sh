#!/bin/bash

# CaptionLive - Backend Development Server (Fresh Build)
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Config
BACKEND_PORT=3000
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

# Header
echo -e "${CYAN}┌─────────────────────────────────────────┐${NC}"
echo -e "${CYAN}│${NC}  ${BLUE}🎙️  CaptionLive Backend Server${NC}         ${CYAN}│${NC}"
echo -e "${CYAN}└─────────────────────────────────────────┘${NC}"
echo ""

# Check requirements
check_requirements() {
    if ! command -v go &> /dev/null; then
        echo -e "${RED}❌ Go not found${NC}"
        echo "   Install: https://go.dev/doc/install"
        echo ""
        echo -e "${RED}Please install missing dependencies${NC}"
        exit 1
    fi
}

# Install dependencies if needed
install_deps() {
    if [ ! -f "$PROJECT_ROOT/backend-go/go.sum" ]; then
        echo -e "${YELLOW}📦 Installing backend dependencies...${NC}"
        (cd "$PROJECT_ROOT/backend-go" && go mod tidy)
        echo ""
    fi
}

# Always build fresh backend binary
build_backend() {
    echo -e "${YELLOW}🔨 Building backend (fresh build)...${NC}"
    (cd "$PROJECT_ROOT/backend-go" && go build -o server .)
    echo -e "${GREEN}✓${NC} Backend built successfully"
    echo ""
}

# Cleanup function
cleanup() {
    echo ""
    echo -e "${BLUE}🛑 Stopping backend server...${NC}"
    [ -n "$BACKEND_PID" ] && kill $BACKEND_PID 2>/dev/null
    echo -e "${GREEN}✓${NC} Backend server stopped"
    exit 0
}

trap cleanup SIGINT SIGTERM

start_backend() {
    echo -e "${BLUE}🚀 Starting backend server...${NC}"
    echo ""
    echo -e "${GREEN}▶${NC} Backend:  ${CYAN}http://localhost:$BACKEND_PORT${NC}"
    (cd "$PROJECT_ROOT/backend-go" && ./server) &
    BACKEND_PID=$!

    echo ""
    echo -e "${GREEN}✨ Ready!${NC} Press ${YELLOW}Ctrl+C${NC} to stop"
    echo ""

    wait
}

check_requirements
install_deps
build_backend
start_backend
