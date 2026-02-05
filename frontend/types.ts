/**
 * Type definitions for Real-time Thai Transcription
 */

// ============================================
// Deepgram API Types
// ============================================

/**
 * Word-level transcription data from Deepgram
 */
export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  punctuated_word?: string;
}

/**
 * Single transcription alternative from Deepgram
 */
export interface DeepgramTranscript {
  confidence: number;
  transcript: string;
  words: TranscriptWord[];
}

/**
 * Channel data containing transcription alternatives
 */
export interface DeepgramChannel {
  alternatives: DeepgramTranscript[];
}

/**
 * WebSocket response from Deepgram Live Transcription API
 */
export interface DeepgramResponse {
  type: 'Results' | 'Metadata' | 'SpeechStarted' | 'UtteranceEnd';
  channel_index: number[];
  duration: number;
  start: number;
  is_final: boolean;
  speech_final: boolean;
  channel: DeepgramChannel;
}

/**
 * Error response from relay server
 */
export interface DeepgramErrorResponse {
  type: 'error';
  message: string;
}

// ============================================
// Application Types
// ============================================

/**
 * Supported ASR (Automatic Speech Recognition) providers
 */
export enum ASRProvider {
  DEEPGRAM = 'deepgram',
  GOOGLE = 'google',
  GEMINI = 'gemini',
  // AZURE = 'azure',     // Future
  // AWS = 'aws',         // Future
  // OPENAI = 'openai',   // Future (Whisper API)
}

/**
 * Provider-specific configuration
 */
export interface ProviderConfig {
  deepgram?: {
    model?: string;        // 'nova-2' (default), 'nova-3', 'enhanced', 'base'
    tier?: string;         // 'nova', 'enhanced', 'base'
    version?: string;      // API version
  };
  google?: {
    model?: string;        // 'default', 'command_and_search', 'phone_call', 'video'
    useEnhanced?: boolean; // Enhanced model (paid)
    apiKey?: string;       // Google Cloud API key
  };
  gemini?: {
    model?: string;        // 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'
    apiKey?: string;       // Gemini API key
    temperature?: number;  // 0-1
  };
  azure?: {
    subscriptionKey?: string; // Azure Speech Service subscription key
    region?: string;          // Azure region (e.g., 'southeastasia')
    model?: string;           // 'default', 'enhanced', etc.
  };
}

/**
 * Processed transcript segment for display
 */
export interface TranscriptSegment {
  id: string;
  text: string;
  isFinal: boolean;
  timestamp: number;
}

/**
 * LiveKit transcript message from Agent (via Data Channel)
 */
export interface LiveKitTranscriptMessage {
  text: string;
  is_final: boolean;
  confidence?: number;
  timestamp?: number;
  provider?: string;
}

/**
 * WebSocket connection states
 */
export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

/**
 * Application configuration stored in localStorage
 */
export interface AppConfig {
  /** Selected ASR provider */
  provider: ASRProvider;
  /** Deepgram API key for direct client-side connection (demo only) */
  apiKey: string;
  /** WebSocket URL for relay server mode */
  backendUrl: string;
  /** Whether to use backend relay server */
  useBackend: boolean;
  /** Provider-specific configurations */
  providerConfig?: ProviderConfig;
  /** VAD configuration */
  vadConfig?: {
    enabled: boolean;
    threshold: number; // 0.0 - 1.0, default 0.5
  };
  /** Selected audio input device ID */
  audioDeviceId?: string;
}

// ============================================
// Component Props Types
// ============================================

/**
 * Props for the useDeepgram hook return value
 */
export interface UseDeepgramReturn {
  connectionState: ConnectionState;
  transcripts: TranscriptSegment[];
  interimTranscript: string;
  error: string | null;
  mediaStream: MediaStream | null;
  startStreaming: () => Promise<void>;
  stopStreaming: () => void;
  clearTranscripts: () => void;
}