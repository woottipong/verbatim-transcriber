/**
 * Application Constants
 * Centralized configuration for the Real-time Thai Transcription
 */

import { ASRProvider } from '../types';

// Storage Keys (versioned to force updates when structure changes)
export const STORAGE_KEYS = {
    CONFIG: 'th-asr-config-v4', // Bumped version for provider support
} as const;

// ASR Provider Information
export const ASR_PROVIDERS = {
    [ASRProvider.GOOGLE]: {
        name: 'Google Cloud STT',
        description: 'Cloud Speech-to-Text API (Streaming)',
        supported: true,
        languages: ['th-TH', 'en-US'],
    },
    [ASRProvider.GEMINI]: {
        name: 'Gemini 2.0 Flash',
        description: 'Multimodal AI with audio understanding (Batch)',
        supported: true,
        languages: ['th', 'en', 'multilingual'],
    },
    [ASRProvider.AZURE]: {
        name: 'Azure Speech',
        description: 'Azure Speech Services (Batch)',
        supported: true,
        languages: ['th-TH', 'en-US'],
    },
} as const;

// Google Speech-to-Text Configuration
export const GOOGLE_CONFIG = {
    LANGUAGE_CODE: 'th-TH',
    MODEL: 'default',
    USE_ENHANCED: false,
    SAMPLE_RATE: 48000,
} as const;

// Azure Speech Configuration
export const AZURE_CONFIG = {
    LANGUAGE_CODE: 'th-TH',
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
    SAMPLE_RATE: 16000,
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
    provider: ASRProvider.GOOGLE, // Default to Google
    apiKey: '', // Not used for backend mode
    backendUrl: import.meta.env.VITE_BACKEND_URL || 'ws://localhost:3000',
    useBackend: true, // Always use backend
    providerConfig: {
        google: {
            model: 'default',
        },
    },
    vadConfig: {
        enabled: false, // VAD has WASM compatibility issues with Vite
        threshold: 0.4,
    },
} as const;

// Connection timeout (ms)
export const CONNECTION_TIMEOUT_MS = 10000;
