package handlers

import (
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/livekit/protocol/auth"
)

type TokenRequest struct {
	Identity string `json:"identity"`
	RoomName string `json:"roomName"`
}

type TokenResponse struct {
	Token  string `json:"token"`
	WsUrl  string `json:"wsUrl"`
	Expire int64  `json:"expire"`
}

func HandleLiveKitToken(c *fiber.Ctx) error {
	var req TokenRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if req.Identity == "" {
		req.Identity = generateIdentity()
	}
	if req.RoomName == "" {
		req.RoomName = "transcription-room"
	}

	at := auth.NewAccessToken(
		os.Getenv("LIVEKIT_API_KEY"),
		os.Getenv("LIVEKIT_API_SECRET"),
	)

	grant := &auth.VideoGrant{
		RoomJoin:     true,
		Room:         req.RoomName,
		CanPublish:   &[]bool{true}[0],
		CanSubscribe: &[]bool{true}[0],
	}

	at.AddGrant(grant).
		SetIdentity(req.Identity).
		SetValidFor(time.Hour)

	token, err := at.ToJWT()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to generate token"})
	}

	return c.JSON(TokenResponse{
		Token:  token,
		WsUrl:  os.Getenv("LIVEKIT_WS_URL"),
		Expire: time.Now().Add(time.Hour).Unix(),
	})
}

func generateIdentity() string {
	return "user-" + time.Now().Format("20060102-150405")
}
