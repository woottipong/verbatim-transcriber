/**
 * Type definitions for Real-time Thai Transcription
 */

// ============================================
// ASR Provider Types
// ============================================

/**
 * Supported ASR (Automatic Speech Recognition) providers
 */
export enum ASRProvider {
  GOOGLE = 'google',
  AZURE = 'azure',
}

/**
 * Provider-specific configuration
 */
export interface ProviderConfig {
  google?: {
    model?: string;        // 'default', 'command_and_search', 'phone_call', 'video'
    useEnhanced?: boolean; // Enhanced model (paid)
  };
  azure?: {
    region?: string;       // Azure region (e.g., 'southeastasia')
    model?: string;        // 'default', 'enhanced', etc.
  };
}

// ============================================
// Transcript Types
// ============================================

/**
 * Word-level transcription data
 */
export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  punctuated_word?: string;
}

/**
 * Single transcription alternative
 */
export interface TranscriptAlternative {
  confidence: number;
  transcript: string;
  words?: TranscriptWord[];
}

/**
 * Channel data containing transcription alternatives
 */
export interface TranscriptChannel {
  alternatives: TranscriptAlternative[];
}

/**
 * Processed transcript segment for display
 */
export interface TranscriptSegment {
  id: string;
  text: string;
  isFinal: boolean;
  timestamp: number;
  provider?: string;   // ASR provider: "google", "azure"
  speaker?: string;    // Speaker identity: "user-123"
}

// ============================================
// WebSocket Types
// ============================================

/**
 * WebSocket response from ASR providers
 */
export interface ASRResponse {
  type: 'transcript' | 'error' | 'connected';
  transcript?: string;
  is_final?: boolean;
  channel?: TranscriptChannel;
  error?: string;
}

/**
 * Error response from relay server
 */
export interface ASRErrorResponse {
  type: 'error';
  message: string;
}

// ============================================
// LiveKit Types
// ============================================

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

// ============================================
// Connection Types
// ============================================

/**
 * WebSocket connection states
 */
export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

// ============================================
// Configuration Types
// ============================================

/**
 * Application configuration stored in localStorage
 */
export interface AppConfig {
  /** Selected ASR provider */
  provider: ASRProvider;
  /** API key (deprecated - use backend) */
  apiKey: string;
  /** WebSocket URL for relay server */
  backendUrl: string;
  /** Whether to use backend relay server */
  useBackend: boolean;
  /** Provider-specific configurations */
  providerConfig?: ProviderConfig;
  /** VAD configuration */
  vadConfig?: {
    enabled: boolean;
    threshold: number; // 0.0 - 1.0
  };
  /** Selected audio input device ID */
  audioDeviceId?: string;
}

// ============================================
// Hook Return Types
// ============================================

/**
 * Common return type for ASR hooks
 */
export interface UseASRReturn {
  connectionState: ConnectionState;
  transcripts: TranscriptSegment[];
  interimTranscript: string;
  error: string | null;
  mediaStream: MediaStream | null;
  startStreaming: () => Promise<void>;
  stopStreaming: () => void;
  clearTranscripts: () => void;
}