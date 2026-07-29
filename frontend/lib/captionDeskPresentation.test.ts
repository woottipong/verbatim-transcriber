import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatCaptionDeskError,
  formatCaptionSegmentAge,
  getCaptionEditorTextUpdate,
  getCaptionDeskOperationalStatus,
  getCaptionReviewInstructions,
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
