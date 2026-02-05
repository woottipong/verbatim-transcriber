package handler

import (
	"context"
	"encoding/json"
	"log"
	"strings"
	"thai-transcriber-backend/config"
	"thai-transcriber-backend/models"

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
			var msg models.Message
			if err := json.Unmarshal(message, &msg); err == nil {
				switch msg.Type {
				case "start":
					logStarting("Google")

					ctx := context.Background()

					// ใช้ sampleRate จาก frontend (ถ้ามี) หรือใช้ค่า default จาก config
					sampleRate := cfg.GoogleConfig.SampleRate
					if msg.SampleRate > 0 {
						sampleRate = msg.SampleRate
						log.Printf("🎤 [Google] Using sample rate from frontend: %d Hz\n", sampleRate)
					} else {
						log.Printf("🎤 [Google] Using default sample rate: %d Hz\n", sampleRate)
					}

					// Initialize client
					var client *speech.Client
					if msg.APIKey != "" {
						// Use provided API key
						client, err = speech.NewClient(ctx, option.WithAPIKey(msg.APIKey))
					} else if cfg.GoogleAPIKey != "" {
						// Use config API key
						client, err = speech.NewClient(ctx, option.WithAPIKey(cfg.GoogleAPIKey))
					} else if cfg.GoogleApplicationCredentials != "" {
						// Use service account JSON file
						client, err = speech.NewClient(ctx, option.WithCredentialsFile(cfg.GoogleApplicationCredentials))
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
									Encoding:                   speechpb.RecognitionConfig_LINEAR16,
									SampleRateHertz:            int32(sampleRate), // ใช้ค่าจาก frontend
									LanguageCode:               cfg.GoogleConfig.LanguageCode,
									Model:                      cfg.GoogleConfig.Model,
									UseEnhanced:                cfg.GoogleConfig.UseEnhanced,
									MaxAlternatives:            1,
									EnableAutomaticPunctuation: true,
									ProfanityFilter:            false, // ไม่กรองคำหยาบ (verbatim)
									EnableWordTimeOffsets:      false,
								},
								InterimResults:  true,
								SingleUtterance: false, // ให้ stream ต่อเนื่อง ไม่ตัดหลังประโยคแรก
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
					// Check if it's EOF or stream closed
					if err.Error() == "EOF" || strings.Contains(err.Error(), "stream is done") {
						log.Printf("⚠️  [Google] Stream closed - stopping session\n")
						session.isProcessing = false
						session.stream = nil
						sendError(conn, "Google", "Stream closed. Please restart.", nil)
					} else {
						sendError(conn, "Google", "Failed to send audio", err)
					}
				}
			}
		}
	}
}

func handleGoogleResponses(conn *websocketFiber.Conn, session *GoogleSession) {
	for {
		resp, err := session.stream.Recv()
		if err != nil {
			// Check if it's the 5-minute limit error
			errMsg := err.Error()
			if strings.Contains(errMsg, "maximum allowed stream duration") ||
				strings.Contains(errMsg, "DeadlineExceeded") {
				log.Printf("⚠️  [Google] 5-minute limit reached - session needs restart\n")
				sendError(conn, "Google", "5-minute limit reached. Please restart the session.", err)
			} else {
				sendError(conn, "Google", "Stream error", err)
			}
			break
		}

		if len(resp.Results) > 0 {
			result := resp.Results[0]
			if len(result.Alternatives) > 0 {
				alt := result.Alternatives[0]
				confidence := float64(alt.Confidence)

				sendTranscript(conn, alt.Transcript, result.IsFinal, confidence)

				// Log เฉพาะ final results (interim ส่งไป UI โดยไม่ log)
				if result.IsFinal {
					logFinalTranscript("Google", alt.Transcript, confidence)
				}
			}
		}
	}
}
