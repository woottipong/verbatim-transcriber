import assert from 'node:assert/strict';
import test from 'node:test';
import {
    canRemoveParticipant,
    describeTranscriptFeedError,
    deriveAdminReadiness,
    isTranscriptLinkUsable,
    isTranscriptTokenResponse,
    keepSelectedRoom,
    maskTranscriptWebSocketUrl,
    selectRoomAfterDelete,
    validateRoomName,
} from './adminRooms.ts';
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
        provider: 'google',
        token: 'signed-token',
        expiresAt: '2026-07-17T10:00:00Z',
        websocketUrl: 'wss://example.test/ws/transcript/google/demo?token=signed-token',
    }), true);
    assert.equal(isTranscriptTokenResponse({ provider: 'openai', token: 'x', expiresAt: '2026-07-17T10:00:00Z', websocketUrl: 'ws://x' }), false);
    assert.equal(isTranscriptTokenResponse({ provider: 'google', token: 'x', expiresAt: 'not-a-date', websocketUrl: 'ws://x' }), false);
    assert.equal(isTranscriptTokenResponse({ provider: 'google', token: 'x', expiresAt: '2026-07-17T10:00:00Z', websocketUrl: 'https://x' }), false);
});

test('transcript links are reusable only before expiry', () => {
    const response = {
        provider: 'gemini' as const,
        token: 'signed-token',
        expiresAt: '2026-07-17T10:00:00Z',
        websocketUrl: 'wss://example.test/ws/transcript/gemini/demo?token=signed-token',
    };
    assert.equal(isTranscriptLinkUsable(response, Date.parse('2026-07-17T09:59:59Z')), true);
    assert.equal(isTranscriptLinkUsable(response, Date.parse('2026-07-17T10:00:00Z')), false);
});

test('admin readiness leads the operator from audio to transcription', () => {
    assert.deepEqual(deriveAdminReadiness([], 0), {
        state: 'waiting-audio',
        title: 'Waiting for audio',
        detail: 'Open Audio Source to publish microphone or tab audio.',
        nextAction: 'open-audio',
    });
    assert.deepEqual(deriveAdminReadiness([
        { identity: 'user-1', name: 'Sender', isAgent: false, state: 'ACTIVE' },
    ], 0), {
        state: 'waiting-agent',
        title: 'Audio connected',
        detail: 'Start a provider to begin transcription.',
        nextAction: 'start-agent',
    });
    assert.deepEqual(deriveAdminReadiness([
        { identity: 'user-1', name: 'Sender', isAgent: false, state: 'ACTIVE' },
        { identity: 'viewer-1', name: 'Viewer', isAgent: false, state: 'ACTIVE' },
    ], 2), {
        state: 'active',
        title: 'Transcription active',
        detail: '2 providers are listening to this room.',
        nextAction: 'ready',
    });
});

test('viewer participants do not make the room look audio-ready', () => {
    assert.equal(deriveAdminReadiness([
        { identity: 'viewer-1', name: 'Viewer', isAgent: false, state: 'ACTIVE' },
    ], 1).state, 'waiting-audio');
});

test('transcript configuration errors explain the recovery', () => {
    assert.equal(
        describeTranscriptFeedError('Transcript WebSocket links are not configured'),
        'External feeds are unavailable. Configure TRANSCRIPT_WS_SECRET with at least 32 characters, restart the backend, then retry.',
    );
    assert.equal(describeTranscriptFeedError('Network request failed'), 'Network request failed');
});

test('masked transcript URLs never expose their signed token', () => {
    const raw = 'wss://example.test/ws/transcript/gemini/demo?token=super-secret&mode=live';
    const masked = maskTranscriptWebSocketUrl(raw);
    assert.equal(masked, 'wss://example.test/ws/transcript/gemini/demo?token=••••••••&mode=live');
    assert.equal(masked.includes('super-secret'), false);
});

test('agents are stopped through agent controls instead of participant removal', () => {
    assert.equal(canRemoveParticipant({ identity: 'user-1', name: 'Sender', isAgent: false, state: 'ACTIVE' }), true);
    assert.equal(canRemoveParticipant({ identity: 'agent-gemini', name: 'Gemini', isAgent: true, state: 'ACTIVE' }), false);
});
