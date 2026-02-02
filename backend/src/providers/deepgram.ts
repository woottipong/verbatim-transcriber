/**
 * Deepgram ASR Provider
 */

import { WebSocket } from 'ws';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { API_KEYS, DEEPGRAM_CONFIG } from '../config.js';
import { fixThaiTranscript, toArrayBuffer, logAudioChunk } from '../utils/index.js';
import type { ASRProvider } from '../types.js';

// ============================================
// Deepgram Client
// ============================================

let deepgramClient: ReturnType<typeof createClient> | null = null;

function getClient() {
    if (!deepgramClient && API_KEYS.DEEPGRAM) {
        deepgramClient = createClient(API_KEYS.DEEPGRAM);
    }
    return deepgramClient;
}

// ============================================
// Provider Implementation
// ============================================

export const DeepgramProvider: ASRProvider = {
    name: 'Deepgram Nova-2',

    isAvailable: () => !!API_KEYS.DEEPGRAM,

    handleConnection: (clientSocket: WebSocket) => {
        const client = getClient();
        if (!client) {
            clientSocket.send(JSON.stringify({ type: 'error', message: 'Deepgram API key not configured' }));
            clientSocket.close();
            return;
        }

        console.log('📱 [Deepgram] Client connected');

        let deepgramLive = client.listen.live(DEEPGRAM_CONFIG);
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
        setupEventHandlers(deepgramLive, clientSocket);

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
            console.log('📱 [Deepgram] Client disconnected');
            cleanup();
        });

        clientSocket.on('error', (err) => {
            console.error('❌ [Deepgram] Client error:', err.message);
            cleanup();
        });
    },
};

// ============================================
// Event Handlers
// ============================================

function setupEventHandlers(
    deepgramLive: ReturnType<ReturnType<typeof createClient>['listen']['live']>,
    clientSocket: WebSocket
) {
    deepgramLive.on('error', (err: Error) => {
        console.error('❌ [Deepgram] Error:', err.message);
        if (clientSocket.readyState === WebSocket.OPEN) {
            clientSocket.send(JSON.stringify({ type: 'error', message: err.message }));
            clientSocket.close(1011, 'Deepgram failed');
        }
    });

    deepgramLive.on(LiveTranscriptionEvents.Open, () => {
        console.log('🎙️  [Deepgram] Connected');
    });

    deepgramLive.on(LiveTranscriptionEvents.Transcript, (data) => {
        const raw = data?.channel?.alternatives?.[0]?.transcript;
        const fixed = raw ? fixThaiTranscript(raw) : '';

        console.log(`📝 [Deepgram] [${data.is_final ? 'FINAL' : 'interim'}] ${fixed}`);

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
        console.log('🔌 [Deepgram] Closed');
        if (clientSocket.readyState === WebSocket.OPEN) {
            clientSocket.close();
        }
    });
}

export default DeepgramProvider;
