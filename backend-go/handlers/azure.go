package handlers

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"thai-transcriber-backend/config"
	"time"

	fasthttpws "github.com/fasthttp/websocket"
	"github.com/gofiber/websocket/v2"
	"github.com/google/uuid"
)

// AzureSession - Azure WebSocket streaming session
type AzureSession struct {
	azureConn    *fasthttpws.Conn
	isProcessing bool
	connectionID string
	requestID    string
	mu           sync.Mutex
}

// Azure WebSocket response structures
type AzureSpeechHypothesis struct {
	Text     string `json:"Text"`
	Offset   int64  `json:"Offset"`
	Duration int64  `json:"Duration"`
}

type AzureSpeechPhrase struct {
	RecognitionStatus string `json:"RecognitionStatus"`
	DisplayText       string `json:"DisplayText"`
	Offset            int64  `json:"Offset"`
	Duration          int64  `json:"Duration"`
	NBest             []struct {
		Confidence float64 `json:"Confidence"`
		Display    string  `json:"Display"`
		Lexical    string  `json:"Lexical"`
	} `json:"NBest,omitempty"`
}

func HandleAzure(conn *websocket.Conn, cfg *config.Config) {
	logConnection("Azure")

	session := &AzureSession{
		isProcessing: false,
		connectionID: strings.ReplaceAll(uuid.New().String(), "-", ""),
	}

	sendConnected(conn)

	defer func() {
		session.mu.Lock()
		if session.azureConn != nil {
			session.azureConn.Close()
		}
		session.mu.Unlock()
		logDisconnection("Azure")
	}()

	for {
		msgType, message, err := conn.ReadMessage()
		if err != nil {
			sendError(conn, "Azure", "Read error", err)
			break
		}

		// Handle control messages (JSON)
		if msgType == websocket.TextMessage {
			var msg Message
			if err := json.Unmarshal(message, &msg); err == nil {
				switch msg.Type {
				case "start":
					logStarting("Azure")

					if cfg.AzureSubscriptionKey == "" || cfg.AzureRegion == "" {
						sendError(conn, "Azure", "Azure credentials not configured", nil)
						continue
					}

					// Connect to Azure WebSocket
					err := connectAzureWebSocket(session, cfg)
					if err != nil {
						sendError(conn, "Azure", "Failed to connect to Azure", err)
						continue
					}

					// Start receiving Azure responses
					go handleAzureResponses(conn, session)

					session.isProcessing = true
					sendStarted(conn)

				case "stop":
					logStopping("Azure")
					session.mu.Lock()
					session.isProcessing = false
					if session.azureConn != nil {
						// Send audio end marker
						sendAudioEnd(session)
						session.azureConn.Close()
						session.azureConn = nil
					}
					session.mu.Unlock()
					sendStopped(conn)
				}
			}
		} else if msgType == websocket.BinaryMessage {
			// Handle audio data - stream directly to Azure
			session.mu.Lock()
			if session.isProcessing && session.azureConn != nil {
				sendAudioChunk(session, message)
			}
			session.mu.Unlock()
		}
	}
}

func connectAzureWebSocket(session *AzureSession, cfg *config.Config) error {
	// Generate new request ID for this session
	session.requestID = strings.ReplaceAll(uuid.New().String(), "-", "")

	// Azure Speech WebSocket URL
	wsURL := fmt.Sprintf(
		"wss://%s.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=%s&format=detailed",
		cfg.AzureRegion,
		cfg.AzureConfig.Language,
	)

	// Create dialer with custom headers
	dialer := fasthttpws.Dialer{}

	// Connect with headers
	azureConn, _, err := dialer.Dial(wsURL, map[string][]string{
		"Ocp-Apim-Subscription-Key": {cfg.AzureSubscriptionKey},
		"X-ConnectionId":            {session.connectionID},
	})
	if err != nil {
		return fmt.Errorf("websocket dial failed: %v", err)
	}

	session.azureConn = azureConn

	// Send speech.config message
	if err := sendSpeechConfig(session); err != nil {
		azureConn.Close()
		return fmt.Errorf("failed to send speech config: %v", err)
	}

	// Send audio config (RIFF header)
	if err := sendAudioConfigMessage(session, cfg); err != nil {
		azureConn.Close()
		return fmt.Errorf("failed to send audio config: %v", err)
	}

	log.Printf("✅ [Azure] WebSocket connected (connection: %s)\n", session.connectionID[:8])
	return nil
}

func sendSpeechConfig(session *AzureSession) error {
	// Speech config JSON
	speechConfig := map[string]interface{}{
		"context": map[string]interface{}{
			"system": map[string]interface{}{
				"name":    "thai-transcriber",
				"version": "1.0.0",
				"build":   "Go",
			},
			"os": map[string]interface{}{
				"platform": "Go",
				"name":     "thai-transcriber-backend",
				"version":  "1.0.0",
			},
		},
	}

	configJSON, err := json.Marshal(speechConfig)
	if err != nil {
		return err
	}

	// Build message with headers
	var buf bytes.Buffer
	buf.WriteString("Path: speech.config\r\n")
	buf.WriteString(fmt.Sprintf("X-RequestId: %s\r\n", session.requestID))
	buf.WriteString(fmt.Sprintf("X-Timestamp: %s\r\n", getISO8601Timestamp()))
	buf.WriteString("Content-Type: application/json\r\n")
	buf.WriteString("\r\n")
	buf.Write(configJSON)

	return session.azureConn.WriteMessage(fasthttpws.TextMessage, buf.Bytes())
}

func sendAudioConfigMessage(session *AzureSession, cfg *config.Config) error {
	// Create RIFF/WAV header for streaming audio
	riffHeader := createRIFFHeader(cfg.AzureConfig.SampleRate, cfg.AzureConfig.Channels, cfg.AzureConfig.BitsPerSample)

	// Build binary message with headers
	var headerBuf bytes.Buffer
	headerBuf.WriteString("Path: audio\r\n")
	headerBuf.WriteString(fmt.Sprintf("X-RequestId: %s\r\n", session.requestID))
	headerBuf.WriteString(fmt.Sprintf("X-Timestamp: %s\r\n", getISO8601Timestamp()))
	headerBuf.WriteString("Content-Type: audio/x-wav\r\n")
	headerBuf.WriteString("\r\n")

	// Combine header text + RIFF header
	headerBytes := headerBuf.Bytes()
	headerLen := len(headerBytes)

	// Azure binary message format: 2-byte header length + header + audio data
	message := make([]byte, 2+headerLen+len(riffHeader))
	binary.BigEndian.PutUint16(message[0:2], uint16(headerLen))
	copy(message[2:2+headerLen], headerBytes)
	copy(message[2+headerLen:], riffHeader)

	return session.azureConn.WriteMessage(fasthttpws.BinaryMessage, message)
}

func sendAudioChunk(session *AzureSession, audioData []byte) error {
	// Build binary message with headers
	var headerBuf bytes.Buffer
	headerBuf.WriteString("Path: audio\r\n")
	headerBuf.WriteString(fmt.Sprintf("X-RequestId: %s\r\n", session.requestID))
	headerBuf.WriteString(fmt.Sprintf("X-Timestamp: %s\r\n", getISO8601Timestamp()))
	headerBuf.WriteString("Content-Type: audio/x-wav\r\n")
	headerBuf.WriteString("\r\n")

	headerBytes := headerBuf.Bytes()
	headerLen := len(headerBytes)

	// Azure binary message format: 2-byte header length + header + audio data
	message := make([]byte, 2+headerLen+len(audioData))
	binary.BigEndian.PutUint16(message[0:2], uint16(headerLen))
	copy(message[2:2+headerLen], headerBytes)
	copy(message[2+headerLen:], audioData)

	return session.azureConn.WriteMessage(fasthttpws.BinaryMessage, message)
}

func sendAudioEnd(session *AzureSession) error {
	// Send empty audio chunk to signal end of audio
	var headerBuf bytes.Buffer
	headerBuf.WriteString("Path: audio\r\n")
	headerBuf.WriteString(fmt.Sprintf("X-RequestId: %s\r\n", session.requestID))
	headerBuf.WriteString(fmt.Sprintf("X-Timestamp: %s\r\n", getISO8601Timestamp()))
	headerBuf.WriteString("Content-Type: audio/x-wav\r\n")
	headerBuf.WriteString("\r\n")

	headerBytes := headerBuf.Bytes()
	headerLen := len(headerBytes)

	// Empty audio message (just headers, no audio data)
	message := make([]byte, 2+headerLen)
	binary.BigEndian.PutUint16(message[0:2], uint16(headerLen))
	copy(message[2:], headerBytes)

	return session.azureConn.WriteMessage(fasthttpws.BinaryMessage, message)
}

func handleAzureResponses(conn *websocket.Conn, session *AzureSession) {
	for {
		session.mu.Lock()
		azureConn := session.azureConn
		session.mu.Unlock()

		if azureConn == nil {
			break
		}

		msgType, message, err := azureConn.ReadMessage()
		if err != nil {
			// Connection closed
			break
		}

		if msgType == fasthttpws.TextMessage {
			// Parse text message (headers + body)
			parseAzureTextMessage(conn, message)
		} else if msgType == fasthttpws.BinaryMessage {
			// Parse binary message (for turn.start, turn.end, etc.)
			parseAzureBinaryMessage(conn, message)
		}
	}
}

func parseAzureTextMessage(conn *websocket.Conn, message []byte) {
	// Azure text messages have headers followed by body
	reader := bufio.NewReader(bytes.NewReader(message))

	// Parse headers
	headers := make(map[string]string)
	for {
		line, err := reader.ReadString('\n')
		if err != nil || line == "\r\n" || line == "\n" {
			break
		}
		line = strings.TrimSpace(line)
		if idx := strings.Index(line, ":"); idx > 0 {
			key := strings.TrimSpace(line[:idx])
			value := strings.TrimSpace(line[idx+1:])
			headers[key] = value
		}
	}

	// Read body
	var bodyBuf bytes.Buffer
	bodyBuf.ReadFrom(reader)
	body := bodyBuf.Bytes()

	path := headers["Path"]

	switch path {
	case "speech.hypothesis":
		// Interim result
		var hypothesis AzureSpeechHypothesis
		if err := json.Unmarshal(body, &hypothesis); err == nil && hypothesis.Text != "" {
			sendTranscript(conn, hypothesis.Text, false, 0.0)
		}

	case "speech.phrase":
		// Final result
		var phrase AzureSpeechPhrase
		if err := json.Unmarshal(body, &phrase); err == nil {
			if phrase.RecognitionStatus == "Success" && phrase.DisplayText != "" {
				confidence := 0.0
				if len(phrase.NBest) > 0 {
					confidence = phrase.NBest[0].Confidence
				}
				logFinalTranscript("Azure", phrase.DisplayText, confidence)
				sendTranscript(conn, phrase.DisplayText, true, confidence)
			}
		}

	case "turn.start":
		log.Printf("🎤 [Azure] Turn started\n")

	case "turn.end":
		log.Printf("🔇 [Azure] Turn ended\n")

	case "speech.startDetected":
		log.Printf("🗣️ [Azure] Speech detected\n")

	case "speech.endDetected":
		log.Printf("🔕 [Azure] Speech ended\n")
	}
}

func parseAzureBinaryMessage(conn *websocket.Conn, message []byte) {
	// Binary messages also have header length prefix
	if len(message) < 2 {
		return
	}

	headerLen := binary.BigEndian.Uint16(message[0:2])
	if len(message) < int(2+headerLen) {
		return
	}

	headerBytes := message[2 : 2+headerLen]

	// Parse headers from binary message
	reader := bufio.NewReader(bytes.NewReader(headerBytes))
	headers := make(map[string]string)
	for {
		line, err := reader.ReadString('\n')
		if err != nil || line == "\r\n" || line == "\n" {
			break
		}
		line = strings.TrimSpace(line)
		if idx := strings.Index(line, ":"); idx > 0 {
			key := strings.TrimSpace(line[:idx])
			value := strings.TrimSpace(line[idx+1:])
			headers[key] = value
		}
	}

	path := headers["Path"]

	switch path {
	case "turn.start":
		log.Printf("🎤 [Azure] Turn started (binary)\n")
	case "turn.end":
		log.Printf("🔇 [Azure] Turn ended (binary)\n")
	}
}

func createRIFFHeader(sampleRate, channels, bitsPerSample int) []byte {
	byteRate := sampleRate * channels * bitsPerSample / 8
	blockAlign := channels * bitsPerSample / 8

	// RIFF header for streaming (data size = 0 for streaming)
	header := make([]byte, 44)

	// RIFF chunk
	copy(header[0:4], "RIFF")
	binary.LittleEndian.PutUint32(header[4:8], 0) // File size (0 for streaming)
	copy(header[8:12], "WAVE")

	// fmt sub-chunk
	copy(header[12:16], "fmt ")
	binary.LittleEndian.PutUint32(header[16:20], 16) // Sub-chunk size
	binary.LittleEndian.PutUint16(header[20:22], 1)  // Audio format (PCM)
	binary.LittleEndian.PutUint16(header[22:24], uint16(channels))
	binary.LittleEndian.PutUint32(header[24:28], uint32(sampleRate))
	binary.LittleEndian.PutUint32(header[28:32], uint32(byteRate))
	binary.LittleEndian.PutUint16(header[32:34], uint16(blockAlign))
	binary.LittleEndian.PutUint16(header[34:36], uint16(bitsPerSample))

	// data sub-chunk
	copy(header[36:40], "data")
	binary.LittleEndian.PutUint32(header[40:44], 0) // Data size (0 for streaming)

	return header
}

func getISO8601Timestamp() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}
