package handler

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"thai-transcriber-backend/internal/application/agentsupervisor"
	"thai-transcriber-backend/internal/application/captionmoderation"
	"thai-transcriber-backend/internal/application/roomoperations"
	"thai-transcriber-backend/internal/application/transcriptaccess"
	"thai-transcriber-backend/internal/infrastructure/transcript"

	"github.com/gofiber/fiber/v2"
	fiberwebsocket "github.com/gofiber/websocket/v2"
	gorillawebsocket "github.com/gorilla/websocket"
)

func TestHandleCreateTranscriptTokenRequiresSecret(t *testing.T) {
	app := fiber.New()
	rooms := roomoperations.New(&roomHandlerAdapter{
		rooms: []roomoperations.RoomRecord{{Name: "demo", SID: "RM_demo"}},
	})
	access := transcriptaccess.New(
		rooms,
		transcript.NewTokenService("", 24*time.Hour),
		TranscriptHub(),
	)
	app.Post("/livekit/rooms/:room/transcript-token", func(c *fiber.Ctx) error {
		return HandleCreateTranscriptToken(c, access)
	})

	request := httptest.NewRequest(http.MethodPost, "/livekit/rooms/demo/transcript-token", nil)
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	if response.StatusCode != fiber.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", response.StatusCode, fiber.StatusServiceUnavailable)
	}
}

func TestBuildCaptionWebSocketURLUsesProviderAndRoom(t *testing.T) {
	app := fiber.New()
	app.Get("/", func(c *fiber.Ctx) error {
		return c.SendString(buildCaptionWebSocketURL(c, "daily-briefing", "google", "signed token"))
	})
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Host = "transcriber.example"
	request.Header.Set("X-Forwarded-Proto", "https")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	want := "wss://transcriber.example/ws/caption/google/daily-briefing?token=signed+token"
	if string(body) != want {
		t.Fatalf("URL = %q, want %q", body, want)
	}
}

func TestHandleCreateCaptionTokenRequiresConnectedProvider(t *testing.T) {
	rooms := roomoperations.New(&roomHandlerAdapter{
		rooms: []roomoperations.RoomRecord{{Name: "room-a", SID: "RM_1"}},
	})
	access := transcriptaccess.New(
		rooms,
		transcript.NewTokenService("test-secret-at-least-32-bytes-long", time.Hour),
		TranscriptHub(),
	)
	supervisor := agentsupervisor.New(func(string, captionmoderation.Mode) agentsupervisor.Agent {
		return newCaptionTokenAgent()
	})
	app := fiber.New()
	app.Post("/:room/:provider", func(c *fiber.Ctx) error {
		return HandleCreateCaptionToken(c, access, supervisor)
	})
	response, err := app.Test(httptest.NewRequest(http.MethodPost, "/room-a/google", nil))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusConflict)
	}
}

func TestHandleCreateCaptionTokenReturnsApprovedFeedURL(t *testing.T) {
	rooms := roomoperations.New(&roomHandlerAdapter{
		rooms: []roomoperations.RoomRecord{{Name: "room-a", SID: "RM_1"}},
	})
	access := transcriptaccess.New(
		rooms,
		transcript.NewTokenService("test-secret-at-least-32-bytes-long", time.Hour),
		TranscriptHub(),
	)
	created := make(chan *captionTokenAgent, 1)
	supervisor := agentsupervisor.New(func(string, captionmoderation.Mode) agentsupervisor.Agent {
		agent := newCaptionTokenAgent()
		created <- agent
		return agent
	})
	if err := supervisor.Start(t.Context(), "room-a", "google", captionmoderation.ModeLive); err != nil {
		t.Fatal(err)
	}
	agent := <-created
	waitForCaptionTokenSignal(t, agent.started)
	for !hasConnectedAgent(supervisor, "room-a", "google") {
		select {
		case <-time.After(time.Millisecond):
		case <-t.Context().Done():
			t.Fatal("agent did not become connected")
		}
	}
	t.Cleanup(func() { _ = supervisor.Stop("room-a", "google") })

	app := fiber.New()
	app.Post("/:room/:provider", func(c *fiber.Ctx) error {
		return HandleCreateCaptionToken(c, access, supervisor)
	})
	request := httptest.NewRequest(http.MethodPost, "/room-a/google", nil)
	request.Host = "api.example.com"
	request.Header.Set("X-Forwarded-Proto", "https")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusOK)
	}
	body, _ := io.ReadAll(response.Body)
	if !strings.Contains(string(body), `wss://api.example.com/ws/caption/google/room-a?token=`) {
		t.Fatalf("response = %s", body)
	}
}

func TestCaptionAndTranscriptTokensCannotCrossMiddleware(t *testing.T) {
	rooms := roomoperations.New(&roomHandlerAdapter{
		rooms: []roomoperations.RoomRecord{{Name: "room-a", SID: "RM_1"}},
	})
	tokens := transcript.NewTokenService("test-secret-at-least-32-bytes-long", time.Hour)
	access := transcriptaccess.New(rooms, tokens, TranscriptHub())
	raw, err := access.Issue(t.Context(), transcriptaccess.Scope{
		Room: "room-a", Provider: "google", Purpose: transcriptaccess.FeedTranscript,
	})
	if err != nil {
		t.Fatal(err)
	}
	caption, err := access.Issue(t.Context(), transcriptaccess.Scope{
		Room: "room-a", Provider: "google", Purpose: transcriptaccess.FeedCaption,
	})
	if err != nil {
		t.Fatal(err)
	}
	app := fiber.New()
	app.Get("/caption/:provider/:room", CaptionWebSocketMiddleware(access), func(c *fiber.Ctx) error {
		return c.SendStatus(http.StatusNoContent)
	})
	app.Get("/raw/:provider/:room", ProviderTranscriptWebSocketMiddleware(access), func(c *fiber.Ctx) error {
		return c.SendStatus(http.StatusNoContent)
	})
	if status := websocketUpgradeStatus(t, app, "/caption/google/room-a?token="+raw.Token); status != http.StatusUnauthorized {
		t.Fatalf("raw token on caption endpoint = %d", status)
	}
	if status := websocketUpgradeStatus(t, app, "/raw/google/room-a?token="+caption.Token); status != http.StatusUnauthorized {
		t.Fatalf("caption token on raw endpoint = %d", status)
	}
}

func TestCaptionWebSocketWritesOnePlainTextFrameWithoutReadyEvent(t *testing.T) {
	hub := transcript.NewHub()
	app := fiber.New()
	app.Get("/ws/caption/:provider/:room", fiberwebsocket.New(HandleCaptionWebSocket(hub)))
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	serverDone := make(chan error, 1)
	go func() { serverDone <- app.Listener(listener) }()
	t.Cleanup(func() {
		_ = app.Shutdown()
		_ = listener.Close()
		select {
		case <-serverDone:
		case <-time.After(time.Second):
		}
	})

	conn, _, err := gorillawebsocket.DefaultDialer.Dial(
		"ws://"+listener.Addr().String()+"/ws/caption/google/room-a",
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	publishDone := make(chan struct{})
	go func() {
		defer close(publishDone)
		ticker := time.NewTicker(10 * time.Millisecond)
		defer ticker.Stop()
		for range ticker.C {
			hub.PublishCaption("room-a", "google", "ผู้ป่วยมีอาการเจ็บหน้าอก")
			return
		}
	}()
	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	messageType, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	if messageType != gorillawebsocket.TextMessage || string(payload) != "ผู้ป่วยมีอาการเจ็บหน้าอก" {
		t.Fatalf("frame type=%d payload=%q", messageType, payload)
	}
	<-publishDone
}

func websocketUpgradeStatus(t *testing.T, app *fiber.App, target string) int {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, target, nil)
	request.Header.Set("Connection", "Upgrade")
	request.Header.Set("Upgrade", "websocket")
	request.Header.Set("Sec-WebSocket-Version", "13")
	request.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	return response.StatusCode
}

func TestBuildTranscriptWebSocketURLUsesForwardedSchemeAndHost(t *testing.T) {
	app := fiber.New()
	app.Get("/url", func(c *fiber.Ctx) error {
		return c.SendString(buildTranscriptWebSocketURL(c, "daily-briefing", "signed token"))
	})

	request := httptest.NewRequest(http.MethodGet, "/url", nil)
	request.Host = "transcriber.example:8443"
	request.Header.Set("X-Forwarded-Proto", "https")
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusOK)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("response body read error = %v", err)
	}
	want := "wss://transcriber.example:8443/livekit/rooms/daily-briefing/transcripts/ws?token=signed+token"
	if string(body) != want {
		t.Fatalf("URL = %q, want %q", string(body), want)
	}
}

func TestBuildProviderTranscriptWebSocketURLUsesProviderAndRoom(t *testing.T) {
	app := fiber.New()
	app.Get("/", func(c *fiber.Ctx) error {
		return c.SendString(buildProviderTranscriptWebSocketURL(
			c,
			"daily-briefing",
			"gpt-realtime-whisper",
			"signed token",
		))
	})

	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Host = "transcriber.example:8443"
	request.Header.Set("X-Forwarded-Proto", "https")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	want := "wss://transcriber.example:8443/ws/transcript/gpt-realtime-whisper/daily-briefing?token=signed+token"
	if string(body) != want {
		t.Fatalf("URL = %q, want %q", body, want)
	}
}
