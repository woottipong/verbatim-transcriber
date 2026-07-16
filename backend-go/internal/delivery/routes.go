package delivery

import (
	"log"
	"thai-transcriber-backend/config"
	"thai-transcriber-backend/internal/delivery/handler"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/websocket/v2"
)

// WSHandler is a WebSocket handler function type
type WSHandler func(c *websocket.Conn)

// SetupRoutes configures all routes for the application
func SetupRoutes(app *fiber.App, cfg *config.Config) {
	setupHealthRoutes(app, cfg)
	setupLiveKitRoutes(app, cfg)
	setupASRRoutes(app, cfg)
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
			"google":  cfg.HasGoogleKey(),
			"azure":   cfg.HasAzureKey(),
			"livekit": cfg.HasLiveKitKey(),
		})
	})
}

// setupLiveKitRoutes configures LiveKit token, room, and agent endpoints
func setupLiveKitRoutes(app *fiber.App, cfg *config.Config) {
	if !cfg.HasLiveKitKey() {
		log.Println("⚠️  [LiveKit] Disabled - LIVEKIT_API_KEY or LIVEKIT_API_SECRET not configured")
		return
	}

	// Token service
	app.Post("/livekit/token", func(c *fiber.Ctx) error {
		return handler.HandleLiveKitToken(c, cfg)
	})
	log.Println("✅ [LiveKit] Token service enabled at POST /livekit/token")

	// Room management
	rooms := app.Group("/livekit/rooms")
	rooms.Get("/", func(c *fiber.Ctx) error { return handler.HandleListRooms(c, cfg) })
	rooms.Get("/detailed", func(c *fiber.Ctx) error { return handler.HandleGetRoomsDetailed(c, cfg) })
	rooms.Get("/:name", func(c *fiber.Ctx) error { return handler.HandleGetRoom(c, cfg) })
	rooms.Delete("/:name", func(c *fiber.Ctx) error { return handler.HandleDeleteRoom(c, cfg) })
	rooms.Delete("/:room/participants/:identity", func(c *fiber.Ctx) error { return handler.HandleRemoveParticipant(c, cfg) })
	log.Println("✅ [LiveKit] Room management enabled at /livekit/rooms/*")

	// Agent (requires ASR provider)
	if cfg.HasGoogleKey() || cfg.HasAzureKey() {
		agent := app.Group("/livekit/agent")
		agent.Post("/start", func(c *fiber.Ctx) error { return handler.HandleAgentStart(c, cfg) })
		agent.Post("/stop", func(c *fiber.Ctx) error { return handler.HandleAgentStop(c, cfg) })
		agent.Get("/status", func(c *fiber.Ctx) error { return handler.HandleAgentStatus(c, cfg) })
		log.Println("✅ [LiveKit Agent] Enabled at /livekit/agent/*")
	} else {
		log.Println("⚠️  [LiveKit Agent] Disabled - No ASR provider configured (Google or Azure)")
	}
}

// setupASRRoutes configures WebSocket routes for ASR providers
func setupASRRoutes(app *fiber.App, cfg *config.Config) {
	var enabled []string

	if cfg.HasGoogleKey() {
		registerWSRoute(app, "/google", func(c *websocket.Conn) { handler.HandleASR(c, cfg, "Google") })
		enabled = append(enabled, "Google")
	} else {
		log.Println("⚠️  [Google] Disabled - GOOGLE_CLOUD_PROJECT and Google credentials not configured")
	}

	if cfg.HasAzureKey() {
		registerWSRoute(app, "/azure", func(c *websocket.Conn) { handler.HandleASR(c, cfg, "Azure") })
		enabled = append(enabled, "Azure")
	} else {
		log.Println("⚠️  [Azure] Disabled - AZURE_SUBSCRIPTION_KEY or AZURE_REGION not configured")
	}

	// Log summary
	if len(enabled) > 0 {
		log.Printf("✅ Enabled ASR providers: %v\n", enabled)
	} else {
		log.Println("⚠️  No ASR providers enabled - Please configure API keys in .env")
	}
}

// registerWSRoute registers a WebSocket route with upgrade middleware
func registerWSRoute(app *fiber.App, path string, h WSHandler) {
	app.Use(path, func(c *fiber.Ctx) error {
		if websocket.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})
	app.Get(path, websocket.New(h))
}
