/**
 * Type definitions for Real-time Thai Transcription
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
  provider?: string;   // ASR provider: "google", "gemini", "azure"
  speaker?: string;    // Speaker identity: "user-123"
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
