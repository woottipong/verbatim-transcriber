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
	"thai-transcriber-backend/internal/delivery"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/joho/godotenv"
)

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("⚠️  No .env file found, using system environment variables")
	}

	// Load configuration
	cfg := config.Load()

	// Initialize Fiber app
	app := fiber.New(fiber.Config{
		DisableStartupMessage: true,
	})

	// Middleware - CORS with restricted origins
	app.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.AllowedOrigins,
		AllowMethods:     "GET,POST,HEAD,PUT,DELETE,PATCH,OPTIONS",
		AllowHeaders:     "Origin, Content-Type, Accept, Authorization",
		AllowCredentials: true,
		MaxAge:           300,
	}))
	app.Use(logger.New())

	// Routes
	delivery.SetupRoutes(app, cfg)

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

	// Timeout for graceful shutdown
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := app.ShutdownWithContext(ctx); err != nil {
		log.Printf("Server forced to shutdown: %v", err)
	}

	log.Println("✅ Server exited gracefully")
}

func printStartupInfo(cfg *config.Config) {
	fmt.Println("\n╔════════════════════════════════════════════════════════════════╗")
	fmt.Println("║  🎙️  Real-time Thai Transcription - Go Backend             ║")
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
		{"Gemini Live STT", cfg.HasGeminiKey(), "✨"},
		{"OpenAI Realtime Whisper", cfg.HasOpenAITranscriptionKey(), "🤖"},
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
		fmt.Printf(" %s %-20s %s\n", p.icon, p.name, status)
	}
	fmt.Println()
	fmt.Println("─────────────────────────────────────────────────────────────────")
	fmt.Printf("🌐 Server:    http://%s:%s\n", cfg.Host, cfg.Port)
	fmt.Printf("💚 Health:    http://%s:%s/health\n", cfg.Host, cfg.Port)
	fmt.Printf("📊 Providers: http://%s:%s/providers\n", cfg.Host, cfg.Port)
	fmt.Println("─────────────────────────────────────────────────────────────────")

	if enabledCount == 0 {
		fmt.Println("\n⚠️  WARNING: No ASR providers configured!")
		fmt.Println("   Please set API keys in .env file")
	} else {
		fmt.Printf("\n🎉 Ready to transcribe! (%d provider%s available)\n", enabledCount, pluralize(enabledCount))
	}
	fmt.Println()
}

func pluralize(count int) string {
	if count == 1 {
		return ""
	}
	return "s"
}
