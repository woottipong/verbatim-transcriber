package asr

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"thai-transcriber-backend/internal/domain"

	"github.com/fasthttp/websocket"
	"github.com/google/uuid"
)

type AzureProvider struct {
	conn                           *websocket.Conn
	results                        chan domain.TranscriptResult
	mu                             sync.Mutex
	closeOnce                      sync.Once
	subscriptionKey                string
	region                         string
	connectionID                   string
	requestID                      string
	isRunning                      bool
	sampleRate                     int
	audioBuffer                    []byte // Buffer to accumulate audio chunks
	bufferThreshold                int    // Send when buffer reaches this size
	segmentationSilenceTimeout     int    // milliseconds
	segmentationMaxSilenceDuration int    // milliseconds
	lastErr                        error
	stopped                        bool
	activeSegmentID                string
	segmentSequence                uint64
}

type AzureConfig struct {
	SubscriptionKey                string
	Region                         string
	SampleRate                     int
	Language                       string
	SegmentationSilenceTimeout     int // milliseconds
	SegmentationMaxSilenceDuration int // milliseconds
}

func NewAzureProvider(ctx context.Context, cfg AzureConfig) (*AzureProvider, error) {
	sampleRate := cfg.SampleRate
	if sampleRate == 0 {
		sampleRate = 16000
	}

	silenceTimeout := cfg.SegmentationSilenceTimeout
	if silenceTimeout == 0 {
		silenceTimeout = 300
	}
	maxSilence := cfg.SegmentationMaxSilenceDuration
	if maxSilence == 0 {
		maxSilence = 500
	}

	return &AzureProvider{
		results:                        make(chan domain.TranscriptResult, 100),
		subscriptionKey:                cfg.SubscriptionKey,
		region:                         cfg.Region,
		connectionID:                   strings.ReplaceAll(uuid.New().String(), "-", ""),
		sampleRate:                     sampleRate,
		audioBuffer:                    make([]byte, 0),
		bufferThreshold:                6400, // ~200ms of 16kHz 16-bit audio (was 32000/~1s)
		segmentationSilenceTimeout:     silenceTimeout,
		segmentationMaxSilenceDuration: maxSilence,
	}, nil
}

func (a *AzureProvider) Name() string {
	return "azure"
}

func (a *AzureProvider) SampleRate() int {
	return a.sampleRate
}

func (a *AzureProvider) Start(ctx context.Context) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.isRunning {
		return nil
	}

	a.requestID = strings.ReplaceAll(uuid.New().String(), "-", "")

	wsURL := fmt.Sprintf(
		"wss://%s.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=th-TH&format=detailed",
		a.region,
	)

	log.Printf("🔗 [Azure] Connecting to: %s", wsURL)

	dialer := websocket.Dialer{}
	conn, resp, err := dialer.DialContext(ctx, wsURL, map[string][]string{
		"Ocp-Apim-Subscription-Key": {a.subscriptionKey},
		"X-ConnectionId":            {a.connectionID},
	})
	if err != nil {
		if resp != nil {
			log.Printf("❌ [Azure] Response status: %d", resp.StatusCode)
		}
		return fmt.Errorf("websocket dial failed: %w", err)
	}

	a.conn = conn

	if err := a.sendSpeechConfig(); err != nil {
		if closeErr := conn.Close(); closeErr != nil {
			log.Printf("⚠️ [Azure] Failed to close connection after config error: %v", closeErr)
		}
		return fmt.Errorf("failed to send speech config: %w", err)
	}

	if err := a.sendAudioConfig(); err != nil {
		if closeErr := conn.Close(); closeErr != nil {
			log.Printf("⚠️ [Azure] Failed to close connection after audio config error: %v", closeErr)
		}
		return fmt.Errorf("failed to send audio config: %w", err)
	}

	a.isRunning = true
	go a.receiveResponses()

	log.Printf("✅ [Azure] WebSocket connected (connection: %s)\n", a.connectionID[:8])
	return nil
}

func (a *AzureProvider) sendSpeechConfig() error {
	speechConfig := map[string]interface{}{
		"context": map[string]interface{}{
			"system": map[string]interface{}{
				"name":    "livekit-agent",
				"version": "1.0.0",
				"build":   "Go",
			},
			"os": map[string]interface{}{
				"platform": "Go",
				"name":     "livekit-asr-agent",
				"version":  "1.0.0",
			},
		},
		"recognition": map[string]interface{}{
			"segmentation": map[string]interface{}{
				"segmentationSilenceTimeoutMs":         fmt.Sprintf("%d", a.segmentationSilenceTimeout),
				"initialSilenceTimeoutMs":              "5000",
				"segmentationMaximumSilenceDurationMs": fmt.Sprintf("%d", a.segmentationMaxSilenceDuration),
			},
			"enableInterimResults": true,
		},
	}

	configJSON, err := json.Marshal(speechConfig)
	if err != nil {
		return err
	}

	header := fmt.Sprintf("Path: speech.config\r\nX-RequestId: %s\r\nX-Timestamp: %s\r\nContent-Type: application/json\r\n\r\n",
		a.requestID, a.getTimestamp())

	return a.conn.WriteMessage(websocket.TextMessage, []byte(header+string(configJSON)))
}

func (a *AzureProvider) sendAudioConfig() error {
	riffHeader := a.createRIFFHeader()

	headerText := fmt.Sprintf("Path: audio\r\nX-RequestId: %s\r\nX-Timestamp: %s\r\nContent-Type: audio/x-wav\r\n",
		a.requestID, a.getTimestamp())
	headerLen := uint16(len(headerText))

	var buf bytes.Buffer
	var headerLenBytes [2]byte
	binary.BigEndian.PutUint16(headerLenBytes[:], headerLen)
	buf.Write(headerLenBytes[:])
	buf.WriteString(headerText)
	buf.Write(riffHeader)

	return a.conn.WriteMessage(websocket.BinaryMessage, buf.Bytes())
}

func (a *AzureProvider) createRIFFHeader() []byte {
	header := make([]byte, 44)
	copy(header[0:4], "RIFF")
	copy(header[8:12], "WAVE")
	copy(header[12:16], "fmt ")
	binary.LittleEndian.PutUint32(header[16:20], 16)
	binary.LittleEndian.PutUint16(header[20:22], 1)
	binary.LittleEndian.PutUint16(header[22:24], 1)
	binary.LittleEndian.PutUint32(header[24:28], uint32(a.sampleRate))
	binary.LittleEndian.PutUint32(header[28:32], uint32(a.sampleRate*2))
	binary.LittleEndian.PutUint16(header[32:34], 2)
	binary.LittleEndian.PutUint16(header[34:36], 16)
	copy(header[36:40], "data")
	return header
}

func (a *AzureProvider) getTimestamp() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

func (a *AzureProvider) receiveResponses() {
	defer a.closeOnce.Do(func() { close(a.results) })
	defer func() {
		a.mu.Lock()
		a.isRunning = false
		a.mu.Unlock()
	}()

	for {
		msgType, message, err := a.conn.ReadMessage()
		if err != nil {
			a.mu.Lock()
			a.lastErr = err
			a.mu.Unlock()
			log.Printf("❌ [Azure] Read error: %v", err)
			return
		}

		if msgType == websocket.TextMessage {
			a.parseTextMessage(string(message))
		}
	}
}

func (a *AzureProvider) parseTextMessage(message string) {
	parts := strings.SplitN(message, "\r\n\r\n", 2)
	if len(parts) < 2 {
		log.Printf("⚠️ [Azure Agent] Invalid message format (no body)")
		return
	}

	headers := parts[0]
	body := parts[1]

	if strings.Contains(headers, "Path:speech.hypothesis") {
		var hypothesis struct {
			Text string `json:"Text"`
		}
		if err := json.Unmarshal([]byte(body), &hypothesis); err == nil && hypothesis.Text != "" {
			if !a.emitResult(domain.TranscriptResult{
				Text:      hypothesis.Text,
				IsFinal:   false,
				SegmentID: a.ensureSegmentID(),
			}) {
				log.Println("⚠️ [Azure] Results channel full, dropping interim")
			}
		}
	} else if strings.Contains(headers, "Path:speech.phrase") {
		var phrase struct {
			RecognitionStatus string `json:"RecognitionStatus"`
			DisplayText       string `json:"DisplayText"`
			NBest             []struct {
				Confidence float64 `json:"Confidence"`
				Display    string  `json:"Display"`
			} `json:"NBest"`
		}
		if err := json.Unmarshal([]byte(body), &phrase); err == nil {
			segmentID := a.ensureSegmentID()
			defer a.finishSegment()
			if phrase.RecognitionStatus == "Success" {
				text := phrase.DisplayText
				confidence := 0.0
				if len(phrase.NBest) > 0 {
					text = phrase.NBest[0].Display
					confidence = phrase.NBest[0].Confidence
				}
				if text != "" {
					log.Printf("✅ [Azure] Final: %s (conf: %.2f)", text, confidence)
					if !a.emitResult(domain.TranscriptResult{
						Text:       text,
						IsFinal:    true,
						Confidence: confidence,
						SegmentID:  segmentID,
					}) {
						log.Println("⚠️ [Azure] Results channel full, dropping final")
					}
				}
			}
		}
	}
}

func (a *AzureProvider) ensureSegmentID() string {
	if a.activeSegmentID == "" {
		a.segmentSequence++
		a.activeSegmentID = fmt.Sprintf("azure-%d", a.segmentSequence)
	}
	return a.activeSegmentID
}

func (a *AzureProvider) finishSegment() {
	a.activeSegmentID = ""
}

func (a *AzureProvider) emitResult(result domain.TranscriptResult) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.isRunning {
		return false
	}
	select {
	case a.results <- result:
		return true
	default:
		return false
	}
}

func (a *AzureProvider) SendAudio(data []byte) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	if !a.isRunning || a.conn == nil {
		return nil
	}

	// Accumulate audio in buffer
	a.audioBuffer = append(a.audioBuffer, data...)

	// Only send when buffer reaches threshold
	if len(a.audioBuffer) < a.bufferThreshold {
		return nil
	}

	// Send buffered audio
	headerText := fmt.Sprintf("Path: audio\r\nX-RequestId: %s\r\nX-Timestamp: %s\r\nContent-Type: audio/x-wav\r\n",
		a.requestID, a.getTimestamp())
	headerLen := uint16(len(headerText))

	var buf bytes.Buffer
	var headerLenBytes [2]byte
	binary.BigEndian.PutUint16(headerLenBytes[:], headerLen)
	buf.Write(headerLenBytes[:])
	buf.WriteString(headerText)
	buf.Write(a.audioBuffer)

	// Clear buffer after sending
	a.audioBuffer = a.audioBuffer[:0]

	return a.conn.WriteMessage(websocket.BinaryMessage, buf.Bytes())
}

func (a *AzureProvider) Results() <-chan domain.TranscriptResult {
	return a.results
}

func (a *AzureProvider) Err() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.lastErr
}

func (a *AzureProvider) Stop() error {
	a.mu.Lock()
	if a.stopped {
		a.mu.Unlock()
		return nil
	}
	a.stopped = true
	a.isRunning = false
	conn := a.conn
	a.closeOnce.Do(func() { close(a.results) })
	a.mu.Unlock()

	var closeErr error
	if conn != nil {
		closeErr = conn.Close()
	}

	log.Println("🛑 [Azure] WebSocket connection closed")
	return closeErr
}
