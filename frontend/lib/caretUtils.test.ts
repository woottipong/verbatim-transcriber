import assert from 'node:assert/strict';
import test from 'node:test';
import { clampCaretOffset } from './caretUtils.ts';

test('caret restoration keeps the previous position within replacement text', () => {
  assert.equal(clampCaretOffset(12, 20), 12);
  assert.equal(clampCaretOffset(30, 20), 20);
  assert.equal(clampCaretOffset(-1, 20), 0);
});
