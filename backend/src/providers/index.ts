/**
 * ASR Providers Registry
 */

import { DeepgramProvider } from './deepgram.js';
import { GeminiProvider } from './gemini.js';
import type { ASRProvider } from '../types.js';

// ============================================
// Provider Registry
// ============================================

export const providers: Record<string, ASRProvider> = {
    deepgram: DeepgramProvider,
    gemini: GeminiProvider,
};

// ============================================
// Provider Utilities
// ============================================

export function getProvider(name: string): ASRProvider | undefined {
    return providers[name.toLowerCase()];
}

export function getAvailableProviders(): ASRProvider[] {
    return Object.values(providers).filter(p => p.isAvailable());
}

export function listProviders(): { name: string; key: string; available: boolean }[] {
    return Object.entries(providers).map(([key, provider]) => ({
        name: provider.name,
        key,
        available: provider.isAvailable(),
    }));
}

// Re-export individual providers
export { DeepgramProvider } from './deepgram.js';
export { GeminiProvider } from './gemini.js';
