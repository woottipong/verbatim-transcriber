export type CaptionDeskConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';
export type CaptionDeskStatusTone = 'success' | 'warning' | 'danger';

export interface CaptionDeskOperationalStatus {
  label: string;
  tone: CaptionDeskStatusTone;
}

export function getCaptionDeskOperationalStatus(
  state: CaptionDeskConnectionState,
  captionConnected: boolean,
  agentConnected: boolean,
  subscriptionBlockCode: string | null,
): CaptionDeskOperationalStatus {
  if (subscriptionBlockCode === 'operator_already_active') {
    return { label: 'Desk already in use', tone: 'danger' };
  }
  if (subscriptionBlockCode) {
    return { label: 'Caption feed unavailable', tone: 'danger' };
  }
  switch (state) {
    case 'ERROR':
      return { label: 'Desk unavailable', tone: 'danger' };
    case 'DISCONNECTED':
      return { label: 'Disconnected', tone: 'danger' };
    case 'CONNECTED':
      if (!agentConnected) return { label: 'Transcriber offline', tone: 'warning' };
      if (!captionConnected) return { label: 'Connecting captions', tone: 'warning' };
      return { label: 'Ready', tone: 'success' };
    default:
      return { label: 'Connecting', tone: 'warning' };
  }
}

export function hasCaptionDeskWork({
  reviewText,
  waitingCount,
}: {
  reviewText: string;
  waitingCount: number;
}): boolean {
  return reviewText.trim().length > 0 || waitingCount > 0;
}

export function formatCaptionDeskError(value: unknown): string {
  if (
    value instanceof TypeError &&
    /failed to fetch|networkerror|network request failed/i.test(value.message)
  ) {
    return 'Can’t reach CaptionLive. Check the backend connection, then try again.';
  }
  return value instanceof Error && value.message
    ? value.message
    : 'Caption Desk connection failed. Try again.';
}

export function getCaptionReviewInstructions(canEdit: boolean): string {
  return canEdit
    ? 'Move the cursor to a break, then press Enter to publish up to it.'
    : 'Captions will be editable when the feed is ready.';
}

export function formatCaptionSegmentAge(ageSeconds: number): string {
  return `Open for ${Math.max(0, Math.floor(ageSeconds))}s`;
}

export function formatCaptionDraftAnnouncement(text: string): string {
  const normalized = text.trim();
  return normalized ? `Draft preview: ${normalized}` : '';
}

export type CaptionEditorTextUpdate =
  | { kind: 'none' }
  | { kind: 'append'; text: string }
  | { kind: 'replace'; text: string };

export function getCaptionEditorTextUpdate(
  currentText: string,
  nextText: string,
): CaptionEditorTextUpdate {
  if (currentText === nextText) return { kind: 'none' };
  if (nextText.startsWith(currentText)) {
    return { kind: 'append', text: nextText.slice(currentText.length) };
  }
  return { kind: 'replace', text: nextText };
}

export type CaptionDeskFontSize = 'sm' | 'md' | 'lg' | 'xl';
export const CAPTION_DESK_FONT_SIZES: CaptionDeskFontSize[] = ['sm', 'md', 'lg', 'xl'];

export function getNextFontSize(
  current: CaptionDeskFontSize,
  direction: 'up' | 'down',
): CaptionDeskFontSize {
  const index = CAPTION_DESK_FONT_SIZES.indexOf(current);
  const validIndex = index === -1 ? 1 : index;
  if (direction === 'up') {
    return CAPTION_DESK_FONT_SIZES[Math.min(validIndex + 1, CAPTION_DESK_FONT_SIZES.length - 1)] || 'md';
  }
  return CAPTION_DESK_FONT_SIZES[Math.max(validIndex - 1, 0)] || 'md';
}

export function formatFontSizeLabel(size: CaptionDeskFontSize): string {
  switch (size) {
    case 'sm':
      return '80%';
    case 'md':
      return '100%';
    case 'lg':
      return '125%';
    case 'xl':
      return '150%';
  }
}

export function getFontSizeStyles(size: CaptionDeskFontSize): { fontSize: string; lineHeight: string } {
  switch (size) {
    case 'sm':
      return { fontSize: '1.25rem', lineHeight: '2.125rem' };
    case 'md':
      return { fontSize: '1.625rem', lineHeight: '2.625rem' };
    case 'lg':
      return { fontSize: '2rem', lineHeight: '3.125rem' };
    case 'xl':
      return { fontSize: '2.375rem', lineHeight: '3.625rem' };
  }
}

export function countGraphemes(text: string): number {
  if (!text) return 0;
  const Segmenter = (Intl as typeof Intl & {
    Segmenter?: new (
      locales?: string,
      options?: { granularity: string },
    ) => { segment(input: string): Iterable<{ segment: string }> };
  }).Segmenter;
  if (!Segmenter) return text.length;
  try {
    const segmenter = new Segmenter(undefined, { granularity: 'grapheme' });
    let count = 0;
    for (const _ of segmenter.segment(text)) {
      count++;
    }
    return count;
  } catch {
    return text.length;
  }
}

export interface CaptionBudgetWarning {
  isOverSingleLine: boolean;
  isOverTwoLines: boolean;
  label: string;
}

export function getCaptionBudgetWarning(graphemeCount: number): CaptionBudgetWarning {
  const isOverSingleLine = graphemeCount > 35;
  const isOverTwoLines = graphemeCount > 70;
  if (isOverTwoLines) {
    return {
      isOverSingleLine: true,
      isOverTwoLines: true,
      label: 'Exceeds 2-line budget (70+ chars)',
    };
  }
  if (isOverSingleLine) {
    return {
      isOverSingleLine: true,
      isOverTwoLines: false,
      label: '2nd line (35+ chars)',
    };
  }
  return {
    isOverSingleLine: false,
    isOverTwoLines: false,
    label: 'Line 1 budget (≤35 chars)',
  };
}


