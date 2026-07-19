package agent

import (
	"context"
	"errors"
	"testing"
	"time"

	"thai-transcriber-backend/internal/domain"
)

type lifecycleProvider struct {
	startErr  error
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
func (p *lifecycleProvider) Err() error      { return nil }
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

func TestTranscriptDeliveryIsReliableForInterimAndFinal(t *testing.T) {
	if !transcriptDeliveryReliable(false) {
		t.Fatal("interim transcript should use reliable delivery")
	}
	if !transcriptDeliveryReliable(true) {
		t.Fatal("final transcript should use reliable delivery")
	}
}
