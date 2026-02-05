package routes

import (
	"log"
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

	// Providers status endpoint
	app.Get("/providers", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"deepgram": true, // Always available (direct browser connection)
			"gemini":   cfg.HasGeminiKey(),
			"google":   cfg.HasGoogleKey(),
			"azure":    cfg.HasAzureKey(),
			"livekit":  cfg.HasLiveKitKey(),
		})
	})

	// LiveKit Token Service
	if cfg.HasLiveKitKey() {
		app.Post("/livekit/token", func(c *fiber.Ctx) error {
			return handlers.HandleLiveKitToken(c, cfg)
		})
		log.Println("✅ [LiveKit] Token service enabled at POST /livekit/token")
	} else {
		log.Println("⚠️  [LiveKit] Disabled - LIVEKIT_API_KEY or LIVEKIT_API_SECRET not configured")
	}

	// Conditionally setup WebSocket routes based on available API keys
	enabledProviders := []string{}

	// Deepgram - NOT USED (direct browser connection)
	// Frontend connects directly to wss://api.deepgram.com

	// Gemini
	if cfg.HasGeminiKey() {
		app.Use("/gemini", func(c *fiber.Ctx) error {
			if websocket.IsWebSocketUpgrade(c) {
				return c.Next()
			}
			return fiber.ErrUpgradeRequired
		})
		app.Get("/gemini", websocket.New(func(c *websocket.Conn) {
			handlers.HandleGemini(c, cfg)
		}))
		enabledProviders = append(enabledProviders, "Gemini")
	} else {
		log.Println("⚠️  [Gemini] Disabled - GEMINI_API_KEY not configured")
	}

	// Google Cloud Speech-to-Text
	if cfg.HasGoogleKey() {
		app.Use("/google", func(c *fiber.Ctx) error {
			if websocket.IsWebSocketUpgrade(c) {
				return c.Next()
			}
			return fiber.ErrUpgradeRequired
		})
		app.Get("/google", websocket.New(func(c *websocket.Conn) {
			handlers.HandleGoogle(c, cfg)
		}))
		enabledProviders = append(enabledProviders, "Google")
	} else {
		log.Println("⚠️  [Google] Disabled - GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_API_KEY not configured")
	}

	// Azure Speech Service
	if cfg.HasAzureKey() {
		app.Use("/azure", func(c *fiber.Ctx) error {
			if websocket.IsWebSocketUpgrade(c) {
				return c.Next()
			}
			return fiber.ErrUpgradeRequired
		})
		app.Get("/azure", websocket.New(func(c *websocket.Conn) {
			handlers.HandleAzure(c, cfg)
		}))
		enabledProviders = append(enabledProviders, "Azure")
	} else {
		log.Println("⚠️  [Azure] Disabled - AZURE_SUBSCRIPTION_KEY or AZURE_REGION not configured")
	}

	// Log enabled providers
	if len(enabledProviders) > 0 {
		log.Printf("✅ Enabled providers: %v\n", enabledProviders)
	} else {
		log.Println("⚠️  No ASR providers enabled - Please configure API keys in .env")
	}
}
