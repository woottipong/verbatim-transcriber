.PHONY: start stop restart status clean logs help dev frontend backend agent livekit

# Default target
.DEFAULT_GOAL := help

# Colors
CYAN := \033[0;36m
GREEN := \033[0;32m
YELLOW := \033[1;33m
NC := \033[0m

help:
	@echo ""
	@echo "$(CYAN)╔══════════════════════════════════════════════╗$(NC)"
	@echo "$(CYAN)║$(NC)  $(GREEN)🎙️  Thai Verbatim Transcriber$(NC)              $(CYAN)║$(NC)"
	@echo "$(CYAN)╚══════════════════════════════════════════════╝$(NC)"
	@echo ""
	@echo "$(YELLOW)Usage:$(NC)"
	@echo "  make [target]"
	@echo ""
	@echo "$(YELLOW)Main Commands:$(NC)"
	@echo "  $(GREEN)make$(NC)              Show this help"
	@echo "  $(GREEN)make start$(NC)        Start all services (LiveKit mode)"
	@echo "  $(GREEN)make stop$(NC)         Stop all services"
	@echo "  $(GREEN)make restart$(NC)      Restart all services"
	@echo "  $(GREEN)make status$(NC)       Show service status"
	@echo ""
	@echo "$(YELLOW)Individual Services:$(NC)"
	@echo "  $(GREEN)make frontend$(NC)     Start frontend only"
	@echo "  $(GREEN)make backend$(NC)      Start backend only"
	@echo "  $(GREEN)make agent$(NC)        Start agent only"
	@echo "  $(GREEN)make livekit$(NC)      Start LiveKit server only"
	@echo ""
	@echo "$(YELLOW)Development:$(NC)"
	@echo "  $(GREEN)make dev$(NC)          Quick start (alias for 'make start')"
	@echo "  $(GREEN)make logs$(NC)         Show logs from all services"
	@echo "  $(GREEN)make clean$(NC)        Clean logs and temp files"
	@echo ""

# Main commands
start:
	@./control.sh start

stop:
	@./control.sh stop

restart:
	@./control.sh restart

status:
	@./control.sh status

clean:
	@./control.sh clean

# Individual services
frontend:
	@./control.sh start --frontend-only

backend:
	@./control.sh start --backend-only

agent:
	@./control.sh start --agent-only

livekit:
	@./control.sh start --livekit-only

# Development shortcuts
dev: start

logs:
	@echo "$(CYAN)━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$(NC)"
	@echo "$(YELLOW)📋 Service Logs$(NC)"
	@echo "$(CYAN)━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$(NC)"
	@echo ""
	@echo "$(GREEN)Backend:$(NC)"
	@tail -n 20 /tmp/backend.log 2>/dev/null || echo "  No backend logs"
	@echo ""
	@echo "$(GREEN)Agent:$(NC)"
	@tail -n 20 /tmp/agent.log 2>/dev/null || echo "  No agent logs"
	@echo ""
	@echo "$(GREEN)Frontend:$(NC)"
	@tail -n 20 /tmp/frontend.log 2>/dev/null || echo "  No frontend logs"
	@echo ""
