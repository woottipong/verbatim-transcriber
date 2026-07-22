import assert from 'node:assert/strict';
import test from 'node:test';

const sessionModule = await import('./liveKitSession.ts').catch(() => ({
  getLiveKitSessionPresentation: () => null,
}));

const getPresentation = sessionModule.getLiveKitSessionPresentation;

test('session is not ready before joining a room', () => {
  const presentation = getPresentation('DISCONNECTED', false, false, 'microphone', false);

  assert.equal(presentation?.headline, 'Ready to Connect');
  assert.equal(presentation?.canSpeak, false);
  assert.deepEqual(presentation?.steps, ['idle', 'idle', 'idle']);
  assert.deepEqual(presentation?.health, [
    { label: 'Room', value: 'Disconnected', state: 'idle' },
    { label: 'Audio Input', value: 'Off', state: 'idle' },
    { label: 'Transcriber', value: 'Disconnected', state: 'idle' },
  ]);
});

test('joining keeps room and microphone visibly in progress', () => {
  const presentation = getPresentation('CONNECTING', false, false, 'microphone', false);

  assert.equal(presentation?.headline, 'Connecting and starting microphone...');
  assert.deepEqual(presentation?.steps, ['pending', 'pending', 'idle']);
});

test('connected session waits for the agent before inviting speech', () => {
  const presentation = getPresentation('CONNECTED', true, false, 'microphone', false);

  assert.equal(presentation?.headline, 'Waiting for transcriber');
  assert.equal(presentation?.canSpeak, false);
  assert.deepEqual(presentation?.steps, ['complete', 'complete', 'pending']);
});

test('muted microphone prevents a connected session from becoming ready', () => {
  const presentation = getPresentation('CONNECTED', false, true, 'microphone', false);

  assert.equal(presentation?.headline, 'Microphone is muted');
  assert.equal(presentation?.canSpeak, false);
  assert.deepEqual(presentation?.steps, ['complete', 'idle', 'complete']);
});

test('session is ready only when room, microphone, and agent are ready', () => {
  const presentation = getPresentation('CONNECTED', true, true, 'microphone', false);

  assert.equal(presentation?.headline, 'Ready to speak');
  assert.equal(presentation?.canSpeak, true);
  assert.deepEqual(presentation?.steps, ['complete', 'complete', 'complete']);
  assert.deepEqual(presentation?.health, [
    { label: 'Room', value: 'Connected', state: 'complete' },
    { label: 'Audio Input', value: 'On', state: 'complete' },
    { label: 'Transcriber', value: 'Connected', state: 'complete' },
  ]);
});

test('Chrome Tab connecting copy instructs the user to share tab audio', () => {
  const presentation = getPresentation('CONNECTING', false, false, 'chrome-tab', false);

  assert.equal(presentation?.headline, 'Connecting Chrome Tab audio...');
  assert.match(presentation?.detail ?? '', /Share tab audio/);
});

test('externally stopped Chrome Tab audio keeps the room in a warning state', () => {
  const presentation = getPresentation('CONNECTED', false, true, 'chrome-tab', true);

  assert.equal(presentation?.headline, 'Tab audio stopped');
  assert.equal(presentation?.health[1].label, 'Audio Input');
  assert.equal(presentation?.health[1].value, 'Stopped');
  assert.equal(presentation?.canSpeak, false);
});

test('ready copy identifies Chrome Tab audio', () => {
  const presentation = getPresentation('CONNECTED', true, true, 'chrome-tab', false);

  assert.equal(presentation?.headline, 'Ready to transcribe');
  assert.match(presentation?.detail ?? '', /Chrome Tab audio/);
});
