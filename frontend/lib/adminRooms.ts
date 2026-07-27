import type { ParticipantInfo, RoomDetails, TranscriptTokenResponse } from './api.ts';
import type { AgentProvider } from './providers.ts';

const ROOM_NAME_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const TRANSCRIPT_PROVIDERS = new Set<AgentProvider>([
    'google',
    'gemini',
    'azure',
    'gpt-realtime-whisper',
]);

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
    return typeof candidate.provider === 'string'
        && TRANSCRIPT_PROVIDERS.has(candidate.provider as AgentProvider)
        && typeof candidate.token === 'string'
        && candidate.token.length > 0
        && typeof candidate.expiresAt === 'string'
        && !Number.isNaN(Date.parse(candidate.expiresAt))
        && typeof candidate.websocketUrl === 'string'
        && candidate.websocketUrl.startsWith('ws');
}

export function isTranscriptLinkUsable(
    response: TranscriptTokenResponse,
    now = Date.now(),
): boolean {
    return Date.parse(response.expiresAt) > now;
}

export interface AdminReadiness {
    state: 'waiting-audio' | 'waiting-agent' | 'active';
    title: string;
    detail: string;
    nextAction: 'open-audio' | 'start-agent' | 'ready';
}

export function deriveAdminReadiness(
    participants: ParticipantInfo[],
    activeAgentCount: number,
): AdminReadiness {
    const hasAudioSender = participants.some(participant =>
        !participant.isAgent && participant.identity.startsWith('user-'),
    );

    if (!hasAudioSender) {
        return {
            state: 'waiting-audio',
            title: 'Waiting for audio',
            detail: activeAgentCount > 0
                ? `${activeAgentCount === 1 ? 'Provider is' : `${activeAgentCount} providers are`} ready and waiting for Audio Source.`
                : 'Open Audio Source to publish microphone or tab audio.',
            nextAction: 'open-audio',
        };
    }

    if (activeAgentCount === 0) {
        return {
            state: 'waiting-agent',
            title: 'Audio connected',
            detail: 'Start a provider to begin transcription.',
            nextAction: 'start-agent',
        };
    }

    return {
        state: 'active',
        title: 'Transcription active',
        detail: activeAgentCount === 1
            ? '1 provider is listening to this room.'
            : `${activeAgentCount} providers are listening to this room.`,
        nextAction: 'ready',
    };
}

export function describeTranscriptFeedError(message: string): string {
    if (message === 'Transcript WebSocket links are not configured') {
        return 'External feeds are unavailable. Configure TRANSCRIPT_WS_SECRET with at least 32 characters, restart the backend, then retry.';
    }
    return message;
}

export function maskTranscriptWebSocketUrl(value: string): string {
    return value.replace(/([?&]token=)[^&]*/i, '$1••••••••');
}

export function canRemoveParticipant(participant: ParticipantInfo): boolean {
    return !participant.isAgent;
}
