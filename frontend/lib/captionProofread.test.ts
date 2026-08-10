import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROOFREAD_HARD_FLUSH_MS,
  PROOFREAD_IDLE_MS,
  PROOFREAD_MAX_GRAPHEMES,
  applyProofreadResult,
  countProofreadGraphemes,
  createProofreadBatch,
  getAppendedSuffix,
  shouldFlushProofread,
  takeTrailingContext,
} from './captionProofread.ts';

test('detects only an appended final suffix', () => {
  assert.equal(getAppendedSuffix('เดิม', 'เดิม เพิ่ม'), ' เพิ่ม');
  assert.equal(getAppendedSuffix('เดิม', 'แก้ไข'), null);
  assert.equal(getAppendedSuffix('เดิม', 'เด'), null);
});

test('creates a range that preserves surrounding whitespace', () => {
  const text = 'ก่อน\n  คำผิด  ';
  const batch = createProofreadBatch(text, 'ก่อน\n'.length, 4, 'r1');
  assert.ok(batch);
  assert.equal(batch.targetText, 'คำผิด');
  assert.equal(text.slice(0, batch.start), 'ก่อน\n  ');
  assert.equal(text.slice(batch.end), '  ');
});

test('uses the latest published caption as context for the first new batch', () => {
  const batch = createProofreadBatch('ข้อความใหม่', 0, 5, 'r-context', 'ข้อความที่เผยแพร่ก่อนหน้า');
  assert.ok(batch);
  assert.equal(batch.contextText, 'ข้อความที่เผยแพร่ก่อนหน้า');
});

test('keeps Thai combining marks together in context and counts', () => {
  const text = 'กำลังอ่าน';
  assert.equal(countProofreadGraphemes(text), 6);
  assert.equal(takeTrailingContext(text, 3), 'อ่าน');
});

test('applies a result while preserving text appended during the request', () => {
  const batch = createProofreadBatch('คำผิด', 0, 3, 'r1');
  assert.ok(batch);
  assert.equal(applyProofreadResult('คำผิด ข้อความใหม่', batch, 'คำถูก'), 'คำถูก ข้อความใหม่');
});

test('rejects a result after manual edit or publication', () => {
  const batch = createProofreadBatch('คำผิด', 0, 3, 'r1');
  assert.ok(batch);
  assert.equal(applyProofreadResult('คำที่แก้เอง', batch, 'คำถูก'), null);
  assert.equal(applyProofreadResult('', batch, 'คำถูก'), null);
});

test('flushes by idle, hard ceiling, size, or explicit force', () => {
  assert.equal(shouldFlushProofread('ข้อความ', PROOFREAD_IDLE_MS, 100), true);
  assert.equal(shouldFlushProofread('ข้อความ', PROOFREAD_IDLE_MS - 1, 100), false);
  assert.equal(shouldFlushProofread('ข้อความ', 100, PROOFREAD_HARD_FLUSH_MS), true);
  assert.equal(shouldFlushProofread('ก'.repeat(PROOFREAD_MAX_GRAPHEMES), 0, 0), true);
  assert.equal(shouldFlushProofread('ข้อความ', 0, 0, true), true);
  assert.equal(shouldFlushProofread('', PROOFREAD_IDLE_MS, PROOFREAD_HARD_FLUSH_MS), false);
});

test('continuous appends wait for the hard ceiling instead of the first idle timer', () => {
  assert.equal(shouldFlushProofread('ข้อความต่อเนื่อง', 100, PROOFREAD_HARD_FLUSH_MS - 1), false);
  assert.equal(shouldFlushProofread('ข้อความต่อเนื่อง', 100, PROOFREAD_HARD_FLUSH_MS), true);
});

test('caps each request at the grapheme budget without dropping the remaining text', () => {
  const text = 'ก'.repeat(400);
  const batch = createProofreadBatch(text, 0, 1, 'r1');
  assert.ok(batch);
  assert.equal(countProofreadGraphemes(batch.targetText), PROOFREAD_MAX_GRAPHEMES);
  assert.equal(batch.end, batch.targetText.length);
  assert.equal(text.slice(batch.end), 'ก'.repeat(80));
});
