import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCaptionDeskUrl,
  buildCaptionDeskSessionKey,
  buildStreamUrl,
  buildViewerUrl,
  parseAppRoute,
} from './appRoutes.ts';

test('parseAppRoute defaults the root and unknown hashes to admin', () => {
  assert.deepEqual(parseAppRoute(''), { page: 'admin', roomName: '', providerName: '', captionPolicy: 'provider-final', autoConnect: false });
  assert.deepEqual(parseAppRoute('#admin'), { page: 'admin', roomName: '', providerName: '', captionPolicy: 'provider-final', autoConnect: false });
  assert.deepEqual(parseAppRoute('#unknown'), { page: 'admin', roomName: '', providerName: '', captionPolicy: 'provider-final', autoConnect: false });
});

test('parseAppRoute reads stream and viewer room parameters', () => {
  assert.deepEqual(parseAppRoute('#stream?room=daily-briefing'), {
    page: 'stream',
    roomName: 'daily-briefing',
    providerName: '',
    captionPolicy: 'provider-final',
    autoConnect: false,
  });
  assert.deepEqual(parseAppRoute('#viewer?room=daily-briefing&autoconnect=1'), {
    page: 'viewer',
    roomName: 'daily-briefing',
    providerName: '',
    captionPolicy: 'provider-final',
    autoConnect: true,
  });
  assert.equal(parseAppRoute('#viewer?room=daily-briefing&autoconnect=true').autoConnect, false);
});

test('parseAppRoute reads Caption Desk room and provider', () => {
  assert.deepEqual(parseAppRoute('#caption-desk?room=daily-briefing&provider=Google'), {
    page: 'caption-desk',
    roomName: 'daily-briefing',
    providerName: 'google',
    captionPolicy: 'provider-final',
    autoConnect: false,
  });
  assert.deepEqual(parseAppRoute('#caption-desk?room=daily-briefing&provider=Gemini&policy=early-final'), {
    page: 'caption-desk',
    roomName: 'daily-briefing',
    providerName: 'gemini',
    captionPolicy: 'early-final',
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
  assert.equal(url, 'https://transcriber.example/app#caption-desk?room=room+name&provider=google&policy=provider-final');
  assert.equal(roomUrl, 'https://transcriber.example/app#caption-desk?room=room+name');
  assert.equal(url.includes('token'), false);
  assert.equal(roomUrl.includes('token'), false);
});

test('Caption Desk session identity includes its fixed finalization policy', () => {
  assert.equal(buildCaptionDeskSessionKey('room-a', 'gemini', 'early-final'), 'room-a:gemini:early-final');
});
