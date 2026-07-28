/**
 * Type definitions for CaptionLive
 */

// ============================================
// Transcript Types
// ============================================

/**
 * Processed transcript segment for display
 */
export interface TranscriptSegment {
  id: string;
  text: string;
  isFinal: boolean;
  timestamp: number;
  provider?: string;   // ASR provider: "google", "gemini", "azure", "gpt-realtime-whisper"
  role?: 'source' | 'translation';
  languageCode?: string;
  turnId?: string;
  segmentId?: string;
  translation?: TranscriptTranslation;
}

export interface TranscriptTranslation {
  text: string;
  languageCode: string;
  isFinal: boolean;
}

// ============================================
// Connection Types
// ============================================

/**
 * LiveKit connection states
 */
export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export type AudioSource = 'microphone' | 'chrome-tab';

// ============================================
// Configuration Types
// ============================================

/**
 * Application configuration stored in localStorage
 */
export interface AppConfig {
  /** Backend HTTP base URL */
  backendUrl: string;
  /** Selected audio input device ID */
  audioDeviceId?: string;
}
