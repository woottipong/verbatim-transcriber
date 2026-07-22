package handler

import (
	"crypto/subtle"
	"strings"

	"thai-transcriber-backend/config"

	"github.com/gofiber/fiber/v2"
)

// RequireControlAuth protects room, agent, and participant-token operations.
// Localhost development remains available without a key; remote binding fails
// closed until a strong CONTROL_API_KEY is configured.
func RequireControlAuth(cfg *config.Config) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if !cfg.RequiresControlAuth() {
			return c.Next()
		}
		if !cfg.HasControlAPIKey() {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
				"error": "Control API authentication is not configured",
			})
		}

		provided := strings.TrimSpace(c.Get("Authorization"))
		if len(provided) >= len("Bearer ") && strings.EqualFold(provided[:len("Bearer ")], "Bearer ") {
			provided = strings.TrimSpace(provided[len("Bearer "):])
		}
		if provided == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(strings.TrimSpace(cfg.ControlAPIKey))) != 1 {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "Control API authentication required",
			})
		}
		return c.Next()
	}
}
