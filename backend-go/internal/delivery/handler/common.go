// Package handlers provides HTTP and WebSocket handlers for the backend API.
//
// This package contains:
//   - Traditional ASR handlers (Google, Azure) for direct WebSocket streaming
//   - LiveKit-related handlers for room management and agent control
//   - Common utilities for WebSocket communication and logging
package handler

import (
	"fmt"
	"log"
	"sync"

	"thai-transcriber-backend/models"
)

type jsonWriter interface {
	WriteJSON(any) error
}

type safeJSONWriter struct {
	mu     sync.Mutex
	writer jsonWriter
}

func newSafeJSONWriter(writer jsonWriter) *safeJSONWriter {
	return &safeJSONWriter{writer: writer}
}

func (w *safeJSONWriter) WriteJSON(value any) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.writer.WriteJSON(value)
}

// Helper functions for WebSocket communication
func sendConnected(conn jsonWriter) error {
	return conn.WriteJSON(models.StatusResponse{Type: "connected"})
}

func sendStarted(conn jsonWriter) error {
	return conn.WriteJSON(models.StatusResponse{Type: "started"})
}

func sendStopped(conn jsonWriter) error {
	return conn.WriteJSON(models.StatusResponse{Type: "stopped"})
}

func sendError(conn jsonWriter, provider, message string, err error) error {
	errorMsg := message
	if err != nil {
		errorMsg = fmt.Sprintf("%s: %v", message, err)
	}
	log.Printf("❌ [%s] %s\n", provider, errorMsg)
	return conn.WriteJSON(models.ErrorResponse{
		Type:  "error",
		Error: errorMsg,
	})
}

func sendTranscript(conn jsonWriter, text string, isFinal bool, confidence float64) error {
	return conn.WriteJSON(models.TranscriptResponse{
		Type:    "transcript",
		Text:    text,
		IsFinal: isFinal,
		Channel: models.Channel{
			Alternatives: []models.Alternative{
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
