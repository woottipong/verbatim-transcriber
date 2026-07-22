package asr

import (
	"strings"
	"time"
	"unicode/utf8"
)

const (
	geminiSpeechRMSThreshold = defaultPCMRMSThreshold
	geminiTurnSilence        = defaultPCMSilenceWindow
	geminiTranslationGrace   = 500 * time.Millisecond
	geminiSoftTurnDuration   = 20 * time.Second
	geminiHardTurnDuration   = 30 * time.Second
	geminiHardTurnRunes      = 600
)

type geminiBoundaryReason uint8

const (
	geminiBoundaryNone geminiBoundaryReason = iota
	geminiBoundarySilence
	geminiBoundaryPunctuation
	geminiBoundaryDuration
	geminiBoundaryLength
)

type geminiSegmenter struct {
	pcmTurnSegmenter
	segmentStartedAt    time.Time
	boundaryRequestedAt time.Time
}

func newGeminiSegmenter(sampleRate int) geminiSegmenter {
	return geminiSegmenter{
		pcmTurnSegmenter: newPCMTurnSegmenter(PCMTurnSegmenterConfig{
			SampleRate:    sampleRate,
			RMSThreshold:  geminiSpeechRMSThreshold,
			SilenceWindow: geminiTurnSilence,
		}),
	}
}

func (s *geminiSegmenter) observeAudio(data []byte, _ time.Time) bool {
	return s.ObserveAudio(data)
}

func (s *geminiSegmenter) observeSource(now time.Time, sourceTail string) geminiBoundaryReason {
	sourceTail = strings.TrimSpace(sourceTail)
	if sourceTail == "" {
		return geminiBoundaryNone
	}
	if s.segmentStartedAt.IsZero() {
		s.segmentStartedAt = now
	}
	if !s.boundaryRequestedAt.IsZero() {
		return geminiBoundaryNone
	}
	if utf8.RuneCountInString(sourceTail) >= geminiHardTurnRunes {
		return geminiBoundaryLength
	}

	elapsed := now.Sub(s.segmentStartedAt)
	if elapsed >= geminiHardTurnDuration {
		return geminiBoundaryDuration
	}
	if elapsed >= geminiSoftTurnDuration && hasGeminiSentenceEnding(sourceTail) {
		return geminiBoundaryPunctuation
	}
	return geminiBoundaryNone
}

func hasGeminiSentenceEnding(text string) bool {
	text = strings.TrimSpace(text)
	return strings.HasSuffix(text, ".") ||
		strings.HasSuffix(text, "?") ||
		strings.HasSuffix(text, "!") ||
		strings.HasSuffix(text, "…") ||
		strings.HasSuffix(text, "。") ||
		strings.HasSuffix(text, "！") ||
		strings.HasSuffix(text, "？")
}

func (s *geminiSegmenter) requestBoundary(now time.Time) bool {
	if !s.boundaryRequestedAt.IsZero() {
		return false
	}
	s.boundaryPending = true
	s.boundaryRequestedAt = now
	return true
}

func (s *geminiSegmenter) boundaryDelay(now time.Time) (time.Duration, bool) {
	if s.boundaryRequestedAt.IsZero() {
		return 0, false
	}

	delay := s.boundaryRequestedAt.Add(geminiTranslationGrace).Sub(now)
	if delay < 0 {
		delay = 0
	}
	return delay, true
}

func (s *geminiSegmenter) reset() {
	s.Reset()
	s.segmentStartedAt = time.Time{}
	s.boundaryRequestedAt = time.Time{}
}
