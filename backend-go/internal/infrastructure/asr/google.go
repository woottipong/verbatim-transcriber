package asr

import (
	"context"
	"io"
	"log"
	"sync"

	"thai-transcriber-backend/internal/domain"

	speech "cloud.google.com/go/speech/apiv1"
	"cloud.google.com/go/speech/apiv1/speechpb"
	"google.golang.org/api/option"
)

type GoogleProvider struct {
	client          *speech.Client
	stream          speechpb.Speech_StreamingRecognizeClient
	results         chan domain.TranscriptResult
	ctx             context.Context
	cancel          context.CancelFunc
	mu              sync.Mutex
	credentials     string
	apiKey          string
	isRunning       bool
	sampleRate      int
	languageCode    string
	autoPunctuation bool
}

type GoogleConfig struct {
	CredentialsFile       string
	APIKey                string
	SampleRate            int
	LanguageCode          string
	EnableAutoPunctuation bool
}

func NewGoogleProvider(ctx context.Context, cfg GoogleConfig) (*GoogleProvider, error) {
	var client *speech.Client
	var err error

	if cfg.CredentialsFile != "" {
		client, err = speech.NewClient(ctx, option.WithCredentialsFile(cfg.CredentialsFile))
	} else if cfg.APIKey != "" {
		client, err = speech.NewClient(ctx, option.WithAPIKey(cfg.APIKey))
	} else {
		client, err = speech.NewClient(ctx)
	}

	if err != nil {
		return nil, err
	}

	sampleRate := cfg.SampleRate
	if sampleRate == 0 {
		sampleRate = 48000
	}

	langCode := cfg.LanguageCode
	if langCode == "" {
		langCode = "th-TH"
	}

	return &GoogleProvider{
		client:          client,
		results:         make(chan domain.TranscriptResult, 100),
		credentials:     cfg.CredentialsFile,
		apiKey:          cfg.APIKey,
		sampleRate:      sampleRate,
		languageCode:    langCode,
		autoPunctuation: cfg.EnableAutoPunctuation,
	}, nil
}

func (g *GoogleProvider) Name() string {
	return "google"
}

func (g *GoogleProvider) SampleRate() int {
	return g.sampleRate
}

func (g *GoogleProvider) Start(ctx context.Context) error {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.isRunning {
		return nil
	}

	g.ctx, g.cancel = context.WithCancel(ctx)

	stream, err := g.client.StreamingRecognize(g.ctx)
	if err != nil {
		return err
	}

	g.stream = stream

	// Note: EnableAutomaticPunctuation=false ทำให้ finalize เร็วขึ้น
	// เพราะ model ไม่ต้องรอ context เพิ่มเพื่อวาง punctuation
	err = stream.Send(&speechpb.StreamingRecognizeRequest{
		StreamingRequest: &speechpb.StreamingRecognizeRequest_StreamingConfig{
			StreamingConfig: &speechpb.StreamingRecognitionConfig{
				Config: &speechpb.RecognitionConfig{
					Encoding:                   speechpb.RecognitionConfig_LINEAR16,
					SampleRateHertz:            int32(g.sampleRate),
					AudioChannelCount:          1, // Mono audio
					LanguageCode:               g.languageCode,
					Model:                      "latest_long",
					UseEnhanced:                true,
					EnableAutomaticPunctuation: g.autoPunctuation,
					ProfanityFilter:            false, // ไม่กรองคำหยาบ (verbatim)
					MaxAlternatives:            1,
				},
				InterimResults: true,
			},
		},
	})
	if err != nil {
		return err
	}

	g.isRunning = true
	go g.receiveResponses()

	log.Println("✅ [Google Agent] STT stream started")
	return nil
}

func (g *GoogleProvider) receiveResponses() {
	defer func() {
		g.mu.Lock()
		g.isRunning = false
		g.mu.Unlock()
	}()

	for {
		resp, err := g.stream.Recv()
		if err == io.EOF {
			log.Println("📭 [Google Agent] Stream ended")
			return
		}
		if err != nil {
			log.Printf("❌ [Google Agent] Receive error: %v", err)
			return
		}

		for _, result := range resp.Results {
			if len(result.Alternatives) == 0 {
				continue
			}

			alt := result.Alternatives[0]
			transcript := domain.TranscriptResult{
				Text:       alt.Transcript,
				IsFinal:    result.IsFinal,
				Confidence: float64(alt.Confidence),
			}

			select {
			case g.results <- transcript:
			default:
				log.Println("⚠️ [Google Agent] Results channel full")
			}
		}
	}
}

func (g *GoogleProvider) SendAudio(data []byte) error {
	g.mu.Lock()
	defer g.mu.Unlock()

	if !g.isRunning || g.stream == nil {
		return nil
	}

	return g.stream.Send(&speechpb.StreamingRecognizeRequest{
		StreamingRequest: &speechpb.StreamingRecognizeRequest_AudioContent{
			AudioContent: data,
		},
	})
}

func (g *GoogleProvider) Results() <-chan domain.TranscriptResult {
	return g.results
}

func (g *GoogleProvider) Stop() error {
	g.mu.Lock()
	defer g.mu.Unlock()

	if !g.isRunning {
		return nil
	}

	if g.cancel != nil {
		g.cancel()
	}

	if g.stream != nil {
		g.stream.CloseSend()
	}

	if g.client != nil {
		g.client.Close()
	}

	g.isRunning = false
	log.Println("🛑 [Google Agent] STT stream stopped")
	return nil
}
