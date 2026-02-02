/**
 * Backend TypeScript Types
 */

import { WebSocket } from 'ws';

// ============================================
// Provider Types
// ============================================

export interface ASRProvider {
    name: string;
    isAvailable: () => boolean;
    handleConnection: (clientSocket: WebSocket) => void;
}

export interface ProviderConfig {
    apiKey: string | undefined;
    enabled: boolean;
}

// ============================================
// Message Types
// ============================================

export interface TranscriptMessage {
    type: 'transcript';
    text: string;
    isFinal: boolean;
    channel?: {
        alternatives: Array<{
            transcript: string;
            confidence: number;
        }>;
    };
}

export interface ErrorMessage {
    type: 'error';
    error: string;
    message?: string;
}

export interface ControlMessage {
    type: 'start' | 'stop' | 'connected' | 'started' | 'stopped';
    apiKey?: string;
    message?: string;
}

export type WSMessage = TranscriptMessage | ErrorMessage | ControlMessage;

// ============================================
// Audio Types
// ============================================

export interface AudioConfig {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
    encoding: string;
}

// ============================================
// Deepgram Types
// ============================================

export interface DeepgramOptions {
    model: string;
    language: string;
    smart_format: boolean;
    interim_results: boolean;
    punctuate: boolean;
    diarize: boolean;
    utterances: boolean;
    filler_words: boolean;
    endpointing: number | false;
    vad_turnoff: number;
    encoding: string;
    sample_rate: number;
    channels: number;
    // Index signature for LiveSchema compatibility
    [key: string]: string | number | boolean | undefined;
}

// ============================================
// Gemini Types
// ============================================

export interface GeminiConfig {
    model: string;
    temperature: number;
    topP: number;
    topK: number;
    maxOutputTokens: number;
    systemInstruction: string;
}

export interface GeminiSession {
    model: any;
    audioBuffer: Buffer[];
    isProcessing: boolean;
    batchSize: number;
}
