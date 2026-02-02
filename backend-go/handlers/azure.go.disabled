package handlers

import (
	"encoding/json"
	"thai-transcriber-backend/config"

	"github.com/Microsoft/cognitive-services-speech-sdk-go/audio"
	"github.com/Microsoft/cognitive-services-speech-sdk-go/common"
	"github.com/Microsoft/cognitive-services-speech-sdk-go/speech"
	websocketFiber "github.com/gofiber/websocket/v2"
)

type AzureSession struct {
	recognizer   *speech.SpeechRecognizer
	audioStream  *audio.PushAudioInputStream
	isProcessing bool
}

func HandleAzure(conn *websocketFiber.Conn, cfg *config.Config) {
	logConnection("Azure")

	session := &AzureSession{
		isProcessing: false,
	}

	sendConnected(conn)

	defer func() {
		if session.audioStream != nil {
			session.audioStream.Close()
		}
		if session.recognizer != nil {
			session.recognizer.Close()
		}
		logDisconnection("Azure")
	}()

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

					// Create speech config
					speechConfig, err := speech.NewSpeechConfigFromSubscription(subscriptionKey, cfg.AzureRegion)
					if err != nil {
						sendError(conn, "Azure", "Speech config failed", err)
						continue
					}
					defer speechConfig.Close()

					// Set recognition language
					speechConfig.SetSpeechRecognitionLanguage(cfg.AzureConfig.Language)

					// Set properties
					speechConfig.SetProperty(common.SpeechServiceConnectionInitialSilenceTimeoutMs, "5000")
					speechConfig.SetProperty(common.SpeechServiceConnectionEndSilenceTimeoutMs, "2000")

					// Create push audio stream
					stream, err := audio.CreatePushAudioInputStream()
					if err != nil {
						sendError(conn, "Azure", "Stream creation failed", err)
						continue
					}
					session.audioStream = stream

					// Create audio config from stream
					audioConfig, err := audio.NewAudioConfigFromStreamInput(stream)
					if err != nil {
						sendError(conn, "Azure", "Audio config failed", err)
						continue
					}
					defer audioConfig.Close()

					// Create recognizer
					recognizer, err := speech.NewSpeechRecognizerFromConfig(speechConfig, audioConfig)
					if err != nil {
						sendError(conn, "Azure", "Recognizer creation failed", err)
						continue
					}
					session.recognizer = recognizer

					// Setup event handlers
					recognizer.Recognizing(func(event speech.SpeechRecognitionEventArgs) {
						defer event.Close()
						if event.Result.Reason == common.RecognizingSpeech {
							sendTranscript(conn, event.Result.Text, false, 0.0)
						}
					})

					recognizer.Recognized(func(event speech.SpeechRecognitionEventArgs) {
						defer event.Close()
						if event.Result.Reason == common.RecognizedSpeech {
							sendTranscript(conn, event.Result.Text, true, 1.0)
							logFinalTranscript("Azure", event.Result.Text, 0)
						}
					})

					recognizer.Canceled(func(event speech.SpeechRecognitionCanceledEventArgs) {
						defer event.Close()
						sendError(conn, "Azure", "Recognition canceled: "+event.ErrorDetails, nil)
					})

					// Start continuous recognition
					errChan := recognizer.StartContinuousRecognitionAsync()
					select {
					case err := <-errChan:
						if err != nil {
							sendError(conn, "Azure", "Failed to start recognition", err)
							continue
						}
					default:
						// Started successfully
					}

					session.isProcessing = true
					sendStarted(conn)

				case "stop":
					logStopping("Azure")
					if session.recognizer != nil {
						session.recognizer.StopContinuousRecognitionAsync()
					}
					if session.audioStream != nil {
						session.audioStream.Close()
						session.audioStream = nil
					}
					session.isProcessing = false
					sendStopped(conn)
				}
			}
		} else if msgType == websocketFiber.BinaryMessage {
			// Handle audio data
			if session.isProcessing && session.audioStream != nil {
				session.audioStream.Write(message)
			}
		}
	}
}
