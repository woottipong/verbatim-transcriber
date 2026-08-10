import {
  type CaptionOperatorMessage,
  type CaptionPublishCommand,
  type CaptionPublishedMessage,
  type CaptionRejectedMessage,
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
  draftJoinWithoutSpace: boolean;
  queuedCount: number;
  waiting: WaitingCaption[];
  recentlyPublished: Array<{ publicationId: string; text: string; publishedAt: number }>;
  error: string | null;
}

interface QueuedCaption {
  text: string;
  rawText: string;
  sourceSegmentIds: string[];
}

const EMPTY: CaptionDeskSnapshot = {
  reviewText: '', rawText: '', sourceSegmentIds: [], isDraftActive: false,
  draftPreview: '', draftJoinWithoutSpace: false,
  queuedCount: 0, waiting: [], recentlyPublished: [], error: null,
};
export const MAX_WAITING_CAPTIONS = 64;
export const MAX_RECENTLY_PUBLISHED = 10;

export class CaptionDeskSession {
  private snapshot: CaptionDeskSnapshot = { ...EMPTY };
  private listeners = new Set<() => void>();
  private edited = false;
  private queued: QueuedCaption[] = [];
  private activeIsDraft = false;
  private activeDraftID = '';
  private activeDraftSequence = 0;
  private latestSourceSequence = 0;

  getSnapshot = (): CaptionDeskSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  ingestOperatorPacket(payload: Uint8Array): void {
    const message = parseCaptionOperatorPacket(payload);
    if (message) this.ingest(message);
  }

  beginSourceEpoch(): void {
    this.activeIsDraft = false;
    this.activeDraftID = '';
    this.activeDraftSequence = 0;
    this.latestSourceSequence = 0;
    this.update({
      ...this.snapshot,
      isDraftActive: false,
      draftPreview: '',
      draftJoinWithoutSpace: false,
      error: null,
    });
  }

  edit(text: string): void {
    this.edited = text !== this.snapshot.rawText;
    this.update({ ...this.snapshot, reviewText: text, error: null });
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
    const next = remainingText ? undefined : this.queued.shift();
    const remainderSourceId = this.snapshot.sourceSegmentIds.at(-1);
    this.edited = remainingText !== '' || Boolean(next && next.text !== next.rawText);
    this.update({
      ...this.snapshot,
      reviewText: remainingText || next?.text || '',
      rawText: remainingText || next?.rawText || '',
      sourceSegmentIds: remainingText && remainderSourceId
        ? [remainderSourceId]
        : next
          ? [...next.sourceSegmentIds]
          : [],
      isDraftActive: this.snapshot.isDraftActive,
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
      ].slice(-MAX_RECENTLY_PUBLISHED),
      error: null,
    });
  }

  reject(message: CaptionRejectedMessage): void {
    const failed = this.snapshot.waiting.find(item => item.requestId === message.requestId);
    if (!failed) return;
    if (!failed.remainingText && this.snapshot.sourceSegmentIds.length > 0) {
      this.queued.unshift({
        text: this.snapshot.reviewText,
        rawText: this.snapshot.rawText,
        sourceSegmentIds: [...this.snapshot.sourceSegmentIds],
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
    this.activeDraftSequence = 0;
    this.latestSourceSequence = 0;
    this.queued = [];
    this.update(EMPTY);
  }

  private ingest(message: CaptionOperatorMessage): void {
    if (message.type === 'caption.published') return this.acknowledge(message);
    if (message.type === 'caption.rejected') return this.reject(message);
    if (message.type === 'caption.draft-cleared') {
      this.latestSourceSequence = Math.max(this.latestSourceSequence, message.source.sequence);
      if (
        this.activeIsDraft &&
        this.activeDraftID === message.source.segmentId &&
        message.source.sequence >= this.activeDraftSequence
      ) {
        this.activeIsDraft = false;
        this.activeDraftID = '';
        this.activeDraftSequence = 0;
        this.update({
          ...this.snapshot,
          isDraftActive: false,
          draftPreview: '',
          draftJoinWithoutSpace: false,
          error: null,
        });
      }
      return;
    }
    if (message.type === 'caption.draft') {
      if (message.source.sequence <= this.latestSourceSequence) return;
      if (
        !this.activeIsDraft ||
        message.source.sequence > this.activeDraftSequence
      ) {
        this.activeIsDraft = true;
        this.activeDraftID = message.source.segmentId;
        this.activeDraftSequence = message.source.sequence;
        this.latestSourceSequence = Math.max(this.latestSourceSequence, message.source.sequence);
        this.update({
          ...this.snapshot,
          isDraftActive: true,
          draftPreview: message.source.text,
          draftJoinWithoutSpace: Boolean(message.source.joinWithoutSpace),
          error: null,
        });
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
      const sources = pending;
      const snapshotSequence = Math.max(
        message.draft?.sequence || 0,
        ...pending.map(item => item.sequence),
      );
      if (snapshotSequence < this.latestSourceSequence) return;
      const knownIDs = new Set(this.snapshot.sourceSegmentIds);
      const incoming = sources.filter(item => !knownIDs.has(item.segmentId));
      const rawText = sources.reduce(
        (text, item) => appendSourceText(text, item.text, item.joinWithoutSpace),
        '',
      );
      this.activeIsDraft = Boolean(message.draft);
      this.activeDraftID = message.draft?.segmentId || '';
      this.activeDraftSequence = message.draft?.sequence || 0;
      this.latestSourceSequence = Math.max(this.latestSourceSequence, snapshotSequence);
      this.queued = [];
      this.update({
        ...this.snapshot,
        reviewText: this.edited
          ? incoming.reduce(
            (text, item) => appendSourceText(text, item.text, item.joinWithoutSpace),
            this.snapshot.reviewText,
          )
          : rawText,
        rawText,
        sourceSegmentIds: sources.map(item => item.segmentId),
        isDraftActive: Boolean(message.draft),
        draftPreview: message.draft?.text || '',
        draftJoinWithoutSpace: Boolean(message.draft?.joinWithoutSpace),
        queuedCount: 0,
        error: null,
      });
      return;
    }
    const source = message.source;
    this.latestSourceSequence = Math.max(this.latestSourceSequence, source.sequence);
    if (this.activeIsDraft && this.activeDraftID === source.segmentId) {
      this.activeIsDraft = false;
      this.activeDraftID = '';
      this.activeDraftSequence = 0;
      this.update({
        ...this.snapshot,
        reviewText: appendSourceText(this.snapshot.reviewText, source.text, source.joinWithoutSpace),
        rawText: appendSourceText(this.snapshot.rawText, source.text, source.joinWithoutSpace),
        sourceSegmentIds: [...this.snapshot.sourceSegmentIds, source.segmentId],
        isDraftActive: false,
        draftPreview: '',
        draftJoinWithoutSpace: false,
        queuedCount: 0,
      });
      return;
    }
    if (this.snapshot.sourceSegmentIds.includes(source.segmentId)) {
      return;
    }
    if (this.queued.some(item => item.sourceSegmentIds.includes(source.segmentId))) return;
    if (this.queued.length > 0) {
      const latestQueued = this.queued[this.queued.length - 1];
      latestQueued.text = appendSourceText(latestQueued.text, source.text, source.joinWithoutSpace);
      latestQueued.rawText = appendSourceText(latestQueued.rawText, source.text, source.joinWithoutSpace);
      latestQueued.sourceSegmentIds.push(source.segmentId);
      return;
    }
    this.update({
      ...this.snapshot,
      reviewText: appendSourceText(this.snapshot.reviewText, source.text, source.joinWithoutSpace),
      rawText: appendSourceText(this.snapshot.rawText, source.text, source.joinWithoutSpace),
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

function appendSourceText(current: string, incoming: string, joinWithoutSpace = false): string {
  const left = current.trimEnd();
  const right = incoming.trim();
  if (!left) return right;
  if (!right) return left;
  return joinWithoutSpace ? `${left}${right}` : `${left} ${right}`;
}
