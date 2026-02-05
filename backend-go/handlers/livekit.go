package handlers

import (
	"context"
	"time"

	"thai-transcriber-backend/config"

	"github.com/gofiber/fiber/v2"
	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
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

// RoomInfo represents room information
type RoomInfo struct {
	Name            string            `json:"name"`
	NumParticipants int               `json:"numParticipants"`
	Participants    []ParticipantInfo `json:"participants,omitempty"`
	CreationTime    int64             `json:"creationTime"`
}

// ParticipantInfo represents participant information
type ParticipantInfo struct {
	Identity string `json:"identity"`
	Name     string `json:"name"`
	IsAgent  bool   `json:"isAgent"`
	State    string `json:"state"`
}

// HandleListRooms returns list of active rooms
func HandleListRooms(c *fiber.Ctx, cfg *config.Config) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Create RoomService client
	roomClient := lksdk.NewRoomServiceClient(cfg.LiveKitURL, cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)

	// List all rooms
	rooms, err := roomClient.ListRooms(ctx, &livekit.ListRoomsRequest{})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   "Failed to list rooms",
			"details": err.Error(),
		})
	}

	// Convert to response format
	roomInfos := make([]RoomInfo, 0, len(rooms.Rooms))
	for _, room := range rooms.Rooms {
		roomInfos = append(roomInfos, RoomInfo{
			Name:            room.Name,
			NumParticipants: int(room.NumParticipants),
			CreationTime:    room.CreationTime,
		})
	}

	return c.JSON(fiber.Map{
		"rooms": roomInfos,
		"total": len(roomInfos),
	})
}

// HandleGetRoom returns room info with participants
func HandleGetRoom(c *fiber.Ctx, cfg *config.Config) error {
	roomName := c.Params("name")
	if roomName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "room name is required",
		})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Create RoomService client
	roomClient := lksdk.NewRoomServiceClient(cfg.LiveKitURL, cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)

	// List participants in room
	participants, err := roomClient.ListParticipants(ctx, &livekit.ListParticipantsRequest{
		Room: roomName,
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   "Failed to get room participants",
			"details": err.Error(),
		})
	}

	// Convert to response format
	participantInfos := make([]ParticipantInfo, 0, len(participants.Participants))
	for _, p := range participants.Participants {
		isAgent := p.Identity == "asr-agent" ||
			len(p.Identity) > 6 && p.Identity[:6] == "agent-"

		participantInfos = append(participantInfos, ParticipantInfo{
			Identity: p.Identity,
			Name:     p.Name,
			IsAgent:  isAgent,
			State:    p.State.String(),
		})
	}

	return c.JSON(fiber.Map{
		"name":         roomName,
		"participants": participantInfos,
		"total":        len(participantInfos),
	})
}

// HandleDeleteRoom deletes a room and disconnects all participants
func HandleDeleteRoom(c *fiber.Ctx, cfg *config.Config) error {
	roomName := c.Params("name")
	if roomName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "room name is required",
		})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Create RoomService client
	roomClient := lksdk.NewRoomServiceClient(cfg.LiveKitURL, cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)

	// Delete room
	_, err := roomClient.DeleteRoom(ctx, &livekit.DeleteRoomRequest{
		Room: roomName,
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   "Failed to delete room",
			"details": err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"message": "Room deleted: " + roomName,
	})
}

// HandleRemoveParticipant removes a participant from a room
func HandleRemoveParticipant(c *fiber.Ctx, cfg *config.Config) error {
	roomName := c.Params("room")
	identity := c.Params("identity")

	if roomName == "" || identity == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "room and identity are required",
		})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Create RoomService client
	roomClient := lksdk.NewRoomServiceClient(cfg.LiveKitURL, cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)

	// Remove participant
	_, err := roomClient.RemoveParticipant(ctx, &livekit.RoomParticipantIdentity{
		Room:     roomName,
		Identity: identity,
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   "Failed to remove participant",
			"details": err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"message": "Participant removed: " + identity,
	})
}

// HandleGetRoomsDetailed returns detailed list of all rooms with participants
func HandleGetRoomsDetailed(c *fiber.Ctx, cfg *config.Config) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Create RoomService client
	roomClient := lksdk.NewRoomServiceClient(cfg.LiveKitURL, cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)

	// List all rooms
	rooms, err := roomClient.ListRooms(ctx, &livekit.ListRoomsRequest{})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   "Failed to list rooms",
			"details": err.Error(),
		})
	}

	// Build detailed room info
	type DetailedRoom struct {
		Name            string            `json:"name"`
		NumParticipants int               `json:"numParticipants"`
		MaxParticipants int               `json:"maxParticipants"`
		CreationTime    int64             `json:"creationTime"`
		EmptyTimeout    int               `json:"emptyTimeout"`
		Participants    []ParticipantInfo `json:"participants"`
	}

	detailedRooms := make([]DetailedRoom, 0, len(rooms.Rooms))
	for _, room := range rooms.Rooms {
		// Get participants for each room
		participants, err := roomClient.ListParticipants(ctx, &livekit.ListParticipantsRequest{
			Room: room.Name,
		})

		participantInfos := []ParticipantInfo{}
		if err == nil {
			for _, p := range participants.Participants {
				isAgent := p.Identity == "asr-agent" ||
					(len(p.Identity) > 6 && p.Identity[:6] == "agent-")

				participantInfos = append(participantInfos, ParticipantInfo{
					Identity: p.Identity,
					Name:     p.Name,
					IsAgent:  isAgent,
					State:    p.State.String(),
				})
			}
		}

		detailedRooms = append(detailedRooms, DetailedRoom{
			Name:            room.Name,
			NumParticipants: int(room.NumParticipants),
			MaxParticipants: int(room.MaxParticipants),
			CreationTime:    room.CreationTime,
			EmptyTimeout:    int(room.EmptyTimeout),
			Participants:    participantInfos,
		})
	}

	return c.JSON(fiber.Map{
		"rooms": detailedRooms,
		"total": len(detailedRooms),
	})
}
