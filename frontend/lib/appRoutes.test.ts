import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStreamUrl, buildViewerUrl, parseAppRoute } from './appRoutes.ts';

test('parseAppRoute defaults the root and unknown hashes to admin', () => {
  assert.deepEqual(parseAppRoute(''), { page: 'admin', roomName: '', autoConnect: false });
  assert.deepEqual(parseAppRoute('#admin'), { page: 'admin', roomName: '', autoConnect: false });
  assert.deepEqual(parseAppRoute('#unknown'), { page: 'admin', roomName: '', autoConnect: false });
});

test('parseAppRoute reads stream and viewer room parameters', () => {
  assert.deepEqual(parseAppRoute('#stream?room=daily-briefing'), {
    page: 'stream',
    roomName: 'daily-briefing',
    autoConnect: false,
  });
  assert.deepEqual(parseAppRoute('#viewer?room=daily-briefing&autoconnect=1'), {
    page: 'viewer',
    roomName: 'daily-briefing',
    autoConnect: true,
  });
  assert.equal(parseAppRoute('#viewer?room=daily-briefing&autoconnect=true').autoConnect, false);
});

test('route builders encode rooms and never include credentials', () => {
  const baseUrl = 'https://transcriber.example/app';
  const streamUrl = buildStreamUrl(baseUrl, 'room name');
  const viewerUrl = buildViewerUrl(baseUrl, 'room name');

  assert.equal(streamUrl, 'https://transcriber.example/app#stream?room=room+name');
  assert.equal(viewerUrl, 'https://transcriber.example/app#viewer?room=room+name&autoconnect=1');
  assert.equal(streamUrl.includes('token'), false);
  assert.equal(viewerUrl.includes('token'), false);
});
