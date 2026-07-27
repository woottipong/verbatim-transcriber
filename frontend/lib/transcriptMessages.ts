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
    languageCode?: string;
    turnId?: string;
    translation?: TranscriptTranslation;
}

export interface PendingTranslation {
    message: TranscriptMessage;
    sourceIdentity: string;
    receivedAt: number;
}

const MAX_PENDING_TRANSLATIONS = 64;
const PENDING_TRANSLATION_TTL_MS = 30_000;
const MAX_INTERIM_TRANSCRIPTS = 64;
const FINAL_DISPLAY_GROUP_WINDOW_MS = 1_600;
const STRONG_SENTENCE_END = /[.!?…。！？]$/u;
const THAI_SCRIPT = /[\u0E00-\u0E7F]/u;

function containsThaiText(segment: Pick<TranscriptSegment, 'text' | 'translation'>): boolean {
    return THAI_SCRIPT.test(segment.text) || Boolean(segment.translation && THAI_SCRIPT.test(segment.translation.text));
}

function joinTranscriptChunks(previous: string, next: string): string {
    const left = previous.trim();
    const right = next.trim();
    if (!left) return right;
    if (!right || left === right) return left;
    if (right.startsWith(left)) return right;
    return `${left} ${right}`;
}

export function groupFinalTranscriptRows(
    segments: readonly TranscriptSegment[],
    windowMs = FINAL_DISPLAY_GROUP_WINDOW_MS,
): TranscriptSegment[] {
    return segments.reduce<TranscriptSegment[]>((rows, segment) => {
        const previous = rows.at(-1);
        const gap = previous ? segment.timestamp - previous.timestamp : Number.POSITIVE_INFINITY;
        const canGroup = Boolean(
            previous &&
            previous.isFinal && segment.isFinal &&
            previous.role !== 'translation' && segment.role !== 'translation' &&
            previous.provider === segment.provider &&
            previous.speaker === segment.speaker &&
            normalizeLanguageTag(previous.languageCode) === normalizeLanguageTag(segment.languageCode) &&
            gap >= 0 && gap <= windowMs &&
            !containsThaiText(previous) && !containsThaiText(segment) &&
            !STRONG_SENTENCE_END.test(previous.text.trim())
        );
        if (!canGroup || !previous) return [...rows, segment];

        const previousTranslation = previous.translation;
        const nextTranslation = segment.translation;
        const canCombineTranslation = previousTranslation && nextTranslation &&
            normalizeLanguageTag(previousTranslation.languageCode) === normalizeLanguageTag(nextTranslation.languageCode);
        const translation = canCombineTranslation
            ? {
                text: joinTranscriptChunks(previousTranslation.text, nextTranslation.text),
                languageCode: nextTranslation.languageCode,
                isFinal: previousTranslation.isFinal && nextTranslation.isFinal,
            }
            : undefined;
        const grouped: TranscriptSegment = {
            ...previous,
            text: joinTranscriptChunks(previous.text, segment.text),
            timestamp: segment.timestamp,
            translation,
        };
        return [...rows.slice(0, -1), grouped];
    }, []);
}

export function isAppendOnlyInterimProvider(provider: string): boolean {
    return provider.toLowerCase() === 'gemini';
}

export function isTranscriptTurnLive(segment: Pick<TranscriptSegment, 'isFinal' | 'translation'>): boolean {
    return !segment.isFinal || segment.translation?.isFinal === false;
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

function areEquivalentLanguageTags(sourceLanguage?: string, targetLanguage?: string): boolean {
    const source = normalizeLanguageTag(sourceLanguage);
    const target = normalizeLanguageTag(targetLanguage);
    if (!source || !target) return false;
    if (source === target) return true;

    const sourceBase = source.split('-', 1)[0];
    const targetBase = target.split('-', 1)[0];
    return sourceBase === targetBase && (source === sourceBase || target === targetBase);
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
        isFinal: message.isFinal,
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
    const turnId = typeof candidate.turnId === 'string' ? candidate.turnId.trim() : undefined;
    if (!role || (role === 'translation' && !turnId)) return undefined;

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
        ...(turnId ? { turnId } : {}),
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
    if (areEquivalentLanguageTags(source.languageCode, message.languageCode) || normalizedSource === normalizedTranslation) {
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

export function clearPendingTranslationsBySource(
    current: ReadonlyMap<string, PendingTranslation>,
    sourceIdentity: string,
): Map<string, PendingTranslation> {
    return new Map(Array.from(current).filter(([, pending]) => pending.sourceIdentity !== sourceIdentity));
}

export function createInterimTranscript(
    message: TranscriptMessage,
    sourceIdentity: string,
    providerOverride?: string,
): InterimTranscript {
    const provider = providerOverride || message.provider || 'unknown';
    const speaker = message.speaker || sourceIdentity;
    const normalizedMessage = { ...message, provider, speaker };
    return {
        key: getTranscriptKey(normalizedMessage, sourceIdentity),
        text: message.text,
        provider,
        speaker,
        sourceIdentity,
        ...(message.languageCode ? { languageCode: message.languageCode } : {}),
        ...(message.turnId ? { turnId: message.turnId } : {}),
    };
}

export function attachTranslationToInterims(
    current: ReadonlyMap<string, InterimTranscript>,
    message: TranscriptMessage,
    sourceIdentity: string,
): { interims: Map<string, InterimTranscript>; attached: boolean } {
    if (message.role !== 'translation' || !message.turnId) {
        return { interims: new Map(current), attached: false };
    }

    const provider = message.provider || 'unknown';
    const speaker = message.speaker || sourceIdentity;
    const entries = Array.from(current);
    let matchingKey: string | undefined;
    for (let index = entries.length - 1; index >= 0; index--) {
        const [key, interim] = entries[index];
        if (interim.provider === provider && interim.speaker === speaker && interim.turnId === message.turnId) {
            matchingKey = key;
            break;
        }
    }
    if (!matchingKey) return { interims: new Map(current), attached: false };

    const next = new Map(current);
    const source = next.get(matchingKey)!;
    const normalizedSource = source.text.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    const normalizedTranslation = message.text.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    if (areEquivalentLanguageTags(source.languageCode, message.languageCode) || normalizedSource === normalizedTranslation) {
        next.set(matchingKey, { ...source, translation: undefined });
        return { interims: next, attached: true };
    }

    next.set(matchingKey, {
        ...source,
        translation: {
            text: message.text,
            languageCode: message.languageCode || '',
            isFinal: message.isFinal,
        },
    });
    return { interims: next, attached: true };
}

export function upsertInterim(
    current: ReadonlyMap<string, InterimTranscript>,
    interim: InterimTranscript,
): Map<string, InterimTranscript> {
    const next = new Map(current);
    const existing = next.get(interim.key);
    next.set(interim.key, {
        ...interim,
        ...(existing?.translation && !interim.translation ? { translation: existing.translation } : {}),
    });
    while (next.size > MAX_INTERIM_TRANSCRIPTS) {
        const oldestKey = next.keys().next().value;
        if (oldestKey === undefined) break;
        next.delete(oldestKey);
    }
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
