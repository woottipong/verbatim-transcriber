import assert from 'node:assert/strict';
import test from 'node:test';

const sessionModule = await import('./liveKitSession.ts').catch(() => ({
  getLiveKitSessionPresentation: () => null,
}));

const getPresentation = sessionModule.getLiveKitSessionPresentation;

test('session is not ready before joining a room', () => {
  const presentation = getPresentation('DISCONNECTED', false, false);

  assert.equal(presentation?.headline, 'Ready to Connect');
  assert.equal(presentation?.canSpeak, false);
  assert.deepEqual(presentation?.steps, ['idle', 'idle', 'idle']);
  assert.deepEqual(presentation?.health, [
    { label: 'Room', value: 'Disconnected', state: 'idle' },
    { label: 'Microphone', value: 'Off', state: 'idle' },
    { label: 'Transcriber', value: 'Disconnected', state: 'idle' },
  ]);
});

test('joining keeps room and microphone visibly in progress', () => {
  const presentation = getPresentation('CONNECTING', false, false);

  assert.equal(presentation?.headline, 'Connecting and starting microphone...');
  assert.deepEqual(presentation?.steps, ['pending', 'pending', 'idle']);
});

test('connected session waits for the agent before inviting speech', () => {
  const presentation = getPresentation('CONNECTED', true, false);

  assert.equal(presentation?.headline, 'Waiting for transcriber');
  assert.equal(presentation?.canSpeak, false);
  assert.deepEqual(presentation?.steps, ['complete', 'complete', 'pending']);
});

test('muted microphone prevents a connected session from becoming ready', () => {
  const presentation = getPresentation('CONNECTED', false, true);

  assert.equal(presentation?.headline, 'Microphone is muted');
  assert.equal(presentation?.canSpeak, false);
  assert.deepEqual(presentation?.steps, ['complete', 'idle', 'complete']);
});

test('session is ready only when room, microphone, and agent are ready', () => {
  const presentation = getPresentation('CONNECTED', true, true);

  assert.equal(presentation?.headline, 'Ready to speak');
  assert.equal(presentation?.canSpeak, true);
  assert.deepEqual(presentation?.steps, ['complete', 'complete', 'complete']);
  assert.deepEqual(presentation?.health, [
    { label: 'Room', value: 'Connected', state: 'complete' },
    { label: 'Microphone', value: 'On', state: 'complete' },
    { label: 'Transcriber', value: 'Connected', state: 'complete' },
  ]);
});

