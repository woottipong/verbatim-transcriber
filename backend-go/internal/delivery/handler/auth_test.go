package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"thai-transcriber-backend/config"

	"github.com/gofiber/fiber/v2"
)

func TestRequireControlAuthAllowsLocalDevelopment(t *testing.T) {
	app := fiber.New()
	app.Get("/protected", RequireControlAuth(&config.Config{Host: "localhost"}), func(c *fiber.Ctx) error {
		return c.SendStatus(http.StatusNoContent)
	})

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/protected", nil))
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusNoContent)
	}
}

func TestRequireControlAuthFailsClosedForRemoteBackend(t *testing.T) {
	app := fiber.New()
	app.Get("/protected", RequireControlAuth(&config.Config{Host: "0.0.0.0"}), func(c *fiber.Ctx) error {
		return c.SendStatus(http.StatusNoContent)
	})

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/protected", nil))
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusServiceUnavailable)
	}
}

func TestRequireControlAuthChecksBearerKey(t *testing.T) {
	key := "test-control-key-at-least-32-bytes-long"
	app := fiber.New()
	app.Get("/protected", RequireControlAuth(&config.Config{Host: "0.0.0.0", ControlAPIKey: key}), func(c *fiber.Ctx) error {
		return c.SendStatus(http.StatusNoContent)
	})

	for _, test := range []struct {
		name   string
		header string
		status int
	}{
		{name: "missing", status: http.StatusUnauthorized},
		{name: "wrong", header: "Bearer wrong-key", status: http.StatusUnauthorized},
		{name: "valid", header: "Bearer " + key, status: http.StatusNoContent},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/protected", nil)
			if test.header != "" {
				request.Header.Set("Authorization", test.header)
			}
			response, err := app.Test(request)
			if err != nil {
				t.Fatalf("app.Test() error = %v", err)
			}
			if response.StatusCode != test.status {
				t.Fatalf("status = %d, want %d", response.StatusCode, test.status)
			}
		})
	}
}
