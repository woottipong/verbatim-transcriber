package delivery

import (
	"log"
	"thai-transcriber-backend/config"
	"thai-transcriber-backend/internal/application/agentsupervisor"
	"thai-transcriber-backend/internal/application/captionproofread"
	"thai-transcriber-backend/internal/application/roomoperations"
	"thai-transcriber-backend/internal/application/transcriptaccess"
	"thai-transcriber-backend/internal/delivery/handler"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	websocket "github.com/gofiber/websocket/v2"
)

// tokenMintLimiter bounds how often one IP can mint a signed LiveKit or
// transcript/caption token. These handlers sign JWTs and call the LiveKit
// API on every request, so an unbounded client (or a leaked control key)
// could otherwise drive real cost with no pushback.
func tokenMintLimiter() fiber.Handler {
	return limiter.New(limiter.Config{
		Max:        30,
		Expiration: 1 * time.Minute,
		LimitReached: func(c *fiber.Ctx) error {
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"error": "Too many token requests. Try again shortly.",
			})
		},
	})
}

// SetupRoutes configures all routes for the application
func SetupRoutes(
	app *fiber.App,
	cfg *config.Config,
	supervisor *agentsupervisor.Supervisor,
	rooms *roomoperations.Operations,
	transcriptAccess *transcriptaccess.Policy,
	proofreadService *captionproofread.Service,
) {
	setupHealthRoutes(app, cfg, proofreadService)
	setupProofreadRoutes(app, cfg, proofreadService)
	setupLiveKitRoutes(app, cfg, supervisor, rooms, transcriptAccess)
}

// setupHealthRoutes configures health check and provider status endpoints
func setupHealthRoutes(app *fiber.App, cfg *config.Config, proofreadService *captionproofread.Service) {
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
			"captionProofread":     proofreadService.Enabled(),
		})
	})
}

const proofreadRequestsPerMinute = 30

func proofreadLimiter() fiber.Handler {
	return limiter.New(limiter.Config{
		Max:        proofreadRequestsPerMinute,
		Expiration: 1 * time.Minute,
		LimitReached: func(c *fiber.Ctx) error {
			log.Println("[CaptionProofread] error_class=rate_limited")
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"error": "Too many proofreading requests. Try again shortly.",
			})
		},
	})
}

func setupProofreadRoutes(app *fiber.App, cfg *config.Config, service *captionproofread.Service) {
	app.Post(
		"/api/caption-desk/ai-proofread",
		proofreadLimiter(),
		handler.RequireControlAuth(cfg),
		func(c *fiber.Ctx) error { return handler.HandleAIProofread(c, service) },
	)
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
	app.Post("/livekit/token", tokenMintLimiter(), controlAuth, func(c *fiber.Ctx) error {
		return handler.HandleLiveKitToken(c, cfg, rooms)
	})
	log.Println("✅ [LiveKit] Token service enabled at POST /livekit/token")
	app.Post("/livekit/viewer-token", tokenMintLimiter(), controlAuth, func(c *fiber.Ctx) error {
		return handler.HandleViewerToken(c, cfg, rooms)
	})
	log.Println("✅ [LiveKit] Read-only viewer tokens enabled at POST /livekit/viewer-token")

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
	roomRoutes.Post("/:room/transcript-token", tokenMintLimiter(), controlAuth, func(c *fiber.Ctx) error {
		return handler.HandleCreateTranscriptToken(c, transcriptAccess)
	})
	roomRoutes.Post("/:room/transcript-token/:provider", tokenMintLimiter(), controlAuth, func(c *fiber.Ctx) error {
		return handler.HandleCreateProviderTranscriptToken(c, transcriptAccess)
	})
	roomRoutes.Post("/:room/caption-token/ws", tokenMintLimiter(), controlAuth, func(c *fiber.Ctx) error {
		return handler.HandleCreateCaptionToken(c, transcriptAccess, supervisor)
	})
	roomRoutes.Post("/:room/caption-token/:provider", tokenMintLimiter(), controlAuth, func(c *fiber.Ctx) error {
		return handler.HandleCaptionDeskToken(c, cfg, rooms, supervisor)
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
	app.Get(
		"/ws/caption/:room",
		handler.CaptionWebSocketMiddleware(transcriptAccess),
		websocket.New(handler.HandleCaptionWebSocket(handler.TranscriptHub())),
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
