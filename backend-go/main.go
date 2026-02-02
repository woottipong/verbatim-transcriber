package main

import (
	"fmt"
	"log"

	"thai-transcriber-backend/config"
	"thai-transcriber-backend/routes"

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
	routes.SetupRoutes(app, cfg)

	// Print startup info
	printStartupInfo(cfg)

	// Start server
	addr := fmt.Sprintf("%s:%s", cfg.Host, cfg.Port)
	log.Fatal(app.Listen(addr))
}

func printStartupInfo(cfg *config.Config) {
	fmt.Println("\n🎙️  Thai Verbatim Transcriber (Go Backend)")
	fmt.Println("==========================================")
	fmt.Println()

	fmt.Println("📦 Available ASR Providers:")
	if cfg.DeepgramAPIKey != "" {
		fmt.Println("   ✅ Deepgram Nova-2 (/deepgram)")
	} else {
		fmt.Println("   ❌ Deepgram (API key not set)")
	}
	if cfg.GeminiAPIKey != "" {
		fmt.Println("   ✅ Gemini 2.0 Flash (/gemini)")
	} else {
		fmt.Println("   ❌ Gemini (API key not set)")
	}

	fmt.Printf("\n🚀 Server running on port %s\n", cfg.Port)
	fmt.Printf("   Health: http://%s:%s/health\n", cfg.Host, cfg.Port)
	fmt.Println("   WebSocket endpoints:")
	fmt.Printf("     - ws://%s:%s/deepgram\n", cfg.Host, cfg.Port)
	fmt.Printf("     - ws://%s:%s/gemini\n\n", cfg.Host, cfg.Port)
}
