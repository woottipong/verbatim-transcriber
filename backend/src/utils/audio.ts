/**
 * Audio Processing Utilities
 */

/**
 * Convert WebSocket data to ArrayBuffer
 */
export function toArrayBuffer(data: ArrayBuffer | Buffer): ArrayBuffer {
    if (data instanceof Buffer) {
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    }
    return data as ArrayBuffer;
}

/**
 * Convert PCM buffer to WAV format
 */
export function convertPCMtoWAV(
    pcmBuffer: Buffer,
    sampleRate: number,
    numChannels: number,
    bitsPerSample: number
): Buffer {
    const dataLength = pcmBuffer.length;
    const buffer = Buffer.alloc(44 + dataLength);

    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataLength, 4);
    buffer.write('WAVE', 8);

    // fmt chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // fmt chunk size
    buffer.writeUInt16LE(1, 20); // PCM format
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, 28); // byte rate
    buffer.writeUInt16LE(numChannels * bitsPerSample / 8, 32); // block align
    buffer.writeUInt16LE(bitsPerSample, 34);

    // data chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataLength, 40);
    pcmBuffer.copy(buffer, 44);

    return buffer;
}

/**
 * Log audio chunk info (debug)
 */
export function logAudioChunk(data: ArrayBuffer | Buffer, chunkNumber: number): void {
    if (chunkNumber === 1) {
        const buffer = data instanceof Buffer ? data : Buffer.from(new Uint8Array(data));
        const header = buffer.subarray(0, Math.min(20, buffer.length));
        console.log('🎵 First chunk header (hex):', header.toString('hex'));
        console.log('🎵 First chunk header (ascii):', buffer.subarray(0, 4).toString('ascii'));
    }
    if (chunkNumber % 20 === 1) {
        console.log(`🔊 Audio chunk #${chunkNumber}, size: ${data.byteLength} bytes`);
    }
}
