import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureChromeTabAudio,
  getChromeTabCaptureError,
} from './audioSources.ts';

interface FakeTrack {
  kind: 'audio' | 'video';
  stopCalled: boolean;
  stop: () => void;
}

function createTrack(kind: FakeTrack['kind']): FakeTrack {
  return {
    kind,
    stopCalled: false,
    stop() {
      this.stopCalled = true;
    },
  };
}

function createStream(audio: FakeTrack[], video: FakeTrack[]): MediaStream {
  return {
    getAudioTracks: () => audio,
    getVideoTracks: () => video,
    getTracks: () => [...audio, ...video],
  } as unknown as MediaStream;
}

test('keeps tab audio and stops display video', async () => {
  const audio = createTrack('audio');
  const video = createTrack('video');

  const result = await captureChromeTabAudio(async () => createStream([audio], [video]));

  assert.equal(result.audioTrack, audio);
  assert.equal(video.stopCalled, true);
  assert.equal(audio.stopCalled, false);
});

test('stops every returned track when the selected surface has no audio', async () => {
  const video = createTrack('video');

  await assert.rejects(
    captureChromeTabAudio(async () => createStream([], [video])),
    /Share tab audio/,
  );
  assert.equal(video.stopCalled, true);
});

test('rejects Chrome Tab capture when the browser API is unavailable', async () => {
  await assert.rejects(
    captureChromeTabAudio(null),
    /not supported/,
  );
});

test('reports a cancelled picker without exposing browser error details', () => {
  assert.equal(
    getChromeTabCaptureError(new DOMException('Browser-specific detail', 'NotAllowedError')),
    'Tab sharing was cancelled or not allowed.',
  );
});
