// Generic ASR WebSocket handler using domain.ASRProvider.
//
// This handler replaces the provider-specific handlers (google.go, azure.go)
// by delegating all ASR logic to the shared provider implementations in
// internal/infrastructure/asr/. Both WebSocket mode and LiveKit Agent mode
// now use the same ASR providers — maintained in one place.

package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync/atomic"

	"thai-transcriber-backend/config"
	"thai-transcriber-backend/internal/domain"
	"thai-transcriber-backend/internal/infrastructure/asr"
	"thai-transcriber-backend/models"

	websocketFiber "github.com/gofiber/websocket/v2"
)

// HandleASR is a generic WebSocket handler for real-time speech-to-text.
// It uses domain.ASRProvider to abstract away provider-specific logic.
//
// Protocol:
//   - Text messages: JSON control messages (start/stop)
//   - Binary messages: Raw PCM audio data (Int16 Little-Endian)
//
// providerName: "Google" or "Azure" (used for logging and provider selection)
func HandleASR(conn *websocketFiber.Conn, cfg *config.Config, providerName string) {
	logConnection(providerName)
	sendConnected(conn)

	var provider domain.ASRProvider
	var cancel context.CancelFunc
	var stoppedByUser atomic.Bool
	isProcessing := false

	defer func() {
		if provider != nil {
			provider.Stop()
		}
		if cancel != nil {
			cancel()
		}
		logDisconnection(providerName)
	}()

	for {
		msgType, message, err := conn.ReadMessage()
		if err != nil {
			sendError(conn, providerName, "Read error", err)
			break
		}

		// Handle control messages (JSON text)
		if msgType == websocketFiber.TextMessage {
			var msg models.Message
			if err := json.Unmarshal(message, &msg); err == nil {
				switch msg.Type {
				case "start":
					logStarting(providerName)

					// Clean up previous session if exists
					if provider != nil {
						provider.Stop()
						provider = nil
					}
					if cancel != nil {
						cancel()
					}

					ctx, c := context.WithCancel(context.Background())
					cancel = c
					stoppedByUser.Store(false)

					// Create ASR provider
					provider, err = createASRProvider(ctx, cfg, providerName, msg)
					if err != nil {
						sendError(conn, providerName, fmt.Sprintf("%s init failed", providerName), err)
						continue
					}

					// Start the provider (connects to ASR service + starts receiving results)
					if err := provider.Start(ctx); err != nil {
						sendError(conn, providerName, "Failed to start streaming", err)
						provider = nil
						continue
					}

					isProcessing = true

					// Forward ASR results to frontend via WebSocket
					go forwardResults(conn, provider, providerName, &stoppedByUser)

					sendStarted(conn)

				case "stop":
					logStopping(providerName)
					stoppedByUser.Store(true)
					isProcessing = false
					if provider != nil {
						provider.Stop()
						provider = nil
					}
					sendStopped(conn)
				}
			}
		} else if msgType == websocketFiber.BinaryMessage {
			// Forward raw PCM audio to ASR provider
			if isProcessing && provider != nil {
				if err := provider.SendAudio(message); err != nil {
					errMsg := err.Error()
					if strings.Contains(errMsg, "EOF") ||
						strings.Contains(errMsg, "stream is done") ||
						strings.Contains(errMsg, "closed") {
						log.Printf("⚠️  [%s] Stream closed - stopping session\n", providerName)
						isProcessing = false
						provider.Stop()
						provider = nil
						sendError(conn, providerName, "Stream closed. Please restart.", nil)
					} else {
						sendError(conn, providerName, "Failed to send audio", err)
					}
				}
			}
		}
	}
}

// createASRProvider creates the appropriate ASR provider based on providerName.
// Supports "Google" and "Azure" providers with configuration from config.Config.
func createASRProvider(ctx context.Context, cfg *config.Config, providerName string, msg models.Message) (domain.ASRProvider, error) {
	switch strings.ToLower(providerName) {
	case "google":
		// Use sample rate from frontend if provided, otherwise use config default
		sampleRate := cfg.GoogleConfig.SampleRate
		if msg.SampleRate > 0 {
			sampleRate = msg.SampleRate
			log.Printf("🎤 [Google] Using sample rate from frontend: %d Hz\n", sampleRate)
		} else {
			log.Printf("🎤 [Google] Using default sample rate: %d Hz\n", sampleRate)
		}

		// Determine credentials (priority: frontend API key > config API key > credentials file > ADC)
		apiKey := msg.APIKey
		credFile := ""
		if apiKey == "" {
			apiKey = cfg.GoogleAPIKey
		}
		if apiKey == "" {
			credFile = cfg.GoogleApplicationCredentials
		}

		return asr.NewGoogleProvider(ctx, asr.GoogleConfig{
			CredentialsFile:       credFile,
			APIKey:                apiKey,
			SampleRate:            sampleRate,
			LanguageCode:          cfg.GoogleConfig.LanguageCode,
			EnableAutoPunctuation: cfg.GoogleConfig.EnableAutoPunctuation,
		})

	case "azure":
		if cfg.AzureSubscriptionKey == "" || cfg.AzureRegion == "" {
			return nil, fmt.Errorf("Azure credentials not configured")
		}

		return asr.NewAzureProvider(ctx, asr.AzureConfig{
			SubscriptionKey:                cfg.AzureSubscriptionKey,
			Region:                         cfg.AzureRegion,
			SampleRate:                     cfg.AzureConfig.SampleRate,
			SegmentationSilenceTimeout:     cfg.AzureConfig.SegmentationSilenceTimeout,
			SegmentationMaxSilenceDuration: cfg.AzureConfig.SegmentationMaxSilenceDuration,
		})

	default:
		return nil, fmt.Errorf("unknown provider: %s", providerName)
	}
}

// forwardResults reads transcription results from the ASR provider channel
// and sends them to the frontend via WebSocket.
// When the results channel closes (stream ended), it sends an error to the frontend
// unless the user explicitly stopped the session.
func forwardResults(conn *websocketFiber.Conn, provider domain.ASRProvider, providerName string, stoppedByUser *atomic.Bool) {
	for result := range provider.Results() {
		sendTranscript(conn, result.Text, result.IsFinal, result.Confidence)
		if result.IsFinal {
			logFinalTranscript(providerName, result.Text, result.Confidence)
		}
	}

	// Results channel closed — stream ended
	if !stoppedByUser.Load() {
		errMsg := "Stream ended unexpectedly. Please restart."

		// Check for specific errors (e.g., Google 5-minute limit)
		if lastErr := provider.Err(); lastErr != nil {
			errStr := lastErr.Error()
			if strings.Contains(errStr, "maximum allowed stream duration") ||
				strings.Contains(errStr, "DeadlineExceeded") {
				errMsg = "5-minute limit reached. Please restart the session."
				log.Printf("⚠️  [%s] %s\n", providerName, errMsg)
			}
		}

		sendError(conn, providerName, errMsg, nil)
	}
}
