/**
 * Application Constants
 * Centralized configuration for CaptionLive
 */

// Storage Keys (versioned to force updates when structure changes)
export const STORAGE_KEYS = {
    CONFIG: 'th-asr-config-v5',
} as const;

// Default App Configuration
export const DEFAULT_CONFIG = {
    backendUrl: import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000',
} as const;
