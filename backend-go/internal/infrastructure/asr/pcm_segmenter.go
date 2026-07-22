package asr

import (
	"encoding/binary"
	"math"
	"time"
)

const (
	defaultPCMRMSThreshold     = 0.015
	defaultPCMSilenceWindow    = 650 * time.Millisecond
	continuousHardTurnDuration = 30 * time.Second
)

// PCMTurnSegmenterConfig controls the local speech/silence boundary detector.
// It is deliberately provider-independent because providers may consume PCM
// at different sample rates while sharing the same turn semantics.
type PCMTurnSegmenterConfig struct {
	SampleRate    int
	RMSThreshold  float64
	SilenceWindow time.Duration
}

type pcmTurnSegmenter struct {
	sampleRate      int
	rmsThreshold    float64
	silenceWindow   time.Duration
	speechSeen      bool
	silence         time.Duration
	boundaryPending bool
}

func newPCMTurnSegmenter(config PCMTurnSegmenterConfig) pcmTurnSegmenter {
	if config.RMSThreshold <= 0 {
		config.RMSThreshold = defaultPCMRMSThreshold
	}
	if config.SilenceWindow <= 0 {
		config.SilenceWindow = defaultPCMSilenceWindow
	}
	return pcmTurnSegmenter{
		sampleRate:    config.SampleRate,
		rmsThreshold:  config.RMSThreshold,
		silenceWindow: config.SilenceWindow,
	}
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

func (s *pcmTurnSegmenter) ObserveAudio(data []byte) bool {
	if s.sampleRate <= 0 || len(data) < 2 {
		return s.boundaryPending
	}

	if pcm16RMS(data) >= s.rmsThreshold {
		s.speechSeen = true
		s.silence = 0
		s.boundaryPending = false
		return false
	}
	if !s.speechSeen {
		return false
	}

	s.silence += time.Duration(len(data)/2) * time.Second / time.Duration(s.sampleRate)
	if s.silence >= s.silenceWindow {
		s.boundaryPending = true
	}
	return s.boundaryPending
}

func (s *pcmTurnSegmenter) BoundaryPending() bool {
	return s.boundaryPending
}

func (s *pcmTurnSegmenter) Reset() {
	s.speechSeen = false
	s.silence = 0
	s.boundaryPending = false
}
