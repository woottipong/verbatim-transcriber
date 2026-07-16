/**
 * Utility functions for the Real-time Thai Transcription
 */

/**
 * Safe JSON parse with fallback
 */
export const safeJsonParse = <T>(json: string, fallback: T): T => {
    try {
        return JSON.parse(json) as T;
    } catch {
        return fallback;
    }
};
