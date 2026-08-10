import assert from 'node:assert/strict';
import test from 'node:test';
import { detectThaiTypos, replaceTypoInText } from './thaiTypoDetector.ts';

test('detects and replaces multiple Thai typo matches in order', () => {
  const matches = detectThaiTypos('อนุญาติ และ คำนวน');
  assert.equal(matches.length, 2);
  assert.equal(matches[0].wrong, 'อนุญาติ');
  assert.equal(matches[1].wrong, 'คำนวน');
  assert.equal(replaceTypoInText('อนุญาติ และ คำนวน', matches[0]), 'อนุญาต และ คำนวน');
});

test('deduplicates overlapping custom and built-in rules', () => {
  const matches = detectThaiTypos('คำนวน', [{ wrong: 'คำนวน', correct: 'คำนวณ' }]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].correct, 'คำนวณ');
});

test('ignores empty, no-op, and non-matching rules', () => {
  const matches = detectThaiTypos('ข้อความ', [
    { wrong: '', correct: 'x' },
    { wrong: 'ข้อความ', correct: 'ข้อความ' },
    { wrong: 'ไม่พบ', correct: 'พบ' },
  ]);
  assert.equal(matches.length, 0);
});
