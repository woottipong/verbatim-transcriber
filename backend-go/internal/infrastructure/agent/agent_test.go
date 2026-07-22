package agent

import (
	"context"
	"encoding/binary"
	"errors"
	"strings"
	"testing"
	"time"

	"thai-transcriber-backend/internal/domain"
)

type lifecycleProvider struct {
	startErr  error
	err       error
	stopCalls int
	results   chan domain.TranscriptResult
}

func (p *lifecycleProvider) Start(context.Context) error             { return p.startErr }
func (p *lifecycleProvider) SendAudio([]byte) error                  { return nil }
func (p *lifecycleProvider) Results() <-chan domain.TranscriptResult { return p.results }
func (p *lifecycleProvider) Stop() error {
	p.stopCalls++
	return nil
}
func (p *lifecycleProvider) Err() error      { return p.err }
func (p *lifecycleProvider) SampleRate() int { return 48000 }
func (p *lifecycleProvider) Name() string    { return "test" }

func TestStartProviderReturnsCleanupThatStopsProvider(t *testing.T) {
	provider := &lifecycleProvider{results: make(chan domain.TranscriptResult)}

	cleanup, err := startProvider(context.Background(), provider)
	if err != nil {
		t.Fatalf("startProvider() error = %v", err)
	}
	cleanup()

	if provider.stopCalls != 1 {
		t.Fatalf("Stop() calls = %d, want 1", provider.stopCalls)
	}
}

func TestStartProviderCleansUpAfterStartFailure(t *testing.T) {
	provider := &lifecycleProvider{
		startErr: errors.New("start failed"),
		results:  make(chan domain.TranscriptResult),
	}

	if _, err := startProvider(context.Background(), provider); err == nil {
		t.Fatal("startProvider() error = nil, want start failure")
	}
	if provider.stopCalls != 1 {
		t.Fatalf("Stop() calls = %d, want 1", provider.stopCalls)
	}
}

func TestHandleTranscriptionResultsStopsRunningAgentWhenProviderFails(t *testing.T) {
	results := make(chan domain.TranscriptResult)
	close(results)
	provider := &lifecycleProvider{
		err:     errors.New("realtime connection lost"),
		results: results,
	}
	cancelled := make(chan struct{})
	agent := &Agent{
		isRunning:   true,
		asrProvider: provider,
		cancel:      func() { close(cancelled) },
	}

	agent.handleTranscriptionResults(provider, nil)

	if agent.IsRunning() {
		t.Fatal("agent remained running after provider results closed with an error")
	}
	select {
	case <-cancelled:
	default:
		t.Fatal("agent context was not cancelled after provider failure")
	}
	if provider.stopCalls != 1 {
		t.Fatalf("provider Stop() calls = %d, want 1", provider.stopCalls)
	}
}

func TestNewTranscriptMessageNormalizesThaiSpacing(t *testing.T) {
	message := newTranscriptMessage(
		domain.TranscriptResult{Text: "ทด สอบ ถอด ความ 1 2 3 4", IsFinal: true},
		"google",
		"speaker-1",
	)

	if got, want := message.Text, "ทดสอบถอดความ 1 2 3 4"; got != want {
		t.Fatalf("message text = %q, want %q", got, want)
	}
}

func TestNewInterimTranscriptMessageKeepsNormalizedThaiText(t *testing.T) {
	message := newTranscriptMessage(
		domain.TranscriptResult{Text: "กำ ลัง ทด สอบ", IsFinal: false},
		"google",
		"speaker-1",
	)

	if message.IsFinal {
		t.Fatal("interim message was marked final")
	}
	if got, want := message.Text, "กำลังทดสอบ"; got != want {
		t.Fatalf("interim message text = %q, want %q", got, want)
	}
}

func TestNewTranscriptMessagePreservesTranslationMetadata(t *testing.T) {
	message := newTranscriptMessage(
		domain.TranscriptResult{
			Text:         "ห้อง ฉุกเฉิน",
			Role:         domain.TranscriptRoleTranslation,
			LanguageCode: "th",
			TurnID:       "gemini-1",
		},
		"gemini",
		"speaker-1",
	)

	if message.Role != domain.TranscriptRoleTranslation || message.LanguageCode != "th" || message.TurnID != "gemini-1" {
		t.Fatalf("translation metadata = role:%q language:%q turn:%q", message.Role, message.LanguageCode, message.TurnID)
	}
	if got, want := message.Text, "ห้องฉุกเฉิน"; got != want {
		t.Fatalf("message text = %q, want %q", got, want)
	}
}

func TestAudioBatchTargetBytesUsesLowLatencyWindow(t *testing.T) {
	if got, want := audioBatchTargetBytes(48000, 40*time.Millisecond), 3840; got != want {
		t.Fatalf("audioBatchTargetBytes() = %d, want %d", got, want)
	}
	if got, want := audioBatchTargetBytes(16000, 40*time.Millisecond), 1280; got != want {
		t.Fatalf("audioBatchTargetBytes() = %d, want %d", got, want)
	}
}

func TestResamplePCM16SupportsProviderRates(t *testing.T) {
	samples := make([]int16, 480)
	if got, want := len(resamplePCM16(samples, 48000, 24000)), 240*2; got != want {
		t.Fatalf("48 kHz to 24 kHz bytes = %d, want %d", got, want)
	}
	if got, want := len(resamplePCM16(samples, 48000, 16000)), 160*2; got != want {
		t.Fatalf("48 kHz to 16 kHz bytes = %d, want %d", got, want)
	}
	if got, want := len(resamplePCM16(samples, 48000, 48000)), 480*2; got != want {
		t.Fatalf("48 kHz passthrough bytes = %d, want %d", got, want)
	}
}

func TestResamplePCM16FiltersFrequenciesAboveTargetNyquist(t *testing.T) {
	samples := make([]int16, 480)
	for i := range samples {
		if i%2 == 0 {
			samples[i] = 12000
		} else {
			samples[i] = -12000
		}
	}

	resampled := resamplePCM16(samples, 48000, 24000)
	for offset := 0; offset+1 < len(resampled); offset += 2 {
		if sample := int16(binary.LittleEndian.Uint16(resampled[offset:])); sample != 0 {
			t.Fatalf("aliased output sample = %d, want 0 after low-pass averaging", sample)
		}
	}
}

func TestTranscriptDeliveryIsReliableForInterimAndFinal(t *testing.T) {
	if !transcriptDeliveryReliable(false) {
		t.Fatal("interim transcript should use reliable delivery")
	}
	if !transcriptDeliveryReliable(true) {
		t.Fatal("final transcript should use reliable delivery")
	}
}

func TestFormatTranscriptLog(t *testing.T) {
	longText := strings.Repeat("a", 170)
	tests := []struct {
		name    string
		message TranscriptMessage
		want    string
	}{
		{
			name: "interim logs metadata and text",
			message: TranscriptMessage{
				Text: "growing interim text", Provider: "gemini", Speaker: "user-1",
				Role: domain.TranscriptRoleSource, LanguageCode: "th", TurnID: "gemini-12",
			},
			want: "🟡 [Transcript] state=interim provider=gemini role=source turn=gemini-12 lang=th speaker=user-1 chars=20 text=\"growing interim text\"",
		},
		{
			name: "final logs paired translation metadata and text",
			message: TranscriptMessage{
				Text: "hello", IsFinal: true, Provider: "gemini", Speaker: "user-1",
				Role: domain.TranscriptRoleTranslation, LanguageCode: "en", TurnID: "gemini-12",
			},
			want: "🟢 [Transcript] state=final provider=gemini role=translation turn=gemini-12 lang=en speaker=user-1 chars=5 text=\"hello\"",
		},
		{
			name: "missing optional metadata uses visible placeholders",
			message: TranscriptMessage{
				Text: "done", IsFinal: true, Provider: "google", Speaker: "user-2",
				Role: domain.TranscriptRoleSource,
			},
			want: "🟢 [Transcript] state=final provider=google role=source turn=- lang=- speaker=user-2 chars=4 text=\"done\"",
		},
		{
			name: "long final text is truncated",
			message: TranscriptMessage{
				Text: longText, IsFinal: true, Provider: "gemini", Speaker: "user-1",
				Role: domain.TranscriptRoleSource, LanguageCode: "en", TurnID: "gemini-13",
			},
			want: "🟢 [Transcript] state=final provider=gemini role=source turn=gemini-13 lang=en speaker=user-1 chars=170 text=\"" + strings.Repeat("a", 160) + "…\"",
		},
		{
			name: "metadata control characters stay on one log line",
			message: TranscriptMessage{
				Text: "done", IsFinal: true, Provider: "gemini\nforged=true", Speaker: "user-1\tadmin=true",
				Role: domain.TranscriptRoleSource, LanguageCode: "th\rEN", TurnID: "gemini-1\nstate=final",
			},
			want: "🟢 [Transcript] state=final provider=gemini\\nforged=true role=source turn=gemini-1\\nstate=final lang=th\\rEN speaker=user-1\\tadmin=true chars=4 text=\"done\"",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := formatTranscriptLog(tt.message); got != tt.want {
				t.Fatalf("formatTranscriptLog() = %q, want %q", got, tt.want)
			}
		})
	}
}
