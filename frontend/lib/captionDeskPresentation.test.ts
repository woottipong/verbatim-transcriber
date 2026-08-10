import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countGraphemes,
  formatCaptionDeskError,
  formatCaptionDraftAnnouncement,
  formatCaptionSegmentAge,
  formatFontSizeLabel,
  getCaptionDeskChangeConfirmation,
  getCaptionPolicyCopy,
  getCaptionProofreadAvailability,
  getCaptionBudgetWarning,
  getCaptionEditorTextUpdate,
  getCaptionDeskOperationalStatus,
  getCaptionDraftStatusLabel,
  getCaptionReviewInstructions,
  getFontSizeStyles,
  getNextFontSize,
  hasCaptionDeskWork,
} from './captionDeskPresentation.ts';

test('terminal room failures are presented as unavailable rather than connecting', () => {
  assert.deepEqual(getCaptionDeskOperationalStatus('ERROR', false, false, null), {
    label: 'Caption Desk ไม่พร้อมใช้งาน',
    tone: 'danger',
  });
  assert.deepEqual(getCaptionDeskOperationalStatus('CONNECTING', false, false, null), {
    label: 'กำลังเชื่อมต่อ',
    tone: 'info',
  });
  assert.deepEqual(getCaptionDeskOperationalStatus('CONNECTED', false, true, null), {
    label: 'กำลังรับข้อความแคปชัน',
    tone: 'info',
  });
});

test('a blocked operator subscription takes priority over connecting states', () => {
  assert.deepEqual(
    getCaptionDeskOperationalStatus(
      'CONNECTED',
      false,
      true,
      'operator_already_active',
    ),
    { label: 'มีผู้ตรวจทานคนอื่นกำลังใช้งานอยู่', tone: 'danger' },
  );
  assert.deepEqual(
    getCaptionDeskOperationalStatus('CONNECTED', true, true, null),
    { label: 'พร้อมใช้งาน', tone: 'success' },
  );
});

test('leaving is guarded only while review or publication work exists', () => {
  assert.equal(hasCaptionDeskWork({ reviewText: '', waitingCount: 0 }), false);
  assert.equal(hasCaptionDeskWork({ reviewText: 'กำลังแก้', waitingCount: 0 }), true);
  assert.equal(hasCaptionDeskWork({ reviewText: '', waitingCount: 1 }), true);
});

test('network failures use operator-facing recovery copy', () => {
  assert.equal(
    formatCaptionDeskError(new TypeError('Failed to fetch')),
    'เชื่อมต่อ CaptionLive ไม่ได้ ตรวจสอบการเชื่อมต่อแบ็กเอนด์แล้วลองอีกครั้ง',
  );
  assert.equal(
    formatCaptionDeskError(new Error('Token rejected')),
    'ไม่มีสิทธิ์เปิด Caption Desk ตรวจสอบลิงก์หรือสิทธิ์แล้วลองใหม่',
  );
  assert.equal(
    formatCaptionDeskError(new Error('Room does not exist or is no longer available')),
    'ไม่พบห้องนี้หรือห้องถูกปิดแล้ว ตรวจสอบห้องใน Control Room แล้วลองใหม่',
  );
  assert.equal(
    formatCaptionDeskError(new Error('Another Caption Desk is already active')),
    'ผู้ให้บริการนี้มีผู้ตรวจทานคนอื่นใช้งานอยู่ ปิดหน้าต่างเดิมหรือลองใหม่ภายหลัง',
  );
  assert.equal(
    formatCaptionDeskError('Move the cursor after the text you want to publish.'),
    'เลื่อนเคอร์เซอร์ไปหลังข้อความที่ต้องการเผยแพร่',
  );
  assert.equal(
    formatCaptionDeskError('Caption is too long to publish. Keep it under 16,000 UTF-8 bytes.'),
    'แคปชันยาวเกินไป เผยแพร่ได้ไม่เกิน 16,000 ไบต์ UTF-8',
  );
  assert.equal(
    formatCaptionDeskError('AI proofreading returned an invalid result'),
    'AI ตรวจแก้คำขัดข้องชั่วคราว ข้อความเดิมยังอยู่ครบ',
  );
});

test('proofread availability maps to a clear operator state', () => {
  assert.equal(getCaptionProofreadAvailability(null), 'unknown');
  assert.equal(getCaptionProofreadAvailability({ captionProofread: true }), 'enabled');
  assert.equal(getCaptionProofreadAvailability({ captionProofread: false }), 'disabled');
});

test('changing desks explains that unfinished captions will be discarded', () => {
  assert.match(getCaptionDeskChangeConfirmation(), /ละทิ้งแคปชัน/);
  assert.match(getCaptionDeskChangeConfirmation(), /เปลี่ยนผู้ให้บริการ/);
});

test('review instructions reflect whether the editor can be used', () => {
  assert.equal(
    getCaptionReviewInstructions(false),
    'แก้ไขได้เมื่อข้อความเริ่มเข้ามา',
  );
  assert.equal(
    getCaptionReviewInstructions(true),
    'เลื่อนเคอร์เซอร์ไปยังจุดแบ่ง แล้วกด Enter เพื่อเผยแพร่ถึงจุดนั้น',
  );
});

test('segment age describes elapsed open time rather than system delay', () => {
  assert.equal(formatCaptionSegmentAge(14), 'รอตรวจทานมาแล้ว 14 วินาที');
});

test('editor text appends a new suffix without replacing the live DOM text', () => {
  assert.deepEqual(
    getCaptionEditorTextUpdate('ข้อความที่แก้', 'ข้อความที่แก้และคำใหม่'),
    { kind: 'append', text: 'และคำใหม่' },
  );
  assert.deepEqual(
    getCaptionEditorTextUpdate('ข้อความเดิม', 'ข้อความใหม่'),
    { kind: 'replace', text: 'ข้อความใหม่' },
  );
});

test('Draft announcements expose preview text without announcing empty revisions', () => {
  assert.equal(formatCaptionDraftAnnouncement(' กำลังถอดข้อความ '), 'ตัวอย่างข้อความสด: กำลังถอดข้อความ');
  assert.equal(formatCaptionDraftAnnouncement('   '), '');
});

test('an active Draft has a visible non-color status label', () => {
  assert.equal(getCaptionDraftStatusLabel(true), 'ข้อความสด · อ่านอย่างเดียว');
  assert.equal(getCaptionDraftStatusLabel(false), '');
});

test('interim mode copy explains both ways to review a caption', () => {
  assert.deepEqual(getCaptionPolicyCopy('early-final'), {
    shortLabel: 'Early interim',
    title: 'Early interim',
    description: 'เริ่มตรวจทานข้อความส่วนที่นิ่งได้ก่อน ไม่ต้องรอข้อความทั้งช่วง · แนะนำ',
  });
  assert.deepEqual(getCaptionPolicyCopy('provider-final'), {
    shortLabel: 'Standard interim',
    title: 'Standard interim',
    description: 'รอให้ผู้ให้บริการยืนยันข้อความทั้งช่วงก่อนเริ่มตรวจทาน',
  });
});

test('font size navigation steps up and down within bounds', () => {
  assert.equal(getNextFontSize('md', 'up'), 'lg');
  assert.equal(getNextFontSize('lg', 'up'), 'xl');
  assert.equal(getNextFontSize('xl', 'up'), 'xl');
  assert.equal(getNextFontSize('md', 'down'), 'sm');
  assert.equal(getNextFontSize('sm', 'down'), 'sm');
  assert.equal(formatFontSizeLabel('md'), '100%');
  assert.deepEqual(getFontSizeStyles('md'), { fontSize: '1.625rem', lineHeight: '2.625rem' });
});

test('grapheme counting and budget warning report correct line thresholds', () => {
  assert.equal(countGraphemes('ผู้ใหญ่'), 4);
  assert.deepEqual(getCaptionBudgetWarning(20), {
    isOverTwoLines: false,
  });
  assert.deepEqual(getCaptionBudgetWarning(40), {
    isOverTwoLines: false,
  });
  assert.deepEqual(getCaptionBudgetWarning(75), {
    isOverTwoLines: true,
  });
});
