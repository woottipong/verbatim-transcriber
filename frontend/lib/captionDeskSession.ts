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
  isDraftActive: boolean;
  draftPreview: string;
  queuedCount: number;
  waiting: WaitingCaption[];
  recentlyPublished: Array<{ publicationId: string; text: string; publishedAt: number }>;
  error: string | null;
}

const EMPTY: CaptionDeskSnapshot = {
  reviewText: '', rawText: '', sourceSegmentIds: [], isDraftActive: false, draftPreview: '',
  queuedCount: 0, waiting: [], recentlyPublished: [], error: null,
};
export const MAX_WAITING_CAPTIONS = 64;

export class CaptionDeskSession {
  private snapshot: CaptionDeskSnapshot = EMPTY;
  private listeners = new Set<() => void>();
  private edited = false;
  private queued: CaptionSource[] = [];
  private interimReviewEnabled = false;
  private activeIsDraft = false;
  private activeDraftID = '';
  private activeDraftText = '';

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

  setInterimReviewEnabled(enabled: boolean): void {
    this.interimReviewEnabled = enabled;
    this.edited = false;
    this.activeIsDraft = false;
    this.activeDraftID = '';
    this.activeDraftText = '';
    this.queued = [];
    this.update({
      ...this.snapshot,
      reviewText: '',
      rawText: '',
      sourceSegmentIds: [],
      isDraftActive: false,
      draftPreview: '',
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
    const text = canSplit ? fullText.slice(0, splitIndex) : fullText;
    const remainingText = canSplit ? fullText.slice(splitIndex) : '';
    if (!text.trim() || this.snapshot.sourceSegmentIds.length === 0) return null;
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
    if (this.interimReviewEnabled) {
      this.activeIsDraft = false;
      this.activeDraftID = '';
      this.activeDraftText = '';
    }
    const next = remainingText ? undefined : this.queued.shift();
    const remainderSourceId = this.snapshot.sourceSegmentIds.at(-1);
    this.update({
      ...this.snapshot,
      reviewText: remainingText || next?.text || '',
      rawText: remainingText || next?.text || '',
      sourceSegmentIds: remainingText && remainderSourceId
        ? [remainderSourceId]
        : next
          ? [next.segmentId]
          : [],
      isDraftActive: this.interimReviewEnabled ? false : this.snapshot.isDraftActive,
      draftPreview: this.snapshot.draftPreview,
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
      reviewText: failed.remainingText ? `${failed.text}${failed.remainingText}` : failed.text,
      rawText: failed.remainingText ? `${failed.text}${failed.remainingText}` : failed.text,
      sourceSegmentIds: [...failed.sourceSegmentIds],
      queuedCount: this.queued.length,
      waiting: this.snapshot.waiting.filter(item => item.requestId !== message.requestId),
      error: message.message || 'Caption was not published.',
    });
  }

  clear(): void {
    this.edited = false;
    this.activeIsDraft = false;
    this.activeDraftID = '';
    this.activeDraftText = '';
    this.queued = [];
    this.update(EMPTY);
  }

  private ingest(message: CaptionOperatorMessage): void {
    if (message.type === 'caption.published') return this.acknowledge(message);
    if (message.type === 'caption.rejected') return this.reject(message);
    if (message.type === 'caption.draft') {
      if (!this.interimReviewEnabled) {
        if (!this.activeIsDraft || this.activeDraftID === message.source.segmentId) {
          this.activeIsDraft = true;
          this.activeDraftID = message.source.segmentId;
          this.activeDraftText = message.source.text;
          this.update({
            ...this.snapshot,
            isDraftActive: true,
            draftPreview: message.source.text,
            error: null,
          });
        }
        return;
      }
      const isActiveDraft = this.activeIsDraft &&
        this.snapshot.sourceSegmentIds.at(-1) === message.source.segmentId;
      if (isActiveDraft) {
        const rawText = replaceTrailingSource(
          this.snapshot.rawText,
          this.activeDraftText,
          message.source.text,
        );
        const reviewText = this.interimReviewEnabled && this.edited
          ? this.snapshot.reviewText
          : replaceTrailingSource(this.snapshot.reviewText, this.activeDraftText, message.source.text);
        this.activeDraftText = message.source.text;
        this.update({
          ...this.snapshot,
          reviewText,
          rawText,
          isDraftActive: true,
          draftPreview: '',
          error: null,
        });
        return;
      }
      if (!this.activeIsDraft || this.snapshot.sourceSegmentIds.length === 0) {
        this.activeIsDraft = true;
        this.activeDraftID = message.source.segmentId;
        this.activeDraftText = message.source.text;
        this.update({
          ...this.snapshot,
          reviewText: appendSourceText(this.snapshot.reviewText, message.source.text),
          rawText: appendSourceText(this.snapshot.rawText, message.source.text),
          sourceSegmentIds: [...this.snapshot.sourceSegmentIds, message.source.segmentId],
          isDraftActive: true,
          draftPreview: '',
          error: null,
        });
        return;
      }
      return;
    }
    if (message.type === 'caption.snapshot') {
      const waitingIDs = new Set(
        this.snapshot.waiting
          .filter(item => !item.remainingText)
          .flatMap(item => item.sourceSegmentIds),
      );
      const pending = message.pending.filter(item => !waitingIDs.has(item.segmentId));
      const reviewDraft = this.interimReviewEnabled &&
        message.draft &&
        !waitingIDs.has(message.draft.segmentId)
        ? message.draft
        : undefined;
      const sources = [...pending, ...(reviewDraft ? [reviewDraft] : [])];
      const knownIDs = new Set(this.snapshot.sourceSegmentIds);
      const incoming = sources.filter(item => !knownIDs.has(item.segmentId));
      const rawText = sources.map(item => item.text).join(' ');
      this.activeIsDraft = Boolean(message.draft);
      this.activeDraftID = message.draft?.segmentId || '';
      this.activeDraftText = message.draft?.text || '';
      this.queued = [];
      this.update({
        ...this.snapshot,
        reviewText: this.edited
          ? incoming.reduce((text, item) => appendSourceText(text, item.text), this.snapshot.reviewText)
          : rawText,
        rawText,
        sourceSegmentIds: sources.map(item => item.segmentId),
        isDraftActive: Boolean(message.draft),
        draftPreview: this.interimReviewEnabled ? '' : message.draft?.text || '',
        queuedCount: 0,
        error: null,
      });
      return;
    }
    const source = message.source;
    if (!this.interimReviewEnabled && this.activeIsDraft && this.activeDraftID === source.segmentId) {
      this.activeIsDraft = false;
      this.activeDraftID = '';
      this.activeDraftText = '';
      this.update({
        ...this.snapshot,
        reviewText: appendSourceText(this.snapshot.reviewText, source.text),
        rawText: appendSourceText(this.snapshot.rawText, source.text),
        sourceSegmentIds: [...this.snapshot.sourceSegmentIds, source.segmentId],
        isDraftActive: false,
        draftPreview: '',
        queuedCount: 0,
      });
      return;
    }
    if (this.snapshot.sourceSegmentIds.includes(source.segmentId)) {
      if (this.activeIsDraft) {
        this.activeIsDraft = false;
        this.activeDraftID = '';
        const rawText = replaceTrailingSource(this.snapshot.rawText, this.activeDraftText, source.text);
        const reviewText = this.edited
          ? this.snapshot.reviewText
          : replaceTrailingSource(this.snapshot.reviewText, this.activeDraftText, source.text);
        this.activeDraftText = '';
        this.update({
          ...this.snapshot,
          reviewText,
          rawText,
          isDraftActive: false,
          draftPreview: '',
        });
      }
      return;
    }
    if (this.queued.some(item => item.segmentId === source.segmentId)) return;
    this.update({
      ...this.snapshot,
      reviewText: appendSourceText(this.snapshot.reviewText, source.text),
      rawText: appendSourceText(this.snapshot.rawText, source.text),
      sourceSegmentIds: [...this.snapshot.sourceSegmentIds, source.segmentId],
      isDraftActive: this.snapshot.isDraftActive,
      draftPreview: this.snapshot.draftPreview,
      queuedCount: 0,
    });
  }

  private update(next: CaptionDeskSnapshot): void {
    this.snapshot = next;
    this.listeners.forEach(listener => listener());
  }
}

function appendSourceText(current: string, incoming: string): string {
  const left = current.trimEnd();
  const right = incoming.trim();
  if (!left) return right;
  if (!right) return left;
  return `${left} ${right}`;
}

function replaceTrailingSource(current: string, previous: string, incoming: string): string {
  const text = current.trimEnd();
  const suffix = previous.trim();
  if (!suffix || !text.endsWith(suffix)) return text;
  return appendSourceText(text.slice(0, -suffix.length), incoming);
}
