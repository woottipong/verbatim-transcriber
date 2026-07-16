import type { AppConfig } from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

export function normalizeAppConfig(candidate: unknown, defaults: AppConfig): AppConfig {
    if (!isRecord(candidate)) return defaults;

    const backendUrl = typeof candidate.backendUrl === 'string' && /^wss?:\/\//.test(candidate.backendUrl)
        ? candidate.backendUrl
        : defaults.backendUrl;
    const provider = candidate.provider === 'google' || candidate.provider === 'azure'
        ? candidate.provider as AppConfig['provider']
        : defaults.provider;
    const vadConfig = isRecord(candidate.vadConfig)
        && typeof candidate.vadConfig.enabled === 'boolean'
        && typeof candidate.vadConfig.threshold === 'number'
        && candidate.vadConfig.threshold >= 0
        && candidate.vadConfig.threshold <= 1
        ? {
            enabled: candidate.vadConfig.enabled,
            threshold: candidate.vadConfig.threshold,
        }
        : defaults.vadConfig;

    const normalized: AppConfig = {
        ...defaults,
        provider,
        backendUrl,
        apiKey: typeof candidate.apiKey === 'string' ? candidate.apiKey : defaults.apiKey,
        useBackend: typeof candidate.useBackend === 'boolean' ? candidate.useBackend : defaults.useBackend,
        vadConfig,
    };

    if (isRecord(candidate.providerConfig)) {
        normalized.providerConfig = candidate.providerConfig as AppConfig['providerConfig'];
    }
    if (typeof candidate.audioDeviceId === 'string') {
        normalized.audioDeviceId = candidate.audioDeviceId;
    }

    return normalized;
}

export function shouldUseVAD(enabled: boolean, hasController: boolean): boolean {
    return enabled && hasController;
}

export function stopMediaStream(stream: Pick<MediaStream, 'getTracks'> | null | undefined): void {
    stream?.getTracks().forEach(track => track.stop());
}

export function toHttpUrl(url: string): string {
    return url.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
}

export function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

export function appendBounded<T>(items: T[], item: T, limit = 500): T[] {
    return [...items.slice(-(limit - 1)), item];
}
