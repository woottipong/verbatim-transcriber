import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatCaptionSegmentAge,
  getCaptionEditorTextUpdate,
  getCaptionDeskRoomStatus,
  getCaptionReviewInstructions,
} from './captionDeskPresentation.ts';

test('terminal room failures are presented as unavailable rather than connecting', () => {
  assert.deepEqual(getCaptionDeskRoomStatus('ERROR'), {
    label: 'Room unavailable',
    tone: 'danger',
  });
  assert.deepEqual(getCaptionDeskRoomStatus('CONNECTING'), {
    label: 'Room connecting',
    tone: 'warning',
  });
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

test('protected editor text appends a new suffix without replacing the live DOM text', () => {
  assert.deepEqual(
    getCaptionEditorTextUpdate('ข้อความที่แก้', 'ข้อความที่แก้และคำใหม่', true),
    { kind: 'append', text: 'และคำใหม่' },
  );
  assert.deepEqual(
    getCaptionEditorTextUpdate('ข้อความเดิม', 'ข้อความใหม่', false),
    { kind: 'replace', text: 'ข้อความใหม่' },
  );
});
