package asr

import (
	"testing"
	"time"
)

func TestPCMTurnSegmenterTracksSpeechAndSilenceAt16kHz(t *testing.T) {
	segmenter := newPCMTurnSegmenter(PCMTurnSegmenterConfig{
		SampleRate:    16000,
		RMSThreshold:  0.015,
		SilenceWindow: 800 * time.Millisecond,
	})

	if segmenter.ObserveAudio(pcm16Batch(4000, 100*time.Millisecond, 16000)) {
		t.Fatal("speech marked a boundary")
	}
	for index := 1; index < 8; index++ {
		if segmenter.ObserveAudio(pcm16Batch(0, 100*time.Millisecond, 16000)) {
			t.Fatalf("silence marked a boundary after %d ms, want 800 ms", index*100)
		}
	}
	if !segmenter.ObserveAudio(pcm16Batch(0, 100*time.Millisecond, 16000)) {
		t.Fatal("800 ms silence did not mark a boundary")
	}
}

func TestPCMTurnSegmenterUsesConfiguredSampleRate(t *testing.T) {
	segmenter := newPCMTurnSegmenter(PCMTurnSegmenterConfig{
		SampleRate:    24000,
		RMSThreshold:  0.015,
		SilenceWindow: 800 * time.Millisecond,
	})

	segmenter.ObserveAudio(pcm16Batch(4000, 100*time.Millisecond, 24000))
	for index := 1; index < 8; index++ {
		if segmenter.ObserveAudio(pcm16Batch(0, 100*time.Millisecond, 24000)) {
			t.Fatalf("silence marked a boundary after %d ms, want 800 ms", index*100)
		}
	}
	if !segmenter.ObserveAudio(pcm16Batch(0, 100*time.Millisecond, 24000)) {
		t.Fatal("800 ms silence did not mark a boundary at 24 kHz")
	}
}

func TestPCMTurnSegmenterCancelsBoundaryWhenSpeechResumes(t *testing.T) {
	segmenter := newPCMTurnSegmenter(PCMTurnSegmenterConfig{
		SampleRate:    24000,
		RMSThreshold:  0.015,
		SilenceWindow: 800 * time.Millisecond,
	})

	segmenter.ObserveAudio(pcm16Batch(4000, 100*time.Millisecond, 24000))
	segmenter.ObserveAudio(pcm16Batch(0, 800*time.Millisecond, 24000))
	if !segmenter.BoundaryPending() {
		t.Fatal("silence did not mark a boundary")
	}
	if segmenter.ObserveAudio(pcm16Batch(4000, 100*time.Millisecond, 24000)) {
		t.Fatal("resumed speech retained a boundary")
	}
	if segmenter.BoundaryPending() {
		t.Fatal("resumed speech left boundary pending")
	}
}
