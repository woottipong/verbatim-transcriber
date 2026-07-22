package asr

import "strings"

// geminiTranscriptAccumulator keeps Gemini's upstream cumulative history
// separate from the prefix already assigned to completed local turns.
type geminiTranscriptAccumulator struct {
	history       string
	emittedPrefix string
}

func (a *geminiTranscriptAccumulator) observe(incoming string) (string, bool) {
	merged, changed := mergeGeminiTranscript(a.history, incoming)
	if changed {
		a.history = merged
	}
	tail, _ := a.tail()
	return tail, changed
}

func (a *geminiTranscriptAccumulator) historyCutoff() string {
	return a.history
}

func (a *geminiTranscriptAccumulator) tailAt(cutoff string) (string, bool) {
	if !strings.HasPrefix(a.history, cutoff) || !strings.HasPrefix(cutoff, a.emittedPrefix) {
		return strings.TrimSpace(a.history), false
	}
	return suffixAfterPrefix(cutoff, a.emittedPrefix)
}

func (a *geminiTranscriptAccumulator) commit(cutoff string) {
	if !strings.HasPrefix(a.history, cutoff) || !strings.HasPrefix(cutoff, a.emittedPrefix) {
		return
	}
	a.emittedPrefix = cutoff
}

func (a *geminiTranscriptAccumulator) tail() (string, bool) {
	return suffixAfterPrefix(a.history, a.emittedPrefix)
}

func (a *geminiTranscriptAccumulator) reset() {
	a.history = ""
	a.emittedPrefix = ""
}

func suffixAfterPrefix(value, prefix string) (string, bool) {
	if prefix == "" {
		return strings.TrimSpace(value), true
	}
	if !strings.HasPrefix(value, prefix) {
		return strings.TrimSpace(value), false
	}
	return strings.TrimSpace(strings.TrimPrefix(value, prefix)), true
}
