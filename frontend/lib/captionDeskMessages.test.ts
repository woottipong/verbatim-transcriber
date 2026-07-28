import assert from 'node:assert/strict';
import test from 'node:test';
import { isCaptionAgentIdentity, parseCaptionOperatorPacket, shouldPublishOnEnter } from './captionDeskMessages.ts';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

test('Enter publishes while Shift+Enter and IME Enter do not', () => {
  assert.equal(shouldPublishOnEnter({ key: 'Enter', shiftKey: false, isComposing: false }), true);
  assert.equal(shouldPublishOnEnter({ key: 'Enter', shiftKey: true, isComposing: false }), false);
  assert.equal(shouldPublishOnEnter({ key: 'Enter', shiftKey: false, isComposing: true }), false);
});

test('accepts only the exact server-owned Agent identity', () => {
  assert.equal(isCaptionAgentIdentity('agent-google', 'google'), true);
  assert.equal(isCaptionAgentIdentity('agent-google-fake', 'google'), false);
  assert.equal(isCaptionAgentIdentity('agent-azure', 'google'), false);
});

test('parses a pending operator packet', () => {
  const message = parseCaptionOperatorPacket(encode({
    type: 'caption.pending',
    provider: 'google',
    source: { segmentId: 'g-1', text: 'ผู้ป่วยมีอาการ', provider: 'google', isFinal: true, sequence: 1 },
  }));
  assert.equal(message?.type, 'caption.pending');
});

test('rejects malformed, unsupported and oversized operator packets', () => {
  assert.equal(parseCaptionOperatorPacket(new Uint8Array([1, 2])), undefined);
  assert.equal(parseCaptionOperatorPacket(encode({ type: 'unknown', provider: 'google' })), undefined);
  assert.equal(parseCaptionOperatorPacket(encode({
    type: 'caption.pending',
    provider: 'unknown',
    source: { segmentId: '', text: 'x', provider: 'unknown', isFinal: true, sequence: 1 },
  })), undefined);
  assert.equal(parseCaptionOperatorPacket(encode({
    type: 'caption.pending',
    provider: 'google',
    source: { segmentId: 'g-1', text: 'x'.repeat(16_001), provider: 'google', isFinal: true, sequence: 1 },
  })), undefined);
  assert.equal(parseCaptionOperatorPacket(encode({
    type: 'caption.snapshot', requestId: 's-1', provider: 'google',
  })), undefined);
  assert.equal(parseCaptionOperatorPacket(encode({
    type: 'caption.pending', provider: 'google',
    source: { segmentId: 'g-1', text: 'x', provider: 'google', isFinal: false, sequence: 1 },
  })), undefined);
});
