import type { TranscriptSegment } from '../types';
import {
    GEMINI_TRANSCRIPT_UPDATE_INTERVAL_MS,
    GOOGLE_TRANSCRIPT_UPDATE_INTERVAL_MS,
    INTERIM_TRANSCRIPT_UPDATE_INTERVAL_MS,
    TranscriptUpdateBuffer,
} from './transcriptUpdates.ts';
import {
    type InterimTranscript,
    type PendingTranslation,
    type TranscriptMessage,
    attachTranslation,
    attachTranslationToInterims,
    clearInterimsBySource,
    clearPendingTranslationsBySource,
    createCommittedTranscript,
    createInterimTranscript,
    getTranscriptKey,
    getTranscriptTurnKey,
    isAppendOnlyInterimProvider,
    parsePublicCaptionMessage,
    parseTranscriptMessage,
    prunePendingTranslations,
    removeInterim,
    storePendingTranslation,
    upsertInterim,
} from './transcriptMessages.ts';

interface BufferedTranscriptMessage extends TranscriptMessage {
    key: string;
    sourceIdentity: string;
}

interface PacketOrder {
    sequence: number;
    sourceIdentity: string;
}

export interface TranscriptSessionSnapshot {
    transcripts: TranscriptSegment[];
    interimTranscripts: Map<string, InterimTranscript>;
}

export interface TranscriptIngestOptions {
    resolveProvider?: (sourceIdentity: string) => string;
    onProviderObserved?: (sourceIdentity: string, provider: string) => void;
    publicCaptionMode?: boolean;
    onPublicCaptionAccepted?: (message: TranscriptMessage) => void;
}

interface TranscriptSessionOptions {
    idPrefix: string;
    schedule?: (callback: () => void, delayMs: number) => number;
    cancel?: (timerId: number) => void;
}

const EMPTY_SNAPSHOT: TranscriptSessionSnapshot = {
    transcripts: [],
    interimTranscripts: new Map(),
};
const MAX_PACKET_ORDER_ENTRIES = 256;
const decoder = new TextDecoder();

export class TranscriptSession {
    private readonly options: TranscriptSessionOptions;
    private snapshot: TranscriptSessionSnapshot = EMPTY_SNAPSHOT;
    private translationsByTurn = new Map<string, PendingTranslation>();
    private latestPacketByKey = new Map<string, PacketOrder>();
    private readonly listeners = new Set<() => void>();
    private readonly transcriptUpdates: TranscriptUpdateBuffer<BufferedTranscriptMessage>;
    private readonly googleUpdates: TranscriptUpdateBuffer<BufferedTranscriptMessage>;
    private readonly geminiUpdates: TranscriptUpdateBuffer<BufferedTranscriptMessage>;
    private seenPublicationIds = new Set<string>();
    private committedSequence = 0;

    constructor(options: TranscriptSessionOptions) {
        this.options = options;
        this.transcriptUpdates = new TranscriptUpdateBuffer(
            message => this.applySource(message),
            INTERIM_TRANSCRIPT_UPDATE_INTERVAL_MS,
            options.schedule,
            options.cancel,
            message => message.isFinal,
            message => message.key,
        );
        this.googleUpdates = new TranscriptUpdateBuffer(
            message => this.applySource(message),
            GOOGLE_TRANSCRIPT_UPDATE_INTERVAL_MS,
            options.schedule,
            options.cancel,
            message => message.isFinal,
            message => message.key,
            'immediate',
        );
        this.geminiUpdates = new TranscriptUpdateBuffer(
            message => this.applyGemini(message),
            GEMINI_TRANSCRIPT_UPDATE_INTERVAL_MS,
            options.schedule,
            options.cancel,
            message => message.isFinal,
            message => message.key,
            'immediate',
        );
    }

    readonly subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    readonly getSnapshot = (): TranscriptSessionSnapshot => this.snapshot;

    ingest(payload: Uint8Array, sourceIdentity: string, options: TranscriptIngestOptions = {}): boolean {
        let decoded: unknown;
        try {
            decoded = JSON.parse(decoder.decode(payload));
        } catch {
            return false;
        }

        const parsed = options.publicCaptionMode
            ? parsePublicCaptionMessage(decoded)
            : parseTranscriptMessage(decoded);
        if (!parsed) return false;

        if (options.publicCaptionMode && !parsed.publicationId) return false;
        if (!options.publicCaptionMode && parsed.publicationId) {
            // Approved captions belong to caption.public / approved WS feeds.
            // Raw Stream and Viewer sessions must never merge them into the
            // provider transcript, even if a transport omits the topic.
            return true;
        }

        if (parsed.publicationId) {
            if (this.seenPublicationIds.has(parsed.publicationId)) return true;
            this.seenPublicationIds.add(parsed.publicationId);
            while (this.seenPublicationIds.size > 500) {
                const oldest = this.seenPublicationIds.values().next().value;
                if (oldest === undefined) break;
                this.seenPublicationIds.delete(oldest);
            }
        }

        const provider = options.publicCaptionMode
            ? 'caption-desk'
            : parsed.provider || options.resolveProvider?.(sourceIdentity) || 'unknown';
        const message = options.publicCaptionMode
            ? {
                ...parsed,
                isFinal: true,
                provider,
                role: 'source' as const,
                segmentId: parsed.publicationId,
                turnId: undefined,
            }
            : { ...parsed, provider };
        if (!options.publicCaptionMode && parsed.provider) {
            options.onProviderObserved?.(sourceIdentity, parsed.provider);
        }
        if (options.publicCaptionMode) options.onPublicCaptionAccepted?.(message);
        const bufferedMessage: BufferedTranscriptMessage = {
            ...message,
            key: getTranscriptKey(message),
            sourceIdentity,
        };
        if (!this.acceptPacket(bufferedMessage)) return true;
        if (provider === 'google') {
            this.googleUpdates.push(bufferedMessage);
        } else if (isAppendOnlyInterimProvider(provider)) {
            this.geminiUpdates.push(bufferedMessage);
        } else if (message.role === 'translation') {
            this.applyTranslation(bufferedMessage);
        } else {
            this.transcriptUpdates.push(bufferedMessage);
        }
        return true;
    }

    removeSource(sourceIdentity: string): void {
        this.transcriptUpdates.removeWhere(message => message.sourceIdentity === sourceIdentity);
        this.googleUpdates.removeWhere(message => message.sourceIdentity === sourceIdentity);
        this.geminiUpdates.removeWhere(message => message.sourceIdentity === sourceIdentity);
        this.translationsByTurn = clearPendingTranslationsBySource(this.translationsByTurn, sourceIdentity);
        this.latestPacketByKey = new Map(
            Array.from(this.latestPacketByKey).filter(([, packet]) => packet.sourceIdentity !== sourceIdentity),
        );
        const interimTranscripts = clearInterimsBySource(this.snapshot.interimTranscripts, sourceIdentity);
        if (interimTranscripts.size !== this.snapshot.interimTranscripts.size) {
            this.publish(this.snapshot.transcripts, interimTranscripts);
        }
    }

    reset(clearCommitted = false): void {
        this.transcriptUpdates.clear();
        this.googleUpdates.clear();
        this.geminiUpdates.clear();
        this.translationsByTurn.clear();
        this.latestPacketByKey.clear();
        this.seenPublicationIds.clear();
        if (clearCommitted) this.committedSequence = 0;

        const transcripts = clearCommitted ? [] : this.snapshot.transcripts;
        if (transcripts.length === this.snapshot.transcripts.length && this.snapshot.interimTranscripts.size === 0) {
            return;
        }
        this.publish(transcripts, new Map());
    }

    clear(): void {
        this.reset(true);
    }

    private applyGemini(message: BufferedTranscriptMessage): void {
        if (message.role === 'translation') {
            this.applyTranslation(message);
            return;
        }
        this.applySource(message);
    }

    private applyTranslation(message: BufferedTranscriptMessage): void {
        this.translationsByTurn = storePendingTranslation(
            this.translationsByTurn,
            message,
            message.sourceIdentity,
        );
        const transcripts = attachTranslation(
            this.snapshot.transcripts,
            message,
        ).transcripts;
        const interimTranscripts = attachTranslationToInterims(
            this.snapshot.interimTranscripts,
            message,
        ).interims;
        this.publish(transcripts, interimTranscripts);
    }

    private applySource(message: BufferedTranscriptMessage): void {
        const provider = message.provider || 'unknown';
        if (message.isFinal) {
            const segment = createCommittedTranscript(
                `${this.options.idPrefix}-${++this.committedSequence}`,
                message,
                provider,
            );
            let transcripts = [...this.snapshot.transcripts.slice(-499), segment];
            if (message.turnId) {
                const pending = this.getPendingTranslation(message);
                if (pending) {
                    transcripts = attachTranslation(
                        transcripts,
                        pending.message,
                    ).transcripts;
                }
            }
            this.publish(transcripts, removeInterim(this.snapshot.interimTranscripts, message.key));
            return;
        }

        let interimTranscripts = upsertInterim(
            this.snapshot.interimTranscripts,
            createInterimTranscript(message, message.sourceIdentity, provider),
        );
        if (message.turnId) {
            const pending = this.getPendingTranslation(message);
            if (pending) {
                interimTranscripts = attachTranslationToInterims(
                    interimTranscripts,
                    pending.message,
                ).interims;
            }
        }
        this.publish(this.snapshot.transcripts, interimTranscripts);
    }

    private getPendingTranslation(message: BufferedTranscriptMessage): PendingTranslation | undefined {
        this.translationsByTurn = prunePendingTranslations(this.translationsByTurn);
        return this.translationsByTurn.get(getTranscriptTurnKey(message));
    }

    private acceptPacket(message: BufferedTranscriptMessage): boolean {
        if (message.sequence === undefined) return true;

        const previous = this.latestPacketByKey.get(message.key);
        if (previous && message.sequence <= previous.sequence) return false;

        this.latestPacketByKey.set(message.key, {
            sequence: message.sequence,
            sourceIdentity: message.sourceIdentity,
        });
        while (this.latestPacketByKey.size > MAX_PACKET_ORDER_ENTRIES) {
            const oldestKey = this.latestPacketByKey.keys().next().value;
            if (oldestKey === undefined) break;
            this.latestPacketByKey.delete(oldestKey);
        }
        return true;
    }

    private publish(
        transcripts: TranscriptSegment[],
        interimTranscripts: Map<string, InterimTranscript>,
    ): void {
        if (
            transcripts === this.snapshot.transcripts &&
            interimTranscripts === this.snapshot.interimTranscripts
        ) {
            return;
        }
        this.snapshot = { transcripts, interimTranscripts };
        this.listeners.forEach(listener => listener());
    }
}
