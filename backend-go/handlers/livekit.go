package handlers

import (
	"time"

	"thai-transcriber-backend/config"

	"github.com/gofiber/fiber/v2"
	"github.com/livekit/protocol/auth"
)

// TokenRequest represents the request body for token generation
type TokenRequest struct {
	Identity string `json:"identity"`
	RoomName string `json:"roomName"`
	// Optional: specify participant permissions
	CanPublish     *bool `json:"canPublish,omitempty"`
	CanSubscribe   *bool `json:"canSubscribe,omitempty"`
	CanPublishData *bool `json:"canPublishData,omitempty"`
}

// TokenResponse represents the response with token and connection info
type TokenResponse struct {
	Token string `json:"token"`
	WsURL string `json:"wsUrl"`
}

// HandleLiveKitToken generates a LiveKit access token
func HandleLiveKitToken(c *fiber.Ctx, cfg *config.Config) error {
	var req TokenRequest

	// Parse request body
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "Invalid request body",
			"details": err.Error(),
		})
	}

	// Validate required fields
	if req.Identity == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "identity is required",
		})
	}

	if req.RoomName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "roomName is required",
		})
	}

	// Create access token
	at := auth.NewAccessToken(cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)

	// Set default permissions (all true if not specified)
	canPublish := true
	canSubscribe := true
	canPublishData := true

	if req.CanPublish != nil {
		canPublish = *req.CanPublish
	}
	if req.CanSubscribe != nil {
		canSubscribe = *req.CanSubscribe
	}
	if req.CanPublishData != nil {
		canPublishData = *req.CanPublishData
	}

	// Create video grant with permissions
	grant := &auth.VideoGrant{
		RoomJoin:       true,
		Room:           req.RoomName,
		CanPublish:     &canPublish,
		CanSubscribe:   &canSubscribe,
		CanPublishData: &canPublishData,
	}

	// Set token properties
	at.AddGrant(grant).
		SetIdentity(req.Identity).
		SetValidFor(time.Duration(cfg.LiveKitConfig.TokenExpiry) * time.Second)

	// Generate JWT token
	token, err := at.ToJWT()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   "Failed to generate token",
			"details": err.Error(),
		})
	}

	return c.JSON(TokenResponse{
		Token: token,
		WsURL: cfg.LiveKitURL,
	})
}
