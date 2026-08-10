export type CaptionDeskConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';
export type CaptionDeskStatusTone = 'success' | 'info' | 'warning' | 'danger';

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
    return { label: 'มีผู้ตรวจทานคนอื่นกำลังใช้งานอยู่', tone: 'danger' };
  }
  if (subscriptionBlockCode) {
    return { label: 'ข้อมูลแคปชันยังไม่พร้อม', tone: 'danger' };
  }
  switch (state) {
    case 'ERROR':
      return { label: 'Caption Desk ไม่พร้อมใช้งาน', tone: 'danger' };
    case 'DISCONNECTED':
      return { label: 'ขาดการเชื่อมต่อ', tone: 'danger' };
    case 'CONNECTED':
      if (!agentConnected) return { label: 'ตัวถอดเสียงยังไม่ทำงาน', tone: 'warning' };
      if (!captionConnected) return { label: 'กำลังรับข้อความแคปชัน', tone: 'info' };
      return { label: 'พร้อมใช้งาน', tone: 'success' };
    default:
      return { label: 'กำลังเชื่อมต่อ', tone: 'info' };
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
    return 'เชื่อมต่อ CaptionLive ไม่ได้ ตรวจสอบการเชื่อมต่อแบ็กเอนด์แล้วลองอีกครั้ง';
  }
  const message = value instanceof Error
    ? value.message
    : typeof value === 'string' ? value : '';
  if (/room (?:does not exist|not found)|no longer available/i.test(message)) {
    return 'ไม่พบห้องนี้หรือห้องถูกปิดแล้ว ตรวจสอบห้องใน Control Room แล้วลองใหม่';
  }
  if (/unauthorized|forbidden|token rejected|permission denied/i.test(message)) {
    return 'ไม่มีสิทธิ์เปิด Caption Desk ตรวจสอบลิงก์หรือสิทธิ์แล้วลองใหม่';
  }
  if (/another Caption Desk is already active/i.test(message)) {
    return 'ผู้ให้บริการนี้มีผู้ตรวจทานคนอื่นใช้งานอยู่ ปิดหน้าต่างเดิมหรือลองใหม่ภายหลัง';
  }
  if (/different finalization policy/i.test(message)) {
    return 'เซสชัน Caption Desk นี้เลือกวิธีเริ่มตรวจทานไม่ตรงกัน';
  }
  if (/cannot publish captions/i.test(message)) {
    return 'ผู้ใช้นี้ไม่มีสิทธิ์เผยแพร่แคปชัน';
  }
  if (/move the cursor after the text you want to publish/i.test(message)) {
    return 'เลื่อนเคอร์เซอร์ไปหลังข้อความที่ต้องการเผยแพร่';
  }
  if (/wait for this caption to finish sending/i.test(message)) {
    return 'รอให้แคปชันนี้ส่งเสร็จก่อนเผยแพร่ส่วนถัดไป';
  }
  const lengthLimit = message.match(/Caption is too long to publish\. Keep it under ([\d,]+) UTF-8 bytes/i);
  if (lengthLimit) {
    return `แคปชันยาวเกินไป เผยแพร่ได้ไม่เกิน ${lengthLimit[1]} ไบต์ UTF-8`;
  }
  const waitingLimit = message.match(/Waiting for (\d+) captions to finish sending/i);
  if (waitingLimit) {
    return `กำลังรอส่งแคปชัน ${waitingLimit[1]} รายการ รอให้รายการหนึ่งเสร็จก่อนแล้วลองใหม่`;
  }
  if (/caption was not published|could not subscribe to this provider/i.test(message)) {
    return 'เผยแพร่แคปชันไม่สำเร็จ ลองอีกครั้ง';
  }
  if (/AI proofreading returned an invalid (?:response|result)|AI proofreading failed/i.test(message)) {
    return 'AI ตรวจแก้คำขัดข้องชั่วคราว ข้อความเดิมยังอยู่ครบ';
  }
  if (/[฀-๿]/.test(message)) return message;
  return 'การเชื่อมต่อ Caption Desk ล้มเหลว ลองอีกครั้ง';
}

export type CaptionProofreadAvailability = 'enabled' | 'disabled' | 'unknown';

export function getCaptionProofreadAvailability(
  providers: { captionProofread?: boolean } | null,
): CaptionProofreadAvailability {
  if (providers === null) return 'unknown';
  return providers.captionProofread === true ? 'enabled' : 'disabled';
}

export function getCaptionDeskChangeConfirmation(): string {
  return 'ละทิ้งแคปชันที่กำลังตรวจทาน แล้วเปลี่ยนผู้ให้บริการหรือไม่?';
}

export function getCaptionReviewInstructions(canEdit: boolean): string {
  return canEdit
    ? 'เลื่อนเคอร์เซอร์ไปยังจุดแบ่ง แล้วกด Enter เพื่อเผยแพร่ถึงจุดนั้น'
    : 'แก้ไขได้เมื่อข้อความเริ่มเข้ามา';
}

export function formatCaptionSegmentAge(ageSeconds: number): string {
  return `รอตรวจทานมาแล้ว ${Math.max(0, Math.floor(ageSeconds))} วินาที`;
}

export function formatCaptionDraftAnnouncement(text: string): string {
  const normalized = text.trim();
  return normalized ? `ตัวอย่างข้อความสด: ${normalized}` : '';
}

export function getCaptionDraftStatusLabel(isActive: boolean): string {
  return isActive ? 'ข้อความสด · อ่านอย่างเดียว' : '';
}

export interface CaptionDeskPolicyCopy {
  shortLabel: string;
  title: string;
  description: string;
}

export function getCaptionPolicyCopy(
  policy: 'early-final' | 'provider-final',
): CaptionDeskPolicyCopy {
  return policy === 'early-final'
    ? {
      shortLabel: 'Early interim',
      title: 'Early interim',
      description: 'เริ่มตรวจทานข้อความส่วนที่นิ่งได้ก่อน ไม่ต้องรอข้อความทั้งช่วง · แนะนำ',
    }
    : {
      shortLabel: 'Standard interim',
      title: 'Standard interim',
      description: 'รอให้ผู้ให้บริการยืนยันข้อความทั้งช่วงก่อนเริ่มตรวจทาน',
    };
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
  isOverTwoLines: boolean;
}

export function getCaptionBudgetWarning(graphemeCount: number): CaptionBudgetWarning {
  const isOverTwoLines = graphemeCount > 70;
  return { isOverTwoLines };
}
