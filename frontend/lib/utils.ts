/**
 * Utility functions for the Thai Verbatim Transcriber
 */

import { MEDIA_RECORDER_CONFIG } from './constants';

/**
 * Get the best supported MIME type for MediaRecorder
 */
export const getSupportedMimeType = (): string => {
    for (const type of MEDIA_RECORDER_CONFIG.PREFERRED_MIME_TYPES) {
        if (type === '' || MediaRecorder.isTypeSupported(type)) {
            return type;
        }
    }
    return '';
};

/**
 * Generate a unique ID (wrapper for crypto.randomUUID with fallback)
 */
export const generateId = (): string => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback for older browsers
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

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

/**
 * Format timestamp to readable string
 */
export const formatTimestamp = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString('th-TH', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
};

/**
 * Debounce function
 */
export const debounce = <T extends (...args: unknown[]) => void>(
    fn: T,
    delay: number
): ((...args: Parameters<T>) => void) => {
    let timeoutId: ReturnType<typeof setTimeout>;
    return (...args: Parameters<T>) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
    };
};
