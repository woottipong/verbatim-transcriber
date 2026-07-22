package asr

import (
	"testing"
	"time"
)

func TestOpenAITranscriptionSegmenterIgnoresLeadingSilence(t *testing.T) {
	segmenter := newOpenAITranscriptionSegmenter(24000)
	for range 310 {
		if segmenter.observeAudio(pcm16Batch(0, 100*time.Millisecond, 24000)) {
			t.Fatal("leading silence requested a commit")
		}
	}
	if segmenter.bufferedAudioDuration != 0 {
		t.Fatalf("buffered duration = %v, want 0 before speech", segmenter.bufferedAudioDuration)
	}
}

func TestOpenAITranscriptionSegmenterCommitsAfterSilence(t *testing.T) {
	segmenter := newOpenAITranscriptionSegmenter(24000)
	if segmenter.observeAudio(pcm16Batch(4000, 100*time.Millisecond, 24000)) {
		t.Fatal("speech requested a commit")
	}
	if segmenter.observeAudio(pcm16Batch(0, 600*time.Millisecond, 24000)) {
		t.Fatal("600 ms silence requested a commit")
	}
	if !segmenter.observeAudio(pcm16Batch(0, 50*time.Millisecond, 24000)) {
		t.Fatal("650 ms silence did not request a commit")
	}
}

func TestOpenAITranscriptionSegmenterCommitsContinuousSpeechAtHardLimit(t *testing.T) {
	segmenter := newOpenAITranscriptionSegmenter(24000)
	for index := 0; index < 299; index++ {
		if segmenter.observeAudio(pcm16Batch(4000, 100*time.Millisecond, 24000)) {
			t.Fatalf("commit requested after %d ms, before hard limit", (index+1)*100)
		}
	}
	if !segmenter.observeAudio(pcm16Batch(4000, 100*time.Millisecond, 24000)) {
		t.Fatal("30 seconds continuous speech did not request a commit")
	}
}

func TestOpenAITranscriptionSegmenterResetStartsANewDurationWindow(t *testing.T) {
	segmenter := newOpenAITranscriptionSegmenter(24000)
	if !segmenter.observeAudio(pcm16Batch(4000, 30*time.Second, 24000)) {
		t.Fatal("hard limit did not request a commit")
	}
	segmenter.reset()

	if segmenter.observeAudio(pcm16Batch(4000, 100*time.Millisecond, 24000)) {
		t.Fatal("new duration window inherited the previous boundary")
	}
	if segmenter.bufferedAudioDuration != 100*time.Millisecond {
		t.Fatalf("buffered duration = %v, want 100ms", segmenter.bufferedAudioDuration)
	}
}
