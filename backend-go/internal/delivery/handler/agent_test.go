package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"thai-transcriber-backend/config"
	"thai-transcriber-backend/internal/application/agentsupervisor"
	"thai-transcriber-backend/internal/application/captionmoderation"

	"github.com/gofiber/fiber/v2"
)

func TestValidateAgentProvider(t *testing.T) {
	cfg := &config.Config{
		GoogleCloudProject:           "project",
		GoogleApplicationCredentials: "credentials.json",
		GeminiAPIKey:                 "gemini-key",
		AzureSubscriptionKey:         "azure-key",
		AzureRegion:                  "southeastasia",
		OpenAIAPIKey:                 "openai-key",
	}

	tests := []struct {
		name     string
		provider string
		want     string
		wantErr  bool
	}{
		{name: "normalizes Google", provider: " Google ", want: "google"},
		{name: "accepts Azure", provider: "azure", want: "azure"},
		{name: "accepts Gemini", provider: " GEMINI ", want: "gemini"},
		{name: "accepts OpenAI Whisper", provider: "gpt-realtime-whisper", want: "gpt-realtime-whisper"},
		{name: "rejects empty", wantErr: true},
		{name: "rejects unknown", provider: "other", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := validateAgentProvider(cfg, tt.provider)
			if (err != nil) != tt.wantErr {
				t.Fatalf("validateAgentProvider(%q) error = %v, wantErr %v", tt.provider, err, tt.wantErr)
			}
			if got != tt.want {
				t.Fatalf("validateAgentProvider(%q) = %q, want %q", tt.provider, got, tt.want)
			}
		})
	}
}

func TestValidateAgentProviderRejectsUnavailableProvider(t *testing.T) {
	if _, err := validateAgentProvider(&config.Config{}, "google"); err == nil {
		t.Fatal("validateAgentProvider() accepted Google without credentials")
	}
}

func TestAgentHandlersPreserveAsyncLifecycleContract(t *testing.T) {
	cfg := &config.Config{
		GoogleCloudProject:           "project",
		GoogleApplicationCredentials: "credentials.json",
	}
	created := make(chan *handlerFakeAgent, 1)
	supervisor := agentsupervisor.New(func(string, captionmoderation.Mode) agentsupervisor.Agent {
		agent := newHandlerFakeAgent()
		created <- agent
		return agent
	})
	app := fiber.New()
	app.Post("/start", func(c *fiber.Ctx) error {
		return HandleAgentStart(c, cfg, supervisor)
	})
	app.Post("/stop", func(c *fiber.Ctx) error {
		return HandleAgentStop(c, cfg, supervisor)
	})
	app.Get("/status", func(c *fiber.Ctx) error {
		return HandleAgentStatus(c, supervisor)
	})

	assertAgentRequestStatus(t, app, http.MethodPost, "/start", `{"roomName":"room-a","provider":"google"}`, http.StatusOK)
	agent := <-created
	agent.waitStarted(t)

	assertAgentRequestStatus(t, app, http.MethodGet, "/status", "", http.StatusOK)
	assertAgentRequestStatus(t, app, http.MethodPost, "/start", `{"roomName":"room-a","provider":"google"}`, http.StatusConflict)
	assertAgentRequestStatus(t, app, http.MethodPost, "/stop", `{"roomName":"room-a","provider":"google"}`, http.StatusOK)
	agent.waitFinished(t)
	assertAgentRequestStatus(t, app, http.MethodPost, "/stop", `{"roomName":"room-a","provider":"google"}`, http.StatusNotFound)
}

func TestHandleAgentStartRejectsInvalidMode(t *testing.T) {
	cfg := &config.Config{
		GoogleCloudProject:           "project",
		GoogleApplicationCredentials: "credentials.json",
	}
	supervisor := agentsupervisor.New(func(string, captionmoderation.Mode) agentsupervisor.Agent {
		return newHandlerFakeAgent()
	})
	app := fiber.New()
	app.Post("/start", func(c *fiber.Ctx) error {
		return HandleAgentStart(c, cfg, supervisor)
	})

	assertAgentRequestStatus(
		t,
		app,
		http.MethodPost,
		"/start",
		`{"roomName":"room-a","provider":"google","mode":"automatic"}`,
		http.StatusBadRequest,
	)
}

type handlerFakeAgent struct {
	mu       sync.Mutex
	started  chan struct{}
	finished chan struct{}
	running  bool
}

func newHandlerFakeAgent() *handlerFakeAgent {
	return &handlerFakeAgent{
		started:  make(chan struct{}),
		finished: make(chan struct{}),
	}
}

func (a *handlerFakeAgent) Start(ctx context.Context, _ string) error {
	a.mu.Lock()
	a.running = true
	a.mu.Unlock()
	close(a.started)
	defer func() {
		a.mu.Lock()
		a.running = false
		a.mu.Unlock()
		close(a.finished)
	}()
	<-ctx.Done()
	return ctx.Err()
}

func (a *handlerFakeAgent) Stop() {
	a.mu.Lock()
	a.running = false
	a.mu.Unlock()
}

func (a *handlerFakeAgent) IsRunning() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.running
}

func (a *handlerFakeAgent) waitStarted(t *testing.T) {
	t.Helper()
	waitForHandlerSignal(t, a.started)
}

func (a *handlerFakeAgent) waitFinished(t *testing.T) {
	t.Helper()
	waitForHandlerSignal(t, a.finished)
}

func waitForHandlerSignal(t *testing.T, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-t.Context().Done():
		t.Fatal("timed out waiting for handler agent lifecycle")
	}
}

func assertAgentRequestStatus(
	t *testing.T,
	app *fiber.App,
	method string,
	target string,
	body string,
	want int,
) {
	t.Helper()
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	if body != "" {
		request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	}
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("%s %s error = %v", method, target, err)
	}
	if response.StatusCode != want {
		t.Fatalf("%s %s status = %d, want %d", method, target, response.StatusCode, want)
	}
}
