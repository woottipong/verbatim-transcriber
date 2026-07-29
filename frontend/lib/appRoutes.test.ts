import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCaptionDeskUrl,
  buildCaptionDeskSessionKey,
  buildStreamUrl,
  buildViewerUrl,
  parseAppRoute,
  parseCaptionDeskSource,
} from './appRoutes.ts';

test('parseAppRoute defaults the root and unknown hashes to admin', () => {
  assert.deepEqual(parseAppRoute(''), { page: 'admin', roomName: '', providerName: '', autoConnect: false });
  assert.deepEqual(parseAppRoute('#admin'), { page: 'admin', roomName: '', providerName: '', autoConnect: false });
  assert.deepEqual(parseAppRoute('#unknown'), { page: 'admin', roomName: '', providerName: '', autoConnect: false });
});

test('parseAppRoute reads stream and viewer room parameters', () => {
  assert.deepEqual(parseAppRoute('#stream?room=daily-briefing'), {
    page: 'stream',
    roomName: 'daily-briefing',
    providerName: '',
    autoConnect: false,
  });
  assert.deepEqual(parseAppRoute('#viewer?room=daily-briefing&autoconnect=1'), {
    page: 'viewer',
    roomName: 'daily-briefing',
    providerName: '',
    autoConnect: true,
  });
  assert.equal(parseAppRoute('#viewer?room=daily-briefing&autoconnect=true').autoConnect, false);
});

test('parseAppRoute reads Caption Desk room and provider', () => {
  assert.deepEqual(parseAppRoute('#caption-desk?room=daily-briefing&provider=Google'), {
    page: 'caption-desk',
    roomName: 'daily-briefing',
    providerName: 'google',
    autoConnect: false,
  });
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

test('Caption Desk route builder encodes room and provider without credentials', () => {
  const url = buildCaptionDeskUrl('https://transcriber.example/app', 'room name', 'Google');
  const roomUrl = buildCaptionDeskUrl('https://transcriber.example/app', 'room name', '');
  const liveDraftUrl = buildCaptionDeskUrl(
    'https://transcriber.example/app',
    'room name',
    'Gemini',
    'live-draft',
  );
  assert.equal(url, 'https://transcriber.example/app#caption-desk?room=room+name&provider=google');
  assert.equal(roomUrl, 'https://transcriber.example/app#caption-desk?room=room+name');
  assert.equal(
    liveDraftUrl,
    'https://transcriber.example/app#caption-desk?room=room+name&provider=gemini&source=live-draft',
  );
  assert.equal(url.includes('token'), false);
  assert.equal(roomUrl.includes('token'), false);
});

test('Caption Desk source mode defaults safely and reads Live Draft explicitly', () => {
  assert.equal(parseCaptionDeskSource('#caption-desk?room=room&provider=google'), 'final');
  assert.equal(
    parseCaptionDeskSource('#caption-desk?room=room&provider=gemini&source=live-draft'),
    'live-draft',
  );
  assert.equal(
    parseCaptionDeskSource('#caption-desk?room=room&provider=gemini&source=interim'),
    'live-draft',
  );
  assert.equal(
    parseCaptionDeskSource('#caption-desk?room=room&provider=gemini&source=unknown'),
    'final',
  );
});

test('Caption Desk session identity changes with room, provider, or source mode', () => {
  assert.equal(
    buildCaptionDeskSessionKey('room-a', 'gemini', 'final'),
    'room-a:gemini:final',
  );
  assert.notEqual(
    buildCaptionDeskSessionKey('room-a', 'gemini', 'final'),
    buildCaptionDeskSessionKey('room-a', 'gemini', 'live-draft'),
  );
});
