package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"thai-transcriber-backend/config"
	"thai-transcriber-backend/internal/application/agentsupervisor"
	"thai-transcriber-backend/models"

	"github.com/gofiber/fiber/v2"
)

// HandleAgentStart starts the LiveKit ASR agent
func HandleAgentStart(c *fiber.Ctx, cfg *config.Config, supervisor *agentsupervisor.Supervisor) error {
	var payload struct {
		models.AgentStartRequest
		LegacyMode json.RawMessage `json:"mode"`
	}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}
	if len(payload.LegacyMode) != 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "mode is no longer supported",
		})
	}
	req := payload.AgentStartRequest

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
	if err := supervisor.Start(c.UserContext(), req.RoomName, req.Provider); err != nil {
		if errors.Is(err, agentsupervisor.ErrAgentAlreadyExists) {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error":   "Agent already running",
				"message": fmt.Sprintf("Agent for %s in room %s is already running", req.Provider, req.RoomName),
			})
		}
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Agent supervisor is unavailable",
		})
	}

	return c.JSON(fiber.Map{
		"status":   "starting",
		"roomName": req.RoomName,
		"provider": req.Provider,
		"message":  "Agent is connecting to room",
	})
}

// HandleAgentStop stops the LiveKit ASR agent
func HandleAgentStop(c *fiber.Ctx, cfg *config.Config, supervisor *agentsupervisor.Supervisor) error {
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

	if err := supervisor.Stop(req.RoomName, req.Provider); err != nil {
		if !errors.Is(err, agentsupervisor.ErrAgentNotFound) {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
				"error": "Agent supervisor is unavailable",
			})
		}
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error":   "Agent not running",
			"message": fmt.Sprintf("No agent for %s in room %s", req.Provider, req.RoomName),
		})
	}

	return c.JSON(fiber.Map{
		"status":   "stopped",
		"roomName": req.RoomName,
		"provider": req.Provider,
		"message":  "Agent has been stopped",
	})
}

// HandleAgentStatus returns the current agent status
func HandleAgentStatus(c *fiber.Ctx, supervisor *agentsupervisor.Supervisor) error {
	status := supervisor.Status()
	runningAgents := make([]fiber.Map, 0, len(status))
	for _, current := range status {
		runningAgents = append(runningAgents, fiber.Map{
			"key":      current.Key,
			"running":  current.Running,
			"provider": current.Provider,
			"room":     current.Room,
		})
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
	case "gpt-realtime-whisper":
		if !cfg.HasOpenAITranscriptionKey() {
			return "", fmt.Errorf("gpt-realtime-whisper provider is not configured")
		}
	case "azure":
		if !cfg.HasAzureKey() {
			return "", fmt.Errorf("azure provider is not configured")
		}
	default:
		return "", fmt.Errorf("provider must be google, gemini, azure, or gpt-realtime-whisper")
	}
	return provider, nil
}
