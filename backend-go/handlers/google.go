package handlers

import (
	"context"
	"encoding/json"
	"thai-transcriber-backend/config"

	speech "cloud.google.com/go/speech/apiv1"
	"cloud.google.com/go/speech/apiv1/speechpb"
	websocketFiber "github.com/gofiber/websocket/v2"
	"google.golang.org/api/option"
)

type GoogleSession struct {
	client       *speech.Client
	stream       speechpb.Speech_StreamingRecognizeClient
	isProcessing bool
}

func HandleGoogle(conn *websocketFiber.Conn, cfg *config.Config) {
	logConnection("Google")

	session := &GoogleSession{
		isProcessing: false,
	}

	sendConnected(conn)

	defer func() {
		if session.stream != nil {
			session.stream.CloseSend()
		}
		if session.client != nil {
			session.client.Close()
		}
		logDisconnection("Google")
	}()

	for {
		msgType, message, err := conn.ReadMessage()
		if err != nil {
			sendError(conn, "Google", "Read error", err)
			break
		}

		// Handle control messages (JSON)
		if msgType == websocketFiber.TextMessage {
			var msg Message
			if err := json.Unmarshal(message, &msg); err == nil {
				switch msg.Type {
				case "start":
					logStarting("Google")

					ctx := context.Background()

					// Initialize client
					var client *speech.Client
					if msg.APIKey != "" {
						// Use provided API key
						client, err = speech.NewClient(ctx, option.WithAPIKey(msg.APIKey))
					} else if cfg.GoogleAPIKey != "" {
						// Use config API key
						client, err = speech.NewClient(ctx, option.WithAPIKey(cfg.GoogleAPIKey))
					} else {
						// Use default credentials (ADC)
						client, err = speech.NewClient(ctx)
					}

					if err != nil {
						sendError(conn, "Google", "Google Speech client init failed", err)
						continue
					}

					session.client = client

					// Create streaming recognize stream
					stream, err := client.StreamingRecognize(ctx)
					if err != nil {
						sendError(conn, "Google", "Failed to create stream", err)
						continue
					}

					session.stream = stream

					// Send initial config
					err = stream.Send(&speechpb.StreamingRecognizeRequest{
						StreamingRequest: &speechpb.StreamingRecognizeRequest_StreamingConfig{
							StreamingConfig: &speechpb.StreamingRecognitionConfig{
								Config: &speechpb.RecognitionConfig{
									Encoding:        speechpb.RecognitionConfig_LINEAR16,
									SampleRateHertz: int32(cfg.GoogleConfig.SampleRate),
									LanguageCode:    cfg.GoogleConfig.LanguageCode,
									Model:           cfg.GoogleConfig.Model,
									UseEnhanced:     cfg.GoogleConfig.UseEnhanced,
								},
								InterimResults: true,
							},
						},
					})

					if err != nil {
						sendError(conn, "Google", "Failed to send config", err)
						continue
					}

					session.isProcessing = true

					// Start receiving responses
					go handleGoogleResponses(conn, session)

					sendStarted(conn)

				case "stop":
					logStopping("Google")
					if session.stream != nil {
						session.stream.CloseSend()
						session.stream = nil
					}
					session.isProcessing = false
					sendStopped(conn)
				}
			}
		} else if msgType == websocketFiber.BinaryMessage {
			// Handle audio data
			if session.isProcessing && session.stream != nil {
				err := session.stream.Send(&speechpb.StreamingRecognizeRequest{
					StreamingRequest: &speechpb.StreamingRecognizeRequest_AudioContent{
						AudioContent: message,
					},
				})

				if err != nil {
					sendError(conn, "Google", "Failed to send audio", err)
				}
			}
		}
	}
}

func handleGoogleResponses(conn *websocketFiber.Conn, session *GoogleSession) {
	for {
		resp, err := session.stream.Recv()
		if err != nil {
			sendError(conn, "Google", "Stream error", err)
			break
		}

		if len(resp.Results) > 0 {
			result := resp.Results[0]
			if len(result.Alternatives) > 0 {
				alt := result.Alternatives[0]
				confidence := float64(alt.Confidence)

				sendTranscript(conn, alt.Transcript, result.IsFinal, confidence)

				if result.IsFinal {
					logFinalTranscript("Google", alt.Transcript, confidence)
				}
			}
		}
	}
}
