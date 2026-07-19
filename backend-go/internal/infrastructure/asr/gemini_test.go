package asr

import (
	"testing"
	"time"

	"thai-transcriber-backend/internal/domain"

	"google.golang.org/genai"
)

func TestGeminiProviderFinalizesPseudoTurnAfterSilenceAndGrace(t *testing.T) {
	provider := &GeminiProvider{cfg: normalizeGeminiConfig(GeminiConfig{})}
	startedAt := time.Unix(1000, 0)
	currentTime := startedAt
	provider.now = func() time.Time { return currentTime }
	provider.transcriptResults(&genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		InterimInputTranscription: &genai.Transcription{Text: "Ich bin Lukas.", LanguageCode: "de"},
		OutputTranscription:       &genai.Transcription{Text: "ฉันชื่อลูคัส", LanguageCode: "th"},
	}})
	provider.observeAudioForSegmentation(pcm16Batch(4000, 100*time.Millisecond, 16000), startedAt)

	currentTime = startedAt.Add(geminiTranslationGrace + geminiTurnSilence)
	finals := provider.observeAudioForSegmentation(
		pcm16Batch(0, 800*time.Millisecond, 16000),
		currentTime,
	)
	if len(finals) != 2 {
		t.Fatalf("finals = %#v, want source and translation", finals)
	}
	if !finals[0].IsFinal || finals[0].TurnID != "gemini-1" || finals[0].LanguageCode != "de" {
		t.Fatalf("final source = %#v", finals[0])
	}
	if !finals[1].IsFinal || finals[1].TurnID != "gemini-1" || finals[1].LanguageCode != "th" {
		t.Fatalf("final translation = %#v", finals[1])
	}

	next := provider.transcriptResults(&genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		InterimInputTranscription: &genai.Transcription{Text: "Hallo an alle.", LanguageCode: "de"},
	}})
	if len(next) != 1 || next[0].TurnID != "gemini-2" || next[0].Text != "Hallo an alle." {
		t.Fatalf("next results = %#v, want new pseudo-turn", next)
	}
}

func TestGeminiProviderCancelsPendingBoundaryOnStop(t *testing.T) {
	provider := &GeminiProvider{
		cfg:     normalizeGeminiConfig(GeminiConfig{}),
		results: make(chan domain.TranscriptResult, 1),
		done:    make(chan struct{}),
	}
	provider.boundaryTimer = time.AfterFunc(time.Hour, func() {})

	if err := provider.Stop(); err != nil {
		t.Fatalf("Stop() error = %v", err)
	}
	provider.transcriptMu.Lock()
	timer := provider.boundaryTimer
	provider.transcriptMu.Unlock()
	if timer != nil {
		t.Fatal("Stop() retained the pending boundary timer")
	}
}

func TestGeminiTranscriptResultsReturnsSourceAndTranslationForSameTurn(t *testing.T) {
	provider := &GeminiProvider{cfg: normalizeGeminiConfig(GeminiConfig{})}
	message := &genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		InputTranscription:  &genai.Transcription{Text: "emergency room", LanguageCode: "en"},
		OutputTranscription: &genai.Transcription{Text: "ห้องฉุกเฉิน", LanguageCode: "th"},
	}}

	results := provider.transcriptResults(message)
	if len(results) != 2 {
		t.Fatalf("transcriptResults() returned %d results, want 2", len(results))
	}
	if results[0].Role != domain.TranscriptRoleSource || results[0].LanguageCode != "en" || results[0].TurnID != "gemini-1" {
		t.Fatalf("source result = %#v", results[0])
	}
	if results[1].Role != domain.TranscriptRoleTranslation || results[1].Text != "ห้องฉุกเฉิน" || results[1].TurnID != "gemini-1" {
		t.Fatalf("translation result = %#v", results[1])
	}
}

func TestGeminiTranslationMetadataUsesConfiguredTargetLanguage(t *testing.T) {
	provider := &GeminiProvider{cfg: normalizeGeminiConfig(GeminiConfig{TargetLanguageCode: "en"})}
	message := &genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		OutputTranscription: &genai.Transcription{
			Text:         "Hello everyone",
			LanguageCode: "es",
		},
	}}

	results := provider.transcriptResults(message)
	if len(results) != 1 {
		t.Fatalf("transcriptResults() returned %d results, want 1", len(results))
	}
	if got, want := results[0].LanguageCode, "en"; got != want {
		t.Fatalf("translation language = %q, want configured target %q", got, want)
	}
}

func TestGeminiSourceMetadataDoesNotInventMissingDetectedLanguage(t *testing.T) {
	provider := &GeminiProvider{cfg: normalizeGeminiConfig(GeminiConfig{LanguageCode: "th"})}
	message := &genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		InputTranscription: &genai.Transcription{Text: "ทดสอบภาษา"},
	}}

	results := provider.transcriptResults(message)
	if len(results) != 1 {
		t.Fatalf("transcriptResults() returned %d results, want 1", len(results))
	}
	if got := results[0].LanguageCode; got != "" {
		t.Fatalf("source language = %q, want empty when Gemini omitted it", got)
	}
}

func TestGeminiTranscriptResultsMarksTurnCompleteAsFinal(t *testing.T) {
	provider := &GeminiProvider{cfg: normalizeGeminiConfig(GeminiConfig{})}
	message := &genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		InputTranscription: &genai.Transcription{Text: "ทดสอบหนึ่งสองสาม"},
		TurnComplete:       true,
	}}

	results := provider.transcriptResults(message)
	if len(results) != 1 || !results[0].IsFinal {
		t.Fatalf("results = %#v, want one final input transcript", results)
	}
	next := provider.transcriptResults(&genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		InputTranscription: &genai.Transcription{Text: "next"},
	}})
	if len(next) != 1 || next[0].TurnID != "gemini-2" {
		t.Fatalf("next results = %#v, want gemini-2", next)
	}
}

func TestGeminiTranscriptResultsMarksFinishedInputTranscriptAsFinal(t *testing.T) {
	provider := &GeminiProvider{cfg: normalizeGeminiConfig(GeminiConfig{})}
	message := &genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		InputTranscription: &genai.Transcription{Text: "ทดสอบจบประโยค", Finished: true},
	}}

	results := provider.transcriptResults(message)
	if len(results) != 1 || !results[0].IsFinal {
		t.Fatalf("results = %#v, want one final finished input transcript", results)
	}
}

func TestGeminiTranscriptResultsSupportsLowLatencyInterimTranscript(t *testing.T) {
	provider := &GeminiProvider{cfg: normalizeGeminiConfig(GeminiConfig{})}
	message := &genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		InterimInputTranscription: &genai.Transcription{Text: "กำลังพูด"},
	}}

	results := provider.transcriptResults(message)
	if len(results) != 1 || results[0].IsFinal || results[0].Text != "กำลังพูด" {
		t.Fatalf("results = %#v, want one interim input transcript", results)
	}
}

func TestGeminiTranscriptResultsAccumulatesSourceChunksForSameTurn(t *testing.T) {
	provider := &GeminiProvider{cfg: normalizeGeminiConfig(GeminiConfig{})}

	first := provider.transcriptResults(&genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		InterimInputTranscription: &genai.Transcription{Text: "useful. Very useful."},
	}})
	second := provider.transcriptResults(&genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		InterimInputTranscription: &genai.Transcription{Text: "Because off"},
	}})

	if len(first) != 1 || first[0].Text != "useful. Very useful." {
		t.Fatalf("first results = %#v", first)
	}
	if len(second) != 1 || second[0].Text != "useful. Very useful. Because off" {
		t.Fatalf("second results = %#v, want accumulated source transcript", second)
	}
	if first[0].TurnID != second[0].TurnID {
		t.Fatalf("turn IDs = %q and %q, want same turn", first[0].TurnID, second[0].TurnID)
	}
}

func TestGeminiTranscriptResultsAccumulatesTranslationChunks(t *testing.T) {
	provider := &GeminiProvider{cfg: normalizeGeminiConfig(GeminiConfig{})}

	first := provider.transcriptResults(&genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		OutputTranscription: &genai.Transcription{Text: "ห้อง"},
	}})
	second := provider.transcriptResults(&genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		OutputTranscription: &genai.Transcription{Text: "ห้องฉุกเฉิน"},
	}})
	third := provider.transcriptResults(&genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		OutputTranscription: &genai.Transcription{Text: "ครับ"},
	}})

	if first[0].Text != "ห้อง" || second[0].Text != "ห้องฉุกเฉิน" || third[0].Text != "ห้องฉุกเฉินครับ" {
		t.Fatalf("translations = %q, %q, %q", first[0].Text, second[0].Text, third[0].Text)
	}
}

func TestGeminiTranscriptResultsFinalizesStoredTranslationOnCompletion(t *testing.T) {
	provider := &GeminiProvider{cfg: normalizeGeminiConfig(GeminiConfig{})}
	provider.transcriptResults(&genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		OutputTranscription: &genai.Transcription{Text: "ห้องฉุกเฉิน"},
	}})

	results := provider.transcriptResults(&genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{TurnComplete: true}})
	if len(results) != 1 || !results[0].IsFinal || results[0].Text != "ห้องฉุกเฉิน" {
		t.Fatalf("results = %#v, want stored final translation", results)
	}
}

func TestGeminiTranscriptResultsFinalizesStoredTranslationOnGenerationComplete(t *testing.T) {
	provider := &GeminiProvider{cfg: normalizeGeminiConfig(GeminiConfig{})}
	provider.transcriptResults(&genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		OutputTranscription: &genai.Transcription{Text: "ห้องฉุกเฉิน"},
	}})

	results := provider.transcriptResults(&genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{GenerationComplete: true}})
	if len(results) != 1 || !results[0].IsFinal || results[0].Text != "ห้องฉุกเฉิน" {
		t.Fatalf("results = %#v, want generation-complete translation", results)
	}
}

func TestGeminiConfigDefaultsToThaiTranslation(t *testing.T) {
	cfg := normalizeGeminiConfig(GeminiConfig{APIKey: "test-key"})

	if got, want := cfg.Model, "gemini-3.5-live-translate-preview"; got != want {
		t.Fatalf("model = %q, want %q", got, want)
	}
	if got, want := cfg.LanguageCode, ""; got != want {
		t.Fatalf("language = %q, want %q", got, want)
	}
	if got, want := cfg.TargetLanguageCode, "th"; got != want {
		t.Fatalf("target language = %q, want %q", got, want)
	}
	if got, want := cfg.SampleRate, 16000; got != want {
		t.Fatalf("sample rate = %d, want %d", got, want)
	}
}

func TestGeminiConfigCanonicalizesSupportedTargetLanguage(t *testing.T) {
	cfg := normalizeGeminiConfig(GeminiConfig{TargetLanguageCode: " PT_br "})
	if got, want := cfg.TargetLanguageCode, "pt-BR"; got != want {
		t.Fatalf("target language = %q, want %q", got, want)
	}
}

func TestNewGeminiProviderRejectsUnsupportedTargetLanguage(t *testing.T) {
	_, err := NewGeminiProvider(t.Context(), GeminiConfig{
		APIKey:             "test-key",
		TargetLanguageCode: "xx-unknown",
	})
	if err == nil {
		t.Fatal("NewGeminiProvider() accepted an unsupported target language")
	}
}

func TestGeminiInputTranscriptionConfigOmitsEmptyLanguageHint(t *testing.T) {
	if cfg := geminiInputTranscriptionConfig(""); cfg.LanguageHints != nil {
		t.Fatalf("language hints = %#v, want nil", cfg.LanguageHints)
	}
	if cfg := geminiInputTranscriptionConfig("en"); cfg.LanguageHints == nil || len(cfg.LanguageHints.LanguageCodes) != 1 || cfg.LanguageHints.LanguageCodes[0] != "en" {
		t.Fatalf("language hints = %#v, want en", cfg.LanguageHints)
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
