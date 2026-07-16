#!/bin/bash

# Thai Verbatim Transcriber - Control Script
# Usage: ./control.sh [command] [options]

set -e

# ============================================================================
# Configuration
# ============================================================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Ports
FRONTEND_PORT=5173
BACKEND_PORT=3000
LIVEKIT_PORT=7880

# Paths
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
BACKEND_DIR="$PROJECT_ROOT/backend-go"
AGENT_DIR="$PROJECT_ROOT/backend-go/agent"
LIVEKIT_DIR="$PROJECT_ROOT/livekit"

# Log files
LOG_DIR="/tmp"
BACKEND_LOG="$LOG_DIR/backend.log"
AGENT_LOG="$LOG_DIR/agent.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"

# PIDs (will be populated by get_pids)
FRONTEND_PID=""
BACKEND_PID=""
AGENT_PID=""

# ============================================================================
# Helper Functions
# ============================================================================

print_header() {
    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}  ${BLUE}🎙️  Thai Verbatim Transcriber${NC}               ${CYAN}║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════╝${NC}"
    echo ""
}

print_separator() {
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

get_pids() {
    # Frontend: Look for vite process in frontend directory
    FRONTEND_PID=$(ps aux | grep -E "vite.*dev" | grep -v grep | grep "frontend" | awk '{print $2}' | head -1)
    
    # Backend: Look for "go run main.go" in backend-go directory (excluding agent)
    BACKEND_PID=$(ps aux | grep -E "go.*run.*main\.go" | grep "backend-go" | grep -v "agent" | grep -v grep | awk '{print $2}' | head -1)
    
    # Agent: Look for "go run main.go" in agent directory
    AGENT_PID=$(ps aux | grep -E "go.*run.*main\.go" | grep "agent" | grep -v grep | awk '{print $2}' | head -1)
}

is_livekit_running() {
    if [ -d "$LIVEKIT_DIR" ]; then
        cd "$LIVEKIT_DIR"
        docker-compose ps 2>/dev/null | grep -q "Up"
        local result=$?
        cd "$PROJECT_ROOT"
        return $result
    fi
    return 1
}

# ============================================================================
# Service Management Functions
# ============================================================================

start_livekit() {
    echo -e "${CYAN}📦 1. Starting LiveKit Server...${NC}"
    
    if ! command -v docker-compose &> /dev/null; then
        echo -e "${RED}  ✗${NC} docker-compose not found"
        return 1
    fi
    
    if is_livekit_running; then
        echo -e "${YELLOW}  ⚠${NC}  Already running"
        return 0
    fi
    
    cd "$LIVEKIT_DIR"
    docker-compose up -d > /dev/null 2>&1
    cd "$PROJECT_ROOT"
    
    echo -e "${GREEN}  ✓${NC}  Running on ${CYAN}ws://localhost:$LIVEKIT_PORT${NC}"
}

start_backend() {
    echo -e "${CYAN}🔧 2. Starting Backend API...${NC}"
    
    get_pids
    if [ -n "$BACKEND_PID" ]; then
        echo -e "${YELLOW}  ⚠${NC}  Already running (PID: $BACKEND_PID)"
        return 0
    fi
    
    cd "$BACKEND_DIR"
    nohup go run main.go > "$BACKEND_LOG" 2>&1 &
    BACKEND_PID=$!
    cd "$PROJECT_ROOT"
    
    sleep 1
    echo -e "${GREEN}  ✓${NC}  Running on ${CYAN}http://localhost:$BACKEND_PORT${NC} (PID: $BACKEND_PID)"
}

start_agent() {
    echo -e "${CYAN}🤖 3. Starting ASR Agent...${NC}"
    
    get_pids
    if [ -n "$AGENT_PID" ]; then
        echo -e "${YELLOW}  ⚠${NC}  Already running (PID: $AGENT_PID)"
        return 0
    fi
    
    if [ ! -d "$AGENT_DIR" ]; then
        echo -e "${RED}  ✗${NC}  Agent directory not found"
        return 1
    fi
    
    cd "$AGENT_DIR"
    
    # Load .env if exists
    if [ -f ".env" ]; then
        set -a
        source <(grep -E "^[A-Z_]+=" .env 2>/dev/null || true)
        set +a
    fi
    
    nohup go run main.go > "$AGENT_LOG" 2>&1 &
    AGENT_PID=$!
    cd "$PROJECT_ROOT"
    
    sleep 1
    echo -e "${GREEN}  ✓${NC}  Running (PID: $AGENT_PID)"
}

start_frontend() {
    echo -e "${CYAN}🎨 4. Starting Frontend...${NC}"
    
    get_pids
    if [ -n "$FRONTEND_PID" ]; then
        echo -e "${YELLOW}  ⚠${NC}  Already running (PID: $FRONTEND_PID)"
        return 0
    fi
    
    # Check if node_modules exists
    if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
        echo -e "${YELLOW}  📦 Installing dependencies...${NC}"
        cd "$FRONTEND_DIR"
        npm install > /dev/null 2>&1
        cd "$PROJECT_ROOT"
    fi
    
    cd "$FRONTEND_DIR"
    nohup npm run dev > "$FRONTEND_LOG" 2>&1 &
    FRONTEND_PID=$!
    cd "$PROJECT_ROOT"
    
    sleep 2
    echo -e "${GREEN}  ✓${NC}  Running on ${CYAN}http://localhost:$FRONTEND_PORT${NC} (PID: $FRONTEND_PID)"
}

stop_livekit() {
    echo -e "${CYAN}📦 1. Stopping LiveKit Server...${NC}"
    
    if is_livekit_running; then
        cd "$LIVEKIT_DIR"
        docker-compose down > /dev/null 2>&1
        cd "$PROJECT_ROOT"
        echo -e "${GREEN}  ✓${NC}  Stopped"
    else
        echo -e "${YELLOW}  ⚠${NC}  Not running"
    fi
}

stop_backend() {
    echo -e "${CYAN}🔧 2. Stopping Backend API...${NC}"
    
    get_pids
    if [ -n "$BACKEND_PID" ]; then
        if [ "$FORCE" = true ]; then
            kill -9 "$BACKEND_PID" 2>/dev/null || true
        else
            kill "$BACKEND_PID" 2>/dev/null || true
        fi
        sleep 0.5
        echo -e "${GREEN}  ✓${NC}  Stopped"
    else
        echo -e "${YELLOW}  ⚠${NC}  Not running"
    fi
}

stop_agent() {
    echo -e "${CYAN}🤖 3. Stopping ASR Agent...${NC}"
    
    get_pids
    if [ -n "$AGENT_PID" ]; then
        if [ "$FORCE" = true ]; then
            kill -9 "$AGENT_PID" 2>/dev/null || true
        else
            kill "$AGENT_PID" 2>/dev/null || true
        fi
        sleep 0.5
        echo -e "${GREEN}  ✓${NC}  Stopped"
    else
        echo -e "${YELLOW}  ⚠${NC}  Not running"
    fi
}

stop_frontend() {
    echo -e "${CYAN}🎨 4. Stopping Frontend...${NC}"
    
    get_pids
    if [ -n "$FRONTEND_PID" ]; then
        if [ "$FORCE" = true ]; then
            kill -9 "$FRONTEND_PID" 2>/dev/null || true
        else
            kill "$FRONTEND_PID" 2>/dev/null || true
        fi
        sleep 0.5
        echo -e "${GREEN}  ✓${NC}  Stopped"
    else
        echo -e "${YELLOW}  ⚠${NC}  Not running"
    fi
}

# ============================================================================
# Command Functions
# ============================================================================

cmd_start() {
    print_header
    echo -e "${YELLOW}Mode:${NC} $MODE"
    echo ""
    
    print_separator
    echo -e "${YELLOW}Starting Services${NC}"
    print_separator
    echo ""
    
    if [ "$LIVEKIT_ONLY" = true ]; then
        start_livekit
    elif [ "$FRONTEND_ONLY" = true ]; then
        start_frontend
    elif [ "$BACKEND_ONLY" = true ]; then
        start_backend
    elif [ "$AGENT_ONLY" = true ]; then
        start_agent
    else
        # Start all services
        if [ "$MODE" = "livekit" ]; then
            start_livekit
            echo ""
            sleep 2
        fi
        
        start_backend
        echo ""
        sleep 1
        
        if [ "$MODE" = "livekit" ]; then
            start_agent
            echo ""
            sleep 1
        fi
        
        start_frontend
    fi
    
    echo ""
    print_separator
    echo -e "${GREEN}✨ All services started!${NC}"
    echo -e "${YELLOW}⚡ Press Ctrl+C to stop${NC}"
    echo ""
    echo -e "${CYAN}🌐 Frontend:${NC} http://localhost:$FRONTEND_PORT"
    echo -e "${CYAN}🔧 Backend:${NC}  http://localhost:$BACKEND_PORT"
    if [ "$MODE" = "livekit" ]; then
        echo -e "${CYAN}📦 LiveKit:${NC}  ws://localhost:$LIVEKIT_PORT"
    fi
    print_separator
    echo ""
    
    # Keep script running and handle Ctrl+C
    trap 'echo ""; echo -e "${YELLOW}Stopping all services...${NC}"; TRAP_HANDLER=true; cmd_stop; exit 0' INT TERM
    
    # Wait forever
    while true; do
        sleep 1
    done
}

cmd_stop() {
    if [ -z "$TRAP_HANDLER" ]; then
        print_header
    fi
    
    print_separator
    echo -e "${YELLOW}Stopping Services${NC}"
    print_separator
    echo ""
    
    if [ "$LIVEKIT_ONLY" = true ]; then
        stop_livekit
    elif [ "$FRONTEND_ONLY" = true ]; then
        stop_frontend
    elif [ "$BACKEND_ONLY" = true ]; then
        stop_backend
    elif [ "$AGENT_ONLY" = true ]; then
        stop_agent
    else
        # Stop all services
        stop_frontend
        echo ""
        stop_agent
        echo ""
        stop_backend
        echo ""
        stop_livekit
    fi
    
    echo ""
    print_separator
    echo -e "${GREEN}✓ All services stopped${NC}"
    print_separator
    echo ""
}

cmd_restart() {
    print_header
    echo -e "${YELLOW}Restarting all services...${NC}"
    echo ""
    
    TRAP_HANDLER="" cmd_stop
    sleep 2
    cmd_start
}

cmd_status() {
    print_header
    print_separator
    echo -e "${YELLOW}📊 Service Status${NC}"
    print_separator
    echo ""
    
    get_pids
    
    # LiveKit
    if is_livekit_running; then
        echo -e "${GREEN}✓${NC} LiveKit Server    ${CYAN}Running${NC}"
        echo "                    ${CYAN}ws://localhost:$LIVEKIT_PORT${NC}"
    else
        echo -e "${RED}✗${NC} LiveKit Server    ${CYAN}Stopped${NC}"
    fi
    
    # Backend
    if [ -n "$BACKEND_PID" ]; then
        echo -e "${GREEN}✓${NC} Backend API       ${CYAN}Running${NC}"
        echo "                    ${CYAN}http://localhost:$BACKEND_PORT${NC} (PID: $BACKEND_PID)"
    else
        echo -e "${RED}✗${NC} Backend API       ${CYAN}Stopped${NC}"
    fi
    
    # Agent
    if [ -n "$AGENT_PID" ]; then
        echo -e "${GREEN}✓${NC} ASR Agent         ${CYAN}Running${NC} (PID: $AGENT_PID)"
    else
        echo -e "${RED}✗${NC} ASR Agent         ${CYAN}Stopped${NC}"
    fi
    
    # Frontend
    if [ -n "$FRONTEND_PID" ]; then
        echo -e "${GREEN}✓${NC} Frontend          ${CYAN}Running${NC}"
        echo "                    ${CYAN}http://localhost:$FRONTEND_PORT${NC} (PID: $FRONTEND_PID)"
    else
        echo -e "${RED}✗${NC} Frontend          ${CYAN}Stopped${NC}"
    fi
    
    echo ""
    print_separator
}

cmd_clean() {
    print_header
    echo -e "${CYAN}🧹 Cleaning up...${NC}"
    echo ""
    
    echo "  • Removing log files..."
    rm -f "$BACKEND_LOG" "$AGENT_LOG" "$FRONTEND_LOG" 2>/dev/null || true
    
    echo "  • Removing node_modules..."
    rm -rf "$FRONTEND_DIR/node_modules" 2>/dev/null || true
    
    echo ""
    echo -e "${GREEN}✓ Cleaned up${NC}"
    echo ""
}

cmd_help() {
    print_header
    echo "Usage: $0 [command] [options]"
    echo ""
    echo -e "${YELLOW}Commands:${NC}"
    echo "  start            Start services (default)"
    echo "  stop             Stop all services"
    echo "  restart          Restart all services"
    echo "  status           Show running services"
    echo "  clean            Clean up logs and temp files"
    echo "  help             Show this help"
    echo ""
    echo -e "${YELLOW}Modes (for start/restart):${NC}"
    echo "  livekit          Start LiveKit system (default)"
    echo "  websocket        Start WebSocket system (legacy)"
    echo ""
    echo -e "${YELLOW}Options:${NC}"
    echo "  --frontend-only   Start/stop only frontend"
    echo "  --backend-only    Start/stop only backend"
    echo "  --agent-only      Start/stop only agent"
    echo "  --livekit-only    Start/stop only LiveKit server"
    echo "  --force, -f       Force stop (kill -9)"
    echo "  --help, -h        Show this help"
    echo ""
    echo -e "${YELLOW}Examples:${NC}"
    echo "  $0 start                      # Start all services"
    echo "  $0 stop                       # Stop all services"
    echo "  $0 restart                    # Restart all services"
    echo "  $0 status                     # Show service status"
    echo "  $0 start --frontend-only      # Start frontend only"
    echo "  $0 stop --agent-only          # Stop agent only"
    echo "  $0 clean                      # Clean up logs"
    echo ""
}

# ============================================================================
# Argument Parsing
# ============================================================================

# Default values
COMMAND="start"
MODE="livekit"
FRONTEND_ONLY=false
BACKEND_ONLY=false
AGENT_ONLY=false
LIVEKIT_ONLY=false
FORCE=false
TRAP_HANDLER=""

# Parse command (first non-option argument)
if [ -n "$1" ] && [[ ! "$1" =~ ^-- ]]; then
    COMMAND="$1"
    shift
fi

# Parse mode and options
for arg in "$@"; do
    case $arg in
        livekit|--livekit|-l)
            MODE="livekit"
            ;;
        websocket|--websocket|-w)
            MODE="websocket"
            ;;
        --frontend-only)
            FRONTEND_ONLY=true
            ;;
        --backend-only)
            BACKEND_ONLY=true
            ;;
        --agent-only)
            AGENT_ONLY=true
            ;;
        --livekit-only)
            LIVEKIT_ONLY=true
            ;;
        --force|-f)
            FORCE=true
            ;;
        --help|-h)
            cmd_help
            exit 0
            ;;
    esac
done

# ============================================================================
# Main Execution
# ============================================================================

case "$COMMAND" in
    start)
        cmd_start
        ;;
    stop)
        cmd_stop
        ;;
    restart)
        cmd_restart
        ;;
    status)
        cmd_status
        ;;
    clean)
        cmd_clean
        ;;
    help|--help|-h)
        cmd_help
        ;;
    *)
        echo -e "${RED}✗ Unknown command: $COMMAND${NC}"
        echo ""
        cmd_help
        exit 1
        ;;
esac
