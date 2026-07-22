package asr

type reconnectAudioBuffer struct {
	data     []byte
	capacity int
	dropped  int64
}

func newReconnectAudioBuffer(capacity int) *reconnectAudioBuffer {
	return &reconnectAudioBuffer{
		data:     make([]byte, 0, max(capacity, 0)),
		capacity: max(capacity, 0),
	}
}

func (b *reconnectAudioBuffer) Add(data []byte) {
	if len(data) == 0 {
		return
	}
	if b.capacity == 0 {
		b.dropped += int64(len(data))
		return
	}
	overflow := len(b.data) + len(data) - b.capacity
	if overflow <= 0 {
		b.data = append(b.data, data...)
		return
	}
	b.dropped += int64(overflow)
	if overflow >= len(b.data) {
		skip := overflow - len(b.data)
		b.data = append(b.data[:0], data[skip:]...)
		return
	}
	b.data = append(b.data[overflow:], data...)
}

func (b *reconnectAudioBuffer) Reset() {
	b.data = b.data[:0]
	b.dropped = 0
}

func (b *reconnectAudioBuffer) Drain() ([]byte, int64) {
	data := append([]byte(nil), b.data...)
	dropped := b.dropped
	b.Reset()
	return data, dropped
}

func (b *reconnectAudioBuffer) RestoreFront(data []byte, dropped int64) {
	tail := append([]byte(nil), b.data...)
	tailDropped := b.dropped
	b.Reset()
	b.dropped = dropped + tailDropped
	b.Add(data)
	b.Add(tail)
}
