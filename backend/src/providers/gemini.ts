/**
 * Gemini ASR Provider
 */

import { WebSocket } from 'ws';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { API_KEYS, GEMINI_CONFIG, GEMINI_BATCH_SIZE, AUDIO_CONFIG } from '../config.js';
import { cleanGeminiTranscription, convertPCMtoWAV } from '../utils/index.js';
import type { ASRProvider, GeminiSession } from '../types.js';

// ============================================
// Provider Implementation
// ============================================

export const GeminiProvider: ASRProvider = {
    name: 'Gemini 2.0 Flash',

    isAvailable: () => !!API_KEYS.GEMINI,

    handleConnection: (clientSocket: WebSocket) => {
        if (!API_KEYS.GEMINI) {
            console.error('❌ [Gemini] API key not configured');
            clientSocket.send(JSON.stringify({
                type: 'error',
                error: 'Gemini API key not configured on server'
            }));
            clientSocket.close();
            return;
        }

        console.log('📱 [Gemini] Client connected');

        // Session state
        const session: GeminiSession = {
            model: null,
            audioBuffer: [],
            isProcessing: false,
            batchSize: GEMINI_BATCH_SIZE,
        };

        // Notify connected
        clientSocket.send(JSON.stringify({ type: 'connected' }));

        // Handle messages
        clientSocket.on('message', async (data: Buffer) => {
            try {
                // Try to parse as JSON (control messages)
                const message = JSON.parse(data.toString());
                await handleControlMessage(clientSocket, session, message);
            } catch (parseError) {
                // Not JSON, treat as audio data
                if (data instanceof Buffer && session.model) {
                    await handleAudioData(clientSocket, session, data);
                }
            }
        });

        // Cleanup on disconnect
        clientSocket.on('close', () => {
            console.log('🔌 [Gemini] Client disconnected');
            session.model = null;
            session.audioBuffer = [];
            session.isProcessing = false;
        });

        clientSocket.on('error', (error) => {
            console.error('❌ [Gemini] WebSocket error:', error);
        });
    },
};

// ============================================
// Message Handlers
// ============================================

async function handleControlMessage(
    clientSocket: WebSocket,
    session: GeminiSession,
    message: { type: string; apiKey?: string }
): Promise<void> {
    switch (message.type) {
        case 'start':
            console.log('🎬 [Gemini] Starting session');

            const apiKey = message.apiKey || API_KEYS.GEMINI;
            const genAI = new GoogleGenerativeAI(apiKey!);

            session.model = genAI.getGenerativeModel({
                model: GEMINI_CONFIG.model,
                generationConfig: {
                    temperature: GEMINI_CONFIG.temperature,
                    topP: GEMINI_CONFIG.topP,
                    topK: GEMINI_CONFIG.topK,
                    maxOutputTokens: GEMINI_CONFIG.maxOutputTokens,
                },
                systemInstruction: GEMINI_CONFIG.systemInstruction,
            });

            clientSocket.send(JSON.stringify({ type: 'started' }));
            break;

        case 'stop':
            console.log('🛑 [Gemini] Stopping session');
            session.model = null;
            session.audioBuffer = [];
            session.isProcessing = false;
            clientSocket.send(JSON.stringify({ type: 'stopped' }));
            break;

        default:
            console.log('[Gemini] Unknown control message:', message.type);
    }
}

async function handleAudioData(
    clientSocket: WebSocket,
    session: GeminiSession,
    data: Buffer
): Promise<void> {
    session.audioBuffer.push(data);
    const totalSize = session.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);

    // Process batch when accumulated enough audio
    if (totalSize >= session.batchSize && !session.isProcessing) {
        session.isProcessing = true;
        const audioBlob = Buffer.concat(session.audioBuffer);
        session.audioBuffer = [];

        try {
            // Convert PCM to WAV format
            const wavBuffer = convertPCMtoWAV(
                audioBlob,
                AUDIO_CONFIG.sampleRate,
                AUDIO_CONFIG.channels,
                AUDIO_CONFIG.bitsPerSample
            );

            // Send audio to Gemini
            const result = await session.model.generateContent([
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
                console.log(`📝 [Gemini] ${cleaned}`);

                // Send transcript
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
            console.error('[Gemini] API error:', err.message);
            clientSocket.send(JSON.stringify({
                type: 'error',
                error: err.message || 'Gemini processing error'
            }));
        } finally {
            session.isProcessing = false;
        }
    }
}

export default GeminiProvider;
