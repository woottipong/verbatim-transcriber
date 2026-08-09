import assert from 'node:assert/strict';
import test from 'node:test';
import {
    checkAvailableProviders,
    createCaptionDeskToken,
    createApprovedCaptionToken,
    deleteRoom,
    removeRoomParticipant,
    startRoomAgent,
    stopRoomAgent,
} from './api.ts';

test('provider availability retries one transient failure before reporting unavailable', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const originalFetch = globalThis.fetch;
    const originalWarn = console.warn;
    let attempts = 0;
    globalThis.fetch = async () => {
        attempts += 1;
        if (attempts === 1) {
            return new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({
            google: true,
            gemini: true,
            azure: true,
            'gpt-realtime-whisper': true,
            livekit: true,
            captionProofread: true,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    console.warn = () => undefined;

    try {
        const availability = checkAvailableProviders('http://localhost:3000');
        await Promise.resolve();
        await t.mock.timers.tick(1_000);

        assert.equal((await availability)?.captionProofread, true);
        assert.equal(attempts, 2);
    } finally {
        globalThis.fetch = originalFetch;
        console.warn = originalWarn;
    }
});

test('control room adapter owns agent endpoint details', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    try {
        await startRoomAgent('ws://localhost:3000', 'room one', 'google');
        await stopRoomAgent('ws://localhost:3000', 'room one', 'google');
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.equal(requests[0].url, 'http://localhost:3000/livekit/agent/start');
    assert.equal(requests[0].init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
        roomName: 'room one',
        provider: 'google',
    });
    assert.equal(requests[1].url, 'http://localhost:3000/livekit/agent/stop');
});

test('approved caption adapter uses its distinct room feed route', async () => {
    const urls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async input => {
        urls.push(String(input));
        return new Response(JSON.stringify({
            token: 'signed',
            expiresAt: '2026-07-29T00:00:00Z',
            websocketUrl: 'ws://localhost:3000/ws/caption/room-a?token=signed',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
        await createApprovedCaptionToken('http://localhost:3000', 'room-a');
    } finally {
        globalThis.fetch = originalFetch;
    }
    assert.deepEqual(urls, ['http://localhost:3000/livekit/rooms/room-a/caption-token/ws']);
});

test('Caption Desk adapter encodes room and provider targets', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response(JSON.stringify({
            token: 'operator-token',
            wsUrl: 'ws://localhost:7880',
            identity: 'caption-operator-test',
            room: 'room/one',
            provider: 'google',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    try {
        const token = await createCaptionDeskToken(
            'ws://localhost:3000',
            'room/one',
            'google',
            'desk-session-1',
            'early-final',
        );
        assert.equal(token.identity, 'caption-operator-test');
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.equal(
        requests[0].url,
        'http://localhost:3000/livekit/rooms/room%2Fone/caption-token/google?sessionId=desk-session-1&policy=early-final',
    );
    assert.equal(requests[0].init?.method, 'POST');
    assert.equal(requests[0].url.includes('token='), false);
});

test('control room adapter encodes destructive operation targets', async () => {
    const urls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async input => {
        urls.push(String(input));
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    try {
        await removeRoomParticipant('https://api.example.com', 'room/one', 'user/a');
        await deleteRoom('https://api.example.com', 'room/one');
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.deepEqual(urls, [
        'https://api.example.com/livekit/rooms/room%2Fone/participants/user%2Fa',
        'https://api.example.com/livekit/rooms/room%2Fone',
    ]);
});

test('control room adapter preserves backend errors', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(
        JSON.stringify({ error: 'Provider is unavailable' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
    );

    try {
        await assert.rejects(
            () => startRoomAgent('http://localhost:3000', 'room', 'google'),
            /Provider is unavailable/,
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});
