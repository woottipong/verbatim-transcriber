import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTranscriptFilename,
  formatTranscriptText,
} from './transcriptExport.ts';

test('exports committed source rows in order and removes empty rows', () => {
  const text = formatTranscriptText([
    { text: ' First source row ', isFinal: true },
    { text: '   ', isFinal: true },
    { text: 'Second source row', isFinal: true },
  ]);

  assert.equal(text, 'First source row\nSecond source row');
});

test('exports only finalized source rows', () => {
  assert.equal(
    formatTranscriptText([
      { text: 'Live draft', isFinal: false },
      { text: 'Final source', isFinal: true },
    ]),
    'Final source',
  );
});

test('exports nearby finalized chunks using the same rows shown in the UI', () => {
  const text = formatTranscriptText([
    { id: '1', text: 'First chunk', isFinal: true, timestamp: 1_000, provider: 'gemini', speaker: 'one' },
    { id: '2', text: 'continues here', isFinal: true, timestamp: 2_200, provider: 'gemini', speaker: 'one' },
  ]);

  assert.equal(text, 'First chunk continues here');
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
