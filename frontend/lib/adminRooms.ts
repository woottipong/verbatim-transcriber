import type { RoomDetails, TranscriptTokenResponse } from './api.ts';

const ROOM_NAME_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function validateRoomName(name: string): string | null {
    if (!ROOM_NAME_PATTERN.test(name)) {
        return 'Use 1–128 letters, numbers, hyphens, or underscores.';
    }
    return null;
}

export function keepSelectedRoom(selectedRoomName: string, rooms: RoomDetails[]): string {
    if (rooms.some(room => room.name === selectedRoomName)) return selectedRoomName;
    return rooms[0]?.name || '';
}

export function selectRoomAfterDelete(deletedRoomName: string, rooms: RoomDetails[]): string {
    const index = rooms.findIndex(room => room.name === deletedRoomName);
    if (index < 0) return rooms[0]?.name || '';
    return rooms[index + 1]?.name || rooms[index - 1]?.name || '';
}

export function isTranscriptTokenResponse(value: unknown): value is TranscriptTokenResponse {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<TranscriptTokenResponse>;
    return typeof candidate.token === 'string'
        && candidate.token.length > 0
        && typeof candidate.expiresAt === 'string'
        && !Number.isNaN(Date.parse(candidate.expiresAt))
        && typeof candidate.websocketUrl === 'string'
        && candidate.websocketUrl.startsWith('ws');
}
