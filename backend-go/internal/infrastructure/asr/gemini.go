package asr

import (
	"context"
	"fmt"
	"io"
	"log"
	"strings"
	"sync"
	"time"

	"thai-transcriber-backend/internal/domain"

	"google.golang.org/genai"
)

const geminiDefaultModel = "gemini-3.5-live-translate-preview"

var geminiSupportedTargetLanguageCodes = func() map[string]string {
	// Canonical BCP-47 codes published for gemini-3.5-live-translate-preview.
	codes := strings.Fields(`
		af ak sq am ar hy az eu be bn bg my ca zh-Hans zh-Hant hr cs da nl en
		et fil fi fr gl ka de el gu ha he hi hu is id it ja jv kn kk km rw ko
		lo lv lt mk ms ml mr mn ne no nb fa pl pt-BR pt-PT pa ro ru sr sd si
		sk sl es su sw sv ta te th tr uk ur uz vi zu
	`)
	supported := make(map[string]string, len(codes))
	for _, code := range codes {
		supported[strings.ToLower(code)] = code
	}
	return supported
}()

// GeminiConfig configures the Gemini Live source and translation transcripts.
type GeminiConfig struct {
	APIKey             string
	Model              string
	LanguageCode       string
	TargetLanguageCode string
	SampleRate         int
}

type GeminiProvider struct {
	session          *genai.Session
	results          chan domain.TranscriptResult
	cfg              GeminiConfig
	ctx              context.Context
	cancel           context.CancelFunc
	done             chan struct{}
	mu               sync.Mutex
	transcriptMu     sync.Mutex
	resultsMu        sync.Mutex
	closeOnce        sync.Once
	doneOnce         sync.Once
	lastErr          error
	starting         bool
	started          bool
	stopped          bool
	resultsClosed    bool
	turnSequence     uint64
	sourceText       string
	sourceLanguage   string
	sourceFinal      bool
	translationText  string
	translationFinal bool
	segmenter        geminiSegmenter
	boundaryTimer    *time.Timer
	boundaryVersion  uint64
	now              func() time.Time
}

func normalizeGeminiConfig(cfg GeminiConfig) GeminiConfig {
	if cfg.Model == "" {
		cfg.Model = geminiDefaultModel
	}
	targetLanguageCode := strings.ReplaceAll(strings.TrimSpace(cfg.TargetLanguageCode), "_", "-")
	if targetLanguageCode == "" {
		cfg.TargetLanguageCode = "th"
	} else if canonical, ok := geminiSupportedTargetLanguageCodes[strings.ToLower(targetLanguageCode)]; ok {
		cfg.TargetLanguageCode = canonical
	} else {
		cfg.TargetLanguageCode = targetLanguageCode
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

	normalized := normalizeGeminiConfig(cfg)
	if _, ok := geminiSupportedTargetLanguageCodes[strings.ToLower(normalized.TargetLanguageCode)]; !ok {
		return nil, fmt.Errorf("unsupported Gemini target language code %q", normalized.TargetLanguageCode)
	}
	return &GeminiProvider{
		cfg:     normalized,
		results: make(chan domain.TranscriptResult, 100),
		done:    make(chan struct{}),
		segmenter: geminiSegmenter{
			sampleRate: normalized.SampleRate,
		},
		now: time.Now,
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
		// The translation model requires AUDIO responses. Model audio remains
		// discarded; input and translated output text are exposed.
		ResponseModalities:       []genai.Modality{genai.ModalityAudio},
		InputAudioTranscription:  geminiInputTranscriptionConfig(g.cfg.LanguageCode),
		OutputAudioTranscription: &genai.AudioTranscriptionConfig{},
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

	if err := session.SendRealtimeInput(genai.LiveRealtimeInput{
		Audio: &genai.Blob{
			Data:     audio,
			MIMEType: fmt.Sprintf("audio/pcm;rate=%d", rate),
		},
	}); err != nil {
		return err
	}

	finals := g.observeAudioForSegmentation(audio, g.currentTime())
	if len(finals) > 0 {
		g.publishResults(finals, ctx)
	}
	return nil
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
	g.cancelBoundaryTimer()

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

		if !g.publishResults(g.transcriptResults(message), ctx) {
			return
		}
	}
}

func geminiInputTranscriptionConfig(languageCode string) *genai.AudioTranscriptionConfig {
	cfg := &genai.AudioTranscriptionConfig{}
	if code := strings.TrimSpace(languageCode); code != "" {
		cfg.LanguageHints = &genai.LanguageHints{LanguageCodes: []string{code}}
	}
	return cfg
}

func (g *GeminiProvider) transcriptResults(message *genai.LiveServerMessage) []domain.TranscriptResult {
	g.transcriptMu.Lock()
	defer g.transcriptMu.Unlock()
	return g.transcriptResultsLocked(message)
}

func (g *GeminiProvider) transcriptResultsLocked(message *genai.LiveServerMessage) []domain.TranscriptResult {
	if message == nil || message.ServerContent == nil {
		return nil
	}

	content := message.ServerContent
	turnID := fmt.Sprintf("gemini-%d", g.turnSequence+1)
	results := make([]domain.TranscriptResult, 0, 2)
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
	hasSource := transcription != nil && strings.TrimSpace(transcription.Text) != ""
	hasTranslation := content.OutputTranscription != nil && strings.TrimSpace(content.OutputTranscription.Text) != ""
	if hasSource || hasTranslation {
		g.segmenter.observeTranscript(g.currentTime())
	}
	if hasSource {
		merged, changed := mergeGeminiTranscript(g.sourceText, transcription.Text)
		if changed {
			g.sourceText = merged
		}
		languageCode := strings.TrimSpace(transcription.LanguageCode)
		g.sourceLanguage = languageCode
		g.sourceFinal = g.sourceFinal || isFinal
		if changed || isFinal {
			results = append(results, domain.TranscriptResult{
				Text:         g.sourceText,
				IsFinal:      isFinal,
				Role:         domain.TranscriptRoleSource,
				LanguageCode: languageCode,
				TurnID:       turnID,
			})
		}
	}

	if output := content.OutputTranscription; output != nil && strings.TrimSpace(output.Text) != "" {
		merged, changed := mergeGeminiTranscript(g.translationText, output.Text)
		outputFinal := output.Finished || content.GenerationComplete || content.TurnComplete
		if changed {
			g.translationText = merged
		}
		if changed || (outputFinal && !g.translationFinal) {
			results = append(results, domain.TranscriptResult{
				Text:         g.translationText,
				IsFinal:      outputFinal,
				Role:         domain.TranscriptRoleTranslation,
				LanguageCode: g.cfg.TargetLanguageCode,
				TurnID:       turnID,
			})
		}
		g.translationFinal = g.translationFinal || outputFinal
	}

	if content.GenerationComplete || content.TurnComplete {
		if g.translationText != "" && !g.translationFinal {
			results = append(results, domain.TranscriptResult{
				Text:         g.translationText,
				IsFinal:      true,
				Role:         domain.TranscriptRoleTranslation,
				LanguageCode: g.cfg.TargetLanguageCode,
				TurnID:       turnID,
			})
			g.translationFinal = true
		}
	}
	if content.TurnComplete {
		results = append(results, g.finalizeCurrentTurnLocked(true)...)
	} else if delay, pending := g.segmenter.boundaryDelay(g.currentTime()); pending {
		g.scheduleBoundaryLocked(delay)
	}

	return results
}

func (g *GeminiProvider) currentTime() time.Time {
	if g.now != nil {
		return g.now()
	}
	return time.Now()
}

func (g *GeminiProvider) observeAudioForSegmentation(audio []byte, now time.Time) []domain.TranscriptResult {
	g.transcriptMu.Lock()
	defer g.transcriptMu.Unlock()
	if g.segmenter.sampleRate <= 0 {
		g.segmenter.sampleRate = normalizeGeminiConfig(g.cfg).SampleRate
	}

	pending := g.segmenter.observeAudio(audio, now)
	if !pending {
		if !g.segmenter.boundaryPending {
			g.stopBoundaryTimerLocked()
		}
		return nil
	}
	delay, _ := g.segmenter.boundaryDelay(now)
	if delay > 0 {
		g.scheduleBoundaryLocked(delay)
		return nil
	}
	return g.finalizeCurrentTurnLocked(false)
}

func (g *GeminiProvider) finalizeCurrentTurnLocked(forceAdvance bool) []domain.TranscriptResult {
	turnID := fmt.Sprintf("gemini-%d", g.turnSequence+1)
	results := make([]domain.TranscriptResult, 0, 2)
	hasContent := g.sourceText != "" || g.translationText != ""
	if g.sourceText != "" && !g.sourceFinal {
		results = append(results, domain.TranscriptResult{
			Text: g.sourceText, IsFinal: true, Role: domain.TranscriptRoleSource,
			LanguageCode: g.sourceLanguage, TurnID: turnID,
		})
	}
	if g.translationText != "" && !g.translationFinal {
		results = append(results, domain.TranscriptResult{
			Text: g.translationText, IsFinal: true, Role: domain.TranscriptRoleTranslation,
			LanguageCode: g.cfg.TargetLanguageCode, TurnID: turnID,
		})
	}
	if forceAdvance || hasContent {
		g.turnSequence++
	}
	g.sourceText = ""
	g.sourceLanguage = ""
	g.sourceFinal = false
	g.translationText = ""
	g.translationFinal = false
	g.segmenter.reset()
	g.stopBoundaryTimerLocked()
	return results
}

func (g *GeminiProvider) scheduleBoundaryLocked(delay time.Duration) {
	g.stopBoundaryTimerLocked()
	g.boundaryVersion++
	version := g.boundaryVersion
	g.boundaryTimer = time.AfterFunc(delay, func() {
		g.completeBoundary(version)
	})
}

func (g *GeminiProvider) completeBoundary(version uint64) {
	g.transcriptMu.Lock()
	if version != g.boundaryVersion || !g.segmenter.boundaryPending {
		g.transcriptMu.Unlock()
		return
	}
	if delay, pending := g.segmenter.boundaryDelay(g.currentTime()); pending && delay > 0 {
		g.scheduleBoundaryLocked(delay)
		g.transcriptMu.Unlock()
		return
	}
	results := g.finalizeCurrentTurnLocked(false)
	g.transcriptMu.Unlock()
	g.publishResults(results, nil)
}

func (g *GeminiProvider) stopBoundaryTimerLocked() {
	if g.boundaryTimer != nil {
		g.boundaryTimer.Stop()
		g.boundaryTimer = nil
	}
}

func (g *GeminiProvider) cancelBoundaryTimer() {
	g.transcriptMu.Lock()
	g.boundaryVersion++
	g.stopBoundaryTimerLocked()
	g.transcriptMu.Unlock()
}

func mergeGeminiTranscript(current, incoming string) (string, bool) {
	current = strings.TrimSpace(current)
	incoming = strings.TrimSpace(incoming)
	if incoming == "" || incoming == current || strings.HasSuffix(current, incoming) {
		return current, false
	}
	if current == "" || strings.HasPrefix(incoming, current) {
		return incoming, incoming != current
	}
	return domain.NormalizeThaiSpacing(current + " " + incoming), true
}

func (g *GeminiProvider) markStartFailed() {
	g.mu.Lock()
	g.starting = false
	g.mu.Unlock()
}

func (g *GeminiProvider) publishResults(results []domain.TranscriptResult, ctx context.Context) bool {
	for _, result := range results {
		g.resultsMu.Lock()
		if g.resultsClosed || g.results == nil {
			g.resultsMu.Unlock()
			return false
		}
		var contextDone <-chan struct{}
		if ctx != nil {
			contextDone = ctx.Done()
		}
		select {
		case g.results <- result:
			g.resultsMu.Unlock()
		case <-contextDone:
			g.resultsMu.Unlock()
			return false
		case <-g.done:
			g.resultsMu.Unlock()
			return false
		}
	}
	return true
}

func (g *GeminiProvider) closeResults() {
	g.resultsMu.Lock()
	defer g.resultsMu.Unlock()
	g.closeOnce.Do(func() {
		g.resultsClosed = true
		if g.results != nil {
			close(g.results)
		}
	})
}
