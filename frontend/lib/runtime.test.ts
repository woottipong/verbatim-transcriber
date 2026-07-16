import assert from 'node:assert/strict';
import test from 'node:test';
import {
    appendBounded,
    normalizeAppConfig,
    shouldUseVAD,
    stopMediaStream,
} from './runtime.ts';

const defaults = {
    provider: 'google',
    apiKey: '',
    backendUrl: 'ws://localhost:3000',
    useBackend: true,
    vadConfig: { enabled: false, threshold: 0.4 },
};

test('normalizes malformed persisted configuration', () => {
    const config = normalizeAppConfig({
        backendUrl: 42,
        vadConfig: { enabled: 'yes', threshold: 2 },
    }, defaults as never);

    assert.deepEqual(config, defaults);
});

test('uses VAD only when a VAD controller is connected', () => {
    assert.equal(shouldUseVAD(true, false), false);
    assert.equal(shouldUseVAD(true, true), true);
});

test('stops every track in a temporary media stream', () => {
    let stopped = 0;
    stopMediaStream({
        getTracks: () => [{ stop: () => stopped++ }, { stop: () => stopped++ }],
    } as never);

    assert.equal(stopped, 2);
});

test('bounds growing transcript collections', () => {
    assert.deepEqual(appendBounded([1, 2], 3, 2), [2, 3]);
});
