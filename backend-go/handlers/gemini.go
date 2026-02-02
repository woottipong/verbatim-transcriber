package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"thai-transcriber-backend/config"
	"thai-transcriber-backend/utils"

	websocketFiber "github.com/gofiber/websocket/v2"
	"github.com/google/generative-ai-go/genai"
	"google.golang.org/api/option"
)

type GeminiSession struct {
	model        *genai.GenerativeModel
	audioBuffer  []byte
	isProcessing bool
	batchSize    int
}

func HandleGemini(conn *websocketFiber.Conn, cfg *config.Config) {
	log.Println("📱 [Gemini] Client connected")

	session := &GeminiSession{
		audioBuffer:  make([]byte, 0),
		isProcessing: false,
		batchSize:    cfg.GeminiConfig.BatchSizeBytes,
	}

	// Send connected message
	conn.WriteJSON(map[string]string{"type": "connected"})

	defer func() {
		log.Println("🔌 [Gemini] Client disconnected")
	}()

	for {
		msgType, message, err := conn.ReadMessage()
		if err != nil {
			log.Printf("❌ [Gemini] Read error: %v\n", err)
			break
		}

		// Handle control messages (JSON)
		if msgType == websocketFiber.TextMessage {
			var msg Message
			if err := json.Unmarshal(message, &msg); err == nil {
				switch msg.Type {
				case "start":
					log.Println("🎬 [Gemini] Starting session")

					apiKey := msg.APIKey
					if apiKey == "" {
						apiKey = cfg.GeminiAPIKey
					}

					ctx := context.Background()
					client, err := genai.NewClient(ctx, option.WithAPIKey(apiKey))
					if err != nil {
						log.Printf("❌ [Gemini] Client init error: %v\n", err)
						conn.WriteJSON(map[string]string{
							"type":  "error",
							"error": fmt.Sprintf("Gemini client init failed: %v", err),
						})
						continue
					}

					session.model = client.GenerativeModel(cfg.GeminiConfig.Model)
					session.model.SetTemperature(cfg.GeminiConfig.Temperature)
					session.model.SetTopP(cfg.GeminiConfig.TopP)
					session.model.SetTopK(int32(cfg.GeminiConfig.TopK))
					session.model.SetMaxOutputTokens(int32(cfg.GeminiConfig.MaxOutputTokens))
					session.model.SystemInstruction = &genai.Content{
						Parts: []genai.Part{genai.Text(cfg.GeminiConfig.SystemInstruction)},
					}

					conn.WriteJSON(map[string]string{"type": "started"})

				case "stop":
					log.Println("🛑 [Gemini] Stopping session")
					session.model = nil
					session.audioBuffer = make([]byte, 0)
					session.isProcessing = false
					conn.WriteJSON(map[string]string{"type": "stopped"})
				}
			}
		} else if msgType == websocketFiber.BinaryMessage {
			// Handle audio data
			if session.model != nil {
				handleGeminiAudioData(conn, session, message, cfg)
			}
		}
	}
}

func handleGeminiAudioData(conn *websocketFiber.Conn, session *GeminiSession, data []byte, cfg *config.Config) {
	session.audioBuffer = append(session.audioBuffer, data...)

	if len(session.audioBuffer) >= session.batchSize && !session.isProcessing {
		session.isProcessing = true
		audioBlob := make([]byte, len(session.audioBuffer))
		copy(audioBlob, session.audioBuffer)
		session.audioBuffer = make([]byte, 0)

		go func() {
			defer func() {
				session.isProcessing = false
			}()

			// Convert PCM to WAV
			wavBuffer := utils.ConvertPCMtoWAV(audioBlob, 16000, 1, 16)

			// Send to Gemini
			ctx := context.Background()
			resp, err := session.model.GenerateContent(ctx,
				genai.Blob{
					MIMEType: "audio/wav",
					Data:     wavBuffer,
				},
			)

			if err != nil {
				log.Printf("❌ [Gemini] API error: %v\n", err)
				conn.WriteJSON(map[string]string{
					"type":  "error",
					"error": err.Error(),
				})
				return
			}

			if len(resp.Candidates) > 0 && resp.Candidates[0].Content != nil {
				var text string
				for _, part := range resp.Candidates[0].Content.Parts {
					if txt, ok := part.(genai.Text); ok {
						text += string(txt)
					}
				}

				cleaned := cleanGeminiTranscription(text)
				if cleaned != "" {
					log.Printf("📝 [Gemini] %s\n", cleaned)

					response := map[string]interface{}{
						"type":     "transcript",
						"is_final": true,
						"channel": map[string]interface{}{
							"alternatives": []map[string]interface{}{
								{
									"transcript": cleaned,
									"confidence": 1.0,
								},
							},
						},
					}

					if err := conn.WriteJSON(response); err != nil {
						log.Printf("❌ [Gemini] Write error: %v\n", err)
					}
				}
			}
		}()
	}
}

func cleanGeminiTranscription(text string) string {
	// Remove empty quotes
	text = strings.ReplaceAll(text, `""`, "")
	text = strings.ReplaceAll(text, `" "`, "")

	// Remove markdown
	text = strings.ReplaceAll(text, "`", "")

	// Normalize whitespace
	text = strings.TrimSpace(text)

	return text
}
