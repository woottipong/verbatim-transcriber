package agent

import (
	"context"
	"errors"
	"testing"

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
