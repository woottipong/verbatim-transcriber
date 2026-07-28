import {
  type CaptionOperatorMessage,
  type CaptionPublishCommand,
  type CaptionPublishedMessage,
  type CaptionRejectedMessage,
  type CaptionSource,
  MAX_CAPTION_TEXT_BYTES,
  parseCaptionOperatorPacket,
} from './captionDeskMessages.ts';

export interface WaitingCaption {
  requestId: string;
  text: string;
  sourceSegmentIds: string[];
  remainingText?: string;
}

export interface CaptionDeskSnapshot {
  reviewText: string;
  rawText: string;
  sourceSegmentIds: string[];
  incomingDraft: string;
  queuedCount: number;
  waiting: WaitingCaption[];
  recentlyPublished: Array<{ publicationId: string; text: string; publishedAt: number }>;
  error: string | null;
}

const EMPTY: CaptionDeskSnapshot = {
  reviewText: '', rawText: '', sourceSegmentIds: [], incomingDraft: '',
  queuedCount: 0, waiting: [], recentlyPublished: [], error: null,
};
export const MAX_WAITING_CAPTIONS = 64;

export class CaptionDeskSession {
  private snapshot: CaptionDeskSnapshot = EMPTY;
  private listeners = new Set<() => void>();
  private edited = false;
  private queued: CaptionSource[] = [];
  private interimEnabled = true;
  private interimReviewEnabled = false;
  private activeIsDraft = false;

  getSnapshot = (): CaptionDeskSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  ingestOperatorPacket(payload: Uint8Array): void {
    const message = parseCaptionOperatorPacket(payload);
    if (message) this.ingest(message);
  }

  edit(text: string): void {
    this.edited = true;
    this.update({ ...this.snapshot, reviewText: text, error: null });
  }

  restore(): void {
    this.edited = false;
    this.update({ ...this.snapshot, reviewText: this.snapshot.rawText, error: null });
  }

  setInterimEnabled(enabled: boolean): void {
    if (this.interimEnabled === enabled) return;
    this.interimEnabled = enabled;
    if (!enabled && this.snapshot.incomingDraft) {
      this.update({ ...this.snapshot, incomingDraft: '' });
    }
  }

  setInterimReviewEnabled(enabled: boolean): void {
    this.interimReviewEnabled = enabled;
    this.edited = false;
    this.activeIsDraft = false;
    this.queued = [];
    this.update({
      ...this.snapshot,
      reviewText: '',
      rawText: '',
      sourceSegmentIds: [],
      incomingDraft: '',
      queuedCount: 0,
      error: null,
    });
  }

  release(provider: string, splitIndex?: number): CaptionPublishCommand | null {
    const fullText = this.snapshot.reviewText;
    if (splitIndex === 0) {
      this.update({
        ...this.snapshot,
        error: 'Move the cursor after the text you want to publish.',
      });
      return null;
    }
    const activeSourceIDs = new Set(this.snapshot.sourceSegmentIds);
    const sourceIsSending = this.snapshot.waiting.some(item =>
      item.sourceSegmentIds.some(id => activeSourceIDs.has(id)),
    );
    if (sourceIsSending) {
      this.update({
        ...this.snapshot,
        error: 'Wait for this caption to finish sending before publishing the next part.',
      });
      return null;
    }
    const canSplit = splitIndex !== undefined && splitIndex > 0 && splitIndex < fullText.length;
    const text = (canSplit ? fullText.slice(0, splitIndex) : fullText).trim();
    const remainingText = canSplit ? fullText.slice(splitIndex).trim() : '';
    if (!text || this.snapshot.sourceSegmentIds.length === 0) return null;
    if (new TextEncoder().encode(text).length > MAX_CAPTION_TEXT_BYTES) {
      this.update({
        ...this.snapshot,
        error: `Caption is too long to publish. Keep it under ${MAX_CAPTION_TEXT_BYTES.toLocaleString()} UTF-8 bytes.`,
      });
      return null;
    }
    if (this.snapshot.waiting.length >= MAX_WAITING_CAPTIONS) {
      this.update({
        ...this.snapshot,
        error: `Waiting for ${MAX_WAITING_CAPTIONS} captions to finish sending. Try again after one completes.`,
      });
      return null;
    }
    const waiting = {
      requestId: crypto.randomUUID(),
      text,
      sourceSegmentIds: [...this.snapshot.sourceSegmentIds],
      ...(remainingText ? { remainingText } : {}),
    };
    this.edited = remainingText !== '';
    this.activeIsDraft = false;
    const next = remainingText ? undefined : this.queued.shift();
    this.update({
      ...this.snapshot,
      reviewText: remainingText || next?.text || '',
      rawText: remainingText || next?.text || '',
      sourceSegmentIds: remainingText ? [...this.snapshot.sourceSegmentIds] : next ? [next.segmentId] : [],
      incomingDraft: '',
      queuedCount: this.queued.length,
      waiting: [...this.snapshot.waiting, waiting],
      error: null,
    });
    return { type: 'caption.publish', provider, ...waiting };
  }

  waitingCommands(provider: string): CaptionPublishCommand[] {
    return this.snapshot.waiting.map(item => ({ type: 'caption.publish', provider, ...item }));
  }

  acknowledge(message: CaptionPublishedMessage): void {
    this.update({
      ...this.snapshot,
      waiting: this.snapshot.waiting.filter(item => item.requestId !== message.requestId),
      recentlyPublished: [
        ...this.snapshot.recentlyPublished,
        { publicationId: message.publicationId, text: message.text, publishedAt: message.publishedAt },
      ].slice(-20),
      error: null,
    });
  }

  reject(message: CaptionRejectedMessage): void {
    const failed = this.snapshot.waiting.find(item => item.requestId === message.requestId);
    if (!failed) return;
    if (!failed.remainingText && this.snapshot.sourceSegmentIds.length > 0) {
      this.queued.unshift({
        segmentId: this.snapshot.sourceSegmentIds[0],
        text: this.snapshot.reviewText,
        provider: message.provider,
        isFinal: true,
        sequence: 0,
      });
    }
    this.edited = true;
    this.update({
      ...this.snapshot,
      reviewText: failed.remainingText ? `${failed.text} ${failed.remainingText}` : failed.text,
      rawText: failed.remainingText ? `${failed.text} ${failed.remainingText}` : failed.text,
      sourceSegmentIds: [...failed.sourceSegmentIds],
      queuedCount: this.queued.length,
      waiting: this.snapshot.waiting.filter(item => item.requestId !== message.requestId),
      error: message.message || 'Caption was not published.',
    });
  }

  clear(): void {
    this.edited = false;
    this.activeIsDraft = false;
    this.queued = [];
    this.update(EMPTY);
  }

  private ingest(message: CaptionOperatorMessage): void {
    if (message.type === 'caption.published') return this.acknowledge(message);
    if (message.type === 'caption.rejected') return this.reject(message);
    if (message.type === 'caption.draft') {
      if (!this.interimEnabled && !this.interimReviewEnabled) return;
      const incomingDraft = this.interimEnabled ? message.source.text : '';
      if (this.interimReviewEnabled) {
        const isActiveDraft = this.activeIsDraft &&
          this.snapshot.sourceSegmentIds.length === 1 &&
          this.snapshot.sourceSegmentIds[0] === message.source.segmentId;
        if (
          this.snapshot.sourceSegmentIds.length === 0 ||
          !this.activeIsDraft ||
          (isActiveDraft && !this.edited)
        ) {
          this.activeIsDraft = true;
          this.edited = false;
          this.update({
            ...this.snapshot,
            reviewText: message.source.text,
            rawText: message.source.text,
            sourceSegmentIds: [message.source.segmentId],
            incomingDraft,
            error: null,
          });
          return;
        }
      }
      this.update({ ...this.snapshot, incomingDraft });
      return;
    }
    if (message.type === 'caption.snapshot') {
      const waitingIDs = new Set(
        this.snapshot.waiting
          .filter(item => !item.remainingText)
          .flatMap(item => item.sourceSegmentIds),
      );
      const pending = message.pending.filter(item => !waitingIDs.has(item.segmentId));
      if (this.edited) {
        const pendingByID = new Map(pending.map(item => [item.segmentId, item]));
        if (this.activeIsDraft && message.draft) {
          pendingByID.set(message.draft.segmentId, message.draft);
        }
        const activeStillValid = this.snapshot.sourceSegmentIds.every(id => pendingByID.has(id));
        const knownIDs = new Set([
          ...this.snapshot.sourceSegmentIds,
          ...this.queued.map(item => item.segmentId),
        ]);
        const incoming = pending.filter(item => !knownIDs.has(item.segmentId));
        if (activeStillValid) {
          this.queued.push(...incoming);
          this.update({
            ...this.snapshot,
            incomingDraft: this.interimEnabled ? message.draft?.text || '' : '',
            queuedCount: this.queued.length,
            error: null,
          });
          return;
        }
        this.update({
          ...this.snapshot,
          incomingDraft: this.interimEnabled ? message.draft?.text || '' : '',
          sourceSegmentIds: this.snapshot.sourceSegmentIds.filter(id => pendingByID.has(id)),
          error: 'The transcriber restarted while you were editing. Your text is preserved, but it cannot be published until new source text arrives.',
        });
        return;
      }
      const current = this.interimReviewEnabled
        ? message.draft || pending.at(-1)
        : pending[0];
      this.edited = false;
      this.activeIsDraft = Boolean(current && !current.isFinal);
      this.queued = this.interimReviewEnabled ? [] : pending.slice(1);
      this.update({
        ...EMPTY,
        reviewText: current?.text || '',
        rawText: current?.text || '',
        sourceSegmentIds: current ? [current.segmentId] : [],
        incomingDraft: this.interimEnabled ? message.draft?.text || '' : '',
        queuedCount: this.queued.length,
        waiting: this.snapshot.waiting,
        recentlyPublished: this.snapshot.recentlyPublished,
      });
      return;
    }
    const source = message.source;
    if (this.snapshot.sourceSegmentIds.includes(source.segmentId)) {
      if (this.activeIsDraft) {
        this.activeIsDraft = false;
        this.update({
          ...this.snapshot,
          reviewText: this.edited ? this.snapshot.reviewText : source.text,
          rawText: source.text,
          incomingDraft: '',
        });
      }
      return;
    }
    if (this.queued.some(item => item.segmentId === source.segmentId)) return;
    if (this.snapshot.sourceSegmentIds.length > 0) {
      this.queued.push(source);
      this.update({ ...this.snapshot, incomingDraft: '', queuedCount: this.queued.length });
      return;
    }
    this.update({
      ...this.snapshot,
      reviewText: source.text,
      rawText: source.text,
      sourceSegmentIds: [source.segmentId],
      incomingDraft: '',
      queuedCount: this.queued.length,
    });
    this.activeIsDraft = false;
  }

  private update(next: CaptionDeskSnapshot): void {
    this.snapshot = next;
    this.listeners.forEach(listener => listener());
  }
}
