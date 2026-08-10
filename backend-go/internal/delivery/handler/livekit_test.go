package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"thai-transcriber-backend/config"
	"thai-transcriber-backend/internal/application/agentsupervisor"
	"thai-transcriber-backend/internal/application/roomoperations"

	"github.com/gofiber/fiber/v2"
	"github.com/livekit/protocol/auth"
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

func TestHandleViewerTokenIssuesServerOwnedReadOnlyGrant(t *testing.T) {
	cfg := &config.Config{
		LiveKitAPIKey:    "api-key",
		LiveKitAPISecret: "api-secret",
		LiveKitURL:       "ws://livekit.test",
		LiveKitConfig:    config.LiveKitConfig{TokenExpiry: 3600},
	}
	operations := roomoperations.New(&roomHandlerAdapter{
		rooms: []roomoperations.RoomRecord{{SID: "RM_room_a", Name: "room-a"}},
	})
	app := fiber.New()
	app.Post("/viewer-token", func(c *fiber.Ctx) error {
		return HandleViewerToken(c, cfg, operations)
	})

	request := httptest.NewRequest(
		http.MethodPost,
		"/viewer-token",
		strings.NewReader(`{"roomName":"room-a","canPublish":true,"canPublishData":true}`),
	)
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusOK)
	}
	var payload struct {
		Token string `json:"token"`
		WsURL string `json:"wsUrl"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	verifier, err := auth.ParseAPIToken(payload.Token)
	if err != nil {
		t.Fatal(err)
	}
	_, grants, err := verifier.Verify(cfg.LiveKitAPISecret)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(grants.Identity, "viewer-") || grants.Video == nil ||
		!grants.Video.RoomJoin || grants.Video.Room != "room-a" ||
		grants.Video.CanPublish == nil || *grants.Video.CanPublish ||
		grants.Video.CanSubscribe == nil || !*grants.Video.CanSubscribe ||
		grants.Video.CanPublishData == nil || *grants.Video.CanPublishData {
		t.Fatalf("viewer grants = %#v", grants)
	}
	if payload.WsURL != cfg.LiveKitURL {
		t.Fatalf("wsUrl = %q, want %q", payload.WsURL, cfg.LiveKitURL)
	}
}

func TestHandleCaptionDeskTokenRequiresActiveProvider(t *testing.T) {
	cfg := captionTokenTestConfig()
	operations := roomoperations.New(&roomHandlerAdapter{
		rooms: []roomoperations.RoomRecord{{SID: "RM_room_a", Name: "room-a"}},
	})
	supervisor := agentsupervisor.New(func(string) agentsupervisor.Agent {
		return newCaptionTokenAgent()
	})
	app := fiber.New()
	app.Post("/rooms/:room/caption-token/:provider", func(c *fiber.Ctx) error {
		return HandleCaptionDeskToken(c, cfg, operations, supervisor)
	})

	response, err := app.Test(httptest.NewRequest(
		http.MethodPost,
		"/rooms/room-a/caption-token/google?sessionId=desk-session-12345678",
		nil,
	))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusConflict {
		t.Fatalf("inactive provider status = %d, want %d", response.StatusCode, http.StatusConflict)
	}

	missingResponse, err := app.Test(httptest.NewRequest(
		http.MethodPost,
		"/rooms/missing/caption-token/google?sessionId=desk-session-12345678",
		nil,
	))
	if err != nil {
		t.Fatal(err)
	}
	if missingResponse.StatusCode != http.StatusNotFound {
		t.Fatalf("missing room status = %d, want %d", missingResponse.StatusCode, http.StatusNotFound)
	}
}

func TestHandleCaptionDeskTokenIssuesServerOwnedOperatorGrant(t *testing.T) {
	cfg := captionTokenTestConfig()
	operations := roomoperations.New(&roomHandlerAdapter{
		rooms: []roomoperations.RoomRecord{{SID: "RM_room_a", Name: "room-a"}},
	})
	created := make(chan *captionTokenAgent, 1)
	supervisor := agentsupervisor.New(func(string) agentsupervisor.Agent {
		agent := newCaptionTokenAgent()
		created <- agent
		return agent
	})
	if err := supervisor.Start(t.Context(), "room-a", "google"); err != nil {
		t.Fatal(err)
	}
	agent := <-created
	waitForCaptionTokenSignal(t, agent.started)
	defer func() {
		_ = supervisor.Stop("room-a", "google")
		waitForCaptionTokenSignal(t, agent.finished)
	}()

	app := fiber.New()
	app.Post("/rooms/:room/caption-token/:provider", func(c *fiber.Ctx) error {
		return HandleCaptionDeskToken(c, cfg, operations, supervisor)
	})
	response, err := app.Test(httptest.NewRequest(
		http.MethodPost,
		"/rooms/room-a/caption-token/google?sessionId=desk-session-12345678",
		nil,
	))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusOK)
	}
	var payload struct {
		Token    string `json:"token"`
		WsURL    string `json:"wsUrl"`
		Identity string `json:"identity"`
		Room     string `json:"room"`
		Provider string `json:"provider"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(payload.Identity, "caption-operator-") ||
		payload.Room != "room-a" || payload.Provider != "google" || payload.WsURL != cfg.LiveKitURL {
		t.Fatalf("token response = %#v", payload)
	}

	verifier, err := auth.ParseAPIToken(payload.Token)
	if err != nil {
		t.Fatal(err)
	}
	_, grants, err := verifier.Verify(cfg.LiveKitAPISecret)
	if err != nil {
		t.Fatal(err)
	}
	if grants.Identity != payload.Identity || grants.Video == nil ||
		!grants.Video.RoomJoin || grants.Video.Room != "room-a" ||
		grants.Video.CanPublish == nil || *grants.Video.CanPublish ||
		grants.Video.CanSubscribe == nil || !*grants.Video.CanSubscribe ||
		grants.Video.CanPublishData == nil || !*grants.Video.CanPublishData {
		t.Fatalf("operator grants = %#v", grants)
	}
	var metadata captionOperatorMetadata
	if err := json.Unmarshal([]byte(grants.Metadata), &metadata); err != nil {
		t.Fatal(err)
	}
	if metadata.Role != "caption-operator" || metadata.Provider != "google" ||
		metadata.SessionID != "desk-session-12345678" ||
		metadata.CaptionPolicy != "provider-final" {
		t.Fatalf("operator metadata = %#v", metadata)
	}
}

func TestHandleCaptionDeskTokenSignsSelectedCaptionPolicy(t *testing.T) {
	cfg := captionTokenTestConfig()
	operations := roomoperations.New(&roomHandlerAdapter{
		rooms: []roomoperations.RoomRecord{{SID: "RM_room_a", Name: "room-a"}},
	})
	created := make(chan *captionTokenAgent, 1)
	supervisor := agentsupervisor.New(func(string) agentsupervisor.Agent {
		agent := newCaptionTokenAgent()
		created <- agent
		return agent
	})
	if err := supervisor.Start(t.Context(), "room-a", "google"); err != nil {
		t.Fatal(err)
	}
	agent := <-created
	waitForCaptionTokenSignal(t, agent.started)
	defer func() {
		_ = supervisor.Stop("room-a", "google")
		waitForCaptionTokenSignal(t, agent.finished)
	}()

	app := fiber.New()
	app.Post("/rooms/:room/caption-token/:provider", func(c *fiber.Ctx) error {
		return HandleCaptionDeskToken(c, cfg, operations, supervisor)
	})
	response, err := app.Test(httptest.NewRequest(
		http.MethodPost,
		"/rooms/room-a/caption-token/google?sessionId=desk-session-12345678&policy=early-final",
		nil,
	))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusOK)
	}
	var payload struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	verifier, err := auth.ParseAPIToken(payload.Token)
	if err != nil {
		t.Fatal(err)
	}
	_, grants, err := verifier.Verify(cfg.LiveKitAPISecret)
	if err != nil {
		t.Fatal(err)
	}
	var metadata captionOperatorMetadata
	if err := json.Unmarshal([]byte(grants.Metadata), &metadata); err != nil {
		t.Fatal(err)
	}
	if metadata.CaptionPolicy != "early-final" {
		t.Fatalf("caption policy = %q", metadata.CaptionPolicy)
	}

	invalid, err := app.Test(httptest.NewRequest(
		http.MethodPost,
		"/rooms/room-a/caption-token/google?sessionId=desk-session-12345678&policy=unknown",
		nil,
	))
	if err != nil {
		t.Fatal(err)
	}
	if invalid.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid policy status = %d, want %d", invalid.StatusCode, http.StatusBadRequest)
	}
}

func TestHandleCaptionDeskTokenRequiresSessionID(t *testing.T) {
	cfg := captionTokenTestConfig()
	operations := roomoperations.New(&roomHandlerAdapter{
		rooms: []roomoperations.RoomRecord{{SID: "RM_room_a", Name: "room-a"}},
	})
	supervisor := agentsupervisor.New(func(string) agentsupervisor.Agent {
		return newCaptionTokenAgent()
	})
	app := fiber.New()
	app.Post("/rooms/:room/caption-token/:provider", func(c *fiber.Ctx) error {
		return HandleCaptionDeskToken(c, cfg, operations, supervisor)
	})

	response, err := app.Test(httptest.NewRequest(
		http.MethodPost,
		"/rooms/room-a/caption-token/google",
		nil,
	))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusBadRequest)
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

type captionTokenAgent struct {
	mu         sync.Mutex
	started    chan struct{}
	finished   chan struct{}
	finishOnce sync.Once
	running    bool
}

func newCaptionTokenAgent() *captionTokenAgent {
	return &captionTokenAgent{started: make(chan struct{}), finished: make(chan struct{})}
}

func (a *captionTokenAgent) Start(ctx context.Context, _ string) error {
	a.mu.Lock()
	a.running = true
	a.mu.Unlock()
	close(a.started)
	return nil
}

func (a *captionTokenAgent) Stop() {
	a.mu.Lock()
	a.running = false
	a.mu.Unlock()
	a.finishOnce.Do(func() { close(a.finished) })
}

func (a *captionTokenAgent) IsRunning() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.running
}

func captionTokenTestConfig() *config.Config {
	return &config.Config{
		GoogleCloudProject:           "project",
		GoogleApplicationCredentials: "credentials.json",
		LiveKitAPIKey:                "api-key",
		LiveKitAPISecret:             "api-secret-long-enough",
		LiveKitURL:                   "ws://livekit.test",
		LiveKitConfig:                config.LiveKitConfig{TokenExpiry: 3600},
	}
}

func waitForCaptionTokenSignal(t *testing.T, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-t.Context().Done():
		t.Fatal("timed out waiting for caption token agent")
	}
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
