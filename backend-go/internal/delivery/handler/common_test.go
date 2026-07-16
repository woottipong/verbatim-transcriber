package handler

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"thai-transcriber-backend/models"
)

type overlapDetectWriter struct {
	active  atomic.Int32
	overlap atomic.Bool
}

func (w *overlapDetectWriter) WriteJSON(any) error {
	if w.active.Add(1) > 1 {
		w.overlap.Store(true)
	}
	time.Sleep(time.Millisecond)
	w.active.Add(-1)
	return nil
}

func TestSafeJSONWriterSerializesWrites(t *testing.T) {
	underlying := &overlapDetectWriter{}
	writer := newSafeJSONWriter(underlying)

	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := writer.WriteJSON(struct{}{}); err != nil {
				t.Errorf("WriteJSON() error = %v", err)
			}
		}()
	}
	wg.Wait()

	if underlying.overlap.Load() {
		t.Fatal("underlying writer received concurrent writes")
	}
}

type captureWriter struct {
	value any
}

func (w *captureWriter) WriteJSON(value any) error {
	w.value = value
	return nil
}

func TestSendTranscriptNormalizesThaiSpacing(t *testing.T) {
	writer := &captureWriter{}
	if err := sendTranscript(writer, "ทด สอบ ถอด ความ 1 2 3 4", true, 0.9); err != nil {
		t.Fatalf("sendTranscript() error = %v", err)
	}

	response, ok := writer.value.(models.TranscriptResponse)
	if !ok {
		t.Fatalf("WriteJSON() value type = %T, want models.TranscriptResponse", writer.value)
	}
	if got, want := response.Text, "ทดสอบถอดความ 1 2 3 4"; got != want {
		t.Fatalf("response text = %q, want %q", got, want)
	}
	if got, want := response.Channel.Alternatives[0].Transcript, response.Text; got != want {
		t.Fatalf("alternative transcript = %q, want %q", got, want)
	}
}
