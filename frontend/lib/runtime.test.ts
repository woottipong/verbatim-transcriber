import assert from 'node:assert/strict';
import test from 'node:test';
import {
    appendBounded,
    normalizeAppConfig,
    stopMediaStream,
} from './runtime.ts';

const defaults = {
    backendUrl: 'http://localhost:3000',
};

test('normalizes malformed persisted configuration', () => {
    const config = normalizeAppConfig({
        backendUrl: 42,
    }, defaults as never);

    assert.deepEqual(config, defaults);
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
