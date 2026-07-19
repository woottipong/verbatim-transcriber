package asr

import (
	"encoding/binary"
	"math"
	"time"
)

const (
	geminiSpeechRMSThreshold = 0.015
	geminiTurnSilence        = 800 * time.Millisecond
	geminiTranslationGrace   = 500 * time.Millisecond
)

type geminiSegmenter struct {
	sampleRate             int
	speechSeen             bool
	silence                time.Duration
	boundaryPending        bool
	lastTranscriptActivity time.Time
}

func pcm16RMS(data []byte) float64 {
	sampleCount := len(data) / 2
	if sampleCount == 0 {
		return 0
	}

	var sumSquares float64
	for offset := 0; offset+1 < len(data); offset += 2 {
		sample := float64(int16(binary.LittleEndian.Uint16(data[offset:]))) / 32768
		sumSquares += sample * sample
	}
	return math.Sqrt(sumSquares / float64(sampleCount))
}

func (s *geminiSegmenter) observeAudio(data []byte, _ time.Time) bool {
	if s.sampleRate <= 0 || len(data) < 2 {
		return s.boundaryPending
	}

	if pcm16RMS(data) >= geminiSpeechRMSThreshold {
		s.speechSeen = true
		s.silence = 0
		s.boundaryPending = false
		return false
	}
	if !s.speechSeen {
		return false
	}

	s.silence += time.Duration(len(data)/2) * time.Second / time.Duration(s.sampleRate)
	if s.silence >= geminiTurnSilence {
		s.boundaryPending = true
	}
	return s.boundaryPending
}

func (s *geminiSegmenter) observeTranscript(now time.Time) {
	s.lastTranscriptActivity = now
}

func (s *geminiSegmenter) boundaryDelay(now time.Time) (time.Duration, bool) {
	if !s.boundaryPending {
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
	s.speechSeen = false
	s.silence = 0
	s.boundaryPending = false
	s.lastTranscriptActivity = time.Time{}
}
