/**
 * Application Constants
 * Centralized configuration for the Thai Verbatim Transcriber
 */

import { ASRProvider } from '../types';

// Storage Keys (versioned to force updates when structure changes)
export const STORAGE_KEYS = {
    CONFIG: 'th-asr-config-v3', // Bumped version for provider support
} as const;

// ASR Provider Information
export const ASR_PROVIDERS = {
    [ASRProvider.DEEPGRAM]: {
        name: 'Deepgram',
        description: 'Nova-2 model, optimized for Thai',
        supported: true,
        languages: ['th', 'en'],
    },
    [ASRProvider.GOOGLE]: {
        name: 'Google Speech-to-Text',
        description: 'Cloud Speech-to-Text API',
        supported: false, // Coming soon
        languages: ['th-TH', 'en-US'],
    },
    [ASRProvider.GEMINI]: {
        name: 'Gemini 2.0 Flash',
        description: 'Multimodal AI with audio understanding',
        supported: true,
        languages: ['th', 'en', 'multilingual'],
    },
} as const;

// Deepgram Configuration
export const DEEPGRAM_CONFIG = {
    MODEL: 'nova-2',
    LANGUAGE: 'th',
    SMART_FORMAT: true, // Enable for better formatting (numbers, spacing, etc.)
    INTERIM_RESULTS: true,
    PUNCTUATE: true, // Enable for Thai readability
    FILLER_WORDS: false, // Keep filler words for verbatim
    DIARIZE: false,
    UTTERANCES: false,
    ENDPOINTING: 2000, // Wait 2 seconds of silence before finalizing
    VAD_TURNOFF: 2000, // Enable Deepgram VAD, wait 2 sec before cutting
    API_BASE_URL: 'wss://api.deepgram.com/v1/listen',
} as const;

// Google Speech-to-Text Configuration (Future)
export const GOOGLE_CONFIG = {
    LANGUAGE_CODE: 'th-TH',
    MODEL: 'default',
    USE_ENHANCED: false,
    SAMPLE_RATE: 16000,
} as const;

// Gemini Configuration
export const GEMINI_CONFIG = {
    MODEL: 'gemini-2.0-flash',
    TEMPERATURE: 0,
    TOP_P: 1,
    TOP_K: 1,
    MAX_OUTPUT_TOKENS: 512,
    BATCH_SIZE_BYTES: 64000, // ~2 seconds of audio
    API_BASE_URL: 'ws://localhost:5001/api/stream',
} as const;

// MediaRecorder Configuration
export const MEDIA_RECORDER_CONFIG = {
    CHUNK_INTERVAL_MS: 250, // 250ms chunks for low latency
    PREFERRED_MIME_TYPES: [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        '', // Browser default fallback
    ],
} as const;

// Audio Visualizer Configuration
export const VISUALIZER_CONFIG = {
    BAR_COUNT: 20,
    FFT_SIZE: 64,
    SMOOTHING: 0.8,
} as const;

// Default App Configuration
export const DEFAULT_CONFIG = {
    provider: ASRProvider.DEEPGRAM, // Default to Deepgram
    apiKey: import.meta.env.VITE_DEEPGRAM_API_KEY || '',
    backendUrl: import.meta.env.VITE_BACKEND_URL || 'ws://localhost:3000',
    useBackend: true, // Default to safer backend mode
    providerConfig: {
        deepgram: {
            model: 'nova-2',
        },
    },
    vadConfig: {
        enabled: false, // ⚠️ DISABLED: VAD has WASM compatibility issues with Vite
        threshold: 0.4, // Fallback mode: streams all audio (works perfectly)
    },
} as const;

// Connection timeout (ms)
export const CONNECTION_TIMEOUT_MS = 10000;
