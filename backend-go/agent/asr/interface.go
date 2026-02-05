package asr

import "context"

// TranscriptResult represents a transcription result from ASR
type TranscriptResult struct {
	Text       string
	IsFinal    bool
	Confidence float64
	Offset     int64
	Duration   int64
}

// Provider is the interface that all ASR providers must implement
type Provider interface {
	Start(ctx context.Context) error
	SendAudio(data []byte) error
	Results() <-chan TranscriptResult
	Stop() error
	SampleRate() int
	Name() string
}
