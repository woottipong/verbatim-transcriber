package handlers

import (
	"encoding/json"
	"log"
	"thai-transcriber-backend/config"

	websocketFiber "github.com/gofiber/websocket/v2"
)

type Message struct {
	Type   string `json:"type"`
	APIKey string `json:"apiKey,omitempty"`
}

type TranscriptResponse struct {
	Type    string  `json:"type"`
	Text    string  `json:"transcript"`
	IsFinal bool    `json:"is_final"`
	Channel Channel `json:"channel"`
}

type Channel struct {
	Alternatives []Alternative `json:"alternatives"`
}

type Alternative struct {
	Transcript string  `json:"transcript"`
	Confidence float64 `json:"confidence"`
}

func HandleDeepgram(conn *websocketFiber.Conn, cfg *config.Config) {
	log.Println("📱 [Deepgram] Client connected")

	// Send connected message
	conn.WriteJSON(map[string]string{"type": "connected"})

	// TODO: Implement Deepgram WebSocket client
	// The Deepgram Go SDK API is still unstable, recommend using REST API or direct WebSocket
	log.Println("⚠️ [Deepgram] Go implementation pending - SDK API unstable")

	defer func() {
		log.Println("🔌 [Deepgram] Client disconnected")
	}()

	for {
		msgType, message, err := conn.ReadMessage()
		if err != nil {
			log.Printf("❌ [Deepgram] Read error: %v\n", err)
			break
		}

		// Handle control messages (JSON)
		if msgType == websocketFiber.TextMessage {
			var msg Message
			if err := json.Unmarshal(message, &msg); err == nil {
				switch msg.Type {
				case "start":
					log.Println("🎬 [Deepgram] Starting session")
					conn.WriteJSON(map[string]string{
						"type":  "error",
						"error": "Deepgram Go implementation not ready. Please use Node.js backend.",
					})

				case "stop":
					log.Println("🛑 [Deepgram] Stopping session")
					conn.WriteJSON(map[string]string{"type": "stopped"})
				}
			}
		}
	}
}
