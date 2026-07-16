package handler

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
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
