import assert from 'node:assert/strict';
import test from 'node:test';
import { isTranscriptTokenResponse, keepSelectedRoom, selectRoomAfterDelete, validateRoomName } from './adminRooms.ts';
import type { RoomDetails } from './api.ts';

const room = (name: string): RoomDetails => ({
    name,
    numParticipants: 0,
    maxParticipants: 20,
    creationTime: 0,
    emptyTimeout: 300,
    participants: [],
});

test('validateRoomName mirrors backend constraints', () => {
    assert.equal(validateRoomName('daily-briefing_01'), null);
    assert.notEqual(validateRoomName(' room'), null);
    assert.notEqual(validateRoomName('room.name'), null);
    assert.notEqual(validateRoomName(''), null);
    assert.notEqual(validateRoomName('a'.repeat(129)), null);
});

test('selection follows room identity through polling and deletion', () => {
    assert.equal(keepSelectedRoom('room-b', [room('room-a'), room('room-b')]), 'room-b');
    assert.equal(keepSelectedRoom('room-b', [room('room-a')]), 'room-a');
    assert.equal(selectRoomAfterDelete('room-b', [room('room-a'), room('room-b'), room('room-c')]), 'room-c');
    assert.equal(selectRoomAfterDelete('room-c', [room('room-a'), room('room-b'), room('room-c')]), 'room-b');
    assert.equal(selectRoomAfterDelete('room-a', []), '');
});

test('transcript token responses are validated without storing them', () => {
    assert.equal(isTranscriptTokenResponse({
        token: 'signed-token',
        expiresAt: '2026-07-17T10:00:00Z',
        websocketUrl: 'wss://example.test/livekit/rooms/demo/transcripts/ws?token=signed-token',
    }), true);
    assert.equal(isTranscriptTokenResponse({ token: 'x', expiresAt: 'not-a-date', websocketUrl: 'ws://x' }), false);
    assert.equal(isTranscriptTokenResponse({ token: 'x', expiresAt: '2026-07-17T10:00:00Z', websocketUrl: 'https://x' }), false);
});
