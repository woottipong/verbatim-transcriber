package delivery

import (
	"log"
	"thai-transcriber-backend/config"
	"thai-transcriber-backend/internal/delivery/handler"

	"github.com/gofiber/fiber/v2"
	websocket "github.com/gofiber/websocket/v2"
)

// SetupRoutes configures all routes for the application
func SetupRoutes(app *fiber.App, cfg *config.Config) {
	setupHealthRoutes(app, cfg)
	setupLiveKitRoutes(app, cfg)
}

// setupHealthRoutes configures health check and provider status endpoints
func setupHealthRoutes(app *fiber.App, cfg *config.Config) {
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status":  "ok",
			"service": "thai-transcriber-backend",
		})
	})

	app.Get("/providers", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"google":               cfg.HasGoogleKey(),
			"gemini":               cfg.HasGeminiKey(),
			"gpt-realtime-whisper": cfg.HasOpenAITranscriptionKey(),
			"azure":                cfg.HasAzureKey(),
			"livekit":              cfg.HasLiveKitKey(),
		})
	})
}

// setupLiveKitRoutes configures LiveKit token, room, and agent endpoints
func setupLiveKitRoutes(app *fiber.App, cfg *config.Config) {
	if !cfg.HasLiveKitKey() {
		log.Println("⚠️  [LiveKit] Disabled - LIVEKIT_API_KEY or LIVEKIT_API_SECRET not configured")
		return
	}
	controlAuth := handler.RequireControlAuth(cfg)

	// Token service
	app.Post("/livekit/token", controlAuth, func(c *fiber.Ctx) error {
		return handler.HandleLiveKitToken(c, cfg)
	})
	log.Println("✅ [LiveKit] Token service enabled at POST /livekit/token")

	// Room management
	rooms := app.Group("/livekit/rooms")
	rooms.Post("/", controlAuth, func(c *fiber.Ctx) error { return handler.HandleCreateRoom(c, cfg) })
	rooms.Get("/", controlAuth, func(c *fiber.Ctx) error { return handler.HandleListRooms(c, cfg) })
	rooms.Get("/detailed", controlAuth, func(c *fiber.Ctx) error { return handler.HandleGetRoomsDetailed(c, cfg) })
	rooms.Post("/:room/transcript-token", controlAuth, func(c *fiber.Ctx) error { return handler.HandleCreateTranscriptToken(c, cfg) })
	rooms.Get("/:room/transcripts/ws", handler.TranscriptWebSocketMiddleware(cfg), websocket.New(handler.HandleTranscriptWebSocket(handler.TranscriptHub())))
	rooms.Get("/:name", controlAuth, func(c *fiber.Ctx) error { return handler.HandleGetRoom(c, cfg) })
	rooms.Delete("/:name", controlAuth, func(c *fiber.Ctx) error { return handler.HandleDeleteRoom(c, cfg) })
	rooms.Delete("/:room/participants/:identity", controlAuth, func(c *fiber.Ctx) error { return handler.HandleRemoveParticipant(c, cfg) })
	log.Println("✅ [LiveKit] Room management enabled at /livekit/rooms/*")

	// Agent (requires ASR provider)
	if cfg.HasGoogleKey() || cfg.HasGeminiKey() || cfg.HasAzureKey() || cfg.HasOpenAITranscriptionKey() {
		agent := app.Group("/livekit/agent")
		agent.Post("/start", controlAuth, func(c *fiber.Ctx) error { return handler.HandleAgentStart(c, cfg) })
		agent.Post("/stop", controlAuth, func(c *fiber.Ctx) error { return handler.HandleAgentStop(c, cfg) })
		agent.Get("/status", controlAuth, func(c *fiber.Ctx) error { return handler.HandleAgentStatus(c, cfg) })
		log.Println("✅ [LiveKit Agent] Enabled at /livekit/agent/*")
	} else {
		log.Println("⚠️  [LiveKit Agent] Disabled - No ASR provider configured (Google, Gemini, Azure, or OpenAI Realtime Whisper)")
	}
}
