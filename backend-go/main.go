package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"thai-transcriber-backend/config"
	"thai-transcriber-backend/internal/application/agentsupervisor"
	"thai-transcriber-backend/internal/application/roomoperations"
	"thai-transcriber-backend/internal/application/transcriptaccess"
	"thai-transcriber-backend/internal/delivery"
	"thai-transcriber-backend/internal/delivery/handler"
	agentinfra "thai-transcriber-backend/internal/infrastructure/agent"
	"thai-transcriber-backend/internal/infrastructure/livekitroom"
	"thai-transcriber-backend/internal/infrastructure/transcript"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/joho/godotenv"
)

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("⚠️  No .env file found, using system environment variables")
	}

	// Load configuration
	cfg := config.Load()
	agentSupervisor := agentsupervisor.New(func(provider string) agentsupervisor.Agent {
		return agentinfra.New(cfg, provider, handler.TranscriptHub())
	})
	roomOperations := roomoperations.New(livekitroom.New(
		cfg.LiveKitURL,
		cfg.LiveKitAPIKey,
		cfg.LiveKitAPISecret,
	))
	transcriptAccess := transcriptaccess.New(
		roomOperations,
		transcript.NewTokenService(cfg.TranscriptWSSecret, 24*time.Hour),
		handler.TranscriptHub(),
	)

	// Initialize Fiber app
	//
	// Timeouts and BodyLimit apply only to the plain HTTP request/response
	// cycle. Once a connection is hijacked for a WebSocket upgrade (transcript
	// and caption feeds), fasthttp's serve loop stops managing that
	// connection entirely, so these limits cannot cut off a live stream — the
	// websocket handlers manage their own ping/pong deadlines instead.
	app := fiber.New(fiber.Config{
		DisableStartupMessage: true,
		ReadTimeout:           10 * time.Second,
		WriteTimeout:          10 * time.Second,
		IdleTimeout:           65 * time.Second,
		BodyLimit:             1 * 1024 * 1024, // control-plane payloads are small JSON
	})

	// Middlewares — Recover from panics, Security Headers (Helmet), CORS, and Logger
	app.Use(recover.New())
	app.Use(helmet.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.AllowedOrigins,
		AllowMethods:     "GET,POST,HEAD,PUT,DELETE,PATCH,OPTIONS",
		AllowHeaders:     "Origin, Content-Type, Accept, Authorization",
		AllowCredentials: true,
		MaxAge:           300,
	}))
	app.Use(logger.New())

	// Routes
	delivery.SetupRoutes(app, cfg, agentSupervisor, roomOperations, transcriptAccess)

	// Print startup info
	printStartupInfo(cfg)

	// Start server in goroutine
	addr := fmt.Sprintf("%s:%s", cfg.Host, cfg.Port)
	go func() {
		log.Printf("🚀 Server starting at http://%s:%s\n", cfg.Host, cfg.Port)
		if err := app.Listen(addr); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("\n⚠️  Shutting down server...")

	// Each phase gets its own full timeout budget instead of sharing one
	// context. A shared context previously let a slow HTTP/WebSocket drain
	// consume the entire budget, leaving the agent supervisor with an
	// already-expired context and no chance to close ASR provider streams
	// cleanly (which matters — some providers bill for open connections).
	httpCtx, httpCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer httpCancel()
	if err := app.ShutdownWithContext(httpCtx); err != nil {
		log.Printf("Server forced to shutdown: %v", err)
	}

	agentCtx, agentCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer agentCancel()
	if err := agentSupervisor.Shutdown(agentCtx); err != nil {
		log.Printf("Agent shutdown incomplete: %v", err)
	}

	log.Println("✅ Server exited gracefully")
}

func printStartupInfo(cfg *config.Config) {
	fmt.Println("\n╔════════════════════════════════════════════════════════════════╗")
	fmt.Println("║  🎙️  CaptionLive — Real-time Transcription Backend            ║")
	fmt.Println("╚════════════════════════════════════════════════════════════════╝")
	fmt.Println()

	// Provider status table
	type providerInfo struct {
		name    string
		enabled bool
		icon    string
	}
	providers := []providerInfo{
		{"Google Cloud STT", cfg.HasGoogleKey(), "🌐"},
		{"Gemini 3.5 Live", cfg.HasGeminiKey(), "✨"},
		{"GPT Realtime Translate", cfg.HasOpenAITranscriptionKey(), "🤖"},
		{"Azure Speech", cfg.HasAzureKey(), "☁️"},
	}

	enabledCount := 0
	for _, p := range providers {
		if p.enabled {
			enabledCount++
		}
	}

	fmt.Printf("📦 ASR Providers: %d/%d enabled\n", enabledCount, len(providers))
	fmt.Println("─────────────────────────────────────────────────────────────────")
	for _, p := range providers {
		status := "❌ Disabled"
		if p.enabled {
			status = "✅ Ready"
		}
		fmt.Printf(" %s %-22s %s\n", p.icon, p.name, status)
	}
	fmt.Println()
	fmt.Println("─────────────────────────────────────────────────────────────────")
	fmt.Printf("🌐 Server:       http://%s:%s\n", cfg.Host, cfg.Port)
	fmt.Printf("💚 Health:       http://%s:%s/health\n", cfg.Host, cfg.Port)
	fmt.Printf("📊 Providers:    http://%s:%s/providers\n", cfg.Host, cfg.Port)
	fmt.Printf("💬 Captions WS:  ws://%s:%s/ws/caption/:room\n", cfg.Host, cfg.Port)
	fmt.Printf("📻 Raw Feeds WS: ws://%s:%s/ws/transcript/:provider/:room\n", cfg.Host, cfg.Port)
	fmt.Println("─────────────────────────────────────────────────────────────────")

	if enabledCount == 0 {
		fmt.Println("\n⚠️  WARNING: No ASR providers configured!")
		fmt.Println("   Please set API keys in .env file")
	} else {
		fmt.Printf("\n🎉 CaptionLive Backend Ready! (%d provider%s available)\n", enabledCount, pluralize(enabledCount))
	}
	fmt.Println()
}

func pluralize(count int) string {
	if count == 1 {
		return ""
	}
	return "s"
}
