package asr

import (
	"testing"

	"thai-transcriber-backend/internal/domain"

	"google.golang.org/genai"
)

func TestGeminiTranscriptResultsReturnsOnlyInputTranscript(t *testing.T) {
	message := &genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		InputTranscription:  &genai.Transcription{Text: "สวัสดีครับ"},
		OutputTranscription: &genai.Transcription{Text: "Hello"},
	}}

	results := geminiTranscriptResults(message)
	if len(results) != 1 {
		t.Fatalf("geminiTranscriptResults() returned %d results, want 1", len(results))
	}
	if got, want := results[0].Text, "สวัสดีครับ"; got != want {
		t.Fatalf("result text = %q, want %q", got, want)
	}
	if results[0].IsFinal {
		t.Fatal("input transcript without turnComplete must remain interim")
	}
}

func TestGeminiTranscriptResultsMarksTurnCompleteAsFinal(t *testing.T) {
	message := &genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		InputTranscription: &genai.Transcription{Text: "ทดสอบหนึ่งสองสาม"},
		TurnComplete:       true,
	}}

	results := geminiTranscriptResults(message)
	if len(results) != 1 || !results[0].IsFinal {
		t.Fatalf("results = %#v, want one final input transcript", results)
	}
}

func TestGeminiTranscriptResultsMarksFinishedInputTranscriptAsFinal(t *testing.T) {
	message := &genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		InputTranscription: &genai.Transcription{Text: "ทดสอบจบประโยค", Finished: true},
	}}

	results := geminiTranscriptResults(message)
	if len(results) != 1 || !results[0].IsFinal {
		t.Fatalf("results = %#v, want one final finished input transcript", results)
	}
}

func TestGeminiTranscriptResultsSupportsLowLatencyInterimTranscript(t *testing.T) {
	message := &genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		InterimInputTranscription: &genai.Transcription{Text: "กำลังพูด"},
	}}

	results := geminiTranscriptResults(message)
	if len(results) != 1 || results[0].IsFinal || results[0].Text != "กำลังพูด" {
		t.Fatalf("results = %#v, want one interim input transcript", results)
	}
}

func TestGeminiConfigDefaultsToThaiTextTranscription(t *testing.T) {
	cfg := normalizeGeminiConfig(GeminiConfig{APIKey: "test-key"})

	if got, want := cfg.Model, "gemini-3.5-live-translate-preview"; got != want {
		t.Fatalf("model = %q, want %q", got, want)
	}
	if got, want := cfg.LanguageCode, "th"; got != want {
		t.Fatalf("language = %q, want %q", got, want)
	}
	if got, want := cfg.TargetLanguageCode, "en"; got != want {
		t.Fatalf("target language = %q, want %q", got, want)
	}
	if got, want := cfg.SampleRate, 16000; got != want {
		t.Fatalf("sample rate = %d, want %d", got, want)
	}
}

func TestGeminiProviderDoesNotEmitWhenStopped(t *testing.T) {
	provider := &GeminiProvider{results: make(chan domain.TranscriptResult, 1)}
	if err := provider.Stop(); err != nil {
		t.Fatalf("Stop() error = %v", err)
	}
	if err := provider.SendAudio([]byte{1, 2}); err == nil {
		t.Fatal("SendAudio() after Stop() returned nil")
	}
}
