#!/bin/bash

# Thai Verbatim Transcriber - Development Server
# Usage: ./start.sh [options]
#   --frontend-only    Start only frontend
#   --backend-only     Start only backend
#   --build            Build backend before starting
#   --help             Show this help

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
BACKEND_PORT=3000
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

# Parse arguments
FRONTEND_ONLY=false
BACKEND_ONLY=false
BUILD_BACKEND=false

for arg in "$@"; do
    case $arg in
        --frontend-only) FRONTEND_ONLY=true ;;
        --backend-only) BACKEND_ONLY=true ;;
        --build) BUILD_BACKEND=true ;;
        --help)
            echo "Usage: ./start.sh [options]"
            echo "  --frontend-only    Start only frontend"
            echo "  --backend-only     Start only backend"
            echo "  --build            Build backend before starting"
            echo "  --help             Show this help"
            exit 0
            ;;
    esac
done

# Header
echo -e "${CYAN}┌─────────────────────────────────────────┐${NC}"
echo -e "${CYAN}│${NC}  ${BLUE}🎙️  Real-time Thai Transcription${NC}      ${CYAN}│${NC}"
echo -e "${CYAN}│${NC}  ${NC}Multi-Provider ASR Comparison${NC}          ${CYAN}│${NC}"
echo -e "${CYAN}└─────────────────────────────────────────┘${NC}"
echo ""

# Check requirements
check_requirements() {
    local has_error=false

    # Check Node.js
    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ Node.js not found${NC}"
        echo "   Install: https://nodejs.org/"
        has_error=true
    fi

    # Check Go
    if ! command -v go &> /dev/null; then
        echo -e "${RED}❌ Go not found${NC}"
        echo "   Install: https://go.dev/doc/install"
        has_error=true
    fi

    if [ "$has_error" = true ]; then
        echo ""
        echo -e "${RED}Please install missing dependencies${NC}"
        exit 1
    fi
}

# Install dependencies
install_deps() {
    # Frontend
    if [ "$BACKEND_ONLY" = false ]; then
        if [ ! -d "$PROJECT_ROOT/frontend/node_modules" ]; then
            echo -e "${YELLOW}📦 Installing frontend dependencies...${NC}"
            (cd "$PROJECT_ROOT/frontend" && npm install)
            echo ""
        fi
    fi

    # Backend
    if [ "$FRONTEND_ONLY" = false ]; then
        if [ ! -f "$PROJECT_ROOT/backend-go/go.sum" ]; then
            echo -e "${YELLOW}📦 Installing backend dependencies...${NC}"
            (cd "$PROJECT_ROOT/backend-go" && go mod tidy)
            echo ""
        fi
    fi
}

# Build backend (optional)
build_backend() {
    if [ "$BUILD_BACKEND" = true ] && [ "$FRONTEND_ONLY" = false ]; then
        echo -e "${YELLOW}🔨 Building backend...${NC}"
        (cd "$PROJECT_ROOT/backend-go" && go build -o server .)
        echo -e "${GREEN}✓${NC} Backend built successfully"
        echo ""
    fi
}

# Cleanup function
cleanup() {
    echo ""
    echo -e "${BLUE}🛑 Stopping servers...${NC}"
    [ -n "$FRONTEND_PID" ] && kill $FRONTEND_PID 2>/dev/null
    [ -n "$BACKEND_PID" ] && kill $BACKEND_PID 2>/dev/null
    echo -e "${GREEN}✓${NC} Servers stopped"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Start servers
start_servers() {
    echo -e "${BLUE}🚀 Starting servers...${NC}"
    echo ""

    # Start frontend
    if [ "$BACKEND_ONLY" = false ]; then
        echo -e "${GREEN}▶${NC} Frontend: ${CYAN}http://localhost:$FRONTEND_PORT${NC}"
        (cd "$PROJECT_ROOT/frontend" && npm run dev) &
        FRONTEND_PID=$!
    fi

    # Start backend
    if [ "$FRONTEND_ONLY" = false ]; then
        echo -e "${GREEN}▶${NC} Backend:  ${CYAN}ws://localhost:$BACKEND_PORT${NC}"
        if [ "$BUILD_BACKEND" = true ] && [ -f "$PROJECT_ROOT/backend-go/server" ]; then
            (cd "$PROJECT_ROOT/backend-go" && ./server) &
        else
            (cd "$PROJECT_ROOT/backend-go" && go run main.go) &
        fi
        BACKEND_PID=$!
    fi

    echo ""
    echo -e "${GREEN}✨ Ready!${NC} Press ${YELLOW}Ctrl+C${NC} to stop"
    echo ""

    # Wait
    wait
}

# Main
check_requirements
install_deps
build_backend
start_servers
