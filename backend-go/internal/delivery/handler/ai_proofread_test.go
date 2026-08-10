package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"thai-transcriber-backend/internal/application/captionproofread"
	"thai-transcriber-backend/internal/domain"

	"github.com/gofiber/fiber/v2"
)

type proofreadHandlerFake struct {
	suggestion string
}

func (f proofreadHandlerFake) Proofread(_ context.Context, request domain.ProofreadRequest) (domain.ProofreadResult, error) {
	return domain.ProofreadResult{RequestID: request.RequestID, Revision: request.Revision, SuggestedText: f.suggestion}, nil
}

func TestHandleAIProofreadMapsValidationAndSuccess(t *testing.T) {
	app := fiber.New()
	service := captionproofread.New(proofreadHandlerFake{suggestion: "แก้แล้ว"})
	app.Post("/proofread", func(c *fiber.Ctx) error { return HandleAIProofread(c, service) })

	tests := []struct {
		name       string
		body       string
		wantStatus int
	}{
		{name: "invalid json", body: "{", wantStatus: fiber.StatusBadRequest},
		{name: "empty target", body: `{"targetText":"   "}`, wantStatus: fiber.StatusBadRequest},
		{name: "oversized target", body: `{"targetText":"` + strings.Repeat("ก", 6_000) + `"}`, wantStatus: fiber.StatusRequestEntityTooLarge},
		{name: "success", body: `{"requestId":"r1","revision":2,"targetText":"ผิด"}`, wantStatus: fiber.StatusOK},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/proofread", strings.NewReader(tt.body))
			request.Header.Set("Content-Type", "application/json")
			response, err := app.Test(request)
			if err != nil {
				t.Fatalf("app.Test() error = %v", err)
			}
			defer response.Body.Close()
			if response.StatusCode != tt.wantStatus {
				t.Fatalf("status = %d, want %d", response.StatusCode, tt.wantStatus)
			}
		})
	}
}

func TestHandleAIProofreadDisabled(t *testing.T) {
	app := fiber.New()
	app.Post("/proofread", func(c *fiber.Ctx) error { return HandleAIProofread(c, captionproofread.New(nil)) })
	request := httptest.NewRequest(http.MethodPost, "/proofread", strings.NewReader(`{"targetText":"ข้อความ"}`))
	request.Header.Set("Content-Type", "application/json")
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != fiber.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", response.StatusCode, fiber.StatusServiceUnavailable)
	}
}
