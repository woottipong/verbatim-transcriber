package asr

import "time"

const (
	geminiSpeechRMSThreshold = defaultPCMRMSThreshold
	geminiTurnSilence        = defaultPCMSilenceWindow
	geminiTranslationGrace   = 500 * time.Millisecond
)

type geminiSegmenter struct {
	pcmTurnSegmenter
	lastTranscriptActivity time.Time
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

func (s *geminiSegmenter) observeTranscript(now time.Time) {
	s.lastTranscriptActivity = now
}

func (s *geminiSegmenter) boundaryDelay(now time.Time) (time.Duration, bool) {
	if !s.BoundaryPending() {
		return 0, false
	}
	if s.lastTranscriptActivity.IsZero() {
		return 0, true
	}

	delay := s.lastTranscriptActivity.Add(geminiTranslationGrace).Sub(now)
	if delay < 0 {
		delay = 0
	}
	return delay, true
}

func (s *geminiSegmenter) reset() {
	s.Reset()
	s.lastTranscriptActivity = time.Time{}
}
