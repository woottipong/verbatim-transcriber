package asr

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/fasthttp/websocket"
	"thai-transcriber-backend/internal/domain"
)

const (
	openAITranscriptionProviderName = "gpt-realtime-whisper"
	openAITranscriptionModel        = "gpt-realtime-whisper"
	openAITranscriptionEndpoint     = "wss://api.openai.com/v1/realtime?intent=transcription"
	openAITranscriptionSampleRate   = 24000
	openAITranscriptionReadyTimeout = 10 * time.Second
	openAITranscriptionDrain        = time.Second
	openAITranscriptionMaxTextBytes = 32 * 1024
	openAITranscriptionReplay       = time.Second
	openAITranscriptionMaxReconnect = 3
)

const (
	openAIEventSessionUpdated      = "session_updated"
	openAIEventTranscriptDelta     = "transcript_delta"
	openAIEventTranscriptCompleted = "transcript_completed"
	openAIEventError               = "error"
)

// OpenAITranscriptionConfig configures the streaming gpt-realtime-whisper model.
// LanguageCode is sent as the source-language hint for the transcription session.
type OpenAITranscriptionConfig struct {
	APIKey       string
	LanguageCode string
	SampleRate   int
}

type openAITranscriptionDialFunc func(context.Context, string, http.Header) (*websocket.Conn, *http.Response, error)

type openAITranscriptionEvent struct {
	kind         string
	typeName     string
	itemID       string
	contentIndex int
	delta        string
	errorText    string
}

type openAITranscriptionSessionUpdate struct {
	Type    string `json:"type"`
	Session struct {
		Type  string `json:"type"`
		Audio struct {
			Input struct {
				Format struct {
					Type string `json:"type"`
					Rate int    `json:"rate"`
				} `json:"format"`
				Transcription struct {
					Model    string `json:"model"`
					Language string `json:"language"`
					Delay    string `json:"delay,omitempty"`
				} `json:"transcription"`
				TurnDetection any `json:"turn_detection"`
			} `json:"input"`
		} `json:"audio"`
	} `json:"session"`
}

type openAITranscriptionProvider struct {
	conn        *websocket.Conn
	dial        openAITranscriptionDialFunc
	results     chan domain.TranscriptResult
	cfg         OpenAITranscriptionConfig
	ctx         context.Context
	cancel      context.CancelFunc
	receiveDone chan struct{}

	mu             sync.Mutex
	writeMu        sync.Mutex
	transcriptMu   sync.Mutex
	resultsMu      sync.Mutex
	closeOnce      sync.Once
	lastErr        error
	started        bool
	starting       bool
	receiveStart   bool
	reconnecting   bool
	reconnectCount int
	stopped        bool
	resultsClosed  bool

	transcriptItems map[string]string
	segmenter       openAITranscriptionSegmenter
	audioBuf        *ringBuffer
	reconnectDelay  func(int) time.Duration
	loggedAudio     bool
	loggedEventType map[string]struct{}
}

// OpenAITranscriptionProvider is the LiveKit ASR provider for OpenAI's
// transcription-only realtime session. It publishes source text only.
type OpenAITranscriptionProvider = openAITranscriptionProvider

func normalizeOpenAITranscriptionConfig(cfg OpenAITranscriptionConfig) OpenAITranscriptionConfig {
	cfg.LanguageCode = normalizeLanguageCode(cfg.LanguageCode, "th")
	if cfg.SampleRate <= 0 {
		cfg.SampleRate = openAITranscriptionSampleRate
	}
	return cfg
}

func normalizeLanguageCode(value, fallback string) string {
	value = strings.TrimSpace(strings.ReplaceAll(value, "_", "-"))
	if value == "" {
		return fallback
	}
	return value
}

func NewOpenAITranscriptionProvider(ctx context.Context, cfg OpenAITranscriptionConfig) (*OpenAITranscriptionProvider, error) {
	if strings.TrimSpace(cfg.APIKey) == "" {
		return nil, fmt.Errorf("OpenAI API key is required")
	}
	normalized := normalizeOpenAITranscriptionConfig(cfg)
	return &openAITranscriptionProvider{
		cfg:             normalized,
		dial:            defaultOpenAITranscriptionDial,
		results:         make(chan domain.TranscriptResult, 100),
		segmenter:       newOpenAITranscriptionSegmenter(normalized.SampleRate),
		transcriptItems: make(map[string]string),
		audioBuf:        newRingBuffer(normalized.SampleRate * 2 * int(openAITranscriptionReplay/time.Second)),
		reconnectDelay:  defaultOpenAITranscriptionReconnectDelay,
		loggedEventType: make(map[string]struct{}),
	}, nil
}

func defaultOpenAITranscriptionDial(ctx context.Context, url string, headers http.Header) (*websocket.Conn, *http.Response, error) {
	return (&websocket.Dialer{}).DialContext(ctx, url, headers)
}

func defaultOpenAITranscriptionReconnectDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	delay := 100 * time.Millisecond * time.Duration(1<<(attempt-1))
	return min(delay, 2*time.Second)
}

func (o *openAITranscriptionProvider) Name() string {
	return openAITranscriptionProviderName
}

func (o *openAITranscriptionProvider) SampleRate() int {
	return o.cfg.SampleRate
}

func (o *openAITranscriptionProvider) Start(ctx context.Context) error {
	o.mu.Lock()
	if o.started {
		o.mu.Unlock()
		return nil
	}
	if o.stopped {
		o.mu.Unlock()
		return errors.New("OpenAI transcription provider is stopped")
	}
	if o.starting {
		o.mu.Unlock()
		return errors.New("OpenAI transcription provider is starting")
	}
	o.starting = true
	o.mu.Unlock()

	streamCtx, cancel := context.WithCancel(ctx)
	o.mu.Lock()
	if o.stopped {
		o.mu.Unlock()
		cancel()
		return errors.New("OpenAI transcription provider is stopped")
	}
	o.ctx = streamCtx
	o.cancel = cancel
	o.mu.Unlock()

	if err := o.connectSession(streamCtx); err != nil {
		cancel()
		o.mu.Lock()
		o.starting = false
		o.lastErr = err
		o.mu.Unlock()
		return err
	}
	o.mu.Lock()
	if o.stopped {
		o.mu.Unlock()
		err := errors.New("OpenAI transcription provider is stopped")
		cancel()
		return err
	}
	o.started = true
	o.starting = false
	o.mu.Unlock()
	log.Printf("✅ [OpenAI Transcribe] Session ready (source=%s, intent=transcription, transcription_model=%s, sample_rate=%d)", o.cfg.LanguageCode, openAITranscriptionModel, o.cfg.SampleRate)
	return nil
}

func (o *openAITranscriptionProvider) sessionUpdatePayload() ([]byte, error) {
	var update openAITranscriptionSessionUpdate
	update.Type = "session.update"
	update.Session.Type = "transcription"
	update.Session.Audio.Input.Format.Type = "audio/pcm"
	update.Session.Audio.Input.Format.Rate = o.cfg.SampleRate
	update.Session.Audio.Input.Transcription.Model = openAITranscriptionModel
	update.Session.Audio.Input.Transcription.Language = o.cfg.LanguageCode
	update.Session.Audio.Input.Transcription.Delay = "low"
	// gpt-realtime-whisper requires manual commits for deterministic turn
	// boundaries; the local PCM segmenter commits after detected silence.
	update.Session.Audio.Input.TurnDetection = nil
	return json.Marshal(update)
}

func (o *openAITranscriptionProvider) connectSession(ctx context.Context) error {
	o.mu.Lock()
	dial := o.dial
	o.mu.Unlock()
	if dial == nil {
		dial = defaultOpenAITranscriptionDial
	}

	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+o.cfg.APIKey)
	conn, _, err := dial(ctx, openAITranscriptionEndpoint, headers)
	if err != nil {
		return fmt.Errorf("connect to OpenAI realtime transcription: %w", err)
	}

	ready := make(chan error, 1)
	done := make(chan struct{})
	o.mu.Lock()
	if o.stopped {
		o.mu.Unlock()
		_ = conn.Close()
		return errors.New("OpenAI transcription provider is stopped")
	}
	o.conn = conn
	o.receiveDone = done
	o.receiveStart = true
	o.mu.Unlock()
	go o.receiveResponses(conn, ready, done)

	payload, err := o.sessionUpdatePayload()
	if err == nil {
		err = o.writeTextTo(conn, payload)
	}
	if err != nil {
		_ = conn.Close()
		waitForOpenAIReceiver(done)
		return fmt.Errorf("send OpenAI transcription session update: %w", err)
	}

	select {
	case err = <-ready:
	case <-ctx.Done():
		err = ctx.Err()
	case <-time.After(openAITranscriptionReadyTimeout):
		err = errors.New("timed out waiting for OpenAI transcription session.updated")
	}
	if err != nil {
		_ = conn.Close()
		waitForOpenAIReceiver(done)
		return fmt.Errorf("initialize OpenAI transcription session: %w", err)
	}
	return nil
}

func waitForOpenAIReceiver(done <-chan struct{}) {
	if done == nil {
		return
	}
	select {
	case <-done:
	case <-time.After(2 * time.Second):
	}
}

func (o *openAITranscriptionProvider) SendAudio(data []byte) error {
	if len(data) == 0 {
		return nil
	}
	o.mu.Lock()
	conn := o.conn
	ctx := o.ctx
	started := o.started
	stopped := o.stopped
	reconnecting := o.reconnecting
	if started && !stopped && o.audioBuf != nil {
		o.audioBuf.Write(data)
	}
	o.mu.Unlock()
	if stopped {
		return errors.New("OpenAI transcription provider is stopped")
	}
	if !started || conn == nil {
		return errors.New("OpenAI transcription provider is not started")
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	if reconnecting || conn == nil {
		return nil
	}

	payload, err := openAITranscriptionAudioAppendPayload(data)
	if err != nil {
		return err
	}
	if err := o.writeTextTo(conn, payload); err != nil {
		o.beginReconnect(conn, err)
		return nil
	}
	o.mu.Lock()
	if !o.loggedAudio {
		o.loggedAudio = true
		log.Printf("🎧 [OpenAI Transcribe] First audio batch sent (%d bytes)", len(data))
	}
	o.mu.Unlock()
	if err := o.observeAudio(data); err != nil {
		o.beginReconnect(conn, err)
	}
	return nil
}

func openAITranscriptionAudioAppendPayload(data []byte) ([]byte, error) {
	message := struct {
		Type  string `json:"type"`
		Audio string `json:"audio"`
	}{Type: "input_audio_buffer.append", Audio: base64.StdEncoding.EncodeToString(data)}
	return json.Marshal(message)
}

func openAITranscriptionAudioCommitPayload() ([]byte, error) {
	return json.Marshal(struct {
		Type string `json:"type"`
	}{Type: "input_audio_buffer.commit"})
}

func (o *openAITranscriptionProvider) writeText(payload []byte) error {
	o.mu.Lock()
	conn := o.conn
	o.mu.Unlock()
	return o.writeTextTo(conn, payload)
}

func (o *openAITranscriptionProvider) writeTextTo(conn *websocket.Conn, payload []byte) error {
	o.writeMu.Lock()
	defer o.writeMu.Unlock()
	if conn == nil {
		return errors.New("OpenAI transcription WebSocket is not connected")
	}
	return conn.WriteMessage(websocket.TextMessage, payload)
}

func (o *openAITranscriptionProvider) observeAudio(data []byte) error {
	o.transcriptMu.Lock()
	defer o.transcriptMu.Unlock()
	if !o.segmenter.observeAudio(data) {
		return nil
	}
	payload, err := openAITranscriptionAudioCommitPayload()
	if err != nil {
		return fmt.Errorf("build OpenAI transcription commit: %w", err)
	}
	if err := o.writeText(payload); err != nil {
		return fmt.Errorf("commit OpenAI transcription audio: %w", err)
	}
	// The API owns transcript finalization and may complete committed items out
	// of order. Reset only the local audio boundary detector; final text is
	// published when the matching completed event arrives.
	o.segmenter.reset()
	return nil
}

func (o *openAITranscriptionProvider) receiveResponses(conn *websocket.Conn, ready chan<- error, done chan<- struct{}) {
	defer close(done)
	acknowledged := false
	readySignaled := false
	signalReady := func(err error) {
		if readySignaled {
			return
		}
		readySignaled = true
		ready <- err
	}
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			o.mu.Lock()
			stopped := o.stopped
			o.mu.Unlock()
			if stopped {
				return
			}
			if !acknowledged {
				signalReady(err)
				return
			}
			if !errors.Is(err, io.EOF) {
				log.Printf("❌ [OpenAI Transcribe] Receive error: %v", err)
			}
			o.beginReconnect(conn, err)
			return
		}

		event, err := parseOpenAITranscriptionEvent(message)
		if err != nil {
			o.setError(fmt.Errorf("parse OpenAI transcription event: %w", err))
			continue
		}
		o.logEventType(event.typeName)
		if event.kind == openAIEventSessionUpdated {
			acknowledged = true
			signalReady(nil)
			continue
		}
		if event.kind == openAIEventError {
			apiErr := errors.New(event.errorText)
			o.setError(apiErr)
			log.Printf("❌ [OpenAI Transcribe] API error: %s", event.errorText)
			if !acknowledged {
				signalReady(apiErr)
			} else {
				o.beginReconnect(conn, apiErr)
			}
			return
		}
		o.handleParsedEvent(event)
	}
}

func (o *openAITranscriptionProvider) handleEvent(message []byte) bool {
	event, err := parseOpenAITranscriptionEvent(message)
	if err != nil {
		o.mu.Lock()
		o.lastErr = fmt.Errorf("parse OpenAI transcription event: %w", err)
		o.mu.Unlock()
		return true
	}
	o.logEventType(event.typeName)
	return o.handleParsedEvent(event)
}

func (o *openAITranscriptionProvider) handleParsedEvent(event openAITranscriptionEvent) bool {
	switch event.kind {
	case openAIEventSessionUpdated:
		return true
	case openAIEventTranscriptDelta:
		return o.appendTranscriptDelta(event.itemID, event.contentIndex, event.delta)
	case openAIEventTranscriptCompleted:
		return o.completeTranscript(event.itemID, event.contentIndex, event.delta)
	case openAIEventError:
		apiErr := errors.New(event.errorText)
		o.setError(apiErr)
		log.Printf("❌ [OpenAI Transcribe] API error: %s", event.errorText)
		return false
	default:
		return true
	}
}

func (o *openAITranscriptionProvider) logEventType(typeName string) {
	if typeName == "" {
		return
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if _, seen := o.loggedEventType[typeName]; seen {
		return
	}
	o.loggedEventType[typeName] = struct{}{}
	log.Printf("ℹ️ [OpenAI Transcribe] Event received: %s", typeName)
}

func (o *openAITranscriptionProvider) beginReconnect(failedConn *websocket.Conn, cause error) {
	o.mu.Lock()
	if o.stopped || o.reconnecting || o.conn != failedConn {
		o.mu.Unlock()
		return
	}
	o.reconnecting = true
	o.lastErr = cause
	ctx := o.ctx
	o.mu.Unlock()
	go o.reconnect(ctx, failedConn, cause)
}

func (o *openAITranscriptionProvider) reconnect(ctx context.Context, failedConn *websocket.Conn, cause error) {
	_ = failedConn.Close()
	lastErr := cause
	for attempt := 1; attempt <= openAITranscriptionMaxReconnect; attempt++ {
		o.mu.Lock()
		if o.stopped {
			o.reconnecting = false
			o.mu.Unlock()
			return
		}
		delayFn := o.reconnectDelay
		o.mu.Unlock()
		if delayFn == nil {
			delayFn = defaultOpenAITranscriptionReconnectDelay
		}
		if delay := delayFn(attempt); delay > 0 {
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				timer.Stop()
				o.finishReconnectFailure(ctx.Err())
				return
			case <-timer.C:
			}
		}

		log.Printf("🔄 [OpenAI Transcribe] Reconnecting session (attempt=%d/%d)", attempt, openAITranscriptionMaxReconnect)
		if err := o.connectSession(ctx); err != nil {
			lastErr = err
			continue
		}

		o.mu.Lock()
		replay := o.audioBuf.Read()
		conn := o.conn
		o.mu.Unlock()
		o.transcriptMu.Lock()
		o.segmenter.reset()
		o.transcriptMu.Unlock()
		if len(replay) > 0 {
			payload, err := openAITranscriptionAudioAppendPayload(replay)
			if err == nil {
				err = o.writeTextTo(conn, payload)
			}
			if err != nil {
				lastErr = fmt.Errorf("replay audio after reconnect: %w", err)
				_ = conn.Close()
				continue
			}
			if err := o.observeAudio(replay); err != nil {
				lastErr = err
				_ = conn.Close()
				continue
			}
			log.Printf("🔄 [OpenAI Transcribe] Replayed %d bytes of recent audio", len(replay))
		}

		o.mu.Lock()
		o.reconnecting = false
		o.reconnectCount++
		o.lastErr = nil
		count := o.reconnectCount
		o.mu.Unlock()
		log.Printf("✅ [OpenAI Transcribe] Session reconnected (#%d)", count)
		return
	}
	o.finishReconnectFailure(lastErr)
}

func (o *openAITranscriptionProvider) finishReconnectFailure(err error) {
	o.mu.Lock()
	if o.stopped {
		o.reconnecting = false
		o.mu.Unlock()
		return
	}
	o.reconnecting = false
	o.started = false
	o.lastErr = fmt.Errorf("OpenAI transcription reconnect failed: %w", err)
	o.mu.Unlock()
	log.Printf("❌ [OpenAI Transcribe] Reconnect exhausted: %v", err)
	o.closeResults()
}

func (o *openAITranscriptionProvider) appendTranscriptDelta(itemID string, contentIndex int, delta string) bool {
	if strings.TrimSpace(delta) == "" {
		return true
	}
	key, turnID, ok := openAITranscriptionItemIdentity(itemID, contentIndex)
	if !ok {
		o.setError(errors.New("OpenAI transcription delta is missing item_id"))
		return true
	}
	o.transcriptMu.Lock()
	text := applyOpenAITranscriptionDelta(o.transcriptItems[key], delta)
	o.transcriptItems[key] = text
	result := domain.TranscriptResult{
		Text: text, Role: domain.TranscriptRoleSource,
		LanguageCode: o.cfg.LanguageCode, TurnID: turnID,
	}
	o.transcriptMu.Unlock()
	return o.publishResults([]domain.TranscriptResult{result}, nil)
}

func (o *openAITranscriptionProvider) completeTranscript(itemID string, contentIndex int, transcript string) bool {
	key, turnID, ok := openAITranscriptionItemIdentity(itemID, contentIndex)
	if !ok {
		o.setError(errors.New("OpenAI transcription completed event is missing item_id"))
		return true
	}
	transcript = truncateOpenAITranscriptionUTF8(transcript, openAITranscriptionMaxTextBytes)
	if strings.TrimSpace(transcript) == "" {
		o.transcriptMu.Lock()
		delete(o.transcriptItems, key)
		o.transcriptMu.Unlock()
		return true
	}
	result := domain.TranscriptResult{
		Text: transcript, IsFinal: true, Role: domain.TranscriptRoleSource,
		LanguageCode: o.cfg.LanguageCode, TurnID: turnID,
	}
	o.transcriptMu.Lock()
	delete(o.transcriptItems, key)
	o.transcriptMu.Unlock()
	return o.publishResults([]domain.TranscriptResult{result}, nil)
}

func openAITranscriptionItemIdentity(itemID string, contentIndex int) (key, turnID string, ok bool) {
	itemID = strings.TrimSpace(itemID)
	if itemID == "" {
		return "", "", false
	}
	key = fmt.Sprintf("%s:%d", itemID, contentIndex)
	return key, fmt.Sprintf("%s:%s", openAITranscriptionProviderName, key), true
}

func (o *openAITranscriptionProvider) Results() <-chan domain.TranscriptResult {
	return o.results
}

func (o *openAITranscriptionProvider) Stop() error {
	o.mu.Lock()
	if o.stopped {
		o.mu.Unlock()
		return nil
	}
	o.stopped = true
	conn := o.conn
	cancel := o.cancel
	started := o.started
	receiveStarted := o.receiveStart
	reconnecting := o.reconnecting
	o.mu.Unlock()

	var closeErr error
	if started && conn != nil && receiveStarted && !reconnecting {
		if payload, err := openAITranscriptionAudioCommitPayload(); err == nil {
			if err := o.writeText(payload); err != nil && !errors.Is(err, websocket.ErrCloseSent) {
				closeErr = err
			}
		}
		select {
		case <-time.After(openAITranscriptionDrain):
		case <-o.receiveDone:
		}
	}

	if conn != nil {
		_ = conn.Close()
	}
	waitForOpenAIReceiver(o.receiveDone)
	if cancel != nil {
		cancel()
	}
	o.closeResults()
	return closeErr
}

func (o *openAITranscriptionProvider) Err() error {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.lastErr
}

func (o *openAITranscriptionProvider) setError(err error) {
	o.mu.Lock()
	o.lastErr = err
	o.mu.Unlock()
}

func (o *openAITranscriptionProvider) closeResults() {
	o.resultsMu.Lock()
	defer o.resultsMu.Unlock()
	if o.resultsClosed || o.results == nil {
		return
	}
	o.resultsClosed = true
	o.closeOnce.Do(func() { close(o.results) })
}

func (o *openAITranscriptionProvider) publishResults(results []domain.TranscriptResult, ctx context.Context) bool {
	for _, result := range results {
		o.resultsMu.Lock()
		if o.resultsClosed || o.results == nil {
			o.resultsMu.Unlock()
			return false
		}
		var done <-chan struct{}
		if ctx != nil {
			done = ctx.Done()
		}
		select {
		case o.results <- result:
			o.resultsMu.Unlock()
		case <-done:
			o.resultsMu.Unlock()
			return false
		}
	}
	return true
}

func parseOpenAITranscriptionEvent(message []byte) (openAITranscriptionEvent, error) {
	var payload struct {
		Type         string `json:"type"`
		ItemID       string `json:"item_id"`
		ContentIndex int    `json:"content_index"`
		Delta        string `json:"delta"`
		Transcript   string `json:"transcript"`
		Error        *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(message, &payload); err != nil {
		return openAITranscriptionEvent{}, err
	}
	switch payload.Type {
	case "session.updated":
		return openAITranscriptionEvent{kind: openAIEventSessionUpdated, typeName: payload.Type}, nil
	case "conversation.item.input_audio_transcription.delta":
		return openAITranscriptionEvent{kind: openAIEventTranscriptDelta, typeName: payload.Type, itemID: payload.ItemID, contentIndex: payload.ContentIndex, delta: payload.Delta}, nil
	case "conversation.item.input_audio_transcription.completed":
		return openAITranscriptionEvent{kind: openAIEventTranscriptCompleted, typeName: payload.Type, itemID: payload.ItemID, contentIndex: payload.ContentIndex, delta: payload.Transcript}, nil
	case "error":
		message := "OpenAI transcription session error"
		if payload.Error != nil && strings.TrimSpace(payload.Error.Message) != "" {
			message = payload.Error.Message
		}
		return openAITranscriptionEvent{kind: openAIEventError, typeName: payload.Type, errorText: message}, nil
	default:
		return openAITranscriptionEvent{typeName: payload.Type}, nil
	}
}

func applyOpenAITranscriptionDelta(current, delta string) string {
	if current == "" {
		return truncateOpenAITranscriptionUTF8(delta, openAITranscriptionMaxTextBytes)
	}
	if strings.HasPrefix(delta, current) {
		return truncateOpenAITranscriptionUTF8(delta, openAITranscriptionMaxTextBytes)
	}
	return truncateOpenAITranscriptionUTF8(current+delta, openAITranscriptionMaxTextBytes)
}

func truncateOpenAITranscriptionUTF8(value string, maxBytes int) string {
	if maxBytes <= 0 || len(value) <= maxBytes {
		return value
	}
	value = value[:maxBytes]
	for !utf8.ValidString(value) {
		value = value[:len(value)-1]
	}
	return value
}
