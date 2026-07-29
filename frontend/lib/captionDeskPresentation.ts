export type CaptionDeskConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';
export type CaptionDeskStatusTone = 'success' | 'warning' | 'danger';

export interface CaptionDeskRoomStatus {
  label: string;
  tone: CaptionDeskStatusTone;
}

export function getCaptionDeskRoomStatus(
  state: CaptionDeskConnectionState,
): CaptionDeskRoomStatus {
  switch (state) {
    case 'CONNECTED':
      return { label: 'Room connected', tone: 'success' };
    case 'ERROR':
      return { label: 'Room unavailable', tone: 'danger' };
    case 'DISCONNECTED':
      return { label: 'Room disconnected', tone: 'danger' };
    default:
      return { label: 'Room connecting', tone: 'warning' };
  }
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
