package handler

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"

	"thai-transcriber-backend/config"
	"thai-transcriber-backend/internal/application/agentsupervisor"
	"thai-transcriber-backend/internal/application/roomoperations"
	"thai-transcriber-backend/models"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/livekit/protocol/auth"
)

var roomNamePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
var deskSessionIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{8,128}$`)

func validateRoomName(name string) error {
	if name == "" || name != strings.TrimSpace(name) || !roomNamePattern.MatchString(name) {
		return errors.New("room name must be 1-128 characters using letters, numbers, hyphens, or underscores")
	}
	return nil
}

// HandleLiveKitToken generates a LiveKit access token.
func HandleLiveKitToken(c *fiber.Ctx, cfg *config.Config, rooms *roomoperations.Operations) error {
	var req models.TokenRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "Invalid request body",
			"details": err.Error(),
		})
	}
	if req.Identity == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "identity is required"})
	}
	if req.RoomName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "roomName is required"})
	}
	if err := validateRoomName(req.RoomName); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

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

	// Every browser participant must join a room provisioned by Control Room.
	// This prevents publisher tokens from implicitly creating arbitrary rooms.
	if _, err := rooms.Find(c.UserContext(), req.RoomName); err != nil {
		if errors.Is(err, roomoperations.ErrRoomNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"code":  "room_not_found",
				"error": "Room does not exist or is no longer available",
			})
		}
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error": "Failed to verify room availability",
		})
	}

	grant := &auth.VideoGrant{
		RoomJoin:       true,
		Room:           req.RoomName,
		CanPublish:     &canPublish,
		CanSubscribe:   &canSubscribe,
		CanPublishData: &canPublishData,
	}
	token, err := auth.NewAccessToken(cfg.LiveKitAPIKey, cfg.LiveKitAPISecret).
		SetVideoGrant(grant).
		SetIdentity(req.Identity).
		SetValidFor(time.Duration(cfg.LiveKitConfig.TokenExpiry) * time.Second).
		ToJWT()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to generate token",
		})
	}

	return c.JSON(models.TokenResponse{Token: token, WsURL: cfg.LiveKitURL})
}

func HandleCaptionDeskToken(
	c *fiber.Ctx,
	cfg *config.Config,
	rooms *roomoperations.Operations,
	supervisor *agentsupervisor.Supervisor,
) error {
	roomName := c.Params("room")
	if err := validateRoomName(roomName); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	provider, err := validateAgentProvider(cfg, c.Params("provider"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	sessionID := strings.TrimSpace(c.Query("sessionId"))
	if !deskSessionIDPattern.MatchString(sessionID) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Caption Desk session ID is invalid",
		})
	}
	if _, err := rooms.Find(c.UserContext(), roomName); err != nil {
		if errors.Is(err, roomoperations.ErrRoomNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"code": "room_not_found", "error": "Room does not exist or is no longer available",
			})
		}
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "Failed to verify room availability"})
	}

	if !hasConnectedAgent(supervisor, roomName, provider) {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"code":  "provider_not_active",
			"error": "The provider is not active in this room",
		})
	}

	identity := "caption-operator-" + uuid.NewString()
	canPublish := false
	canSubscribe := true
	canPublishData := true
	grant := &auth.VideoGrant{
		RoomJoin:       true,
		Room:           roomName,
		CanPublish:     &canPublish,
		CanSubscribe:   &canSubscribe,
		CanPublishData: &canPublishData,
	}
	metadata, err := json.Marshal(captionOperatorMetadata{
		Role: "caption-operator", Provider: provider, SessionID: sessionID,
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create operator metadata"})
	}
	token, err := auth.NewAccessToken(cfg.LiveKitAPIKey, cfg.LiveKitAPISecret).
		SetVideoGrant(grant).
		SetIdentity(identity).
		SetMetadata(string(metadata)).
		SetValidFor(time.Duration(cfg.LiveKitConfig.TokenExpiry) * time.Second).
		ToJWT()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create Caption Desk token"})
	}
	return c.JSON(models.CaptionDeskTokenResponse{
		Token: token, WsURL: cfg.LiveKitURL, Identity: identity, Room: roomName, Provider: provider,
	})
}

type captionOperatorMetadata struct {
	Role      string `json:"role"`
	Provider  string `json:"provider"`
	SessionID string `json:"sessionId"`
}

// HandleCreateRoom creates an empty room. Starting an agent remains a separate
// operator action.
func HandleCreateRoom(c *fiber.Ctx, rooms *roomoperations.Operations) error {
	var req models.RoomCreateRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}
	if err := validateRoomName(req.Name); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	room, err := rooms.Create(c.UserContext(), req.Name)
	if err != nil {
		if errors.Is(err, roomoperations.ErrRoomAlreadyExists) {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "Room already exists"})
		}
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "Failed to create room"})
	}
	return c.Status(fiber.StatusCreated).JSON(roomInfo(room))
}

func HandleListRooms(c *fiber.Ctx, rooms *roomoperations.Operations) error {
	found, err := rooms.List(c.UserContext())
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "Failed to list rooms"})
	}
	roomInfos := make([]models.RoomInfo, 0, len(found))
	for _, room := range found {
		roomInfos = append(roomInfos, roomInfo(room))
	}
	return c.JSON(fiber.Map{"rooms": roomInfos, "total": len(roomInfos)})
}

func HandleGetRoom(c *fiber.Ctx, rooms *roomoperations.Operations) error {
	roomName := c.Params("name")
	if roomName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "room name is required"})
	}

	details, err := rooms.Get(c.UserContext(), roomName)
	if err != nil {
		return writeRoomUpstreamError(c, err, "Failed to get room participants")
	}
	participants := participantInfos(details.Participants)
	return c.JSON(fiber.Map{
		"name":         roomName,
		"participants": participants,
		"total":        len(participants),
	})
}

// HandleDeleteRoom deletes a room before coordinating dependent local state.
func HandleDeleteRoom(
	c *fiber.Ctx,
	rooms *roomoperations.Operations,
	supervisor *agentsupervisor.Supervisor,
) error {
	roomName := c.Params("name")
	if roomName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "room name is required"})
	}
	if err := rooms.Delete(c.UserContext(), roomName); err != nil {
		return writeRoomUpstreamError(c, err, "Failed to delete room")
	}

	supervisor.StopRoom(roomName)
	TranscriptHub().Invalidate(roomName)
	return c.JSON(fiber.Map{
		"success": true,
		"message": "Room deleted: " + roomName,
	})
}

func HandleRemoveParticipant(c *fiber.Ctx, rooms *roomoperations.Operations) error {
	roomName := c.Params("room")
	identity := c.Params("identity")
	if roomName == "" || identity == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "room and identity are required",
		})
	}
	if err := rooms.RemoveParticipant(c.UserContext(), roomName, identity); err != nil {
		return writeRoomUpstreamError(c, err, "Failed to remove participant")
	}
	return c.JSON(fiber.Map{
		"success": true,
		"message": "Participant removed: " + identity,
	})
}

func HandleGetRoomsDetailed(c *fiber.Ctx, rooms *roomoperations.Operations) error {
	found, err := rooms.Detailed(c.UserContext())
	if err != nil {
		return writeRoomUpstreamError(c, err, "Failed to load detailed rooms")
	}

	type detailedRoom struct {
		Name            string                   `json:"name"`
		NumParticipants int                      `json:"numParticipants"`
		MaxParticipants int                      `json:"maxParticipants"`
		CreationTime    int64                    `json:"creationTime"`
		EmptyTimeout    int                      `json:"emptyTimeout"`
		Participants    []models.ParticipantInfo `json:"participants"`
	}
	response := make([]detailedRoom, 0, len(found))
	for _, details := range found {
		response = append(response, detailedRoom{
			Name:            details.Name,
			NumParticipants: details.NumParticipants,
			MaxParticipants: details.MaxParticipants,
			CreationTime:    details.CreationTime,
			EmptyTimeout:    details.EmptyTimeout,
			Participants:    participantInfos(details.Participants),
		})
	}
	return c.JSON(fiber.Map{"rooms": response, "total": len(response)})
}

func writeRoomUpstreamError(c *fiber.Ctx, err error, message string) error {
	if errors.Is(err, roomoperations.ErrRoomNotFound) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Room not found"})
	}
	return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": message})
}

func roomInfo(room roomoperations.Room) models.RoomInfo {
	return models.RoomInfo{
		Name:            room.Name,
		NumParticipants: room.NumParticipants,
		CreationTime:    room.CreationTime,
	}
}

func participantInfos(participants []roomoperations.Participant) []models.ParticipantInfo {
	response := make([]models.ParticipantInfo, 0, len(participants))
	for _, participant := range participants {
		response = append(response, models.ParticipantInfo{
			Identity: participant.Identity,
			Name:     participant.Name,
			IsAgent:  participant.IsAgent,
			State:    participant.State,
		})
	}
	return response
}
