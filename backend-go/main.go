package main

import (
	"fmt"
	"log"

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

	// Middleware
	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowMethods: "GET,POST,HEAD,PUT,DELETE,PATCH,OPTIONS",
		AllowHeaders: "Origin, Content-Type, Accept",
	}))
	app.Use(logger.New())

	// Routes
	delivery.SetupRoutes(app, cfg)

	// Print startup info
	printStartupInfo(cfg)

	// Start server
	addr := fmt.Sprintf("%s:%s", cfg.Host, cfg.Port)
	log.Fatal(app.Listen(addr))
}

func printStartupInfo(cfg *config.Config) {
	fmt.Println("\n╔════════════════════════════════════════════════════════════════╗")
	fmt.Println("║  🎙️  Real-time Thai Transcription - Go Backend             ║")
	fmt.Println("╚════════════════════════════════════════════════════════════════╝")
	fmt.Println()

	// Count enabled providers
	enabledCount := 0
	providers := []struct {
		name    string
		enabled bool
		path    string
		icon    string
		note    string
	}{
		{"Gemini 2.0 Flash", cfg.HasGeminiKey(), "/gemini", "✨", ""},
		{"Google Cloud STT", cfg.HasGoogleKey(), "/google", "🌐", ""},
		{"Azure Speech", cfg.HasAzureKey(), "/azure", "☁️", ""},
	}

	for _, p := range providers {
		if p.enabled {
			enabledCount++
		}
	}

	// Display provider status
	fmt.Printf("📦 ASR Providers: %d/%d enabled\n", enabledCount, len(providers))
	fmt.Println("─────────────────────────────────────────────────────────────────")

	for _, p := range providers {
		status := "❌ Disabled"
		detail := ""
		if p.enabled {
			status = "✅ Ready"
			if p.path != "" && p.path != "(direct browser)" {
				detail = fmt.Sprintf("ws://%s:%s%s", cfg.Host, cfg.Port, p.path)
			} else if p.note != "" {
				detail = p.note
			}
		}
		fmt.Printf(" %s %-20s %s\n", p.icon, p.name, status)
		if detail != "" {
			fmt.Printf("    └─ %s\n", detail)
		}
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

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
