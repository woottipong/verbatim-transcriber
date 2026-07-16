package asr

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type AzureProvider struct {
	conn            *websocket.Conn
	results         chan TranscriptResult
	subscriptionKey string
	region          string
	sampleRate      int
	mu              sync.Mutex
	stopped         bool
}

type AzureConfig struct {
	Context struct {
		System struct {
			Name string `json:"name"`
		} `json:"system"`
		Recognition struct {
			SegmentationSilenceTimeoutMs int  `json:"segmentationSilenceTimeoutMs"`
			EnableInterimResults         bool `json:"enableInterimResults"`
		} `json:"recognition"`
	} `json:"context"`
}

type AzureSpeechResponse struct {
	RecognitionStatus string `json:"RecognitionStatus"`
	Offset            int64  `json:"Offset"`
	Duration          int64  `json:"Duration"`
	NBest             []struct {
		Lexical    string  `json:"Lexical"`
		ITN        string  `json:"ITN"`
		Display    string  `json:"Display"`
		Confidence float64 `json:"Confidence"`
	} `json:"NBest"`
}

func NewAzureProvider(subscriptionKey, region string, sampleRate int) *AzureProvider {
	return &AzureProvider{
		results:         make(chan TranscriptResult, 100),
		subscriptionKey: subscriptionKey,
		region:          region,
		sampleRate:      sampleRate,
	}
}

func (a *AzureProvider) Start(ctx context.Context) error {
	wsURL := fmt.Sprintf(
		"wss://%s.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1",
		a.region,
	)

	headers := http.Header{}
	headers.Set("Ocp-Apim-Subscription-Key", a.subscriptionKey)
	headers.Set("X-ConnectionId", generateConnectionID())

	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	conn, _, err := dialer.Dial(wsURL, headers)
	if err != nil {
		return fmt.Errorf("dial failed: %w", err)
	}
	a.conn = conn

	a.mu.Lock()
	a.stopped = false
	a.mu.Unlock()

	config := AzureConfig{
		Context: struct {
			System struct {
				Name string `json:"name"`
			} `json:"system"`
			Recognition struct {
				SegmentationSilenceTimeoutMs int  `json:"segmentationSilenceTimeoutMs"`
				EnableInterimResults         bool `json:"enableInterimResults"`
			} `json:"recognition"`
		}{
			System: struct {
				Name string `json:"name"`
			}{
				Name: "LiveKit-Agent",
			},
			Recognition: struct {
				SegmentationSilenceTimeoutMs int  `json:"segmentationSilenceTimeoutMs"`
				EnableInterimResults         bool `json:"enableInterimResults"`
			}{
				SegmentationSilenceTimeoutMs: 500,
				EnableInterimResults:         true,
			},
		},
	}

	configData, _ := json.Marshal(config)
	if err := a.conn.WriteMessage(websocket.TextMessage, configData); err != nil {
		return fmt.Errorf("send config failed: %w", err)
	}

	go a.processResponses()
	return nil
}

func (a *AzureProvider) SendAudio(data []byte) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.stopped || a.conn == nil {
		return nil
	}

	return a.conn.WriteMessage(websocket.BinaryMessage, data)
}

func (a *AzureProvider) Results() <-chan TranscriptResult {
	return a.results
}

func (a *AzureProvider) Stop() error {
	a.mu.Lock()
	a.stopped = true
	a.mu.Unlock()

	if a.conn != nil {
		return a.conn.Close()
	}
	return nil
}

func (a *AzureProvider) processResponses() {
	defer close(a.results)

	for {
		_, message, err := a.conn.ReadMessage()
		if err != nil {
			return
		}

		var resp AzureSpeechResponse
		if err := json.Unmarshal(message, &resp); err != nil {
			continue
		}

		if resp.RecognitionStatus != "Success" || len(resp.NBest) == 0 {
			continue
		}

		best := resp.NBest[0]
		a.results <- TranscriptResult{
			Text:       best.Display,
			IsFinal:    true,
			Confidence: best.Confidence,
		}
	}
}

func generateConnectionID() string {
	return fmt.Sprintf("agent-%d", time.Now().UnixNano())
}
