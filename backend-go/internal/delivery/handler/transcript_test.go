package handler

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"thai-transcriber-backend/internal/application/roomoperations"
	"thai-transcriber-backend/internal/application/transcriptaccess"
	"thai-transcriber-backend/internal/infrastructure/transcript"

	"github.com/gofiber/fiber/v2"
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
