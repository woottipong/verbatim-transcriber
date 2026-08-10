package delivery

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"thai-transcriber-backend/config"
	"thai-transcriber-backend/internal/application/captionproofread"
	"thai-transcriber-backend/internal/domain"

	"github.com/gofiber/fiber/v2"
)

type routeProofreadFake struct{}

func (routeProofreadFake) Proofread(_ context.Context, request domain.ProofreadRequest) (domain.ProofreadResult, error) {
	return domain.ProofreadResult{SuggestedText: request.TargetText}, nil
}

func proofreadTestRequest(t *testing.T) *http.Request {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/api/caption-desk/ai-proofread", strings.NewReader(`{"targetText":"ข้อความ"}`))
	request.Header.Set("Content-Type", "application/json")
	return request
}

func TestProofreadRouteRequiresRemoteControlAuth(t *testing.T) {
	app := fiber.New()
	setupProofreadRoutes(app, &config.Config{Host: "0.0.0.0", ControlAPIKey: strings.Repeat("k", 32)}, captionproofread.New(routeProofreadFake{}))
	response, err := app.Test(proofreadTestRequest(t))
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != fiber.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.StatusCode, fiber.StatusUnauthorized)
	}
}

func TestProofreadRouteRateLimitsRequests(t *testing.T) {
	var output bytes.Buffer
	previousWriter := log.Writer()
	log.SetOutput(&output)
	t.Cleanup(func() { log.SetOutput(previousWriter) })

	app := fiber.New()
	setupProofreadRoutes(app, &config.Config{Host: "localhost"}, captionproofread.New(routeProofreadFake{}))

	var lastStatus int
	for index := 0; index < proofreadRequestsPerMinute+1; index++ {
		response, err := app.Test(proofreadTestRequest(t))
		if err != nil {
			t.Fatalf("request %d error = %v", index, err)
		}
		lastStatus = response.StatusCode
		response.Body.Close()
	}
	if lastStatus != fiber.StatusTooManyRequests {
		t.Fatalf("last status = %d, want %d", lastStatus, fiber.StatusTooManyRequests)
	}
	if !strings.Contains(output.String(), "error_class=rate_limited") {
		t.Fatalf("log = %q, want rate-limited event", output.String())
	}
}

func TestProvidersReportsProofreadCapability(t *testing.T) {
	app := fiber.New()
	cfg := &config.Config{
		GeminiAPIKey: "gemini-key",
		GeminiProofreadConfig: config.GeminiProofreadConfig{
			Model: "gemini-3.5-flash-lite",
		},
	}
	setupHealthRoutes(app, cfg, captionproofread.New(routeProofreadFake{}))
	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/providers", nil))
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	defer response.Body.Close()
	var payload map[string]bool
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload["captionProofread"] {
		t.Fatalf("captionProofread = false, payload = %#v", payload)
	}
}

func TestProvidersDoesNotReportProofreadWhenServiceIsDisabled(t *testing.T) {
	app := fiber.New()
	cfg := &config.Config{
		GeminiAPIKey: "gemini-key",
		GeminiProofreadConfig: config.GeminiProofreadConfig{
			Model: "gemini-2.5-flash-lite",
		},
	}
	setupHealthRoutes(app, cfg, captionproofread.New(nil))

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/providers", nil))
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	defer response.Body.Close()
	var payload map[string]bool
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["captionProofread"] {
		t.Fatalf("captionProofread = true with a disabled service, payload = %#v", payload)
	}
}
