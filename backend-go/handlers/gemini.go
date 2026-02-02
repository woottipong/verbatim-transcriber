package handlers

import (
	"context"
	"encoding/json"
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
	logConnection("Gemini")

	session := &GeminiSession{
		audioBuffer:  make([]byte, 0),
		isProcessing: false,
		batchSize:    cfg.GeminiConfig.BatchSizeBytes,
	}

	sendConnected(conn)

	defer logDisconnection("Gemini")

	for {
		msgType, message, err := conn.ReadMessage()
		if err != nil {
			sendError(conn, "Gemini", "Read error", err)
			break
		}

		// Handle control messages (JSON)
		if msgType == websocketFiber.TextMessage {
			var msg Message
			if err := json.Unmarshal(message, &msg); err == nil {
				switch msg.Type {
				case "start":
					logStarting("Gemini")

					ctx := context.Background()
					client, err := genai.NewClient(ctx, option.WithAPIKey(cfg.GeminiAPIKey))
					if err != nil {
						sendError(conn, "Gemini", "Gemini client init failed", err)
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

					sendStarted(conn)

				case "stop":
					logStopping("Gemini")
					session.model = nil
					session.audioBuffer = make([]byte, 0)
					session.isProcessing = false
					sendStopped(conn)
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
				sendError(conn, "Gemini", "API error", err)
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
					logFinalTranscript("Gemini", cleaned, 0)
					sendTranscript(conn, cleaned, true, 1.0)
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
