import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countGraphemes,
  formatCaptionDeskError,
  formatCaptionDraftAnnouncement,
  formatCaptionSegmentAge,
  formatFontSizeLabel,
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
    label: 'Desk unavailable',
    tone: 'danger',
  });
  assert.deepEqual(getCaptionDeskOperationalStatus('CONNECTING', false, false, null), {
    label: 'Connecting',
    tone: 'warning',
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
    { label: 'Desk already in use', tone: 'danger' },
  );
  assert.deepEqual(
    getCaptionDeskOperationalStatus('CONNECTED', true, true, null),
    { label: 'Ready', tone: 'success' },
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
    'Can’t reach CaptionLive. Check the backend connection, then try again.',
  );
  assert.equal(
    formatCaptionDeskError(new Error('Token rejected')),
    'Token rejected',
  );
});

test('review instructions reflect whether the editor can be used', () => {
  assert.equal(
    getCaptionReviewInstructions(false),
    'Captions will be editable when the feed is ready.',
  );
  assert.equal(
    getCaptionReviewInstructions(true),
    'Move the cursor to a break, then press Enter to publish up to it.',
  );
});

test('segment age describes elapsed open time rather than system delay', () => {
  assert.equal(formatCaptionSegmentAge(14), 'Open for 14s');
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
  assert.equal(formatCaptionDraftAnnouncement(' กำลังถอดข้อความ '), 'Draft preview: กำลังถอดข้อความ');
  assert.equal(formatCaptionDraftAnnouncement('   '), '');
});

test('an active Draft has a visible non-color status label', () => {
  assert.equal(getCaptionDraftStatusLabel(true), 'Draft สด · อ่านอย่างเดียว');
  assert.equal(getCaptionDraftStatusLabel(false), '');
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
    isOverSingleLine: false,
    isOverTwoLines: false,
    label: 'Line 1 budget (≤35 chars)',
  });
  assert.deepEqual(getCaptionBudgetWarning(40), {
    isOverSingleLine: true,
    isOverTwoLines: false,
    label: '2nd line (35+ chars)',
  });
  assert.deepEqual(getCaptionBudgetWarning(75), {
    isOverSingleLine: true,
    isOverTwoLines: true,
    label: '',
  });
});
