import type { TranscriptSegment, TranscriptTranslation } from '../types';

export type TranscriptRole = 'source' | 'translation';

export interface TranscriptMessage {
    type: 'transcript';
    text: string;
    isFinal: boolean;
    confidence?: number;
    timestamp?: number;
    provider?: string;
    speaker?: string;
    role: TranscriptRole;
    languageCode?: string;
    turnId?: string;
}

export interface InterimTranscript {
    key: string;
    text: string;
    provider: string;
    speaker: string;
    sourceIdentity: string;
}

export interface PendingTranslation {
    message: TranscriptMessage;
    sourceIdentity: string;
    receivedAt: number;
}

const MAX_PENDING_TRANSLATIONS = 64;
const PENDING_TRANSLATION_TTL_MS = 30_000;

export function isAppendOnlyInterimProvider(provider: string): boolean {
    return provider.toLowerCase() === 'gemini';
}

export function appendTranscriptIfNew(
    current: TranscriptSegment[],
    next: TranscriptSegment,
): TranscriptSegment[] {
    if (next.turnId && isAppendOnlyInterimProvider(next.provider || '')) {
        const turnIndex = current.findLastIndex(segment => (
            segment.provider === next.provider &&
            segment.speaker === next.speaker &&
            segment.role === next.role &&
            segment.turnId === next.turnId
        ));
        if (turnIndex >= 0) {
            const existing = current[turnIndex];
            if (existing.text === next.text && existing.isFinal === next.isFinal) return current;

            const updated = current.slice();
            updated[turnIndex] = {
                ...existing,
                ...next,
                id: existing.id,
                timestamp: existing.timestamp,
                ...(existing.translation ? { translation: existing.translation } : {}),
            };
            return updated;
        }
    }

    const previous = current[current.length - 1];
    if (
        previous &&
        previous.text === next.text &&
        previous.provider === next.provider &&
        previous.speaker === next.speaker &&
        previous.role === next.role &&
        previous.turnId === next.turnId
    ) {
        return current;
    }

    return [...current.slice(-499), next];
}

export function formatLanguageLabel(languageCode: string): string {
    return languageCode.trim() || '—';
}

export function normalizeLanguageTag(languageCode?: string): string | undefined {
    const candidate = languageCode?.trim().replaceAll('_', '-');
    if (!candidate) return undefined;

    try {
        return Intl.getCanonicalLocales(candidate)[0];
    } catch {
        return undefined;
    }
}

export function createCommittedTranscript(
    id: string,
    message: TranscriptMessage,
    provider: string,
    speaker: string,
): TranscriptSegment {
    return {
        id,
        text: message.text,
        isFinal: true,
        timestamp: message.timestamp ?? Date.now(),
        provider,
        speaker,
        role: message.role,
        ...(message.languageCode ? { languageCode: message.languageCode } : {}),
        ...(message.turnId ? { turnId: message.turnId } : {}),
    };
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

    const role = candidate.role === undefined || candidate.role === 'source'
        ? 'source'
        : candidate.role === 'translation'
            ? 'translation'
            : undefined;
    if (!role || (role === 'translation' && typeof candidate.turnId !== 'string')) return undefined;

    const text = candidate.text.replace(/\s+/g, ' ').trim();
    if (!text) return undefined;

    return {
        type: 'transcript',
        text,
        isFinal: candidate.isFinal,
        role,
        ...(typeof candidate.confidence === 'number' ? { confidence: candidate.confidence } : {}),
        ...(typeof candidate.timestamp === 'number' ? { timestamp: candidate.timestamp } : {}),
        ...(typeof candidate.provider === 'string' ? { provider: candidate.provider } : {}),
        ...(typeof candidate.speaker === 'string' ? { speaker: candidate.speaker } : {}),
        ...(typeof candidate.languageCode === 'string' ? { languageCode: candidate.languageCode } : {}),
        ...(typeof candidate.turnId === 'string' ? { turnId: candidate.turnId } : {}),
    };
}

export function getTranscriptKey(message: TranscriptMessage, sourceIdentity: string): string {
    const provider = message.provider || 'unknown';
    const speaker = message.speaker || sourceIdentity;
    return message.turnId
        ? `${provider}:${speaker}:${message.turnId}:${message.role}`
        : `${provider}:${speaker}`;
}

export function getTranscriptTurnKey(message: Pick<TranscriptMessage, 'provider' | 'speaker' | 'turnId'>, sourceIdentity: string): string {
    return `${message.provider || 'unknown'}:${message.speaker || sourceIdentity}:${message.turnId || 'unknown'}`;
}

export function attachTranslation(
    current: TranscriptSegment[],
    message: TranscriptMessage,
    sourceIdentity: string,
): { transcripts: TranscriptSegment[]; attached: boolean } {
    if (message.role !== 'translation' || !message.turnId) return { transcripts: current, attached: false };

    const provider = message.provider || 'unknown';
    const speaker = message.speaker || sourceIdentity;
    let index = -1;
    for (let candidate = current.length - 1; candidate >= 0; candidate--) {
        const segment = current[candidate];
        if (segment.provider === provider && segment.speaker === speaker && segment.turnId === message.turnId && segment.role !== 'translation') {
            index = candidate;
            break;
        }
    }
    if (index < 0) return { transcripts: current, attached: false };

    const next = current.map(segment => (
        segment.provider === provider && segment.speaker === speaker && segment.turnId === message.turnId && segment.translation
            ? { ...segment, translation: undefined }
            : segment
    ));
    const source = next[index];
    const normalizedSource = source.text.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    const normalizedTranslation = message.text.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    const sourceLanguage = source.languageCode?.toLowerCase().split(/[-_]/, 1)[0];
    const translationLanguage = message.languageCode?.toLowerCase().split(/[-_]/, 1)[0];
    if ((sourceLanguage && sourceLanguage === translationLanguage) || normalizedSource === normalizedTranslation) {
        return { transcripts: next, attached: true };
    }

    const translation: TranscriptTranslation = {
        text: message.text,
        languageCode: message.languageCode || '',
        isFinal: message.isFinal,
    };
    next[index] = { ...source, translation };
    return { transcripts: next, attached: true };
}

export function prunePendingTranslations(
    current: ReadonlyMap<string, PendingTranslation>,
    now = Date.now(),
): Map<string, PendingTranslation> {
    return new Map(Array.from(current).filter(([, pending]) => now - pending.receivedAt <= PENDING_TRANSLATION_TTL_MS));
}

export function storePendingTranslation(
    current: ReadonlyMap<string, PendingTranslation>,
    message: TranscriptMessage,
    sourceIdentity: string,
    now = Date.now(),
): Map<string, PendingTranslation> {
    const next = prunePendingTranslations(current, now);
    const key = getTranscriptTurnKey(message, sourceIdentity);
    next.delete(key);
    next.set(key, { message, sourceIdentity, receivedAt: now });
    while (next.size > MAX_PENDING_TRANSLATIONS) {
        const oldestKey = next.keys().next().value;
        if (oldestKey === undefined) break;
        next.delete(oldestKey);
    }
    return next;
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
