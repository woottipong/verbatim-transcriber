package handlers

import (
	"fmt"
	"log"

	websocketFiber "github.com/gofiber/websocket/v2"
)

// Common message types
type Message struct {
	Type   string `json:"type"`
	APIKey string `json:"apiKey,omitempty"`
}

type TranscriptResponse struct {
	Type    string  `json:"type"`
	Text    string  `json:"text"`
	IsFinal bool    `json:"isFinal"`
	Channel Channel `json:"channel"`
}

type Channel struct {
	Alternatives []Alternative `json:"alternatives"`
}

type Alternative struct {
	Transcript string  `json:"transcript"`
	Confidence float64 `json:"confidence"`
}

type ErrorResponse struct {
	Type  string `json:"type"`
	Error string `json:"error"`
}

type StatusResponse struct {
	Type string `json:"type"`
}

// Helper functions for WebSocket communication
func sendConnected(conn *websocketFiber.Conn) error {
	return conn.WriteJSON(StatusResponse{Type: "connected"})
}

func sendStarted(conn *websocketFiber.Conn) error {
	return conn.WriteJSON(StatusResponse{Type: "started"})
}

func sendStopped(conn *websocketFiber.Conn) error {
	return conn.WriteJSON(StatusResponse{Type: "stopped"})
}

func sendError(conn *websocketFiber.Conn, provider, message string, err error) error {
	errorMsg := message
	if err != nil {
		errorMsg = fmt.Sprintf("%s: %v", message, err)
	}
	log.Printf("❌ [%s] %s\n", provider, errorMsg)
	return conn.WriteJSON(ErrorResponse{
		Type:  "error",
		Error: errorMsg,
	})
}

func sendTranscript(conn *websocketFiber.Conn, text string, isFinal bool, confidence float64) error {
	return conn.WriteJSON(TranscriptResponse{
		Type:    "transcript",
		Text:    text,
		IsFinal: isFinal,
		Channel: Channel{
			Alternatives: []Alternative{
				{
					Transcript: text,
					Confidence: confidence,
				},
			},
		},
	})
}

// Logging helpers
func logConnection(provider string) {
	log.Printf("📱 [%s] Client connected\n", provider)
}

func logDisconnection(provider string) {
	log.Printf("🔌 [%s] Client disconnected\n", provider)
}

func logStarting(provider string) {
	log.Printf("🎬 [%s] Starting session\n", provider)
}

func logStopping(provider string) {
	log.Printf("🛑 [%s] Stopping session\n", provider)
}

func logFinalTranscript(provider, text string, confidence float64) {
	if confidence > 0 {
		log.Printf("📝 [%s] Final: %s (confidence: %.2f)\n", provider, text, confidence)
	} else {
		log.Printf("📝 [%s] Final: %s\n", provider, text)
	}
}
