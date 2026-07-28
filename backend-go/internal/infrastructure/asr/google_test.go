package asr

import (
	"errors"
	"testing"
	"time"

	"thai-transcriber-backend/internal/domain"
)

func TestBuildV2StreamingConfigRequest(t *testing.T) {
	request := buildV2StreamingConfigRequest(GoogleConfig{
		ProjectID:             "thai-transcriber",
		Location:              "asia-southeast1",
		Model:                 "chirp_3",
		SampleRate:            48000,
		LanguageCode:          "th-TH",
		EnableAutoPunctuation: true,
	})

	if got, want := request.GetRecognizer(), "projects/thai-transcriber/locations/asia-southeast1/recognizers/_"; got != want {
		t.Fatalf("recognizer = %q, want %q", got, want)
	}

	config := request.GetStreamingConfig()
	if config == nil {
		t.Fatal("streaming config is nil")
	}
	if got, want := config.GetConfig().GetModel(), "chirp_3"; got != want {
		t.Fatalf("model = %q, want %q", got, want)
	}
	if got, want := config.GetConfig().GetLanguageCodes(), []string{"th-TH"}; len(got) != len(want) || got[0] != want[0] {
		t.Fatalf("language codes = %v, want %v", got, want)
	}
	if got, want := config.GetConfig().GetExplicitDecodingConfig().GetSampleRateHertz(), int32(48000); got != want {
		t.Fatalf("sample rate = %d, want %d", got, want)
	}
	if !config.GetStreamingFeatures().GetInterimResults() {
		t.Fatal("interim results are disabled")
	}
}

func TestBuildV2StreamingConfigRequestDefaultsToChirp2(t *testing.T) {
	request := buildV2StreamingConfigRequest(GoogleConfig{
		ProjectID:    "thai-transcriber",
		Location:     "asia-southeast1",
		SampleRate:   48000,
		LanguageCode: "th-TH",
	})

	if got, want := request.GetStreamingConfig().GetConfig().GetModel(), "chirp_2"; got != want {
		t.Fatalf("model = %q, want %q", got, want)
	}
}

func TestAudioChunksStayWithinV2Limit(t *testing.T) {
	audio := make([]byte, maxV2AudioRequestBytes+1)
	chunks := audioChunks(audio)

	if got, want := len(chunks), 2; got != want {
		t.Fatalf("chunk count = %d, want %d", got, want)
	}
	if got, want := len(chunks[0]), maxV2AudioRequestBytes; got != want {
		t.Fatalf("first chunk length = %d, want %d", got, want)
	}
	if got, want := len(chunks[1]), 1; got != want {
		t.Fatalf("second chunk length = %d, want %d", got, want)
	}
}

func TestGoogleProviderDoesNotEmitWhenStopped(t *testing.T) {
	provider := &GoogleProvider{
		results: make(chan domain.TranscriptResult, 1),
		stopped: true,
	}

	if provider.emitResult(domain.TranscriptResult{Text: "late result"}) {
		t.Fatal("emitResult() emitted after provider stopped")
	}
}

func TestGoogleProviderKeepsSegmentAcrossInterimsAndAdvancesAfterFinal(t *testing.T) {
	provider := &GoogleProvider{segmentSequence: 1}

	if got, want := provider.segmentIDForResult(false, 0), "google-1"; got != want {
		t.Fatalf("first interim segment = %q, want %q", got, want)
	}
	if got, want := provider.segmentIDForResult(false, 0), "google-1"; got != want {
		t.Fatalf("revised interim segment = %q, want %q", got, want)
	}
	if got, want := provider.segmentIDForResult(true, 0), "google-1"; got != want {
		t.Fatalf("final segment = %q, want %q", got, want)
	}
	if got, want := provider.segmentIDForResult(false, 0), "google-2"; got != want {
		t.Fatalf("next interim segment = %q, want %q", got, want)
	}
}

func TestGoogleProviderAssignsDistinctIDsToConsecutiveInterims(t *testing.T) {
	provider := &GoogleProvider{segmentSequence: 1}

	if got, want := provider.segmentIDForResult(false, 0), "google-1"; got != want {
		t.Fatalf("first interim segment = %q, want %q", got, want)
	}
	if got, want := provider.segmentIDForResult(false, 1), "google-2"; got != want {
		t.Fatalf("second interim segment = %q, want %q", got, want)
	}

	// A later response revises the same two unfinalized portions.
	if got, want := provider.segmentIDForResult(false, 0), "google-1"; got != want {
		t.Fatalf("revised first interim segment = %q, want %q", got, want)
	}
	if got, want := provider.segmentIDForResult(false, 1), "google-2"; got != want {
		t.Fatalf("revised second interim segment = %q, want %q", got, want)
	}
}

func TestGoogleProviderAdvancesPastFinalsBeforeInterims(t *testing.T) {
	provider := &GoogleProvider{segmentSequence: 1}

	if got, want := provider.segmentIDForResult(true, 0), "google-1"; got != want {
		t.Fatalf("first final segment = %q, want %q", got, want)
	}
	if got, want := provider.segmentIDForResult(true, 0), "google-2"; got != want {
		t.Fatalf("second final segment = %q, want %q", got, want)
	}
	if got, want := provider.segmentIDForResult(false, 0), "google-3"; got != want {
		t.Fatalf("first remaining interim segment = %q, want %q", got, want)
	}
	if got, want := provider.segmentIDForResult(false, 1), "google-4"; got != want {
		t.Fatalf("second remaining interim segment = %q, want %q", got, want)
	}
}

func TestGoogleProviderStopClosesResultsBeforeStart(t *testing.T) {
	provider := &GoogleProvider{results: make(chan domain.TranscriptResult)}

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

func TestGoogleProviderTerminalErrorClosesResults(t *testing.T) {
	wantErr := errors.New("stream failed")
	provider := &GoogleProvider{
		results:   make(chan domain.TranscriptResult),
		isRunning: true,
	}

	provider.finishWithError(wantErr)

	if !errors.Is(provider.Err(), wantErr) {
		t.Fatalf("Err() = %v, want %v", provider.Err(), wantErr)
	}
	select {
	case _, ok := <-provider.Results():
		if ok {
			t.Fatal("results channel remained open after terminal error")
		}
	case <-time.After(10 * time.Millisecond):
		t.Fatal("results channel remained open after terminal error")
	}
}
