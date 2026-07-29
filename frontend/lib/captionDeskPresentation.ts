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

export type CaptionEditorTextUpdate =
  | { kind: 'none' }
  | { kind: 'append'; text: string }
  | { kind: 'replace'; text: string };

export function getCaptionEditorTextUpdate(
  currentText: string,
  nextText: string,
  operatorEditsActive: boolean,
): CaptionEditorTextUpdate {
  if (currentText === nextText) return { kind: 'none' };
  if (operatorEditsActive && nextText.startsWith(currentText)) {
    return { kind: 'append', text: nextText.slice(currentText.length) };
  }
  return { kind: 'replace', text: nextText };
}
