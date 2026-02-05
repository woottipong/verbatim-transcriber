package asr

import (
	"context"
)

type TranscriptResult struct {
	Text       string  `json:"text"`
	IsFinal    bool    `json:"isFinal"`
	Confidence float64 `json:"confidence"`
	Speaker    string  `json:"speaker,omitempty"`
}

type ASRProvider interface {
	Start(ctx context.Context) error
	SendAudio(data []byte) error
	Results() <-chan TranscriptResult
	Stop() error
}
