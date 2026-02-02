package utils

import (
	"bytes"
	"encoding/binary"
)

// ConvertPCMtoWAV converts PCM audio data to WAV format
func ConvertPCMtoWAV(pcmData []byte, sampleRate, channels, bitsPerSample int) []byte {
	buf := new(bytes.Buffer)

	// WAV Header
	buf.WriteString("RIFF")
	binary.Write(buf, binary.LittleEndian, uint32(36+len(pcmData))) // ChunkSize
	buf.WriteString("WAVE")

	// fmt subchunk
	buf.WriteString("fmt ")
	binary.Write(buf, binary.LittleEndian, uint32(16))                                  // Subchunk1Size (16 for PCM)
	binary.Write(buf, binary.LittleEndian, uint16(1))                                   // AudioFormat (1 = PCM)
	binary.Write(buf, binary.LittleEndian, uint16(channels))                            // NumChannels
	binary.Write(buf, binary.LittleEndian, uint32(sampleRate))                          // SampleRate
	binary.Write(buf, binary.LittleEndian, uint32(sampleRate*channels*bitsPerSample/8)) // ByteRate
	binary.Write(buf, binary.LittleEndian, uint16(channels*bitsPerSample/8))            // BlockAlign
	binary.Write(buf, binary.LittleEndian, uint16(bitsPerSample))                       // BitsPerSample

	// data subchunk
	buf.WriteString("data")
	binary.Write(buf, binary.LittleEndian, uint32(len(pcmData))) // Subchunk2Size
	buf.Write(pcmData)

	return buf.Bytes()
}
