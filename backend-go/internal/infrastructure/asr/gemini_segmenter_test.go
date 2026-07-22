package asr

import (
	"encoding/binary"
	"math"
	"strings"
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
	segmenter := newGeminiSegmenter(16000)
	now := time.Unix(100, 0)

	if segmenter.observeAudio(pcm16Batch(4000, 100*time.Millisecond, 16000), now) {
		t.Fatal("speech marked a boundary")
	}
	for index := 1; index <= 6; index++ {
		if segmenter.observeAudio(pcm16Batch(0, 100*time.Millisecond, 16000), now.Add(time.Duration(index)*100*time.Millisecond)) {
			t.Fatalf("silence marked a boundary after %d ms, want 650 ms", index*100)
		}
	}
	if !segmenter.observeAudio(pcm16Batch(0, 50*time.Millisecond, 16000), now.Add(650*time.Millisecond)) {
		t.Fatal("650 ms silence did not mark a boundary")
	}
	segmenter.requestBoundary(now.Add(650 * time.Millisecond))
	if delay, pending := segmenter.boundaryDelay(now.Add(650 * time.Millisecond)); !pending || delay != 500*time.Millisecond {
		t.Fatalf("boundaryDelay() = (%v, %v), want (500ms, true)", delay, pending)
	}
}

func TestGeminiSegmenterWaitsForTranscriptGrace(t *testing.T) {
	segmenter := newGeminiSegmenter(16000)
	now := time.Unix(200, 0)
	segmenter.observeAudio(pcm16Batch(4000, 100*time.Millisecond, 16000), now)
	segmenter.observeAudio(pcm16Batch(0, 650*time.Millisecond, 16000), now.Add(650*time.Millisecond))
	segmenter.requestBoundary(now.Add(650 * time.Millisecond))

	if delay, pending := segmenter.boundaryDelay(now.Add(650 * time.Millisecond)); !pending || delay != 500*time.Millisecond {
		t.Fatalf("boundaryDelay() = (%v, %v), want (500ms, true)", delay, pending)
	}
	if delay, pending := segmenter.boundaryDelay(now.Add(1150 * time.Millisecond)); !pending || delay != 0 {
		t.Fatalf("boundaryDelay() after grace = (%v, %v), want (0, true)", delay, pending)
	}
}

func TestGeminiSegmenterKeepsFixedBoundaryWhenSpeechResumes(t *testing.T) {
	segmenter := newGeminiSegmenter(16000)
	now := time.Unix(300, 0)
	segmenter.observeAudio(pcm16Batch(4000, 100*time.Millisecond, 16000), now)
	segmenter.observeAudio(pcm16Batch(0, 650*time.Millisecond, 16000), now.Add(650*time.Millisecond))
	segmenter.requestBoundary(now.Add(650 * time.Millisecond))

	if segmenter.observeAudio(pcm16Batch(4000, 100*time.Millisecond, 16000), now.Add(750*time.Millisecond)) {
		t.Fatal("resumed speech requested another boundary")
	}
	if delay, pending := segmenter.boundaryDelay(now.Add(850 * time.Millisecond)); !pending || delay != 300*time.Millisecond {
		t.Fatalf("boundaryDelay() = (%v, %v), want (300ms, true)", delay, pending)
	}
}

func TestGeminiSegmenterRequestsContinuousBoundaries(t *testing.T) {
	start := time.Unix(400, 0)
	tests := []struct {
		name string
		now  time.Time
		text string
		want geminiBoundaryReason
	}{
		{name: "before soft limit", now: start.Add(19 * time.Second), text: "still speaking.", want: geminiBoundaryNone},
		{name: "soft punctuation", now: start.Add(20 * time.Second), text: "complete sentence?", want: geminiBoundaryPunctuation},
		{name: "soft without punctuation", now: start.Add(20 * time.Second), text: "still speaking", want: geminiBoundaryNone},
		{name: "hard duration", now: start.Add(30 * time.Second), text: "still speaking", want: geminiBoundaryDuration},
		{name: "hard unicode length", now: start.Add(time.Second), text: strings.Repeat("ก", 600), want: geminiBoundaryLength},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			segmenter := newGeminiSegmenter(16000)
			segmenter.observeSource(start, "เริ่ม")
			if got := segmenter.observeSource(tt.now, tt.text); got != tt.want {
				t.Fatalf("reason = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestGeminiBoundaryDeadlineDoesNotSlide(t *testing.T) {
	segmenter := newGeminiSegmenter(16000)
	requestedAt := time.Unix(500, 0)
	if !segmenter.requestBoundary(requestedAt) {
		t.Fatal("first request was rejected")
	}
	segmenter.observeSource(requestedAt.Add(400*time.Millisecond), "new activity")

	delay, pending := segmenter.boundaryDelay(requestedAt.Add(450 * time.Millisecond))
	if !pending || delay != 50*time.Millisecond {
		t.Fatalf("boundaryDelay() = (%v, %v), want (50ms, true)", delay, pending)
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
