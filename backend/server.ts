/**
 * Thai Verbatim Transcriber - Relay Server
 */

import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import path from 'path';
import { fileURLToPath } from 'url';

// ============================================
// Configuration
// ============================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DEEPGRAM_OPTIONS = {
  model: 'nova-2',
  language: 'th',
  smart_format: false,
  interim_results: true,
  punctuate: false,
  diarize: false,
  utterances: false,
  filler_words: false, // Keep filler words for verbatim
  endpointing: false, // Don't auto-segment
  vad_turnoff: 0, // Disable Deepgram VAD (using Silero)
  encoding: 'linear16',
  sample_rate: 48000,
  channels: 1,
} as const;

const PORT = process.env.PORT || 3000;

// Validate API keys
if (!process.env.DEEPGRAM_API_KEY) {
  console.error('❌ ERROR: DEEPGRAM_API_KEY not set');
  process.exit(1);
}

if (!process.env.GEMINI_API_KEY) {
  console.warn('⚠️  WARNING: GEMINI_API_KEY not set (optional)');
}

// ============================================
// Utilities
// ============================================

/**
 * Fix Thai text spacing issues from STT
 */
function fixThaiTranscript(text: string): string {
  if (!text) return text;

  return text
    .replace(/([ก-ฮ])\s+([ั ิ ี ึ ื ุ ู ็ ์])/g, '$1$2')
    .replace(/([ก-ฮ][ั ิ ี ึ ื ุ ู]?)\s+([ก-ฮ][ั ิ ี ึ ื ุ ู ็ ์])/g, '$1$2')
    .replace(/\s+([ั ิ ี ึ ื ุ ู เ แ โ ใ ไ ำ ็ ์])/g, '$1')
    .replace(/([ั ิ ี ึ ื ุ ู เ แ โ ใ ไ ำ ็ ์])\s+/g, '$1')
    .replace(/([ก-ฮ])\s([ก-ฮ])\s([ก-ฮ])/g, '$1$2$3')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Convert WebSocket data to ArrayBuffer
 */
function toArrayBuffer(data: ArrayBuffer | Buffer): ArrayBuffer {
  if (data instanceof Buffer) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  }
  return data as ArrayBuffer;
}

/**
 * Log audio chunk info (debug)
 */
function logAudioChunk(data: ArrayBuffer | Buffer, chunkNumber: number) {
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

// ============================================
// Server Setup
// ============================================

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

// Initialize Gemini if API key is available
let genAI: GoogleGenerativeAI | null = null;
if (process.env.GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

app.get('/health', (_, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    providers: {
      deepgram: !!process.env.DEEPGRAM_API_KEY,
      gemini: !!process.env.GEMINI_API_KEY,
    }
  });
});

// ============================================
// WebSocket Upgrade Handler
// ============================================

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url!, `http://${request.headers.host}`).pathname;

  if (pathname === '/') {
    // Deepgram route
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('deepgram', ws, request);
    });
  } else if (pathname === '/gemini') {
    // Gemini route
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('gemini', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// ============================================
// Deepgram WebSocket Handler
// ============================================

wss.on('deepgram', handleDeepgramConnection);

function handleDeepgramConnection(clientSocket: WebSocket) {
  console.log('📱 Client connected');

  let deepgramLive = deepgram.listen.live(DEEPGRAM_OPTIONS);
  let audioChunkCount = 0;
  let isClosing = false;

  // Cleanup function
  const cleanup = () => {
    if (isClosing) return;
    isClosing = true;
    try {
      deepgramLive?.finish();
    } catch (e) {
      // ignore
    }
  };

  // Setup Deepgram event handlers
  setupDeepgramHandlers(deepgramLive, clientSocket);

  // Handle audio from client
  clientSocket.on('message', (data: ArrayBuffer | Buffer) => {
    if (deepgramLive?.getReadyState() === 1) {
      audioChunkCount++;
      logAudioChunk(data, audioChunkCount);
      deepgramLive.send(toArrayBuffer(data));
    }
  });

  // Client disconnect
  clientSocket.on('close', () => {
    console.log('📱 Client disconnected');
    cleanup();
  });

  clientSocket.on('error', (err) => {
    console.error('❌ Client error:', err.message);
    cleanup();
  });
}

/**
 * Setup all Deepgram event handlers
 */
function setupDeepgramHandlers(
  deepgramLive: ReturnType<typeof deepgram.listen.live>,
  clientSocket: WebSocket
) {
  deepgramLive.on('error', (err: Error) => {
    console.error('❌ Deepgram error:', err.message);
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.send(JSON.stringify({ type: 'error', message: err.message }));
      clientSocket.close(1011, 'Deepgram failed');
    }
  });

  deepgramLive.on(LiveTranscriptionEvents.Open, () => {
    console.log('🎙️  Deepgram connected');
  });

  deepgramLive.on(LiveTranscriptionEvents.Transcript, (data) => {
    const raw = data?.channel?.alternatives?.[0]?.transcript;
    const fixed = raw ? fixThaiTranscript(raw) : '';

    console.log(`📝 [${data.is_final ? 'FINAL' : 'interim'}] ${fixed}`);

    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.send(JSON.stringify({
        ...data,
        channel: {
          ...data.channel,
          alternatives: [{
            ...data.channel.alternatives[0],
            transcript: fixed
          }]
        }
      }));
    }
  });

  deepgramLive.on(LiveTranscriptionEvents.Close, () => {
    console.log('🔌 Deepgram closed');
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.close();
    }
  });
}

// ============================================
// Gemini WebSocket Handler
// ============================================

wss.on('gemini', handleGeminiConnection);

/**
 * Clean Gemini transcription output
 */
function cleanGeminiTranscription(text: string): string {
  if (!text) return '';

  let cleaned = text
    // Remove the prompt text that sometimes gets echoed
    .replace(/ถอดความเสียงนี้เป็นข้อความที่สละสวย จัดวรรคตอนให้เหมาะสม:?/gi, '')
    .replace(/ถอดความเสียงนี้.*/gi, '')
    // Remove greeting words
    .replace(/^(สวัสดีค่ะ|สวัสดีครับ|สวัสดี)[\s,]*/gi, '')
    .replace(/[\s,]*(สวัสดีค่ะ|สวัสดีครับ)[\s,]*/gi, ' ')
    // Remove timestamps
    .replace(/\[?\(?\d{1,2}:\d{2}(:\d{2})?\)?\]?/g, '')
    // Remove markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`/g, '')
    // Remove periods after Thai text
    .replace(/([\u0E00-\u0E7F])\./g, '$1')
    // Remove repeated words
    .replace(/\b(\S+)\s+\1\b/gi, '$1')
    // Remove extra whitespace
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned;
}

function handleGeminiConnection(clientSocket: WebSocket) {
  console.log('📱 Gemini client connected');

  if (!genAI) {
    console.error('❌ Gemini API key not configured');
    clientSocket.send(JSON.stringify({
      type: 'error',
      error: 'Gemini API key not configured on server'
    }));
    clientSocket.close();
    return;
  }

  let model: any = null;
  let audioBuffer: Buffer[] = [];
  const BATCH_SIZE = 64000; // ~2 seconds of audio
  let isProcessing = false;

  // Notify connected
  clientSocket.send(JSON.stringify({ type: 'connected' }));

  clientSocket.on('message', async (data: Buffer) => {
    try {
      // Try to parse as JSON (control messages)
      const message = JSON.parse(data.toString());

      if (message.type === 'start') {
        console.log('🎬 Starting Gemini session');

        // Initialize model with Thai-optimized system instruction
        const apiKey = message.apiKey || process.env.GEMINI_API_KEY;
        const customGenAI = new GoogleGenerativeAI(apiKey);

        model = customGenAI.getGenerativeModel({
          model: 'gemini-2.0-flash',
          generationConfig: {
            temperature: 0,
            topP: 1,
            topK: 1,
            maxOutputTokens: 512,
          },
          systemInstruction: `คุณคือนักถอดความ หน้าที่:
1. ถอดเสียงพูดให้ตรงตามที่ได้ยินเท่านั้น ห้ามเพิ่มหรือตัดคำใดๆ เด็ดขาด
2. ห้ามเพิ่ม "ครับ" "ค่ะ" "นะ" "ฮะ" ถ้าในเสียงไม่มี
3. เขียนภาษาไทยติดกันตามปกติ เว้นวรรคหลังคำลงท้ายประโยคที่ได้ยินจริงเท่านั้น
4. ถ้าเป็นเสียงดนตรี/เสียงรบกวน/ไม่มีคำพูด ให้ตอบว่างเปล่า
5. ภาษาอังกฤษ: มี space ระหว่างคำ ขึ้นต้นประโยคด้วยตัวพิมพ์ใหญ่`,
        });

        clientSocket.send(JSON.stringify({ type: 'started' }));

      } else if (message.type === 'stop') {
        console.log('🛑 Stopping Gemini session');
        model = null;
        audioBuffer = [];
        isProcessing = false;
        clientSocket.send(JSON.stringify({ type: 'stopped' }));
      }

    } catch (parseError) {
      // Not JSON, treat as audio data
      if (data instanceof Buffer && model) {
        audioBuffer.push(data);
        const totalSize = audioBuffer.reduce((sum, buf) => sum + buf.length, 0);

        // Send batch when accumulated enough audio
        if (totalSize >= BATCH_SIZE && !isProcessing) {
          isProcessing = true;
          const audioBlob = Buffer.concat(audioBuffer);
          audioBuffer = [];

          try {
            // Convert PCM to WAV format
            const wavBuffer = convertPCMtoWAV(audioBlob, 16000, 1, 16);

            // Send audio to Gemini using generateContent
            const result = await model.generateContent([
              {
                inlineData: {
                  data: wavBuffer.toString('base64'),
                  mimeType: 'audio/wav',
                },
              },
            ]);

            const text = result.response.text();
            const cleaned = cleanGeminiTranscription(text);

            if (cleaned) {
              console.log(`📝 Gemini transcript: ${cleaned}`);

              // Send transcript in Deepgram-compatible format
              clientSocket.send(JSON.stringify({
                type: 'transcript',
                text: cleaned,
                isFinal: true,
                channel: {
                  alternatives: [{
                    transcript: cleaned,
                    confidence: 1.0,
                  }]
                }
              }));
            }

          } catch (err: any) {
            console.error('Gemini API error:', err.message);
            clientSocket.send(JSON.stringify({
              type: 'error',
              error: err.message || 'Gemini processing error'
            }));
          } finally {
            isProcessing = false;
          }
        }
      }
    }
  });

  clientSocket.on('close', () => {
    console.log('🔌 Gemini client disconnected');
    model = null;
    audioBuffer = [];
    isProcessing = false;
  });

  clientSocket.on('error', (error) => {
    console.error('Gemini WebSocket error:', error);
  });
}

// ============================================
// PCM to WAV Conversion
// ============================================

/**
 * Convert PCM buffer to WAV format for Gemini
 */
function convertPCMtoWAV(
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

// ============================================
// Start Server
// ============================================

server.listen(PORT, () => {
  console.log('');
  console.log('🎙️  Thai Verbatim Transcriber - Relay Server');
  console.log('═══════════════════════════════════════════');
  console.log(`📡 Deepgram:  ws://localhost:${PORT}`);
  console.log(`🤖 Gemini:    ws://localhost:${PORT}/gemini`);
  console.log(`🔐 Deepgram:  ${process.env.DEEPGRAM_API_KEY ? '✓ Loaded' : '✗ Missing'}`);
  console.log(`🔐 Gemini:    ${process.env.GEMINI_API_KEY ? '✓ Loaded' : '✗ Missing'}`);
  console.log(`🌐 Health:    http://localhost:${PORT}/health`);
  console.log('');
});

