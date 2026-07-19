package asr

import (
	"encoding/binary"
	"math"
	"testing"
	"time"
)

func TestPCM16RMSNormalizesSamples(t *testing.T) {
	if got := pcm16RMS(pcm16Batch(0, 100*time.Millisecond, 16000)); got != 0 {
		t.Fatalf("silent RMS = %f, want 0", got)
	}

	got := pcm16RMS(pcm16Batch(16384, 100*time.Millisecond, 16000))
	if math.Abs(got-0.5) > 0.001 {
		t.Fatalf("half-scale RMS = %f, want 0.5", got)
	}
}

func TestGeminiSegmenterMarksBoundaryAfterSilence(t *testing.T) {
	segmenter := geminiSegmenter{sampleRate: 16000}
	now := time.Unix(100, 0)
	segmenter.observeTranscript(now)

	if segmenter.observeAudio(pcm16Batch(4000, 100*time.Millisecond, 16000), now) {
		t.Fatal("speech marked a boundary")
	}
	for index := 1; index <= 7; index++ {
		if segmenter.observeAudio(pcm16Batch(0, 100*time.Millisecond, 16000), now.Add(time.Duration(index)*100*time.Millisecond)) {
			t.Fatalf("silence marked a boundary after %d ms, want 800 ms", index*100)
		}
	}
	if !segmenter.observeAudio(pcm16Batch(0, 100*time.Millisecond, 16000), now.Add(800*time.Millisecond)) {
		t.Fatal("800 ms silence did not mark a boundary")
	}
	if delay, pending := segmenter.boundaryDelay(now.Add(800 * time.Millisecond)); !pending || delay != 0 {
		t.Fatalf("boundaryDelay() = (%v, %v), want (0, true)", delay, pending)
	}
}

func TestGeminiSegmenterWaitsForTranscriptGrace(t *testing.T) {
	segmenter := geminiSegmenter{sampleRate: 16000}
	now := time.Unix(200, 0)
	segmenter.observeAudio(pcm16Batch(4000, 100*time.Millisecond, 16000), now)
	segmenter.observeAudio(pcm16Batch(0, 800*time.Millisecond, 16000), now.Add(800*time.Millisecond))
	segmenter.observeTranscript(now.Add(800 * time.Millisecond))

	if delay, pending := segmenter.boundaryDelay(now.Add(800 * time.Millisecond)); !pending || delay != 500*time.Millisecond {
		t.Fatalf("boundaryDelay() = (%v, %v), want (500ms, true)", delay, pending)
	}
	if delay, pending := segmenter.boundaryDelay(now.Add(1300 * time.Millisecond)); !pending || delay != 0 {
		t.Fatalf("boundaryDelay() after grace = (%v, %v), want (0, true)", delay, pending)
	}
}

func TestGeminiSegmenterCancelsBoundaryWhenSpeechResumes(t *testing.T) {
	segmenter := geminiSegmenter{sampleRate: 16000}
	now := time.Unix(300, 0)
	segmenter.observeAudio(pcm16Batch(4000, 100*time.Millisecond, 16000), now)
	segmenter.observeAudio(pcm16Batch(0, 800*time.Millisecond, 16000), now.Add(800*time.Millisecond))
	segmenter.observeTranscript(now.Add(800 * time.Millisecond))

	if segmenter.observeAudio(pcm16Batch(4000, 100*time.Millisecond, 16000), now.Add(900*time.Millisecond)) {
		t.Fatal("resumed speech retained a boundary")
	}
	if delay, pending := segmenter.boundaryDelay(now.Add(time.Second)); pending || delay != 0 {
		t.Fatalf("boundaryDelay() = (%v, %v), want no boundary", delay, pending)
	}
}

func pcm16Batch(amplitude int16, duration time.Duration, sampleRate int) []byte {
	sampleCount := int(duration * time.Duration(sampleRate) / time.Second)
	data := make([]byte, sampleCount*2)
	for index := 0; index < sampleCount; index++ {
		binary.LittleEndian.PutUint16(data[index*2:], uint16(amplitude))
	}
	return data
}
