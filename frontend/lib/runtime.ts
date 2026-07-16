import type { AppConfig } from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

export function normalizeAppConfig(candidate: unknown, defaults: AppConfig): AppConfig {
    if (!isRecord(candidate)) return defaults;

    const backendUrl = typeof candidate.backendUrl === 'string' && /^https?:\/\//.test(toHttpUrl(candidate.backendUrl))
        ? candidate.backendUrl
        : defaults.backendUrl;

    const normalized: AppConfig = {
        ...defaults,
        backendUrl,
    };

    if (typeof candidate.audioDeviceId === 'string') {
        normalized.audioDeviceId = candidate.audioDeviceId;
    }

    return normalized;
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
