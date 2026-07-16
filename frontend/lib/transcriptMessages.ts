import type { TranscriptSegment } from '../types';

export interface TranscriptMessage {
    type: 'transcript';
    text: string;
    isFinal: boolean;
    confidence?: number;
    timestamp?: number;
    provider?: string;
    speaker?: string;
}

export interface InterimTranscript {
    key: string;
    text: string;
    provider: string;
    speaker: string;
    sourceIdentity: string;
}

export function isAppendOnlyInterimProvider(provider: string): boolean {
    return provider.toLowerCase() === 'gemini';
}

export function appendTranscriptIfNew(
    current: ReadonlyArray<TranscriptSegment>,
    next: TranscriptSegment,
): TranscriptSegment[] {
    const previous = current[current.length - 1];
    if (
        previous &&
        previous.text === next.text &&
        previous.provider === next.provider &&
        previous.speaker === next.speaker
    ) {
        return [...current];
    }

    return [...current.slice(-499), next];
}

export function parseTranscriptMessage(value: unknown): TranscriptMessage | undefined {
    if (typeof value !== 'object' || value === null) return undefined;

    const candidate = value as Record<string, unknown>;
    if (
        candidate.type !== 'transcript' ||
        typeof candidate.text !== 'string' ||
        typeof candidate.isFinal !== 'boolean'
    ) {
        return undefined;
    }

    const text = candidate.text.replace(/\s+/g, ' ').trim();
    if (!text) return undefined;

    return {
        type: 'transcript',
        text,
        isFinal: candidate.isFinal,
        ...(typeof candidate.confidence === 'number' ? { confidence: candidate.confidence } : {}),
        ...(typeof candidate.timestamp === 'number' ? { timestamp: candidate.timestamp } : {}),
        ...(typeof candidate.provider === 'string' ? { provider: candidate.provider } : {}),
        ...(typeof candidate.speaker === 'string' ? { speaker: candidate.speaker } : {}),
    };
}

export function getTranscriptKey(message: TranscriptMessage, sourceIdentity: string): string {
    const provider = message.provider || 'unknown';
    const speaker = message.speaker || sourceIdentity;
    return `${provider}:${speaker}`;
}

export function upsertInterim(
    current: ReadonlyMap<string, InterimTranscript>,
    interim: InterimTranscript,
): Map<string, InterimTranscript> {
    const next = new Map(current);
    next.set(interim.key, interim);
    return next;
}

export function removeInterim(
    current: ReadonlyMap<string, InterimTranscript>,
    key: string,
): Map<string, InterimTranscript> {
    if (!current.has(key)) return new Map(current);
    const next = new Map(current);
    next.delete(key);
    return next;
}

export function clearInterimsBySource(
    current: ReadonlyMap<string, InterimTranscript>,
    sourceIdentity: string,
): Map<string, InterimTranscript> {
    return new Map(Array.from(current).filter(([, interim]) => interim.sourceIdentity !== sourceIdentity));
}
