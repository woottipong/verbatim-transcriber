package routes

import (
	"thai-transcriber-backend/config"
	"thai-transcriber-backend/handlers"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/websocket/v2"
)

func SetupRoutes(app *fiber.App, cfg *config.Config) {
	// Health check
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status":  "ok",
			"service": "thai-transcriber-backend",
		})
	})

	// WebSocket upgrade middleware
	app.Use("/deepgram", func(c *fiber.Ctx) error {
		if websocket.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})

	app.Use("/gemini", func(c *fiber.Ctx) error {
		if websocket.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})

	// WebSocket handlers
	app.Get("/deepgram", websocket.New(func(c *websocket.Conn) {
		handlers.HandleDeepgram(c, cfg)
	}))

	app.Get("/gemini", websocket.New(func(c *websocket.Conn) {
		handlers.HandleGemini(c, cfg)
	}))
}
