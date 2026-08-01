import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLegacyViewerTokenRequest, shouldFallbackViewerToken } from './viewerToken.ts';

test('falls back only when the dedicated Viewer route is unavailable', () => {
    assert.equal(shouldFallbackViewerToken(404, { error: 'Cannot POST' }, true), true);
    assert.equal(shouldFallbackViewerToken(404, { code: 'room_not_found' }, true), false);
    assert.equal(shouldFallbackViewerToken(500, {}, true), false);
    assert.equal(shouldFallbackViewerToken(404, {}, false), false);
});

test('legacy Viewer tokens request least privilege explicitly', () => {
    const request = buildLegacyViewerTokenRequest('stage');
    assert.equal(request.roomName, 'stage');
    assert.equal(request.canPublish, false);
    assert.equal(request.canSubscribe, true);
    assert.equal(request.canPublishData, false);
    assert.match(String(request.identity), /^viewer-/);
});
