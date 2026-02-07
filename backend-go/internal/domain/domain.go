// Package domain defines core business entities and interfaces.
//
// This package contains the domain layer of Clean Architecture:
//   - Entities: Core business objects (TranscriptResult)
//   - Interfaces: Contracts that infrastructure must implement (ASR Provider)
//
// The domain layer has no dependencies on external packages.
package domain

import "context"

// =============================================================================
// ASR (Automatic Speech Recognition) Domain
// =============================================================================

// TranscriptResult represents a transcription result from an ASR provider.
// This is the core entity for speech-to-text functionality.
type TranscriptResult struct {
	Text       string  // Transcribed text
	IsFinal    bool    // True if this is a final result, false for interim
	Confidence float64 // Confidence score (0-1)
	Offset     int64   // Audio offset in nanoseconds (provider-specific)
	Duration   int64   // Duration in nanoseconds (provider-specific)
}

// ASRProvider is the interface that all ASR providers must implement.
// This follows the Dependency Inversion Principle - high-level modules
// (use cases) depend on abstractions, not concrete implementations.
type ASRProvider interface {
	// Start initializes the connection to the ASR service
	Start(ctx context.Context) error

	// SendAudio streams PCM audio data (Int16 Little-Endian) to the provider
	SendAudio(data []byte) error

	// Results returns a channel of transcription results.
	// The channel is closed when the provider stops or encounters an error.
	Results() <-chan TranscriptResult

	// Stop closes the connection and cleans up resources
	Stop() error

	// Err returns the last error that caused the stream to end (e.g., timeout)
	Err() error

	// SampleRate returns the expected sample rate for audio input
	SampleRate() int

	// Name returns the provider name (e.g., "google", "azure")
	Name() string
}

// =============================================================================
// Room Domain (LiveKit)
// =============================================================================

// Participant represents a participant in a room.
type Participant struct {
	Identity string
	Name     string
	IsAgent  bool
	State    string
}

// Room represents a LiveKit room.
type Room struct {
	Name            string
	NumParticipants int
	Participants    []Participant
	CreationTime    int64
}
