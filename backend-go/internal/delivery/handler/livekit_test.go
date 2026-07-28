package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"thai-transcriber-backend/config"
	"thai-transcriber-backend/internal/application/roomoperations"

	"github.com/gofiber/fiber/v2"
)

func TestValidateRoomName(t *testing.T) {
	tests := []struct {
		name    string
		room    string
		wantErr bool
	}{
		{name: "letters and numbers", room: "daily-briefing_01"},
		{name: "one character", room: "a"},
		{name: "128 characters", room: strings.Repeat("a", 128)},
		{name: "empty", room: "", wantErr: true},
		{name: "leading whitespace", room: " room", wantErr: true},
		{name: "trailing whitespace", room: "room ", wantErr: true},
		{name: "punctuation", room: "room.name", wantErr: true},
		{name: "slash", room: "room/name", wantErr: true},
		{name: "too long", room: strings.Repeat("a", 129), wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := validateRoomName(tt.room); (err != nil) != tt.wantErr {
				t.Fatalf("validateRoomName(%q) error = %v, wantErr %v", tt.room, err, tt.wantErr)
			}
		})
	}
}

func TestHandleCreateRoomMapsConflict(t *testing.T) {
	operations := roomoperations.New(&roomHandlerAdapter{
		createErr: roomoperations.ErrRoomAlreadyExists,
	})
	app := fiber.New()
	app.Post("/rooms", func(c *fiber.Ctx) error {
		return HandleCreateRoom(c, operations)
	})

	request := httptest.NewRequest(http.MethodPost, "/rooms", strings.NewReader(`{"name":"room-a"}`))
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusConflict)
	}
}

func TestHandleLiveKitTokenRejectsPublisherForMissingRoom(t *testing.T) {
	operations := roomoperations.New(&roomHandlerAdapter{})
	cfg := &config.Config{
		LiveKitAPIKey:    "api-key",
		LiveKitAPISecret: "api-secret",
	}
	app := fiber.New()
	app.Post("/token", func(c *fiber.Ctx) error {
		return HandleLiveKitToken(c, cfg, operations)
	})

	request := httptest.NewRequest(
		http.MethodPost,
		"/token",
		strings.NewReader(`{"identity":"publisher-1","roomName":"missing-room"}`),
	)
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusNotFound)
	}
	var payload struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Code != "room_not_found" {
		t.Fatalf("code = %q, want room_not_found", payload.Code)
	}
}

func TestHandleListRoomsMapsUpstreamFailureToBadGateway(t *testing.T) {
	operations := roomoperations.New(&roomHandlerAdapter{
		listErr: errors.New("livekit unavailable"),
	})
	app := fiber.New()
	app.Get("/rooms", func(c *fiber.Ctx) error {
		return HandleListRooms(c, operations)
	})

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/rooms", nil))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusBadGateway)
	}
}

func TestHandleDetailedRoomsDoesNotReturnPartialData(t *testing.T) {
	operations := roomoperations.New(&roomHandlerAdapter{
		rooms: []roomoperations.RoomRecord{
			{Name: "room-a"},
			{Name: "room-b"},
		},
		participantErrs: map[string]error{
			"room-b": errors.New("participant lookup failed"),
		},
	})
	app := fiber.New()
	app.Get("/rooms/detailed", func(c *fiber.Ctx) error {
		return HandleGetRoomsDetailed(c, operations)
	})

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/rooms/detailed", nil))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusBadGateway)
	}
}

type roomHandlerAdapter struct {
	rooms           []roomoperations.RoomRecord
	createErr       error
	listErr         error
	participantErrs map[string]error
}

func (a *roomHandlerAdapter) CreateRoom(context.Context, string) (roomoperations.RoomRecord, error) {
	return roomoperations.RoomRecord{}, a.createErr
}

func (a *roomHandlerAdapter) ListRooms(context.Context, []string) ([]roomoperations.RoomRecord, error) {
	return a.rooms, a.listErr
}

func (a *roomHandlerAdapter) ListParticipants(_ context.Context, room string) ([]roomoperations.ParticipantRecord, error) {
	return nil, a.participantErrs[room]
}

func (a *roomHandlerAdapter) DeleteRoom(context.Context, string) error {
	return nil
}

func (a *roomHandlerAdapter) RemoveParticipant(context.Context, string, string) error {
	return nil
}
