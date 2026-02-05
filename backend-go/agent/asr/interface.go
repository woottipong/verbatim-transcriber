// Package asr provides speech-to-text provider interfaces and implementations.
//
// Supported providers:
//   - Google Cloud Speech-to-Text (gRPC streaming)
//   - Azure Speech Service (WebSocket streaming)
//
// Each provider implements the Provider interface and handles:
//   - Connection management
//   - Audio streaming (PCM Int16 format)
//   - Transcription results (interim and final)
package asr

import "context"

// TranscriptResult represents a transcription result from an ASR provider.
type TranscriptResult struct {
	Text       string  // Transcribed text
	IsFinal    bool    // True if this is a final result, false for interim
	Confidence float64 // Confidence score (0-1)
	Offset     int64   // Audio offset in nanoseconds (provider-specific)
	Duration   int64   // Duration in nanoseconds (provider-specific)
}

// Provider is the interface that all ASR providers must implement.
// Each provider manages its own connection to the cloud service and
// handles audio streaming and result processing.
type Provider interface {
	// Start initializes the connection to the ASR service
	Start(ctx context.Context) error
	// SendAudio streams PCM audio data (Int16 Little-Endian) to the provider
	SendAudio(data []byte) error
	// Results returns a channel of transcription results
	Results() <-chan TranscriptResult
	// Stop closes the connection and cleans up resources
	Stop() error
	// SampleRate returns the expected sample rate for audio input
	SampleRate() int
	// Name returns the provider name (e.g., "google", "azure")
	Name() string
}
