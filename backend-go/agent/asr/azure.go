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

	"github.com/fasthttp/websocket"
	"github.com/google/uuid"
)

type AzureProvider struct {
	conn            *websocket.Conn
	results         chan TranscriptResult
	ctx             context.Context
	cancel          context.CancelFunc
	mu              sync.Mutex
	subscriptionKey string
	region          string
	connectionID    string
	requestID       string
	isRunning       bool
	sampleRate      int
}

type AzureConfig struct {
	SubscriptionKey string
	Region          string
	SampleRate      int
	Language        string
}

func NewAzureProvider(ctx context.Context, cfg AzureConfig) (*AzureProvider, error) {
	sampleRate := cfg.SampleRate
	if sampleRate == 0 {
		sampleRate = 16000
	}

	return &AzureProvider{
		results:         make(chan TranscriptResult, 100),
		subscriptionKey: cfg.SubscriptionKey,
		region:          cfg.Region,
		connectionID:    strings.ReplaceAll(uuid.New().String(), "-", ""),
		sampleRate:      sampleRate,
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

	a.ctx, a.cancel = context.WithCancel(ctx)
	a.requestID = strings.ReplaceAll(uuid.New().String(), "-", "")

	wsURL := fmt.Sprintf(
		"wss://%s.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=th-TH&format=detailed",
		a.region,
	)

	dialer := websocket.Dialer{}
	conn, _, err := dialer.Dial(wsURL, map[string][]string{
		"Ocp-Apim-Subscription-Key": {a.subscriptionKey},
		"X-ConnectionId":            {a.connectionID},
	})
	if err != nil {
		return fmt.Errorf("websocket dial failed: %v", err)
	}

	a.conn = conn

	if err := a.sendSpeechConfig(); err != nil {
		conn.Close()
		return fmt.Errorf("failed to send speech config: %v", err)
	}

	if err := a.sendAudioConfig(); err != nil {
		conn.Close()
		return fmt.Errorf("failed to send audio config: %v", err)
	}

	a.isRunning = true
	go a.receiveResponses()

	log.Printf("✅ [Azure Agent] WebSocket connected (connection: %s)\n", a.connectionID[:8])
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
				"segmentationSilenceTimeoutMs": "500",
				"initialSilenceTimeoutMs":      "5000",
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
	binary.Write(&buf, binary.BigEndian, headerLen)
	buf.WriteString(headerText)
	buf.Write(riffHeader)

	return a.conn.WriteMessage(websocket.BinaryMessage, buf.Bytes())
}

func (a *AzureProvider) createRIFFHeader() []byte {
	var buf bytes.Buffer

	buf.WriteString("RIFF")
	binary.Write(&buf, binary.LittleEndian, uint32(0))
	buf.WriteString("WAVE")

	buf.WriteString("fmt ")
	binary.Write(&buf, binary.LittleEndian, uint32(16))
	binary.Write(&buf, binary.LittleEndian, uint16(1))
	binary.Write(&buf, binary.LittleEndian, uint16(1))
	binary.Write(&buf, binary.LittleEndian, uint32(a.sampleRate))
	binary.Write(&buf, binary.LittleEndian, uint32(a.sampleRate*2))
	binary.Write(&buf, binary.LittleEndian, uint16(2))
	binary.Write(&buf, binary.LittleEndian, uint16(16))

	buf.WriteString("data")
	binary.Write(&buf, binary.LittleEndian, uint32(0))

	return buf.Bytes()
}

func (a *AzureProvider) getTimestamp() string {
	return fmt.Sprintf("%d", uuid.New().ID())
}

func (a *AzureProvider) receiveResponses() {
	defer func() {
		a.mu.Lock()
		a.isRunning = false
		a.mu.Unlock()
	}()

	for {
		msgType, message, err := a.conn.ReadMessage()
		if err != nil {
			log.Printf("❌ [Azure Agent] Read error: %v", err)
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
		return
	}

	headers := parts[0]
	body := parts[1]

	if strings.Contains(headers, "Path: speech.hypothesis") {
		var hypothesis struct {
			Text string `json:"Text"`
		}
		if err := json.Unmarshal([]byte(body), &hypothesis); err == nil && hypothesis.Text != "" {
			select {
			case a.results <- TranscriptResult{
				Text:    hypothesis.Text,
				IsFinal: false,
			}:
			default:
			}
		}
	} else if strings.Contains(headers, "Path: speech.phrase") {
		var phrase struct {
			RecognitionStatus string `json:"RecognitionStatus"`
			DisplayText       string `json:"DisplayText"`
			NBest             []struct {
				Confidence float64 `json:"Confidence"`
				Display    string  `json:"Display"`
			} `json:"NBest"`
		}
		if err := json.Unmarshal([]byte(body), &phrase); err == nil {
			if phrase.RecognitionStatus == "Success" {
				text := phrase.DisplayText
				confidence := 0.0
				if len(phrase.NBest) > 0 {
					text = phrase.NBest[0].Display
					confidence = phrase.NBest[0].Confidence
				}
				if text != "" {
					select {
					case a.results <- TranscriptResult{
						Text:       text,
						IsFinal:    true,
						Confidence: confidence,
					}:
					default:
					}
				}
			}
		}
	}
}

func (a *AzureProvider) SendAudio(data []byte) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	if !a.isRunning || a.conn == nil {
		return nil
	}

	headerText := fmt.Sprintf("Path: audio\r\nX-RequestId: %s\r\nX-Timestamp: %s\r\nContent-Type: audio/x-wav\r\n",
		a.requestID, a.getTimestamp())
	headerLen := uint16(len(headerText))

	var buf bytes.Buffer
	binary.Write(&buf, binary.BigEndian, headerLen)
	buf.WriteString(headerText)
	buf.Write(data)

	return a.conn.WriteMessage(websocket.BinaryMessage, buf.Bytes())
}

func (a *AzureProvider) Results() <-chan TranscriptResult {
	return a.results
}

func (a *AzureProvider) Stop() error {
	a.mu.Lock()
	defer a.mu.Unlock()

	if !a.isRunning {
		return nil
	}

	if a.cancel != nil {
		a.cancel()
	}

	if a.conn != nil {
		a.conn.Close()
	}

	a.isRunning = false
	log.Println("🛑 [Azure Agent] WebSocket connection closed")
	return nil
}
