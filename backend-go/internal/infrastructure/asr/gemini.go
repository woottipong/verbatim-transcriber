package asr

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"thai-transcriber-backend/internal/domain"

	"google.golang.org/genai"
)

const geminiDefaultModel = "gemini-3.5-live-translate-preview"

const (
	geminiConnectionRotation   = 9 * time.Minute
	geminiReconnectAudio       = 15 * time.Second
	geminiMaxReconnectAttempts = 3
)

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

type geminiSession interface {
	SendRealtimeInput(genai.LiveRealtimeInput) error
	Receive() (*genai.LiveServerMessage, error)
	Close() error
}

type geminiConnectFunc func(context.Context, string) (geminiSession, error)

type geminiReconnectBuffer struct {
	data     []byte
	capacity int
	dropped  int64
}

func newGeminiReconnectBuffer(capacity int) *geminiReconnectBuffer {
	return &geminiReconnectBuffer{
		data:     make([]byte, 0, max(capacity, 0)),
		capacity: max(capacity, 0),
	}
}

func (b *geminiReconnectBuffer) Add(data []byte) {
	if len(data) == 0 {
		return
	}
	if b.capacity == 0 {
		b.dropped += int64(len(data))
		return
	}
	overflow := len(b.data) + len(data) - b.capacity
	if overflow <= 0 {
		b.data = append(b.data, data...)
		return
	}
	b.dropped += int64(overflow)
	if overflow >= len(b.data) {
		skip := overflow - len(b.data)
		b.data = append(b.data[:0], data[skip:]...)
		return
	}
	b.data = append(b.data[overflow:], data...)
}

func (b *geminiReconnectBuffer) Reset() {
	b.data = b.data[:0]
	b.dropped = 0
}

func (b *geminiReconnectBuffer) Drain() ([]byte, int64) {
	data := append([]byte(nil), b.data...)
	dropped := b.dropped
	b.Reset()
	return data, dropped
}

func (b *geminiReconnectBuffer) RestoreFront(data []byte, dropped int64) {
	tail := append([]byte(nil), b.data...)
	tailDropped := b.dropped
	b.Reset()
	b.dropped = dropped + tailDropped
	b.Add(data)
	b.Add(tail)
}

type GeminiProvider struct {
	session                geminiSession
	results                chan domain.TranscriptResult
	cfg                    GeminiConfig
	ctx                    context.Context
	cancel                 context.CancelFunc
	done                   chan struct{}
	mu                     sync.Mutex
	transcriptMu           sync.Mutex
	resultsMu              sync.Mutex
	closeOnce              sync.Once
	doneOnce               sync.Once
	lastErr                error
	starting               bool
	started                bool
	stopped                bool
	resultsClosed          bool
	reconnecting           bool
	reconnectCount         int
	resumptionHandle       string
	resumptionAvailable    bool
	turnSequence           uint64
	sourceAccumulator      geminiTranscriptAccumulator
	translationAccumulator geminiTranscriptAccumulator
	sourceLanguage         string
	sourceFinal            bool
	translationFinal       bool
	pendingSourceCutoff    string
	pendingBoundaryReason  geminiBoundaryReason
	segmenter              geminiSegmenter
	boundaryTimer          *time.Timer
	boundaryVersion        uint64
	rotationTimer          *time.Timer
	rotationAfter          time.Duration
	audioBuf               *geminiReconnectBuffer
	connect                geminiConnectFunc
	reconnectDelay         func(int) time.Duration
	now                    func() time.Time
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
	if cfg.SampleRate <= 0 {
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
		cfg:            normalized,
		results:        make(chan domain.TranscriptResult, 100),
		done:           make(chan struct{}),
		segmenter:      newGeminiSegmenter(normalized.SampleRate),
		rotationAfter:  geminiConnectionRotation,
		audioBuf:       newGeminiReconnectBuffer(normalized.SampleRate * 2 * int(geminiReconnectAudio/time.Second)),
		reconnectDelay: defaultGeminiReconnectDelay,
		now:            time.Now,
	}, nil
}

func defaultGeminiReconnectDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	return min(100*time.Millisecond*time.Duration(1<<(attempt-1)), 2*time.Second)
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

	streamCtx, cancel := context.WithCancel(ctx)
	g.mu.Lock()
	connect := g.connect
	g.mu.Unlock()
	if connect == nil {
		client, err := genai.NewClient(ctx, &genai.ClientConfig{
			APIKey:  g.cfg.APIKey,
			Backend: genai.BackendGeminiAPI,
			HTTPOptions: genai.HTTPOptions{
				// Live API is currently exposed on the v1alpha Gemini API surface.
				APIVersion: "v1alpha",
			},
		})
		if err != nil {
			cancel()
			g.markStartFailed()
			return fmt.Errorf("create Gemini client: %w", err)
		}
		connect = func(connectCtx context.Context, handle string) (geminiSession, error) {
			return client.Live.Connect(connectCtx, g.cfg.Model, geminiLiveConnectConfig(g.cfg, handle))
		}
		g.mu.Lock()
		g.connect = connect
		g.mu.Unlock()
	}

	session, err := connect(streamCtx, "")
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
	g.scheduleRotationLocked(session)
	g.mu.Unlock()

	log.Printf("✅ [Gemini] Live connected (model=%s, language=%s, target=%s, response=audio-discarded)",
		g.cfg.Model, g.cfg.LanguageCode, g.cfg.TargetLanguageCode)
	go g.receiveResponses(session)
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
	reconnecting := g.reconnecting
	rate := g.cfg.SampleRate
	if reconnecting && g.audioBuf != nil {
		g.audioBuf.Add(audio)
	}
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

	if reconnecting {
		finals := g.observeAudioForSegmentation(audio, g.currentTime())
		if len(finals) > 0 {
			g.publishResults(finals, ctx)
		}
		return nil
	}

	if err := session.SendRealtimeInput(genai.LiveRealtimeInput{
		Audio: &genai.Blob{
			Data:     audio,
			MIMEType: fmt.Sprintf("audio/pcm;rate=%d", rate),
		},
	}); err != nil {
		g.beginReconnect(session, err, audio)
		return nil
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
	done := g.done
	g.stopRotationLocked()
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
	g.closeResults()
	return closeErr
}

func (g *GeminiProvider) Err() error {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.lastErr
}

func (g *GeminiProvider) receiveResponses(session geminiSession) {
	for {
		g.mu.Lock()
		ctx := g.ctx
		stopped := g.stopped
		g.mu.Unlock()
		if session == nil || stopped {
			return
		}

		message, err := session.Receive()
		if err != nil {
			g.mu.Lock()
			stopped := g.stopped
			g.mu.Unlock()
			if stopped || ctx.Err() != nil {
				return
			}
			if err != io.EOF && !stopped {
				log.Printf("❌ [Gemini] Receive error: %v", err)
			}
			g.beginReconnect(session, err, nil)
			return
		}
		if message == nil {
			continue
		}

		if update := message.SessionResumptionUpdate; update != nil {
			g.mu.Lock()
			if g.session == session {
				g.resumptionAvailable = update.Resumable && update.NewHandle != ""
				if g.resumptionAvailable {
					g.resumptionHandle = update.NewHandle
				}
			}
			g.mu.Unlock()
		}
		if goAway := message.GoAway; goAway != nil {
			g.mu.Lock()
			resumptionAvailable := g.session == session && g.resumptionAvailable
			g.mu.Unlock()
			if resumptionAvailable {
				log.Printf("🔄 [Gemini] Server requested connection rotation (time_left=%s)", goAway.TimeLeft)
				g.beginReconnect(session, errors.New("Gemini Live server sent GoAway"), nil)
				return
			}
			log.Printf("ℹ️ [Gemini] Deferring GoAway rotation until the connection closes because no safe resumption handle is available (time_left=%s)", goAway.TimeLeft)
		}

		if !g.publishResults(g.transcriptResults(message), ctx) {
			return
		}
	}
}

func (g *GeminiProvider) scheduleRotationLocked(session geminiSession) {
	g.stopRotationLocked()
	rotationAfter := g.rotationAfter
	if rotationAfter <= 0 {
		rotationAfter = geminiConnectionRotation
	}
	g.rotationTimer = time.AfterFunc(rotationAfter, func() {
		g.requestScheduledRotation(session)
	})
}

func (g *GeminiProvider) requestScheduledRotation(session geminiSession) {
	g.mu.Lock()
	if g.stopped || g.reconnecting || g.session != session || g.ctx == nil || g.ctx.Err() != nil {
		g.mu.Unlock()
		return
	}
	if !g.resumptionAvailable {
		g.scheduleRotationLocked(session)
		g.mu.Unlock()
		log.Printf("ℹ️ [Gemini] Deferred scheduled rotation because no safe resumption handle is available")
		return
	}
	g.mu.Unlock()
	g.beginReconnect(session, errors.New("Gemini Live scheduled connection rotation"), nil)
}

func (g *GeminiProvider) stopRotationLocked() {
	if g.rotationTimer != nil {
		g.rotationTimer.Stop()
		g.rotationTimer = nil
	}
}

func (g *GeminiProvider) beginReconnect(failedSession geminiSession, cause error, initialAudio []byte) {
	g.mu.Lock()
	if g.stopped || g.ctx == nil || g.ctx.Err() != nil {
		g.mu.Unlock()
		return
	}
	if g.reconnecting {
		if g.session == failedSession && g.audioBuf != nil && len(initialAudio) > 0 {
			g.audioBuf.Add(initialAudio)
		}
		g.mu.Unlock()
		return
	}
	if g.session != failedSession {
		g.mu.Unlock()
		return
	}
	g.reconnecting = true
	g.stopRotationLocked()
	if g.audioBuf != nil {
		g.audioBuf.Reset()
		g.audioBuf.Add(initialAudio)
	}
	ctx := g.ctx
	g.mu.Unlock()
	go g.reconnect(ctx, failedSession, cause)
}

func (g *GeminiProvider) reconnect(ctx context.Context, failedSession geminiSession, cause error) {
	_ = failedSession.Close()
	lastErr := cause
	freshSessionPrepared := false
	for attempt := 1; attempt <= geminiMaxReconnectAttempts; attempt++ {
		g.mu.Lock()
		if g.stopped || ctx.Err() != nil {
			g.reconnecting = false
			g.mu.Unlock()
			return
		}
		connect := g.connect
		delayFn := g.reconnectDelay
		handle := ""
		if g.resumptionAvailable {
			handle = g.resumptionHandle
		}
		// Preserve two attempts for transient resume failures, then start a fresh
		// session rather than making an otherwise healthy room permanently fail.
		if attempt == geminiMaxReconnectAttempts {
			handle = ""
		}
		g.mu.Unlock()
		if handle == "" && !freshSessionPrepared {
			if !g.prepareFreshSession(ctx) {
				return
			}
			freshSessionPrepared = true
		}

		if delayFn == nil {
			delayFn = defaultGeminiReconnectDelay
		}
		if delay := delayFn(attempt); delay > 0 {
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				timer.Stop()
				g.mu.Lock()
				g.reconnecting = false
				g.mu.Unlock()
				return
			case <-timer.C:
			}
		}

		log.Printf("🔄 [Gemini] Reconnecting Live session (attempt=%d/%d resume=%t)",
			attempt, geminiMaxReconnectAttempts, handle != "")
		if connect == nil {
			lastErr = errors.New("Gemini Live connector is unavailable")
			continue
		}
		newSession, err := connect(ctx, handle)
		if err != nil {
			lastErr = err
			continue
		}

		count, err := g.activateReconnectedSession(newSession, handle)
		if err != nil {
			lastErr = err
			_ = newSession.Close()
			continue
		}

		go g.receiveResponses(newSession)
		log.Printf("✅ [Gemini] Live session reconnected (#%d resume=%t)", count, handle != "")
		return
	}
	g.finishReconnectFailure(lastErr)
}

func (g *GeminiProvider) prepareFreshSession(ctx context.Context) bool {
	g.transcriptMu.Lock()
	results := g.finalizeUpstreamTurnLocked()
	g.resetUpstreamTurnLocked()
	g.transcriptMu.Unlock()
	return g.publishResults(results, ctx)
}

func (g *GeminiProvider) activateReconnectedSession(session geminiSession, handle string) (int, error) {
	for {
		g.mu.Lock()
		if g.stopped {
			g.mu.Unlock()
			return 0, context.Canceled
		}
		replay, dropped := g.audioBuf.Drain()
		rate := g.cfg.SampleRate
		if len(replay) == 0 {
			g.logDroppedReconnectAudio(dropped, rate)
			g.session = session
			g.reconnecting = false
			g.reconnectCount++
			g.lastErr = nil
			g.resumptionHandle = ""
			g.resumptionAvailable = false
			count := g.reconnectCount
			g.scheduleRotationLocked(session)
			g.mu.Unlock()
			return count, nil
		}
		g.mu.Unlock()
		if err := session.SendRealtimeInput(genai.LiveRealtimeInput{Audio: &genai.Blob{
			Data: replay, MIMEType: fmt.Sprintf("audio/pcm;rate=%d", rate),
		}}); err != nil {
			g.mu.Lock()
			g.audioBuf.RestoreFront(replay, dropped)
			g.mu.Unlock()
			return 0, fmt.Errorf("replay audio after Gemini reconnect: %w", err)
		}
		g.logDroppedReconnectAudio(dropped, rate)
		log.Printf("🔄 [Gemini] Replayed %d bytes of buffered audio", len(replay))
	}
}

func (g *GeminiProvider) logDroppedReconnectAudio(dropped int64, rate int) {
	if dropped <= 0 {
		return
	}
	log.Printf("⚠️ [Gemini] Reconnect audio buffer overflowed (dropped_bytes=%d dropped_ms=%d)",
		dropped, dropped*1000/int64(rate*2))
}

func (g *GeminiProvider) finishReconnectFailure(err error) {
	g.mu.Lock()
	if g.stopped {
		g.reconnecting = false
		g.mu.Unlock()
		return
	}
	g.reconnecting = false
	g.started = false
	g.lastErr = fmt.Errorf("Gemini Live reconnect failed: %w", err)
	g.mu.Unlock()
	log.Printf("❌ [Gemini] Reconnect exhausted: %v", err)
	g.closeResults()
}

func geminiInputTranscriptionConfig(languageCode string) *genai.AudioTranscriptionConfig {
	cfg := &genai.AudioTranscriptionConfig{}
	if code := strings.TrimSpace(languageCode); code != "" {
		cfg.LanguageHints = &genai.LanguageHints{LanguageCodes: []string{code}}
	}
	return cfg
}

func geminiLiveConnectConfig(cfg GeminiConfig, resumptionHandle string) *genai.LiveConnectConfig {
	echoTargetLanguage := false
	return &genai.LiveConnectConfig{
		// The translation model requires AUDIO responses. Model audio remains
		// discarded; input and translated output text are exposed.
		ResponseModalities:       []genai.Modality{genai.ModalityAudio},
		InputAudioTranscription:  geminiInputTranscriptionConfig(cfg.LanguageCode),
		OutputAudioTranscription: &genai.AudioTranscriptionConfig{},
		TranslationConfig: &genai.TranslationConfig{
			TargetLanguageCode: cfg.TargetLanguageCode,
			EchoTargetLanguage: &echoTargetLanguage,
		},
		SessionResumption: &genai.SessionResumptionConfig{
			Handle: resumptionHandle,
		},
		ContextWindowCompression: &genai.ContextWindowCompressionConfig{
			SlidingWindow: &genai.SlidingWindow{},
		},
	}
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
	now := g.currentTime()
	turnID := g.currentTurnIDLocked()
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
	if hasSource {
		tail, changed := g.sourceAccumulator.observe(transcription.Text)
		languageCode := strings.TrimSpace(transcription.LanguageCode)
		if languageCode != "" || g.sourceLanguage == "" {
			g.sourceLanguage = languageCode
		}
		if g.pendingBoundaryReason == geminiBoundaryNone && (changed || isFinal) && tail != "" {
			results = append(results, domain.TranscriptResult{
				Text:         tail,
				IsFinal:      isFinal,
				Role:         domain.TranscriptRoleSource,
				LanguageCode: g.sourceLanguage,
				TurnID:       turnID,
			})
			g.sourceFinal = g.sourceFinal || isFinal
		}
		if reason := g.segmenter.observeSource(now, tail); reason != geminiBoundaryNone {
			g.requestBoundaryLocked(now, reason)
		}
	}

	if output := content.OutputTranscription; output != nil && strings.TrimSpace(output.Text) != "" {
		tail, changed := g.translationAccumulator.observe(output.Text)
		outputFinal := output.Finished || content.GenerationComplete || content.TurnComplete
		if tail != "" && (changed || (outputFinal && !g.translationFinal)) {
			results = append(results, domain.TranscriptResult{
				Text:         tail,
				IsFinal:      outputFinal,
				Role:         domain.TranscriptRoleTranslation,
				LanguageCode: g.cfg.TargetLanguageCode,
				TurnID:       turnID,
			})
		}
		g.translationFinal = g.translationFinal || outputFinal
	}

	if content.GenerationComplete || content.TurnComplete {
		translationTail, prefixOK := g.translationAccumulator.tail()
		g.logPrefixInvariantLocked("translation", prefixOK)
		if translationTail != "" && !g.translationFinal {
			results = append(results, domain.TranscriptResult{
				Text:         translationTail,
				IsFinal:      true,
				Role:         domain.TranscriptRoleTranslation,
				LanguageCode: g.cfg.TargetLanguageCode,
				TurnID:       turnID,
			})
			g.translationFinal = true
		}
	}
	if content.TurnComplete {
		if g.pendingBoundaryReason != geminiBoundaryNone {
			results = append(results, g.completePendingBoundaryLocked()...)
		}
		results = append(results, g.finalizeUpstreamTurnLocked()...)
		g.resetUpstreamTurnLocked()
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
	if g.segmenter.sampleRate <= 0 || g.segmenter.rmsThreshold <= 0 || g.segmenter.silenceWindow <= 0 {
		g.segmenter = newGeminiSegmenter(normalizeGeminiConfig(g.cfg).SampleRate)
	}

	if !g.segmenter.observeAudio(audio, now) {
		return nil
	}
	if !g.requestBoundaryLocked(now, geminiBoundarySilence) {
		return nil
	}
	if delay, pending := g.segmenter.boundaryDelay(now); pending && delay <= 0 {
		return g.completePendingBoundaryLocked()
	}
	return nil
}

func (g *GeminiProvider) currentTurnIDLocked() string {
	return fmt.Sprintf("gemini-%d", g.turnSequence+1)
}

func (g *GeminiProvider) requestBoundaryLocked(now time.Time, reason geminiBoundaryReason) bool {
	if reason == geminiBoundaryNone || !g.segmenter.requestBoundary(now) {
		return false
	}
	g.pendingSourceCutoff = g.sourceAccumulator.historyCutoff()
	g.pendingBoundaryReason = reason
	g.scheduleBoundaryLocked(geminiTranslationGrace)
	return true
}

func (g *GeminiProvider) completePendingBoundaryLocked() []domain.TranscriptResult {
	if g.pendingBoundaryReason == geminiBoundaryNone {
		return nil
	}

	turnID := g.currentTurnIDLocked()
	results := make([]domain.TranscriptResult, 0, 2)
	sourceTail, sourcePrefixOK := g.sourceAccumulator.tailAt(g.pendingSourceCutoff)
	g.logPrefixInvariantLocked("source", sourcePrefixOK)
	translationCutoff := g.translationAccumulator.historyCutoff()
	translationTail, translationPrefixOK := g.translationAccumulator.tailAt(translationCutoff)
	g.logPrefixInvariantLocked("translation", translationPrefixOK)

	if sourceTail != "" && !g.sourceFinal {
		results = append(results, domain.TranscriptResult{
			Text: sourceTail, IsFinal: true, Role: domain.TranscriptRoleSource,
			LanguageCode: g.sourceLanguage, TurnID: turnID,
		})
	}
	if translationTail != "" && !g.translationFinal {
		results = append(results, domain.TranscriptResult{
			Text: translationTail, IsFinal: true, Role: domain.TranscriptRoleTranslation,
			LanguageCode: g.cfg.TargetLanguageCode, TurnID: turnID,
		})
	}
	if sourceTail != "" || translationTail != "" {
		g.turnSequence++
	}

	requestedAt := g.segmenter.boundaryRequestedAt
	g.sourceAccumulator.commit(g.pendingSourceCutoff)
	g.translationAccumulator.commit(translationCutoff)
	g.sourceFinal = false
	g.translationFinal = false
	g.pendingSourceCutoff = ""
	g.pendingBoundaryReason = geminiBoundaryNone
	g.segmenter.reset()
	g.stopBoundaryTimerLocked()

	nextTurnID := g.currentTurnIDLocked()
	bufferedSource, sourcePrefixOK := g.sourceAccumulator.tail()
	g.logPrefixInvariantLocked("source", sourcePrefixOK)
	if bufferedSource != "" {
		results = append(results, domain.TranscriptResult{
			Text: bufferedSource, IsFinal: false, Role: domain.TranscriptRoleSource,
			LanguageCode: g.sourceLanguage, TurnID: nextTurnID,
		})
		if reason := g.segmenter.observeSource(requestedAt, bufferedSource); reason != geminiBoundaryNone {
			g.requestBoundaryLocked(requestedAt, reason)
		}
	}
	bufferedTranslation, translationPrefixOK := g.translationAccumulator.tail()
	g.logPrefixInvariantLocked("translation", translationPrefixOK)
	if bufferedTranslation != "" {
		results = append(results, domain.TranscriptResult{
			Text: bufferedTranslation, IsFinal: false, Role: domain.TranscriptRoleTranslation,
			LanguageCode: g.cfg.TargetLanguageCode, TurnID: nextTurnID,
		})
	}
	return results
}

func (g *GeminiProvider) finalizeUpstreamTurnLocked() []domain.TranscriptResult {
	turnID := g.currentTurnIDLocked()
	results := make([]domain.TranscriptResult, 0, 2)
	sourceTail, sourcePrefixOK := g.sourceAccumulator.tail()
	g.logPrefixInvariantLocked("source", sourcePrefixOK)
	translationTail, translationPrefixOK := g.translationAccumulator.tail()
	g.logPrefixInvariantLocked("translation", translationPrefixOK)
	if sourceTail != "" && !g.sourceFinal {
		results = append(results, domain.TranscriptResult{
			Text: sourceTail, IsFinal: true, Role: domain.TranscriptRoleSource,
			LanguageCode: g.sourceLanguage, TurnID: turnID,
		})
	}
	if translationTail != "" && !g.translationFinal {
		results = append(results, domain.TranscriptResult{
			Text: translationTail, IsFinal: true, Role: domain.TranscriptRoleTranslation,
			LanguageCode: g.cfg.TargetLanguageCode, TurnID: turnID,
		})
	}
	if sourceTail != "" || translationTail != "" {
		g.turnSequence++
	}
	return results
}

func (g *GeminiProvider) resetUpstreamTurnLocked() {
	g.sourceAccumulator.reset()
	g.translationAccumulator.reset()
	g.sourceLanguage = ""
	g.sourceFinal = false
	g.translationFinal = false
	g.pendingSourceCutoff = ""
	g.pendingBoundaryReason = geminiBoundaryNone
	g.segmenter.reset()
	g.stopBoundaryTimerLocked()
}

func (g *GeminiProvider) logPrefixInvariantLocked(role string, prefixOK bool) {
	if prefixOK {
		return
	}
	var accumulator *geminiTranscriptAccumulator
	if role == "source" {
		accumulator = &g.sourceAccumulator
	} else {
		accumulator = &g.translationAccumulator
	}
	log.Printf("⚠️ [Gemini] transcript prefix invariant failed (role=%s prefix_bytes=%d history_bytes=%d)",
		role, len(accumulator.emittedPrefix), len(accumulator.history))
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
	if version != g.boundaryVersion || g.pendingBoundaryReason == geminiBoundaryNone {
		g.transcriptMu.Unlock()
		return
	}
	results := g.completePendingBoundaryLocked()
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
	separator := " "
	lastCurrent, _ := utf8.DecodeLastRuneInString(current)
	firstIncoming, _ := utf8.DecodeRuneInString(incoming)
	if isGeminiThaiRune(lastCurrent) && isGeminiThaiRune(firstIncoming) {
		// Gemini may stream adjacent pieces of one Thai word. The separator here
		// is synthetic, so do not let conservative output normalization preserve it.
		separator = ""
	}
	return domain.NormalizeTranscriptSpacing(current + separator + incoming), true
}

func isGeminiThaiRune(r rune) bool {
	return r >= 0x0E00 && r <= 0x0E7F
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
