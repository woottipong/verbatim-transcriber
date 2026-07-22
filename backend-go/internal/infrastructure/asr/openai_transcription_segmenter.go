package asr

import "time"

// openAITranscriptionSegmenter decides when the current manual OpenAI audio
// buffer should be committed. Text arrives only after a commit, so the hard
// boundary must be derived from buffered PCM duration rather than transcript
// punctuation or length.
type openAITranscriptionSegmenter struct {
	pcmTurnSegmenter
	bufferedAudioDuration time.Duration
}

func newOpenAITranscriptionSegmenter(sampleRate int) openAITranscriptionSegmenter {
	return openAITranscriptionSegmenter{
		pcmTurnSegmenter: newPCMTurnSegmenter(PCMTurnSegmenterConfig{
			SampleRate:    sampleRate,
			RMSThreshold:  defaultPCMRMSThreshold,
			SilenceWindow: defaultPCMSilenceWindow,
		}),
	}
}

func (s *openAITranscriptionSegmenter) observeAudio(data []byte) bool {
	silenceBoundary := s.ObserveAudio(data)
	if s.speechSeen && s.sampleRate > 0 {
		s.bufferedAudioDuration += time.Duration(len(data)/2) * time.Second / time.Duration(s.sampleRate)
	}
	return silenceBoundary || s.bufferedAudioDuration >= continuousHardTurnDuration
}

func (s *openAITranscriptionSegmenter) reset() {
	s.Reset()
	s.bufferedAudioDuration = 0
}
