package delivery

import (
	"log"
	"thai-transcriber-backend/config"
	"thai-transcriber-backend/internal/application/agentsupervisor"
	"thai-transcriber-backend/internal/application/roomoperations"
	"thai-transcriber-backend/internal/application/transcriptaccess"
	"thai-transcriber-backend/internal/delivery/handler"

	"github.com/gofiber/fiber/v2"
	websocket "github.com/gofiber/websocket/v2"
)

// SetupRoutes configures all routes for the application
func SetupRoutes(
	app *fiber.App,
	cfg *config.Config,
	supervisor *agentsupervisor.Supervisor,
	rooms *roomoperations.Operations,
	transcriptAccess *transcriptaccess.Policy,
) {
	setupHealthRoutes(app, cfg)
	setupLiveKitRoutes(app, cfg, supervisor, rooms, transcriptAccess)
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
func setupLiveKitRoutes(
	app *fiber.App,
	cfg *config.Config,
	supervisor *agentsupervisor.Supervisor,
	rooms *roomoperations.Operations,
	transcriptAccess *transcriptaccess.Policy,
) {
	if !cfg.HasLiveKitKey() {
		log.Println("⚠️  [LiveKit] Disabled - LIVEKIT_API_KEY or LIVEKIT_API_SECRET not configured")
		return
	}
	controlAuth := handler.RequireControlAuth(cfg)

	// Token service
	app.Post("/livekit/token", controlAuth, func(c *fiber.Ctx) error {
		return handler.HandleLiveKitToken(c, cfg, rooms)
	})
	log.Println("✅ [LiveKit] Token service enabled at POST /livekit/token")

	// Room management
	roomRoutes := app.Group("/livekit/rooms")
	roomRoutes.Post("/", controlAuth, func(c *fiber.Ctx) error {
		return handler.HandleCreateRoom(c, rooms)
	})
	roomRoutes.Get("/", controlAuth, func(c *fiber.Ctx) error {
		return handler.HandleListRooms(c, rooms)
	})
	roomRoutes.Get("/detailed", controlAuth, func(c *fiber.Ctx) error {
		return handler.HandleGetRoomsDetailed(c, rooms)
	})
	roomRoutes.Post("/:room/transcript-token", controlAuth, func(c *fiber.Ctx) error {
		return handler.HandleCreateTranscriptToken(c, transcriptAccess)
	})
	roomRoutes.Post("/:room/transcript-token/:provider", controlAuth, func(c *fiber.Ctx) error {
		return handler.HandleCreateProviderTranscriptToken(c, transcriptAccess)
	})
	roomRoutes.Get(
		"/:room/transcripts/ws",
		handler.TranscriptWebSocketMiddleware(transcriptAccess),
		websocket.New(handler.HandleTranscriptWebSocket(handler.TranscriptHub())),
	)
	app.Get(
		"/ws/transcript/:provider/:room",
		handler.ProviderTranscriptWebSocketMiddleware(transcriptAccess),
		websocket.New(handler.HandleProviderTranscriptWebSocket(handler.TranscriptHub())),
	)
	roomRoutes.Get("/:name", controlAuth, func(c *fiber.Ctx) error {
		return handler.HandleGetRoom(c, rooms)
	})
	roomRoutes.Delete("/:name", controlAuth, func(c *fiber.Ctx) error {
		return handler.HandleDeleteRoom(c, rooms, supervisor)
	})
	roomRoutes.Delete("/:room/participants/:identity", controlAuth, func(c *fiber.Ctx) error {
		return handler.HandleRemoveParticipant(c, rooms)
	})
	log.Println("✅ [LiveKit] Room management enabled at /livekit/rooms/*")

	// Agent (requires ASR provider)
	if cfg.HasGoogleKey() || cfg.HasGeminiKey() || cfg.HasAzureKey() || cfg.HasOpenAITranscriptionKey() {
		agent := app.Group("/livekit/agent")
		agent.Post("/start", controlAuth, func(c *fiber.Ctx) error {
			return handler.HandleAgentStart(c, cfg, supervisor)
		})
		agent.Post("/stop", controlAuth, func(c *fiber.Ctx) error {
			return handler.HandleAgentStop(c, cfg, supervisor)
		})
		agent.Get("/status", controlAuth, func(c *fiber.Ctx) error {
			return handler.HandleAgentStatus(c, supervisor)
		})
		log.Println("✅ [LiveKit Agent] Enabled at /livekit/agent/*")
	} else {
		log.Println("⚠️  [LiveKit Agent] Disabled - No ASR provider configured (Google, Gemini, Azure, or OpenAI Realtime Whisper)")
	}
}
