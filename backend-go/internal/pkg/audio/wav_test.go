package audio

import (
	"encoding/binary"
	"testing"
)

func TestPCMToWAVBuildsStandardHeader(t *testing.T) {
	pcm := []byte{1, 2, 3, 4}
	wav := PCMToWAV16kMono(pcm)

	if got, want := len(wav), 44+len(pcm); got != want {
		t.Fatalf("WAV length = %d, want %d", got, want)
	}
	if got := string(wav[0:4]); got != "RIFF" {
		t.Fatalf("chunk ID = %q, want RIFF", got)
	}
	if got := binary.LittleEndian.Uint32(wav[24:28]); got != SampleRate16kHz {
		t.Fatalf("sample rate = %d, want %d", got, SampleRate16kHz)
	}
	if got := binary.LittleEndian.Uint32(wav[40:44]); got != uint32(len(pcm)) {
		t.Fatalf("PCM size = %d, want %d", got, len(pcm))
	}
	if got := wav[44:]; string(got) != string(pcm) {
		t.Fatalf("PCM payload = %v, want %v", got, pcm)
	}
}
