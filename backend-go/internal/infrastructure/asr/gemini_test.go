package asr

import (
	"slices"
	"testing"
	"time"

	"thai-transcriber-backend/internal/domain"

	"google.golang.org/genai"
)

func interimInput(text string) *genai.LiveServerMessage {
	return &genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		InterimInputTranscription: &genai.Transcription{Text: text},
	}}
}

func sourceTexts(results []domain.TranscriptResult) []string {
	texts := make([]string, 0, len(results))
	for _, result := range results {
		if result.Role == domain.TranscriptRoleSource {
			texts = append(texts, result.Text)
		}
	}
	return texts
}

func TestGeminiForcedBoundaryDoesNotRepeatSource(t *testing.T) {
	tests := []struct {
		name       string
		continuing string
	}{
		{name: "cumulative", continuing: "first sentence. second sentence"},
		{name: "incremental", continuing: "second sentence"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			now := time.Unix(300, 0)
			provider := &GeminiProvider{
				cfg:       normalizeGeminiConfig(GeminiConfig{}),
				segmenter: newGeminiSegmenter(16000),
				now:       func() time.Time { return now },
			}
			provider.transcriptResults(interimInput("first sentence."))
			provider.transcriptMu.Lock()
			provider.requestBoundaryLocked(now, geminiBoundaryPunctuation)
			provider.transcriptMu.Unlock()
			provider.transcriptResults(interimInput(tt.continuing))

			now = now.Add(geminiTranslationGrace)
			provider.transcriptMu.Lock()
			results := provider.completePendingBoundaryLocked()
			provider.transcriptMu.Unlock()

			if got := sourceTexts(results); !slices.Equal(got, []string{"first sentence.", "second sentence"}) {
				t.Fatalf("source results = %q", got)
			}
			if !results[0].IsFinal || results[0].TurnID != "gemini-1" {
				t.Fatalf("old source = %#v, want final gemini-1", results[0])
			}
			if results[1].IsFinal || results[1].TurnID != "gemini-2" {
				t.Fatalf("buffered source = %#v, want interim gemini-2", results[1])
			}
		})
	}
}

func TestGeminiTranslationGraceKeepsTranslationWithOldTurn(t *testing.T) {
	now := time.Unix(600, 0)
	provider := &GeminiProvider{
		cfg:       normalizeGeminiConfig(GeminiConfig{}),
		segmenter: newGeminiSegmenter(16000),
		now:       func() time.Time { return now },
	}
	provider.transcriptResults(&genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		InterimInputTranscription: &genai.Transcription{Text: "first."},
		OutputTranscription:       &genai.Transcription{Text: "แรก"},
	}})
	provider.transcriptMu.Lock()
	provider.requestBoundaryLocked(now, geminiBoundaryPunctuation)
	provider.transcriptMu.Unlock()
	provider.transcriptResults(&genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		InterimInputTranscription: &genai.Transcription{Text: "first. second"},
		OutputTranscription:       &genai.Transcription{Text: "แรก ต่อ"},
	}})

	now = now.Add(geminiTranslationGrace)
	provider.transcriptMu.Lock()
	results := provider.completePendingBoundaryLocked()
	provider.transcriptMu.Unlock()

	var oldTranslation domain.TranscriptResult
	for _, result := range results {
		if result.Role == domain.TranscriptRoleTranslation && result.TurnID == "gemini-1" {
			oldTranslation = result
		}
	}
	if !oldTranslation.IsFinal || oldTranslation.Text != "แรก ต่อ" {
		t.Fatalf("old translation = %#v", oldTranslation)
	}

	next := provider.transcriptResults(&genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{
		OutputTranscription: &genai.Transcription{Text: "แรก ต่อ ใหม่"},
	}})
	if len(next) != 1 || next[0].TurnID != "gemini-2" || next[0].Text != "ใหม่" {
		t.Fatalf("next translation = %#v, want new gemini-2 tail", next)
	}
}

func TestGeminiTurnCompleteWhileBoundaryPendingFinalizesRemainingTailOnce(t *testing.T) {
	now := time.Unix(900, 0)
	provider := &GeminiProvider{
		cfg:       normalizeGeminiConfig(GeminiConfig{}),
		segmenter: newGeminiSegmenter(16000),
		now:       func() time.Time { return now },
	}
	provider.transcriptResults(interimInput("first."))
	provider.transcriptMu.Lock()
	provider.requestBoundaryLocked(now, geminiBoundaryPunctuation)
	provider.transcriptMu.Unlock()
	provider.transcriptResults(interimInput("first. second"))

	results := provider.transcriptResults(&genai.LiveServerMessage{ServerContent: &genai.LiveServerContent{TurnComplete: true}})
	finalsByTurn := map[string]int{}
	for _, result := range results {
		if result.Role == domain.TranscriptRoleSource && result.IsFinal {
			finalsByTurn[result.TurnID]++
		}
		if result.TurnID == "gemini-3" {
			t.Fatalf("unexpected empty turn result: %#v", result)
		}
	}
	if finalsByTurn["gemini-1"] != 1 || finalsByTurn["gemini-2"] != 1 {
		t.Fatalf("final source counts = %#v, want one per completed turn", finalsByTurn)
	}

	next := provider.transcriptResults(interimInput("fresh upstream turn"))
	if len(next) != 1 || next[0].TurnID != "gemini-3" || next[0].Text != "fresh upstream turn" {
		t.Fatalf("next results = %#v", next)
	}
}

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

	currentTime = startedAt.Add(geminiTurnSilence)
	if finals := provider.observeAudioForSegmentation(
		pcm16Batch(0, 800*time.Millisecond, 16000),
		currentTime,
	); len(finals) != 0 {
		t.Fatalf("silence finalized before translation grace: %#v", finals)
	}
	currentTime = currentTime.Add(geminiTranslationGrace)
	provider.transcriptMu.Lock()
	finals := provider.completePendingBoundaryLocked()
	provider.transcriptMu.Unlock()
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

func TestGeminiSilenceRequestsFixedBoundary(t *testing.T) {
	now := time.Unix(1200, 0)
	provider := &GeminiProvider{
		cfg:       normalizeGeminiConfig(GeminiConfig{}),
		segmenter: newGeminiSegmenter(16000),
		now:       func() time.Time { return now },
	}
	provider.transcriptResults(interimInput("continuous source"))
	provider.observeAudioForSegmentation(pcm16Batch(4000, 100*time.Millisecond, 16000), now)
	now = now.Add(geminiTurnSilence)
	if results := provider.observeAudioForSegmentation(pcm16Batch(0, geminiTurnSilence, 16000), now); len(results) != 0 {
		t.Fatalf("silence returned early finals: %#v", results)
	}

	provider.transcriptMu.Lock()
	reason := provider.pendingBoundaryReason
	delay, pending := provider.segmenter.boundaryDelay(now)
	provider.transcriptMu.Unlock()
	if reason != geminiBoundarySilence || !pending || delay != geminiTranslationGrace {
		t.Fatalf("boundary = (reason=%v delay=%v pending=%t)", reason, delay, pending)
	}
}

func TestGeminiBoundaryTimerIgnoresStaleVersion(t *testing.T) {
	now := time.Unix(1500, 0)
	provider := &GeminiProvider{
		cfg:       normalizeGeminiConfig(GeminiConfig{}),
		results:   make(chan domain.TranscriptResult, 8),
		done:      make(chan struct{}),
		segmenter: newGeminiSegmenter(16000),
		now:       func() time.Time { return now },
	}
	provider.transcriptResults(interimInput("first."))
	provider.transcriptMu.Lock()
	provider.requestBoundaryLocked(now, geminiBoundaryPunctuation)
	staleVersion := provider.boundaryVersion
	provider.completePendingBoundaryLocked()
	provider.transcriptMu.Unlock()
	provider.transcriptResults(interimInput("second."))
	provider.transcriptMu.Lock()
	provider.requestBoundaryLocked(now, geminiBoundaryPunctuation)
	wantSequence := provider.turnSequence
	provider.transcriptMu.Unlock()

	provider.completeBoundary(staleVersion)
	provider.transcriptMu.Lock()
	gotSequence := provider.turnSequence
	provider.stopBoundaryTimerLocked()
	provider.transcriptMu.Unlock()
	if gotSequence != wantSequence {
		t.Fatalf("stale timer advanced sequence to %d, want %d", gotSequence, wantSequence)
	}
}

func TestGeminiStopRacesSafelyWithBoundaryTimer(t *testing.T) {
	for iteration := 0; iteration < 100; iteration++ {
		provider := &GeminiProvider{
			cfg:       normalizeGeminiConfig(GeminiConfig{}),
			results:   make(chan domain.TranscriptResult, 4),
			done:      make(chan struct{}),
			segmenter: newGeminiSegmenter(16000),
			now:       time.Now,
		}
		provider.sourceAccumulator.observe("continuous source")
		provider.transcriptMu.Lock()
		provider.requestBoundaryLocked(time.Now(), geminiBoundaryDuration)
		provider.stopBoundaryTimerLocked()
		provider.scheduleBoundaryLocked(time.Millisecond)
		provider.transcriptMu.Unlock()

		stopped := make(chan struct{})
		go func() {
			if err := provider.Stop(); err != nil {
				t.Errorf("Stop() error = %v", err)
			}
			close(stopped)
		}()
		select {
		case <-stopped:
		case <-time.After(time.Second):
			t.Fatal("Stop timed out")
		}
		for range provider.Results() {
		}
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
