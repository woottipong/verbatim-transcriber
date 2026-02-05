package handlers

import (
	"context"
	"sync"

	"thai-transcriber-backend/agent"
	"thai-transcriber-backend/config"

	"github.com/gofiber/fiber/v2"
)

var (
	agentInstance *agent.Agent
	agentMu       sync.Mutex
)

// AgentStartRequest represents the request to start agent
type AgentStartRequest struct {
	RoomName string `json:"roomName"`
}

// HandleAgentStart starts the LiveKit ASR agent
func HandleAgentStart(c *fiber.Ctx, cfg *config.Config) error {
	agentMu.Lock()
	defer agentMu.Unlock()

	// Check if agent is already running
	if agentInstance != nil && agentInstance.IsRunning() {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"error":   "Agent already running",
			"message": "Stop the current agent before starting a new one",
		})
	}

	// Parse request
	var req AgentStartRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.RoomName == "" {
		req.RoomName = "transcription-room" // default room
	}

	// Create and start agent
	agentInstance = agent.New(cfg)

	go func() {
		ctx := context.Background()
		if err := agentInstance.Start(ctx, req.RoomName); err != nil {
			// Log error but don't block
			agentMu.Lock()
			agentInstance = nil
			agentMu.Unlock()
		}
	}()

	return c.JSON(fiber.Map{
		"status":   "starting",
		"roomName": req.RoomName,
		"message":  "Agent is connecting to room",
	})
}

// HandleAgentStop stops the LiveKit ASR agent
func HandleAgentStop(c *fiber.Ctx, cfg *config.Config) error {
	agentMu.Lock()
	defer agentMu.Unlock()

	if agentInstance == nil || !agentInstance.IsRunning() {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error":   "Agent not running",
			"message": "No agent is currently running",
		})
	}

	agentInstance.Stop()
	agentInstance = nil

	return c.JSON(fiber.Map{
		"status":  "stopped",
		"message": "Agent has been stopped",
	})
}

// HandleAgentStatus returns the current agent status
func HandleAgentStatus(c *fiber.Ctx, cfg *config.Config) error {
	agentMu.Lock()
	defer agentMu.Unlock()

	isRunning := agentInstance != nil && agentInstance.IsRunning()

	return c.JSON(fiber.Map{
		"running": isRunning,
	})
}
