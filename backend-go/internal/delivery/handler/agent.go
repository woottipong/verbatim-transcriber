package handler

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"

	"thai-transcriber-backend/config"
	"thai-transcriber-backend/internal/infrastructure/agent"
	"thai-transcriber-backend/models"

	"github.com/gofiber/fiber/v2"
)

// agentKey creates unique key for agent: room-provider
func agentKey(room, provider string) string {
	return fmt.Sprintf("%s-%s", room, provider)
}

var (
	// Map of running agents: key = "roomName-provider"
	agents   = make(map[string]*agent.Agent)
	agentsMu sync.Mutex
)

// HandleAgentStart starts the LiveKit ASR agent
func HandleAgentStart(c *fiber.Ctx, cfg *config.Config) error {
	// Parse request
	var req models.AgentStartRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.RoomName == "" {
		req.RoomName = "transcription-room" // default room
	}

	provider, err := validateAgentProvider(cfg, req.Provider)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": err.Error(),
		})
	}
	req.Provider = provider

	key := agentKey(req.RoomName, req.Provider)

	agentsMu.Lock()
	defer agentsMu.Unlock()

	// Check if this specific agent is already running
	if existingAgent, exists := agents[key]; exists && existingAgent.IsRunning() {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"error":   "Agent already running",
			"message": fmt.Sprintf("Agent for %s in room %s is already running", req.Provider, req.RoomName),
		})
	}

	// Create and start agent with provider preference
	newAgent := agent.New(cfg, req.Provider)
	agents[key] = newAgent

	go func() {
		ctx := context.Background()
		if err := newAgent.Start(ctx, req.RoomName); err != nil {
			log.Printf("❌ [Agent] Failed to start %s agent in room %s: %v", req.Provider, req.RoomName, err)
			// Log error and remove from map
			agentsMu.Lock()
			delete(agents, key)
			agentsMu.Unlock()
		}
	}()

	return c.JSON(fiber.Map{
		"status":   "starting",
		"roomName": req.RoomName,
		"provider": req.Provider,
		"message":  "Agent is connecting to room",
	})
}

// HandleAgentStop stops the LiveKit ASR agent
func HandleAgentStop(c *fiber.Ctx, cfg *config.Config) error {
	var req models.AgentStopRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.RoomName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "roomName and provider are required",
		})
	}
	provider, err := validateAgentProvider(cfg, req.Provider)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": err.Error(),
		})
	}
	req.Provider = provider

	key := agentKey(req.RoomName, req.Provider)

	agentsMu.Lock()
	defer agentsMu.Unlock()

	agentInstance, exists := agents[key]
	if !exists || !agentInstance.IsRunning() {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error":   "Agent not running",
			"message": fmt.Sprintf("No agent for %s in room %s", req.Provider, req.RoomName),
		})
	}

	agentInstance.Stop()
	delete(agents, key)

	return c.JSON(fiber.Map{
		"status":   "stopped",
		"roomName": req.RoomName,
		"provider": req.Provider,
		"message":  "Agent has been stopped",
	})
}

// HandleAgentStatus returns the current agent status
func HandleAgentStatus(c *fiber.Ctx, cfg *config.Config) error {
	agentsMu.Lock()
	defer agentsMu.Unlock()

	// Build list of running agents
	runningAgents := []fiber.Map{}
	for key, ag := range agents {
		if ag.IsRunning() {
			runningAgents = append(runningAgents, fiber.Map{
				"key":      key,
				"running":  true,
				"provider": ag.GetProvider(),
				"room":     ag.GetRoom(),
			})
		}
	}

	return c.JSON(fiber.Map{
		"count":  len(runningAgents),
		"agents": runningAgents,
	})
}

func validateAgentProvider(cfg *config.Config, provider string) (string, error) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	switch provider {
	case "google":
		if !cfg.HasGoogleKey() {
			return "", fmt.Errorf("google provider is not configured")
		}
	case "gemini":
		if !cfg.HasGeminiKey() {
			return "", fmt.Errorf("gemini provider is not configured")
		}
	case "azure":
		if !cfg.HasAzureKey() {
			return "", fmt.Errorf("azure provider is not configured")
		}
	default:
		return "", fmt.Errorf("provider must be google, gemini, or azure")
	}
	return provider, nil
}
