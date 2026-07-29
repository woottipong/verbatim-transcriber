export const CAPTION_OPERATOR_TOPIC = 'caption.operator';
export const CAPTION_COMMAND_TOPIC = 'caption.command';
export const CAPTION_PUBLIC_TOPIC = 'caption.public';

export const MAX_CAPTION_TEXT_BYTES = 16_000;

export interface CaptionSource {
  segmentId: string;
  text: string;
  provider: string;
  isFinal: boolean;
  sequence: number;
  languageCode?: string;
}

export interface CaptionSnapshotMessage {
  type: 'caption.snapshot';
  requestId: string;
  provider: string;
  draft?: CaptionSource;
  pending: CaptionSource[];
}

export interface CaptionDraftMessage {
  type: 'caption.draft';
  provider: string;
  source: CaptionSource;
}

export interface CaptionPendingMessage {
  type: 'caption.pending';
  provider: string;
  source: CaptionSource;
}

export interface CaptionPublishedMessage {
  type: 'caption.published';
  requestId: string;
  provider: string;
  publicationId: string;
  sourceSegmentIds: string[];
  text: string;
  publishedAt: number;
}

export interface CaptionRejectedMessage {
  type: 'caption.rejected';
  requestId: string;
  provider: string;
  code: string;
  message: string;
}

export type CaptionOperatorMessage =
  | CaptionSnapshotMessage
  | CaptionDraftMessage
  | CaptionPendingMessage
  | CaptionPublishedMessage
  | CaptionRejectedMessage;

export interface CaptionPublishCommand {
  type: 'caption.publish';
  requestId: string;
  provider: string;
  sourceSegmentIds: string[];
  text: string;
  remainingText?: string;
}

export function parseCaptionOperatorPacket(payload: Uint8Array): CaptionOperatorMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return undefined;
  }
  if (!isRecord(value) || typeof value.type !== 'string' || !isProvider(value.provider)) return undefined;

  switch (value.type) {
    case 'caption.snapshot': {
      if (!Array.isArray(value.pending)) return undefined;
      const pending = value.pending.map(parseSource);
      if (
        pending.some(source => !source || !source.isFinal || source.provider !== value.provider) ||
        !isNonEmpty(value.requestId)
      ) return undefined;
      const draft = value.draft === undefined ? undefined : parseSource(value.draft);
      if (value.draft !== undefined && (!draft || draft.isFinal || draft.provider !== value.provider)) return undefined;
      return { type: value.type, requestId: value.requestId, provider: value.provider, pending: pending as CaptionSource[], ...(draft ? { draft } : {}) };
    }
    case 'caption.draft':
    case 'caption.pending': {
      const source = parseSource(value.source);
      if (
        !source || source.provider !== value.provider ||
        (value.type === 'caption.draft' && source.isFinal) ||
        (value.type === 'caption.pending' && !source.isFinal)
      ) return undefined;
      return { type: value.type, provider: value.provider, source };
    }
    case 'caption.published':
      if (
        !isNonEmpty(value.requestId) || !isNonEmpty(value.publicationId) ||
        !isText(value.text) || !isStringArray(value.sourceSegmentIds) ||
        typeof value.publishedAt !== 'number'
      ) return undefined;
      return {
        type: value.type,
        requestId: value.requestId,
        provider: value.provider,
        publicationId: value.publicationId,
        sourceSegmentIds: value.sourceSegmentIds,
        text: value.text,
        publishedAt: value.publishedAt,
      };
    case 'caption.rejected':
      if (!isNonEmpty(value.requestId) || !isNonEmpty(value.code) || typeof value.message !== 'string') return undefined;
      return {
        type: value.type,
        requestId: value.requestId,
        provider: value.provider,
        code: value.code,
        message: value.message,
      };
    default:
      return undefined;
  }
}

export function buildCaptionSubscribeCommand(provider: string): Uint8Array {
  return encode({ type: 'caption.subscribe', requestId: crypto.randomUUID(), provider });
}

export function buildCaptionPublishCommand(command: CaptionPublishCommand): Uint8Array {
  return encode(command);
}

export function shouldPublishOnEnter(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'isComposing'>): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing;
}

export function getCaptionSubscriptionError(
  message: CaptionOperatorMessage,
  subscribed: boolean,
): string | null {
  if (subscribed || message.type !== 'caption.rejected') return null;
  return message.message || 'Caption Desk could not subscribe to this provider.';
}

export function isCaptionAgentIdentity(identity: string | undefined, provider: string): boolean {
  return identity === `agent-${provider}`;
}

function parseSource(value: unknown): CaptionSource | undefined {
  if (
    !isRecord(value) || !isNonEmpty(value.segmentId) || !isText(value.text) ||
    !isProvider(value.provider) || typeof value.isFinal !== 'boolean' ||
    !Number.isSafeInteger(value.sequence) || Number(value.sequence) < 0
  ) return undefined;
  return {
    segmentId: value.segmentId,
    text: value.text,
    provider: value.provider,
    isFinal: value.isFinal,
    sequence: Number(value.sequence),
    ...(typeof value.languageCode === 'string' ? { languageCode: value.languageCode } : {}),
  };
}

function isProvider(value: unknown): value is string {
  return typeof value === 'string' && ['google', 'gemini', 'azure', 'gpt-realtime-whisper'].includes(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && new TextEncoder().encode(value).length <= MAX_CAPTION_TEXT_BYTES;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 500 && value.every(isNonEmpty);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}
