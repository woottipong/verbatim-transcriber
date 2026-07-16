package asr

import (
	"testing"
	"time"

	"thai-transcriber-backend/internal/domain"
)

func TestAzureProviderDoesNotEmitWhenStopped(t *testing.T) {
	provider := &AzureProvider{results: make(chan domain.TranscriptResult, 1)}

	if provider.emitResult(domain.TranscriptResult{Text: "late result"}) {
		t.Fatal("emitResult() emitted after provider stopped")
	}
}

func TestAzureProviderStopClosesResultsBeforeStart(t *testing.T) {
	provider := &AzureProvider{results: make(chan domain.TranscriptResult)}

	if err := provider.Stop(); err != nil {
		t.Fatalf("Stop() error = %v", err)
	}
	select {
	case _, ok := <-provider.Results():
		if ok {
			t.Fatal("results channel remained open after Stop()")
		}
	case <-time.After(10 * time.Millisecond):
		t.Fatal("results channel remained open after Stop()")
	}
}

func TestAzureTimestampUsesISO8601(t *testing.T) {
	provider := &AzureProvider{}
	const layout = "2006-01-02T15:04:05.000Z"

	if _, err := time.Parse(layout, provider.getTimestamp()); err != nil {
		t.Fatalf("getTimestamp() is not ISO-8601: %v", err)
	}
}
