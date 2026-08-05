#!/bin/bash

# CaptionLive - Frontend Development Server
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Config
FRONTEND_PORT=5173
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

# Header
echo -e "${CYAN}┌─────────────────────────────────────────┐${NC}"
echo -e "${CYAN}│${NC}  ${BLUE}🎙️  CaptionLive Frontend Server${NC}        ${CYAN}│${NC}"
echo -e "${CYAN}└─────────────────────────────────────────┘${NC}"
echo ""

# Check requirements
check_requirements() {
    local has_error=false

    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ Node.js not found${NC}"
        echo "   Install: https://nodejs.org/"
        has_error=true
    fi
    if ! command -v pnpm &> /dev/null; then
        echo -e "${RED}❌ pnpm not found${NC}"
        echo "   Install: corepack enable && corepack prepare pnpm@latest --activate"
        has_error=true
    fi

    if [ "$has_error" = true ]; then
        echo ""
        echo -e "${RED}Please install missing dependencies${NC}"
        exit 1
    fi
}

# Install dependencies if needed
install_deps() {
    if [ ! -d "$PROJECT_ROOT/frontend/node_modules" ]; then
        echo -e "${YELLOW}📦 Installing frontend dependencies...${NC}"
        (cd "$PROJECT_ROOT/frontend" && pnpm install)
        echo ""
    fi
}

# Cleanup function
cleanup() {
    echo ""
    echo -e "${BLUE}🛑 Stopping frontend server...${NC}"
    [ -n "$FRONTEND_PID" ] && kill $FRONTEND_PID 2>/dev/null
    echo -e "${GREEN}✓${NC} Frontend server stopped"
    exit 0
}

trap cleanup SIGINT SIGTERM

start_frontend() {
    echo -e "${BLUE}🚀 Starting frontend server...${NC}"
    echo ""
    echo -e "${GREEN}▶${NC} Frontend: ${CYAN}http://localhost:$FRONTEND_PORT${NC}"
    (cd "$PROJECT_ROOT/frontend" && pnpm run dev) &
    FRONTEND_PID=$!

    echo ""
    echo -e "${GREEN}✨ Ready!${NC} Press ${YELLOW}Ctrl+C${NC} to stop"
    echo ""

    wait
}

check_requirements
install_deps
start_frontend
