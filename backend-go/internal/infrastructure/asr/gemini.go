package asr

import (
	"context"
	"fmt"
	"io"
	"log"
	"strings"
	"sync"

	"thai-transcriber-backend/internal/domain"

	"google.golang.org/genai"
)

const geminiDefaultModel = "gemini-3.5-live-translate-preview"

// GeminiConfig configures the Gemini Live source-audio transcription stream.
// The translation model still requires a target language, but this provider
// intentionally exposes only the input transcript to the application.
type GeminiConfig struct {
	APIKey             string
	Model              string
	LanguageCode       string
	TargetLanguageCode string
	SampleRate         int
}

type GeminiProvider struct {
	session   *genai.Session
	results   chan domain.TranscriptResult
	cfg       GeminiConfig
	ctx       context.Context
	cancel    context.CancelFunc
	done      chan struct{}
	mu        sync.Mutex
	closeOnce sync.Once
	doneOnce  sync.Once
	lastErr   error
	starting  bool
	started   bool
	stopped   bool
}

func normalizeGeminiConfig(cfg GeminiConfig) GeminiConfig {
	if cfg.Model == "" {
		cfg.Model = geminiDefaultModel
	}
	if cfg.LanguageCode == "" {
		cfg.LanguageCode = "th"
	}
	if cfg.TargetLanguageCode == "" {
		cfg.TargetLanguageCode = "en"
	}
	if cfg.SampleRate == 0 {
		cfg.SampleRate = 16000
	}
	return cfg
}

func NewGeminiProvider(ctx context.Context, cfg GeminiConfig) (*GeminiProvider, error) {
	if strings.TrimSpace(cfg.APIKey) == "" {
		return nil, fmt.Errorf("gemini API key is required")
	}

	return &GeminiProvider{
		cfg:     normalizeGeminiConfig(cfg),
		results: make(chan domain.TranscriptResult, 100),
		done:    make(chan struct{}),
	}, nil
}

func (g *GeminiProvider) Name() string {
	return "gemini"
}

func (g *GeminiProvider) SampleRate() int {
	return g.cfg.SampleRate
}

func (g *GeminiProvider) Start(ctx context.Context) error {
	g.mu.Lock()
	if g.started {
		g.mu.Unlock()
		return nil
	}
	if g.stopped {
		g.mu.Unlock()
		return fmt.Errorf("gemini provider is stopped")
	}
	if g.starting {
		g.mu.Unlock()
		return fmt.Errorf("gemini provider is starting")
	}
	g.starting = true
	g.mu.Unlock()

	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		APIKey:  g.cfg.APIKey,
		Backend: genai.BackendGeminiAPI,
		HTTPOptions: genai.HTTPOptions{
			// Live API is currently exposed on the v1alpha Gemini API surface.
			APIVersion: "v1alpha",
		},
	})
	if err != nil {
		g.markStartFailed()
		return fmt.Errorf("create Gemini client: %w", err)
	}

	streamCtx, cancel := context.WithCancel(ctx)
	echoTargetLanguage := false
	session, err := client.Live.Connect(streamCtx, g.cfg.Model, &genai.LiveConnectConfig{
		// The translation model requires AUDIO responses. We intentionally do
		// not consume or forward model audio; only input transcription is used.
		ResponseModalities: []genai.Modality{genai.ModalityAudio},
		InputAudioTranscription: &genai.AudioTranscriptionConfig{
			LanguageHints: &genai.LanguageHints{LanguageCodes: []string{g.cfg.LanguageCode}},
		},
		TranslationConfig: &genai.TranslationConfig{
			TargetLanguageCode: g.cfg.TargetLanguageCode,
			EchoTargetLanguage: &echoTargetLanguage,
		},
	})
	if err != nil {
		cancel()
		g.markStartFailed()
		return fmt.Errorf("connect Gemini Live session: %w", err)
	}

	g.mu.Lock()
	g.starting = false
	if g.stopped {
		g.mu.Unlock()
		cancel()
		_ = session.Close()
		return fmt.Errorf("gemini provider stopped while connecting")
	}
	g.session = session
	g.ctx = streamCtx
	g.cancel = cancel
	g.started = true
	g.mu.Unlock()

	log.Printf("✅ [Gemini] Live connected (model=%s, language=%s, target=%s, response=audio-discarded)",
		g.cfg.Model, g.cfg.LanguageCode, g.cfg.TargetLanguageCode)
	go g.receiveResponses()
	return nil
}

func (g *GeminiProvider) SendAudio(audio []byte) error {
	if len(audio) == 0 {
		return nil
	}

	g.mu.Lock()
	session := g.session
	ctx := g.ctx
	started := g.started
	stopped := g.stopped
	rate := g.cfg.SampleRate
	g.mu.Unlock()

	if stopped {
		return fmt.Errorf("gemini provider is stopped")
	}
	if !started || session == nil {
		return fmt.Errorf("gemini provider is not started")
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	return session.SendRealtimeInput(genai.LiveRealtimeInput{
		Audio: &genai.Blob{
			Data:     audio,
			MIMEType: fmt.Sprintf("audio/pcm;rate=%d", rate),
		},
	})
}

func (g *GeminiProvider) Results() <-chan domain.TranscriptResult {
	return g.results
}

func (g *GeminiProvider) Stop() error {
	g.mu.Lock()
	if g.stopped {
		g.mu.Unlock()
		return nil
	}
	g.stopped = true
	cancel := g.cancel
	session := g.session
	started := g.started
	done := g.done
	if done == nil {
		done = make(chan struct{})
		g.done = done
	}
	g.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	g.doneOnce.Do(func() { close(done) })
	var closeErr error
	if session != nil {
		closeErr = session.Close()
	}
	if !started {
		g.closeResults()
	}
	return closeErr
}

func (g *GeminiProvider) Err() error {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.lastErr
}

func (g *GeminiProvider) receiveResponses() {
	defer g.closeResults()

	for {
		g.mu.Lock()
		session := g.session
		ctx := g.ctx
		g.mu.Unlock()
		if session == nil {
			return
		}

		message, err := session.Receive()
		if err != nil {
			g.mu.Lock()
			stopped := g.stopped
			if err != io.EOF && !stopped {
				g.lastErr = err
			}
			g.mu.Unlock()
			if err != io.EOF && !stopped {
				log.Printf("❌ [Gemini] Receive error: %v", err)
			}
			return
		}

		for _, result := range geminiTranscriptResults(message) {
			select {
			case g.results <- result:
			case <-ctx.Done():
				return
			case <-g.done:
				return
			}
		}
	}
}

func geminiTranscriptResults(message *genai.LiveServerMessage) []domain.TranscriptResult {
	if message == nil || message.ServerContent == nil {
		return nil
	}

	content := message.ServerContent
	transcription := content.InterimInputTranscription
	isFinal := false

	// Gemini can signal the end of input transcription either with the
	// transcription's `finished` flag or with the enclosing turnComplete flag.
	// Prefer the low-latency field while the input is still being transcribed.
	if content.InputTranscription != nil {
		inputFinished := content.InputTranscription.Finished || content.TurnComplete
		if inputFinished || transcription == nil {
			transcription = content.InputTranscription
			isFinal = inputFinished
		}
	} else if transcription != nil {
		isFinal = transcription.Finished || content.TurnComplete
	}
	if transcription == nil || strings.TrimSpace(transcription.Text) == "" {
		return nil
	}

	return []domain.TranscriptResult{{
		Text:    transcription.Text,
		IsFinal: isFinal,
	}}
}

func (g *GeminiProvider) markStartFailed() {
	g.mu.Lock()
	g.starting = false
	g.mu.Unlock()
}

func (g *GeminiProvider) closeResults() {
	g.closeOnce.Do(func() { close(g.results) })
}
