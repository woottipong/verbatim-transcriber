package asr

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
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
	provider.observeAudio(pcm16Batch(0, 800*time.Millisecond, 24000))

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
