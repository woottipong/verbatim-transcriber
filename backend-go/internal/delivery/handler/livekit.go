package handler

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"thai-transcriber-backend/config"
	"thai-transcriber-backend/models"

	"github.com/gofiber/fiber/v2"
	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	"github.com/livekit/psrpc"
	lksdk "github.com/livekit/server-sdk-go/v2"
)

var roomNamePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func validateRoomName(name string) error {
	if name == "" || name != strings.TrimSpace(name) || !roomNamePattern.MatchString(name) {
		return errors.New("room name must be 1-128 characters using letters, numbers, hyphens, or underscores")
	}
	return nil
}

// HandleLiveKitToken generates a LiveKit access token
func HandleLiveKitToken(c *fiber.Ctx, cfg *config.Config) error {
	var req models.TokenRequest

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
	at.SetVideoGrant(grant).
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

	return c.JSON(models.TokenResponse{
		Token: token,
		WsURL: cfg.LiveKitURL,
	})
}

// HandleCreateRoom creates an empty LiveKit room. Starting an ASR agent is a
// separate operator action so room provisioning never requests provider work.
func HandleCreateRoom(c *fiber.Ctx, cfg *config.Config) error {
	var req models.RoomCreateRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}
	if err := validateRoomName(req.Name); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	ctx, cancel := context.WithTimeout(c.UserContext(), 5*time.Second)
	defer cancel()
	roomClient := lksdk.NewRoomServiceClient(cfg.LiveKitURL, cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)
	room, err := roomClient.CreateRoom(ctx, &livekit.CreateRoomRequest{Name: req.Name})
	if err != nil {
		if isRoomConflictError(err) {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "Room already exists"})
		}
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "Failed to create room"})
	}

	return c.Status(fiber.StatusCreated).JSON(models.RoomInfo{
		Name:            room.Name,
		NumParticipants: int(room.NumParticipants),
		CreationTime:    room.CreationTime,
	})
}

func isRoomConflictError(err error) bool {
	if code, ok := psrpc.GetErrorCode(err); ok && code == psrpc.AlreadyExists {
		return true
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "already exists") ||
		strings.Contains(message, "already_exists") ||
		strings.Contains(message, "room exists") ||
		strings.Contains(message, "already_present") ||
		strings.Contains(message, "already present")
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
	roomInfos := make([]models.RoomInfo, 0, len(rooms.Rooms))
	for _, room := range rooms.Rooms {
		roomInfos = append(roomInfos, models.RoomInfo{
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
	participantInfos := make([]models.ParticipantInfo, 0, len(participants.Participants))
	for _, p := range participants.Participants {
		isAgent := p.Identity == "asr-agent" ||
			len(p.Identity) > 6 && p.Identity[:6] == "agent-"

		participantInfos = append(participantInfos, models.ParticipantInfo{
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
	stopAgentsForRoom(roomName)
	TranscriptHub().Invalidate(roomName)

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
		Name            string                   `json:"name"`
		NumParticipants int                      `json:"numParticipants"`
		MaxParticipants int                      `json:"maxParticipants"`
		CreationTime    int64                    `json:"creationTime"`
		EmptyTimeout    int                      `json:"emptyTimeout"`
		Participants    []models.ParticipantInfo `json:"participants"`
	}

	detailedRooms := make([]DetailedRoom, 0, len(rooms.Rooms))
	for _, room := range rooms.Rooms {
		// Get participants for each room
		participants, err := roomClient.ListParticipants(ctx, &livekit.ListParticipantsRequest{
			Room: room.Name,
		})

		participantInfos := []models.ParticipantInfo{}
		if err == nil {
			for _, p := range participants.Participants {
				isAgent := p.Identity == "asr-agent" ||
					(len(p.Identity) > 6 && p.Identity[:6] == "agent-")

				participantInfos = append(participantInfos, models.ParticipantInfo{
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
