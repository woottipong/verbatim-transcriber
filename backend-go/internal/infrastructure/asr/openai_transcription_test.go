package asr

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fasthttp/websocket"
	"thai-transcriber-backend/internal/domain"
)

func TestOpenAITranscriptionConfigDefaults(t *testing.T) {
	cfg := normalizeOpenAITranscriptionConfig(OpenAITranscriptionConfig{})
	if cfg.LanguageCode != "th" {
		t.Fatalf("language = %q, want th", cfg.LanguageCode)
	}
	if cfg.SampleRate != 24000 {
		t.Fatalf("sample rate = %d, want 24000", cfg.SampleRate)
	}
}

func TestOpenAITranscriptionUsesTranscriptionIntentEndpoint(t *testing.T) {
	const want = "wss://api.openai.com/v1/realtime?intent=transcription"
	if openAITranscriptionEndpoint != want {
		t.Fatalf("realtime endpoint = %q, want %q", openAITranscriptionEndpoint, want)
	}
}

func TestOpenAITranscriptionAudioAppendUsesDocumentedEvent(t *testing.T) {
	payload, err := openAITranscriptionAudioAppendPayload([]byte{1, 2, 3, 4})
	if err != nil {
		t.Fatalf("marshal audio append: %v", err)
	}
	var event struct {
		Type  string `json:"type"`
		Audio string `json:"audio"`
	}
	if err := json.Unmarshal(payload, &event); err != nil {
		t.Fatalf("unmarshal audio append: %v", err)
	}
	if event.Type != "input_audio_buffer.append" {
		t.Fatalf("event type = %q, want input_audio_buffer.append", event.Type)
	}
	if event.Audio != base64.StdEncoding.EncodeToString([]byte{1, 2, 3, 4}) {
		t.Fatal("audio payload was not base64 encoded")
	}
}

func TestOpenAITranscriptionCommitUsesDocumentedEvent(t *testing.T) {
	payload, err := openAITranscriptionAudioCommitPayload()
	if err != nil {
		t.Fatalf("marshal commit: %v", err)
	}
	if string(payload) != `{"type":"input_audio_buffer.commit"}` {
		t.Fatalf("commit payload = %s", payload)
	}
}

func TestNewOpenAITranscriptionProviderRequiresAPIKey(t *testing.T) {
	if _, err := NewOpenAITranscriptionProvider(context.Background(), OpenAITranscriptionConfig{}); err == nil {
		t.Fatal("provider without API key was accepted")
	}
}

func TestOpenAITranscriptionStopUnblocksSaturatedResultPublisher(t *testing.T) {
	provider := &openAITranscriptionProvider{
		results:         make(chan domain.TranscriptResult, 1),
		transcriptItems: make(map[string]string),
	}
	provider.results <- domain.TranscriptResult{Text: "buffer full"}

	publishDone := make(chan struct{})
	go func() {
		defer close(publishDone)
		provider.appendTranscriptDelta("item-1", 0, "blocked result")
	}()
	waitForOpenAIResultPublisher(t, provider)

	stopDone := make(chan error, 1)
	go func() {
		stopDone <- provider.Stop()
	}()
	select {
	case err := <-stopDone:
		if err != nil {
			t.Fatalf("Stop() error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Stop() blocked behind a saturated result publisher")
	}
	select {
	case <-publishDone:
	case <-time.After(time.Second):
		t.Fatal("result publisher remained blocked after Stop()")
	}
}

func waitForOpenAIResultPublisher(t *testing.T, provider *openAITranscriptionProvider) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for {
		if !provider.resultsMu.TryLock() {
			return
		}
		provider.resultsMu.Unlock()
		if time.Now().After(deadline) {
			t.Fatal("result publisher did not block on the saturated channel")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestOpenAITranscriptionStartUsesRealtimeEndpointAndBearerAuth(t *testing.T) {
	provider, err := NewOpenAITranscriptionProvider(context.Background(), OpenAITranscriptionConfig{APIKey: "test-key"})
	if err != nil {
		t.Fatalf("new provider: %v", err)
	}
	provider.dial = func(_ context.Context, url string, headers http.Header) (*websocket.Conn, *http.Response, error) {
		if url != openAITranscriptionEndpoint {
			t.Fatalf("dial URL = %q, want %q", url, openAITranscriptionEndpoint)
		}
		if got, want := headers.Get("Authorization"), "Bearer test-key"; got != want {
			t.Fatalf("authorization = %q, want %q", got, want)
		}
		return nil, nil, errors.New("dial blocked in unit test")
	}

	if err := provider.Start(context.Background()); err == nil {
		t.Fatal("Start() error = nil, want dial error")
	}
}

func TestOpenAITranscriptionStartWaitsForSessionUpdated(t *testing.T) {
	const acknowledgementDelay = 75 * time.Millisecond
	serverErrors := make(chan error, 1)
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			serverErrors <- err
			return
		}
		defer conn.Close()
		if _, _, err := conn.ReadMessage(); err != nil {
			serverErrors <- err
			return
		}
		time.Sleep(acknowledgementDelay)
		if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"session.updated"}`)); err != nil {
			serverErrors <- err
			return
		}
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}))
	defer server.Close()

	provider, err := NewOpenAITranscriptionProvider(context.Background(), OpenAITranscriptionConfig{APIKey: "test-key"})
	if err != nil {
		t.Fatalf("new provider: %v", err)
	}
	websocketURL := "ws" + strings.TrimPrefix(server.URL, "http")
	provider.dial = func(ctx context.Context, _ string, headers http.Header) (*websocket.Conn, *http.Response, error) {
		return (&websocket.Dialer{}).DialContext(ctx, websocketURL, headers)
	}

	startedAt := time.Now()
	if err := provider.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if elapsed := time.Since(startedAt); elapsed < acknowledgementDelay {
		t.Fatalf("Start() returned after %v, before session.updated at %v", elapsed, acknowledgementDelay)
	}
	if err := provider.Stop(); err != nil {
		t.Fatalf("Stop() error = %v", err)
	}
	select {
	case err := <-serverErrors:
		t.Fatalf("test WebSocket server: %v", err)
	default:
	}
}

func TestOpenAITranscriptionCommitsContinuousSpeechAtHardLimit(t *testing.T) {
	commitAfterAppends := make(chan int, 1)
	allowCompleted := make(chan struct{})
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
		if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"session.updated"}`)); err != nil {
			return
		}

		appendCount := 0
		for {
			_, payload, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var event struct {
				Type string `json:"type"`
			}
			if json.Unmarshal(payload, &event) != nil {
				continue
			}
			switch event.Type {
			case "input_audio_buffer.append":
				appendCount++
			case "input_audio_buffer.commit":
				commitAfterAppends <- appendCount
				<-allowCompleted
				_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"conversation.item.input_audio_transcription.completed","item_id":"item-hard-limit","content_index":0,"transcript":"ข้อความสุดท้าย"}`))
				return
			}
		}
	}))
	defer server.Close()

	provider, err := NewOpenAITranscriptionProvider(context.Background(), OpenAITranscriptionConfig{APIKey: "test-key"})
	if err != nil {
		t.Fatalf("new provider: %v", err)
	}
	websocketURL := "ws" + strings.TrimPrefix(server.URL, "http")
	provider.dial = func(ctx context.Context, _ string, headers http.Header) (*websocket.Conn, *http.Response, error) {
		return (&websocket.Dialer{}).DialContext(ctx, websocketURL, headers)
	}
	if err := provider.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	defer provider.Stop()

	batch := pcm16Batch(4000, 100*time.Millisecond, 24000)
	for range 300 {
		if err := provider.SendAudio(batch); err != nil {
			t.Fatalf("SendAudio() error = %v", err)
		}
	}

	select {
	case appendCount := <-commitAfterAppends:
		if appendCount != 300 {
			t.Fatalf("commit followed %d appends, want 300", appendCount)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for 30-second audio commit")
	}
	select {
	case result := <-provider.Results():
		t.Fatalf("provider published a local result before completed event: %#v", result)
	case <-time.After(25 * time.Millisecond):
	}

	close(allowCompleted)
	result := receiveOpenAITranscriptionResult(t, provider.Results())
	if !result.IsFinal || result.Text != "ข้อความสุดท้าย" || result.TurnID != "gpt-realtime-whisper:item-hard-limit:0" {
		t.Fatalf("completed result = %#v", result)
	}
}

func TestOpenAITranscriptionReconnectsAndReplaysRecentAudio(t *testing.T) {
	var connectionCount atomic.Int32
	secondAudio := make(chan []byte, 1)
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		connection := connectionCount.Add(1)
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
		if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"session.updated"}`)); err != nil {
			return
		}
		for {
			_, payload, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var event struct {
				Type  string `json:"type"`
				Audio string `json:"audio"`
			}
			if json.Unmarshal(payload, &event) != nil || event.Type != "input_audio_buffer.append" {
				continue
			}
			audio, err := base64.StdEncoding.DecodeString(event.Audio)
			if err != nil {
				return
			}
			if connection == 1 {
				return
			}
			select {
			case secondAudio <- audio:
			default:
			}
		}
	}))
	defer server.Close()

	provider, err := NewOpenAITranscriptionProvider(context.Background(), OpenAITranscriptionConfig{APIKey: "test-key"})
	if err != nil {
		t.Fatalf("new provider: %v", err)
	}
	websocketURL := "ws" + strings.TrimPrefix(server.URL, "http")
	provider.dial = func(ctx context.Context, _ string, headers http.Header) (*websocket.Conn, *http.Response, error) {
		return (&websocket.Dialer{}).DialContext(ctx, websocketURL, headers)
	}
	provider.reconnectDelay = func(int) time.Duration { return 0 }

	if err := provider.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	provider.transcriptMu.Lock()
	provider.transcriptItems["stale-item:0"] = "stale Draft"
	provider.transcriptItemOrder = append(provider.transcriptItemOrder, "stale-item:0")
	provider.transcriptMu.Unlock()
	audio := pcm16Batch(4000, 40*time.Millisecond, 24000)
	if err := provider.SendAudio(audio); err != nil {
		t.Fatalf("SendAudio() error = %v", err)
	}

	select {
	case replayed := <-secondAudio:
		if string(replayed) != string(audio) {
			t.Fatalf("replayed audio bytes = %d, want %d matching bytes", len(replayed), len(audio))
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for reconnect and replay; connections=%d", connectionCount.Load())
	}
	provider.transcriptMu.Lock()
	staleItemCount := len(provider.transcriptItems)
	provider.transcriptMu.Unlock()
	if staleItemCount != 0 {
		t.Fatalf("fresh session retained %d stale transcript items", staleItemCount)
	}
	select {
	case _, ok := <-provider.Results():
		if !ok {
			t.Fatal("results channel closed after a recoverable connection loss")
		}
	default:
	}
	if err := provider.Stop(); err != nil {
		t.Fatalf("Stop() error = %v", err)
	}
}

func TestOpenAITranscriptionStopDuringReconnectDoesNotExposeTransientError(t *testing.T) {
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
		if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"session.updated"}`)); err != nil {
			return
		}
		_, _, _ = conn.ReadMessage()
	}))
	defer server.Close()

	provider, err := NewOpenAITranscriptionProvider(context.Background(), OpenAITranscriptionConfig{APIKey: "test-key"})
	if err != nil {
		t.Fatalf("new provider: %v", err)
	}
	websocketURL := "ws" + strings.TrimPrefix(server.URL, "http")
	var dialCount atomic.Int32
	reconnectStarted := make(chan struct{})
	allowReconnect := make(chan struct{})
	provider.dial = func(ctx context.Context, _ string, headers http.Header) (*websocket.Conn, *http.Response, error) {
		if dialCount.Add(1) == 1 {
			return (&websocket.Dialer{}).DialContext(ctx, websocketURL, headers)
		}
		close(reconnectStarted)
		<-allowReconnect
		return nil, nil, errors.New("network unavailable")
	}
	provider.reconnectDelay = func(int) time.Duration { return 0 }

	if err := provider.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if err := provider.SendAudio(pcm16Batch(4000, 40*time.Millisecond, 24000)); err != nil {
		t.Fatalf("SendAudio() error = %v", err)
	}
	select {
	case <-reconnectStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for reconnect")
	}
	if err := provider.Stop(); err != nil {
		t.Fatalf("Stop() error = %v", err)
	}
	close(allowReconnect)
	if err := provider.Err(); err != nil {
		t.Fatalf("Err() = %v, want nil after normal Stop during reconnect", err)
	}
}

func TestOpenAITranscriptionStopDuringAPIErrorReconnectDoesNotExposeTransientError(t *testing.T) {
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
		if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"session.updated"}`)); err != nil {
			return
		}
		_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"error","error":{"message":"temporary upstream error"}}`))
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}))
	defer server.Close()

	provider, err := NewOpenAITranscriptionProvider(context.Background(), OpenAITranscriptionConfig{APIKey: "test-key"})
	if err != nil {
		t.Fatalf("new provider: %v", err)
	}
	websocketURL := "ws" + strings.TrimPrefix(server.URL, "http")
	var dialCount atomic.Int32
	reconnectStarted := make(chan struct{})
	allowReconnect := make(chan struct{})
	provider.dial = func(ctx context.Context, _ string, headers http.Header) (*websocket.Conn, *http.Response, error) {
		if dialCount.Add(1) == 1 {
			return (&websocket.Dialer{}).DialContext(ctx, websocketURL, headers)
		}
		close(reconnectStarted)
		<-allowReconnect
		return nil, nil, errors.New("network unavailable")
	}
	provider.reconnectDelay = func(int) time.Duration { return 0 }
	if err := provider.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	select {
	case <-reconnectStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for API-error reconnect")
	}
	if err := provider.Stop(); err != nil {
		t.Fatalf("Stop() error = %v", err)
	}
	close(allowReconnect)
	if err := provider.Err(); err != nil {
		t.Fatalf("Err() = %v, want nil after normal Stop during API-error reconnect", err)
	}
}

func TestOpenAITranscriptionParentCancellationDuringReconnectIsNormalTermination(t *testing.T) {
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
		if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"session.updated"}`)); err != nil {
			return
		}
		_, _, _ = conn.ReadMessage()
	}))
	defer server.Close()

	provider, err := NewOpenAITranscriptionProvider(context.Background(), OpenAITranscriptionConfig{APIKey: "test-key"})
	if err != nil {
		t.Fatalf("new provider: %v", err)
	}
	websocketURL := "ws" + strings.TrimPrefix(server.URL, "http")
	provider.dial = func(ctx context.Context, _ string, headers http.Header) (*websocket.Conn, *http.Response, error) {
		return (&websocket.Dialer{}).DialContext(ctx, websocketURL, headers)
	}
	reconnectWaiting := make(chan struct{})
	provider.reconnectDelay = func(int) time.Duration {
		select {
		case <-reconnectWaiting:
		default:
			close(reconnectWaiting)
		}
		return time.Hour
	}

	ctx, cancel := context.WithCancel(context.Background())
	if err := provider.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if err := provider.SendAudio(pcm16Batch(4000, 40*time.Millisecond, 24000)); err != nil {
		t.Fatalf("SendAudio() error = %v", err)
	}
	select {
	case <-reconnectWaiting:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for reconnect backoff")
	}
	cancel()
	select {
	case _, ok := <-provider.Results():
		if ok {
			t.Fatal("unexpected result after parent context cancellation")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("results remained open after parent context cancellation")
	}
	if err := provider.Err(); err != nil {
		t.Fatalf("Err() = %v, want nil after parent context cancellation", err)
	}
	if err := provider.Stop(); err != nil {
		t.Fatalf("Stop() error = %v", err)
	}
}

func TestOpenAITranscriptionReplaysAudioThatArrivesDuringHandoff(t *testing.T) {
	var connectionCount atomic.Int32
	secondSetup := make(chan struct{})
	allowSecondReady := make(chan struct{})
	secondAudio := make(chan []byte, 4)
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		connection := connectionCount.Add(1)
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
		if connection == 2 {
			close(secondSetup)
			<-allowSecondReady
		}
		if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"session.updated"}`)); err != nil {
			return
		}
		for {
			_, payload, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var event struct {
				Type  string `json:"type"`
				Audio string `json:"audio"`
			}
			if json.Unmarshal(payload, &event) != nil || event.Type != "input_audio_buffer.append" {
				continue
			}
			audio, err := base64.StdEncoding.DecodeString(event.Audio)
			if err != nil {
				return
			}
			if connection == 1 {
				return
			}
			secondAudio <- audio
		}
	}))
	defer server.Close()

	provider, err := NewOpenAITranscriptionProvider(context.Background(), OpenAITranscriptionConfig{APIKey: "test-key"})
	if err != nil {
		t.Fatalf("new provider: %v", err)
	}
	websocketURL := "ws" + strings.TrimPrefix(server.URL, "http")
	provider.dial = func(ctx context.Context, _ string, headers http.Header) (*websocket.Conn, *http.Response, error) {
		return (&websocket.Dialer{}).DialContext(ctx, websocketURL, headers)
	}
	provider.reconnectDelay = func(int) time.Duration { return 0 }
	if err := provider.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	t.Cleanup(func() { _ = provider.Stop() })

	initial := pcm16Batch(2000, 40*time.Millisecond, 24000)
	late := pcm16Batch(6000, 40*time.Millisecond, 24000)
	if err := provider.SendAudio(initial); err != nil {
		t.Fatalf("SendAudio(initial) error = %v", err)
	}
	select {
	case <-secondSetup:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for replacement connection")
	}

	provider.writeMu.Lock()
	close(allowSecondReady)
	time.Sleep(20 * time.Millisecond)
	if err := provider.SendAudio(late); err != nil {
		provider.writeMu.Unlock()
		t.Fatalf("SendAudio(late) error = %v", err)
	}
	provider.writeMu.Unlock()

	want := append(append([]byte(nil), initial...), late...)
	var replayed []byte
	deadline := time.After(500 * time.Millisecond)
	for len(replayed) < len(want) {
		select {
		case audio := <-secondAudio:
			replayed = append(replayed, audio...)
		case <-deadline:
			t.Fatalf("replayed audio bytes = %d, want %d including handoff audio", len(replayed), len(want))
		}
	}
	if string(replayed) != string(want) {
		t.Fatalf("replayed audio did not preserve initial and handoff order")
	}
}

func TestOpenAITranscriptionRestoresHandoffAudioAfterReplayFailure(t *testing.T) {
	serverDone := make(chan struct{})
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		<-serverDone
	}))
	defer server.Close()

	websocketURL := "ws" + strings.TrimPrefix(server.URL, "http")
	conn, _, err := (&websocket.Dialer{}).Dial(websocketURL, nil)
	if err != nil {
		t.Fatalf("dial test WebSocket: %v", err)
	}
	if err := conn.Close(); err != nil {
		t.Fatalf("close test WebSocket: %v", err)
	}
	close(serverDone)

	provider, err := NewOpenAITranscriptionProvider(context.Background(), OpenAITranscriptionConfig{APIKey: "test-key"})
	if err != nil {
		t.Fatalf("new provider: %v", err)
	}
	audio := pcm16Batch(4000, 40*time.Millisecond, 24000)
	provider.mu.Lock()
	provider.conn = conn
	provider.ctx = context.Background()
	provider.reconnecting = true
	provider.handoffBuf.Add(audio)
	provider.mu.Unlock()

	if _, err := provider.activateReconnectedSession(context.Background()); err == nil {
		t.Fatal("activateReconnectedSession() error = nil, want replay failure")
	}
	provider.mu.Lock()
	restored, _ := provider.handoffBuf.Drain()
	provider.mu.Unlock()
	if string(restored) != string(audio) {
		t.Fatalf("restored audio bytes = %d, want %d matching bytes", len(restored), len(audio))
	}
}

func TestOpenAITranscriptionClosesResultsAfterReconnectIsExhausted(t *testing.T) {
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
		if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"session.updated"}`)); err != nil {
			return
		}
		_, _, _ = conn.ReadMessage()
	}))
	defer server.Close()

	provider, err := NewOpenAITranscriptionProvider(context.Background(), OpenAITranscriptionConfig{APIKey: "test-key"})
	if err != nil {
		t.Fatalf("new provider: %v", err)
	}
	websocketURL := "ws" + strings.TrimPrefix(server.URL, "http")
	var dialCount atomic.Int32
	provider.dial = func(ctx context.Context, _ string, headers http.Header) (*websocket.Conn, *http.Response, error) {
		if dialCount.Add(1) > 1 {
			return nil, nil, errors.New("network unavailable")
		}
		return (&websocket.Dialer{}).DialContext(ctx, websocketURL, headers)
	}
	provider.reconnectDelay = func(int) time.Duration { return 0 }

	if err := provider.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if err := provider.SendAudio(pcm16Batch(4000, 40*time.Millisecond, 24000)); err != nil {
		t.Fatalf("SendAudio() error = %v", err)
	}
	select {
	case _, ok := <-provider.Results():
		if ok {
			t.Fatal("unexpected transcript result while waiting for terminal reconnect failure")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("results channel remained open after reconnect attempts were exhausted")
	}
	if provider.Err() == nil || !strings.Contains(provider.Err().Error(), "reconnect failed") {
		t.Fatalf("Err() = %v, want terminal reconnect error", provider.Err())
	}
	if got, want := dialCount.Load(), int32(openAITranscriptionMaxReconnect+1); got != want {
		t.Fatalf("dial attempts = %d, want %d", got, want)
	}
	if err := provider.Stop(); err != nil {
		t.Fatalf("Stop() error = %v", err)
	}
}

func TestOpenAITranscriptionEventParser(t *testing.T) {
	delta, err := parseOpenAITranscriptionEvent([]byte(`{"type":"conversation.item.input_audio_transcription.delta","item_id":"item-1","content_index":0,"delta":"สวัสดี"}`))
	if err != nil || delta.kind != openAIEventTranscriptDelta || delta.itemID != "item-1" || delta.contentIndex != 0 || delta.delta != "สวัสดี" {
		t.Fatalf("delta event = %#v, err=%v", delta, err)
	}
	completed, err := parseOpenAITranscriptionEvent([]byte(`{"type":"conversation.item.input_audio_transcription.completed","item_id":"item-1","content_index":0,"transcript":"สวัสดีครับ"}`))
	if err != nil || completed.kind != openAIEventTranscriptCompleted || completed.itemID != "item-1" || completed.contentIndex != 0 || completed.delta != "สวัสดีครับ" {
		t.Fatalf("completed event = %#v, err=%v", completed, err)
	}
}

func TestOpenAITranscriptionProviderPublishesSourceOnly(t *testing.T) {
	provider, err := NewOpenAITranscriptionProvider(context.Background(), OpenAITranscriptionConfig{APIKey: "test-key"})
	if err != nil {
		t.Fatalf("new provider: %v", err)
	}
	if !provider.handleEvent([]byte(`{"type":"conversation.item.input_audio_transcription.delta","item_id":"item-1","content_index":0,"delta":"สวัสดี"}`)) {
		t.Fatal("delta event unexpectedly stopped provider")
	}
	result := receiveOpenAITranscriptionResult(t, provider.Results())
	if result.Role != domain.TranscriptRoleSource || result.LanguageCode != "th" || result.Text != "สวัสดี" {
		t.Fatalf("result = %#v", result)
	}
	if result.TurnID != "gpt-realtime-whisper:item-1:0" {
		t.Fatalf("turn ID = %q", result.TurnID)
	}
}

func TestOpenAITranscriptionBoundsActiveTranscriptItems(t *testing.T) {
	provider := &openAITranscriptionProvider{
		cfg:             normalizeOpenAITranscriptionConfig(OpenAITranscriptionConfig{}),
		results:         make(chan domain.TranscriptResult, openAITranscriptionMaxActiveItems+1),
		transcriptItems: make(map[string]string),
	}
	for index := 0; index <= openAITranscriptionMaxActiveItems; index++ {
		itemID := fmt.Sprintf("item-%d", index)
		if !provider.appendTranscriptDelta(itemID, 0, itemID) {
			t.Fatalf("append item %d stopped provider", index)
		}
	}

	provider.transcriptMu.Lock()
	defer provider.transcriptMu.Unlock()
	if got := len(provider.transcriptItems); got != openAITranscriptionMaxActiveItems {
		t.Fatalf("active transcript items = %d, want %d", got, openAITranscriptionMaxActiveItems)
	}
	if _, exists := provider.transcriptItems["item-0:0"]; exists {
		t.Fatal("oldest active transcript item was not evicted")
	}
}

func TestOpenAITranscriptionProviderPairsOutOfOrderCompletedEventsByItemID(t *testing.T) {
	provider, err := NewOpenAITranscriptionProvider(context.Background(), OpenAITranscriptionConfig{APIKey: "test-key"})
	if err != nil {
		t.Fatalf("new provider: %v", err)
	}

	events := []string{
		`{"type":"conversation.item.input_audio_transcription.delta","item_id":"item-1","content_index":0,"delta":"หนึ่ง"}`,
		`{"type":"conversation.item.input_audio_transcription.delta","item_id":"item-2","content_index":0,"delta":"สอง"}`,
		`{"type":"conversation.item.input_audio_transcription.completed","item_id":"item-2","content_index":0,"transcript":"สองครับ"}`,
		`{"type":"conversation.item.input_audio_transcription.completed","item_id":"item-1","content_index":0,"transcript":"หนึ่งครับ"}`,
	}
	for _, event := range events {
		if !provider.handleEvent([]byte(event)) {
			t.Fatalf("event unexpectedly stopped provider: %s", event)
		}
	}

	results := make([]domain.TranscriptResult, 0, len(events))
	for range events {
		results = append(results, receiveOpenAITranscriptionResult(t, provider.Results()))
	}
	wants := []domain.TranscriptResult{
		{Text: "หนึ่ง", TurnID: "gpt-realtime-whisper:item-1:0"},
		{Text: "สอง", TurnID: "gpt-realtime-whisper:item-2:0"},
		{Text: "สองครับ", TurnID: "gpt-realtime-whisper:item-2:0", IsFinal: true},
		{Text: "หนึ่งครับ", TurnID: "gpt-realtime-whisper:item-1:0", IsFinal: true},
	}
	for i, want := range wants {
		if results[i].Text != want.Text || results[i].TurnID != want.TurnID || results[i].IsFinal != want.IsFinal {
			t.Fatalf("result[%d] = %#v, want text=%q turn=%q final=%t", i, results[i], want.Text, want.TurnID, want.IsFinal)
		}
	}
}

func TestOpenAITranscriptionDeltaMergePreservesStreamSpacing(t *testing.T) {
	merged := applyOpenAITranscriptionDelta("hello", " world")
	if merged != "hello world" {
		t.Fatalf("merged text = %q, want hello world", merged)
	}
	merged = applyOpenAITranscriptionDelta("สวัสดี", "ครับ")
	if merged != "สวัสดีครับ" {
		t.Fatalf("Thai merged text = %q, want สวัสดีครับ", merged)
	}
}

func TestOpenAITranscriptionDeltaMergeBoundsText(t *testing.T) {
	merged := applyOpenAITranscriptionDelta("", strings.Repeat("x", openAITranscriptionMaxTextBytes+100))
	if len([]byte(merged)) > openAITranscriptionMaxTextBytes {
		t.Fatalf("merged text bytes = %d, want <= %d", len([]byte(merged)), openAITranscriptionMaxTextBytes)
	}
}

func TestOpenAITranscriptionProviderWaitsForCompletedEventAfterSilence(t *testing.T) {
	provider, err := NewOpenAITranscriptionProvider(context.Background(), OpenAITranscriptionConfig{APIKey: "test-key"})
	if err != nil {
		t.Fatalf("new provider: %v", err)
	}
	provider.handleEvent([]byte(`{"type":"conversation.item.input_audio_transcription.delta","item_id":"item-1","content_index":0,"delta":"สวัสดี"}`))
	_ = receiveOpenAITranscriptionResult(t, provider.Results())

	provider.observeAudio(pcm16Batch(4000, 100*time.Millisecond, 24000))
	provider.observeAudio(pcm16Batch(0, 650*time.Millisecond, 24000))

	select {
	case unexpected := <-provider.Results():
		t.Fatalf("silence published a local final before completed event: %#v", unexpected)
	case <-time.After(25 * time.Millisecond):
	}

	provider.handleEvent([]byte(`{"type":"conversation.item.input_audio_transcription.completed","item_id":"item-1","content_index":0,"transcript":"สวัสดีครับ"}`))
	final := receiveOpenAITranscriptionResult(t, provider.Results())
	if !final.IsFinal || final.Role != domain.TranscriptRoleSource || final.LanguageCode != "th" || final.Text != "สวัสดีครับ" {
		t.Fatalf("final result = %#v", final)
	}
}

func TestOpenAITranscriptionProviderStopIsIdempotentAndClosesResults(t *testing.T) {
	provider, err := NewOpenAITranscriptionProvider(context.Background(), OpenAITranscriptionConfig{APIKey: "test-key"})
	if err != nil {
		t.Fatalf("new provider: %v", err)
	}
	if err := provider.Stop(); err != nil {
		t.Fatalf("first stop: %v", err)
	}
	if err := provider.Stop(); err != nil {
		t.Fatalf("second stop: %v", err)
	}
	if _, ok := <-provider.Results(); ok {
		t.Fatal("results channel remained open after stop")
	}
}

func receiveOpenAITranscriptionResult(t *testing.T, results <-chan domain.TranscriptResult) domain.TranscriptResult {
	t.Helper()
	select {
	case result := <-results:
		return result
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for OpenAI transcription result")
		return domain.TranscriptResult{}
	}
}
