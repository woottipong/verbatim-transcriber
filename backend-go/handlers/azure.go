package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"thai-transcriber-backend/config"
	"thai-transcriber-backend/utils"

	websocketFiber "github.com/gofiber/websocket/v2"
)

// AzureSession - Azure REST API based session
type AzureSession struct {
	audioBuffer  []byte
	isProcessing bool
	batchSize    int
	httpClient   *http.Client
	apiEndpoint  string
	apiKey       string
}

// AzureResponse - Azure Speech API response
type AzureRecognitionResult struct {
	RecognitionStatus string `json:"RecognitionStatus"`
	DisplayText       string `json:"DisplayText"`
	Offset            int64  `json:"Offset"`
	Duration          int64  `json:"Duration"`
}

func HandleAzure(conn *websocketFiber.Conn, cfg *config.Config) {
	logConnection("Azure")

	session := &AzureSession{
		audioBuffer:  make([]byte, 0),
		isProcessing: false,
		batchSize:    64000, // ~1-2 seconds of audio
		httpClient:   &http.Client{},
	}

	sendConnected(conn)

	defer logDisconnection("Azure")

	for {
		msgType, message, err := conn.ReadMessage()
		if err != nil {
			sendError(conn, "Azure", "Read error", err)
			break
		}

		// Handle control messages (JSON)
		if msgType == websocketFiber.TextMessage {
			var msg Message
			if err := json.Unmarshal(message, &msg); err == nil {
				switch msg.Type {
				case "start":
					logStarting("Azure")

					subscriptionKey := msg.APIKey
					if subscriptionKey == "" {
						subscriptionKey = cfg.AzureSubscriptionKey
					}

					if subscriptionKey == "" || cfg.AzureRegion == "" {
						sendError(conn, "Azure", "Azure credentials not configured", nil)
						continue
					}

					session.apiKey = subscriptionKey
					session.apiEndpoint = fmt.Sprintf(
						"https://%s.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1",
						cfg.AzureRegion,
					)

					session.isProcessing = true
					sendStarted(conn)

				case "stop":
					logStopping("Azure")
					session.audioBuffer = make([]byte, 0)
					session.isProcessing = false
					sendStopped(conn)
				}
			}
		} else if msgType == websocketFiber.BinaryMessage {
			// Handle audio data
			if session.isProcessing {
				handleAzureAudioData(conn, session, message, cfg)
			}
		}
	}
}

func handleAzureAudioData(conn *websocketFiber.Conn, session *AzureSession, data []byte, cfg *config.Config) {
	session.audioBuffer = append(session.audioBuffer, data...)

	// Process when buffer reaches batch size
	if len(session.audioBuffer) >= session.batchSize {
		audioBlob := make([]byte, len(session.audioBuffer))
		copy(audioBlob, session.audioBuffer)
		session.audioBuffer = make([]byte, 0)

		go func() {
			// Convert PCM to WAV (Azure expects WAV format)
			wavBuffer := utils.ConvertPCMtoWAV(audioBlob, 16000, 1, 16)

			// Create HTTP request
			req, err := http.NewRequest("POST", session.apiEndpoint, bytes.NewReader(wavBuffer))
			if err != nil {
				sendError(conn, "Azure", "Request creation failed", err)
				return
			}

			// Set headers
			req.Header.Set("Ocp-Apim-Subscription-Key", session.apiKey)
			req.Header.Set("Content-Type", "audio/wav; codecs=audio/pcm; samplerate=16000")
			req.Header.Set("Accept", "application/json")

			// Query parameters
			q := req.URL.Query()
			q.Add("language", cfg.AzureConfig.Language)
			q.Add("format", "detailed")
			req.URL.RawQuery = q.Encode()

			// Send request
			resp, err := session.httpClient.Do(req)
			if err != nil {
				sendError(conn, "Azure", "API request failed", err)
				return
			}
			defer resp.Body.Close()

			// Read response
			body, err := io.ReadAll(resp.Body)
			if err != nil {
				sendError(conn, "Azure", "Failed to read response", err)
				return
			}

			// Check status code
			if resp.StatusCode != http.StatusOK {
				sendError(conn, "Azure", fmt.Sprintf("API error (status %d): %s", resp.StatusCode, string(body)), nil)
				return
			}

			// Parse response
			var result AzureRecognitionResult
			if err := json.Unmarshal(body, &result); err != nil {
				sendError(conn, "Azure", "Failed to parse response", err)
				return
			}

			// Send transcript if recognized
			if result.RecognitionStatus == "Success" && result.DisplayText != "" {
				logFinalTranscript("Azure", result.DisplayText, 0)
				sendTranscript(conn, result.DisplayText, true, 1.0)
			}
		}()
	}
}
