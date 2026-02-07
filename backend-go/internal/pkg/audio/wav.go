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
	"bytes"
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
	buf := new(bytes.Buffer)

	byteRate := sampleRate * channels * bitsPerSample / 8
	blockAlign := channels * bitsPerSample / 8

	// RIFF chunk descriptor
	buf.WriteString("RIFF")
	binary.Write(buf, binary.LittleEndian, uint32(36+len(pcmData))) // ChunkSize
	buf.WriteString("WAVE")

	// fmt sub-chunk
	buf.WriteString("fmt ")
	binary.Write(buf, binary.LittleEndian, uint32(16))            // Subchunk1Size (16 for PCM)
	binary.Write(buf, binary.LittleEndian, uint16(FormatPCM))     // AudioFormat
	binary.Write(buf, binary.LittleEndian, uint16(channels))      // NumChannels
	binary.Write(buf, binary.LittleEndian, uint32(sampleRate))    // SampleRate
	binary.Write(buf, binary.LittleEndian, uint32(byteRate))      // ByteRate
	binary.Write(buf, binary.LittleEndian, uint16(blockAlign))    // BlockAlign
	binary.Write(buf, binary.LittleEndian, uint16(bitsPerSample)) // BitsPerSample

	// data sub-chunk
	buf.WriteString("data")
	binary.Write(buf, binary.LittleEndian, uint32(len(pcmData))) // Subchunk2Size
	buf.Write(pcmData)

	return buf.Bytes()
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
