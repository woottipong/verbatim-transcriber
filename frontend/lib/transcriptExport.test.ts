import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTranscriptFilename,
  formatTranscriptText,
} from './transcriptExport.ts';

test('exports committed source rows in order and removes empty rows', () => {
  const text = formatTranscriptText([
    { text: ' First source row ' },
    { text: '   ' },
    { text: 'Second source row' },
  ]);

  assert.equal(text, 'First source row\nSecond source row');
});

test('does not require isFinal so committed Gemini chunks remain exportable', () => {
  assert.equal(
    formatTranscriptText([{ text: 'Committed Gemini chunk' }]),
    'Committed Gemini chunk',
  );
});

test('builds a safe provider transcript filename', () => {
  assert.equal(
    buildTranscriptFilename('Demo Room', 'Gemini Live', new Date(2026, 6, 22)),
    'demo-room-gemini-live-transcript-2026-07-22.txt',
  );
});

test('uses safe fallbacks when room and provider names have no filename characters', () => {
  assert.equal(
    buildTranscriptFilename('ห้องทดสอบ', '***', new Date(2026, 0, 5)),
    'room-provider-transcript-2026-01-05.txt',
  );
});
