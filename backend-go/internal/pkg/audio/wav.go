// Package audio provides audio format conversion utilities.
//
// Supported conversions:
//   - PCM to WAV (with configurable sample rate, channels, bit depth)
//
// Common audio formats used in this project:
//   - Google: 48kHz, mono, 16-bit PCM
//   - Azure: 16kHz, mono, 16-bit PCM
package audio

import (
	"encoding/binary"
)

// Common audio format constants
const (
	// Sample rates
	SampleRate48kHz = 48000 // Used by Google
	SampleRate16kHz = 16000 // Used by Azure

	// Channels
	Mono   = 1
	Stereo = 2

	// Bit depth
	BitsPerSample16 = 16

	// Audio format codes
	FormatPCM = 1
)

// WAVHeader represents a standard WAV file header (44 bytes).
type WAVHeader struct {
	ChunkID       [4]byte // "RIFF"
	ChunkSize     uint32  // File size - 8
	Format        [4]byte // "WAVE"
	Subchunk1ID   [4]byte // "fmt "
	Subchunk1Size uint32  // 16 for PCM
	AudioFormat   uint16  // 1 for PCM
	NumChannels   uint16
	SampleRate    uint32
	ByteRate      uint32 // SampleRate * NumChannels * BitsPerSample/8
	BlockAlign    uint16 // NumChannels * BitsPerSample/8
	BitsPerSample uint16
	Subchunk2ID   [4]byte // "data"
	Subchunk2Size uint32  // PCM data size
}

// PCMToWAV converts raw PCM audio data to WAV format.
//
// Parameters:
//   - pcmData: Raw PCM audio bytes (signed 16-bit little-endian)
//   - sampleRate: Sample rate in Hz (e.g., 16000, 48000)
//   - channels: Number of audio channels (1=mono, 2=stereo)
//   - bitsPerSample: Bit depth (typically 16)
//
// Returns WAV-formatted audio data with proper header.
func PCMToWAV(pcmData []byte, sampleRate, channels, bitsPerSample int) []byte {
	byteRate := sampleRate * channels * bitsPerSample / 8
	blockAlign := channels * bitsPerSample / 8
	wav := make([]byte, 44+len(pcmData))
	copy(wav[0:4], "RIFF")
	binary.LittleEndian.PutUint32(wav[4:8], uint32(36+len(pcmData)))
	copy(wav[8:12], "WAVE")
	copy(wav[12:16], "fmt ")
	binary.LittleEndian.PutUint32(wav[16:20], 16)
	binary.LittleEndian.PutUint16(wav[20:22], FormatPCM)
	binary.LittleEndian.PutUint16(wav[22:24], uint16(channels))
	binary.LittleEndian.PutUint32(wav[24:28], uint32(sampleRate))
	binary.LittleEndian.PutUint32(wav[28:32], uint32(byteRate))
	binary.LittleEndian.PutUint16(wav[32:34], uint16(blockAlign))
	binary.LittleEndian.PutUint16(wav[34:36], uint16(bitsPerSample))
	copy(wav[36:40], "data")
	binary.LittleEndian.PutUint32(wav[40:44], uint32(len(pcmData)))
	copy(wav[44:], pcmData)
	return wav
}

// PCMToWAV16kMono is a convenience function for 16kHz mono audio.
// This is the format used by Azure Speech.
func PCMToWAV16kMono(pcmData []byte) []byte {
	return PCMToWAV(pcmData, SampleRate16kHz, Mono, BitsPerSample16)
}

// PCMToWAV48kMono is a convenience function for 48kHz mono audio.
// This is the format used by Deepgram and Google.
func PCMToWAV48kMono(pcmData []byte) []byte {
	return PCMToWAV(pcmData, SampleRate48kHz, Mono, BitsPerSample16)
}
