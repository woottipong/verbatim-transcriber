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
// providerName: "Google", "Gemini", or "Azure" (used for logging and provider selection)
func HandleASR(conn *websocketFiber.Conn, cfg *config.Config, providerName string) {
	logConnection(providerName)
	conn.SetReadLimit(1 << 20)
	writer := newSafeJSONWriter(conn)
	if err := sendConnected(writer); err != nil {
		log.Printf("❌ [%s] Failed to send connection status: %v", providerName, err)
		return
	}

	var provider domain.ASRProvider
	var cancel context.CancelFunc
	var sessionStopped *atomic.Bool
	isProcessing := false

	defer func() {
		if sessionStopped != nil {
			sessionStopped.Store(true)
		}
		if provider != nil {
			stopProvider(provider, providerName)
		}
		if cancel != nil {
			cancel()
		}
		logDisconnection(providerName)
	}()

	for {
		msgType, message, err := conn.ReadMessage()
		if err != nil {
			_ = sendError(writer, providerName, "Read error", err)
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
					if sessionStopped != nil {
						sessionStopped.Store(true)
					}
					if provider != nil {
						stopProvider(provider, providerName)
						provider = nil
					}
					if cancel != nil {
						cancel()
					}

					ctx, c := context.WithCancel(context.Background())
					cancel = c
					sessionStopped = &atomic.Bool{}

					// Create ASR provider
					provider, err = createASRProvider(ctx, cfg, providerName, msg)
					if err != nil {
						_ = sendError(writer, providerName, fmt.Sprintf("%s init failed", providerName), err)
						continue
					}

					// Start the provider (connects to ASR service + starts receiving results)
					if err := provider.Start(ctx); err != nil {
						_ = sendError(writer, providerName, "Failed to start streaming", err)
						stopProvider(provider, providerName)
						provider = nil
						continue
					}

					isProcessing = true

					// Forward ASR results to frontend via WebSocket
					go forwardResults(writer, provider, providerName, sessionStopped)

					_ = sendStarted(writer)

				case "stop":
					logStopping(providerName)
					if sessionStopped != nil {
						sessionStopped.Store(true)
					}
					isProcessing = false
					if provider != nil {
						stopProvider(provider, providerName)
						provider = nil
					}
					_ = sendStopped(writer)
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
						if sessionStopped != nil {
							sessionStopped.Store(true)
						}
						stopProvider(provider, providerName)
						provider = nil
						_ = sendError(writer, providerName, "Stream closed. Please restart.", nil)
					} else {
						_ = sendError(writer, providerName, "Failed to send audio", err)
					}
				}
			}
		}
	}
}

// createASRProvider creates the appropriate ASR provider based on providerName.
// Supports "Google", "Gemini", and "Azure" providers with configuration from config.Config.
func createASRProvider(ctx context.Context, cfg *config.Config, providerName string, msg models.Message) (domain.ASRProvider, error) {
	switch strings.ToLower(providerName) {
	case "google":
		if err := validateSampleRate(msg.SampleRate); err != nil {
			return nil, err
		}
		// Use sample rate from frontend if provided, otherwise use config default
		sampleRate := cfg.GoogleConfig.SampleRate
		if msg.SampleRate > 0 {
			sampleRate = msg.SampleRate
			log.Printf("🎤 [Google] Using sample rate from frontend: %d Hz\n", sampleRate)
		} else {
			log.Printf("🎤 [Google] Using default sample rate: %d Hz\n", sampleRate)
		}

		// Credentials are backend-only and must never be accepted from WebSocket clients.
		apiKey := cfg.GoogleAPIKey
		credFile := ""
		if apiKey == "" {
			credFile = cfg.GoogleApplicationCredentials
		}

		return asr.NewGoogleProvider(ctx, asr.GoogleConfig{
			CredentialsFile:       credFile,
			APIKey:                apiKey,
			ProjectID:             cfg.GoogleCloudProject,
			Location:              cfg.GoogleConfig.Location,
			Model:                 cfg.GoogleConfig.Model,
			SampleRate:            sampleRate,
			LanguageCode:          cfg.GoogleConfig.LanguageCode,
			EnableAutoPunctuation: cfg.GoogleConfig.EnableAutoPunctuation,
		})

	case "azure":
		if cfg.AzureSubscriptionKey == "" || cfg.AzureRegion == "" {
			return nil, fmt.Errorf("azure credentials not configured")
		}

		return asr.NewAzureProvider(ctx, asr.AzureConfig{
			SubscriptionKey:                cfg.AzureSubscriptionKey,
			Region:                         cfg.AzureRegion,
			SampleRate:                     cfg.AzureConfig.SampleRate,
			SegmentationSilenceTimeout:     cfg.AzureConfig.SegmentationSilenceTimeout,
			SegmentationMaxSilenceDuration: cfg.AzureConfig.SegmentationMaxSilenceDuration,
		})

	case "gemini":
		if cfg.GeminiAPIKey == "" {
			return nil, fmt.Errorf("gemini credentials not configured")
		}

		return asr.NewGeminiProvider(ctx, asr.GeminiConfig{
			APIKey:             cfg.GeminiAPIKey,
			Model:              cfg.GeminiConfig.Model,
			LanguageCode:       cfg.GeminiConfig.LanguageCode,
			TargetLanguageCode: cfg.GeminiConfig.TargetLanguageCode,
			SampleRate:         cfg.GeminiConfig.SampleRate,
		})

	default:
		return nil, fmt.Errorf("unknown provider: %s", providerName)
	}
}

func stopProvider(provider domain.ASRProvider, providerName string) {
	if err := provider.Stop(); err != nil {
		log.Printf("⚠️ [%s] Failed to stop provider: %v", providerName, err)
	}
}

func validateSampleRate(sampleRate int) error {
	if sampleRate == 0 {
		return nil
	}
	if sampleRate < 8000 || sampleRate > 96000 {
		return fmt.Errorf("sample rate must be between 8000 and 96000 Hz")
	}
	return nil
}

// forwardResults reads transcription results from the ASR provider channel
// and sends them to the frontend via WebSocket.
// When the results channel closes (stream ended), it sends an error to the frontend
// unless the user explicitly stopped the session.
func forwardResults(conn jsonWriter, provider domain.ASRProvider, providerName string, stoppedByUser *atomic.Bool) {
	for result := range provider.Results() {
		if err := sendTranscript(conn, result.Text, result.IsFinal, result.Confidence); err != nil {
			log.Printf("❌ [%s] Failed to send transcript: %v", providerName, err)
			return
		}
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

		_ = sendError(conn, providerName, errMsg, nil)
	}
}
