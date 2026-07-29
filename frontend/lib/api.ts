/**
 * API utilities for checking backend provider availability
 */

import { getControlAuthHeaders, toHttpUrl } from './runtime.ts';
import type { AgentProvider } from './providers.ts';

export interface ParticipantInfo {
    identity: string;
    name: string;
    isAgent: boolean;
    state: string;
}

export interface RoomDetails {
    name: string;
    numParticipants: number;
    maxParticipants: number;
    creationTime: number;
    emptyTimeout: number;
    participants: ParticipantInfo[];
}

export interface RunningAgent {
    key: string;
    running: boolean;
    provider: string;
    room: string;
}

export interface AgentStatus {
    count: number;
    agents: RunningAgent[];
}

export interface TranscriptTokenResponse {
    token: string;
    expiresAt: string;
    websocketUrl: string;
    provider?: AgentProvider;
}

export interface CaptionDeskTokenResponse {
    token: string;
    wsUrl: string;
    identity: string;
    room: string;
    provider: AgentProvider;
}

export interface ProvidersResponse {
    google: boolean;
    gemini: boolean;
    azure: boolean;
    'gpt-realtime-whisper': boolean;
    livekit: boolean;
}

/**
 * Check which ASR providers are available on the backend
 */
export async function checkAvailableProviders(backendUrl: string): Promise<ProvidersResponse | null> {
    try {
        // Convert WebSocket URL to HTTP
        const httpUrl = toHttpUrl(backendUrl);
        const response = await fetch(`${httpUrl}/providers`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            console.warn('Failed to check providers:', response.statusText);
            return null;
        }

        return await response.json();
    } catch (error) {
        console.warn('Could not check available providers:', error);
        return null;
    }
}

/**
 * Check if a specific provider is enabled
 */
export function isProviderEnabled(
    providersResponse: ProvidersResponse | null,
    providerName: string
): boolean {
    // If we haven't checked providers yet (null), return true to allow connection
    // This provides graceful fallback if backend check fails
    if (!providersResponse) return true;

    const provider = providerName.toLowerCase() as keyof ProvidersResponse;
    if (!['google', 'gemini', 'azure', 'gpt-realtime-whisper'].includes(provider)) return false;
    return providersResponse[provider] === true;
}

export async function createRoom(backendUrl: string, name: string): Promise<RoomDetails> {
    const response = await fetch(`${toHttpUrl(backendUrl)}/livekit/rooms/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getControlAuthHeaders() },
        body: JSON.stringify({ name }),
    });
    return parseApiResponse<RoomDetails>(response, 'Failed to create room');
}

export async function createTranscriptToken(
    backendUrl: string,
    roomName: string,
    provider: AgentProvider,
): Promise<TranscriptTokenResponse> {
    const response = await fetch(
        `${toHttpUrl(backendUrl)}/livekit/rooms/${encodeURIComponent(roomName)}/transcript-token/${encodeURIComponent(provider)}`,
        { method: 'POST', headers: getControlAuthHeaders() },
    );
    return parseApiResponse<TranscriptTokenResponse>(response, 'Failed to generate transcript link');
}

export async function fetchDetailedRooms(backendUrl: string): Promise<RoomDetails[]> {
    const response = await fetch(`${toHttpUrl(backendUrl)}/livekit/rooms/detailed`, { headers: getControlAuthHeaders() });
    const data = await parseApiResponse<{ rooms?: RoomDetails[] }>(response, 'Failed to load rooms');
    return data.rooms || [];
}

export async function fetchAgentStatus(backendUrl: string): Promise<AgentStatus> {
    const response = await fetch(`${toHttpUrl(backendUrl)}/livekit/agent/status`, { headers: getControlAuthHeaders() });
    return parseApiResponse<AgentStatus>(response, 'Failed to load agent status');
}

export async function startRoomAgent(
    backendUrl: string,
    roomName: string,
    provider: AgentProvider,
): Promise<void> {
    const response = await fetch(`${toHttpUrl(backendUrl)}/livekit/agent/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getControlAuthHeaders() },
        body: JSON.stringify({ roomName, provider }),
    });
    await parseApiResponse(response, 'Failed to start agent');
}

export async function createCaptionDeskToken(
    backendUrl: string,
    roomName: string,
    provider: AgentProvider,
    sessionId: string,
): Promise<CaptionDeskTokenResponse> {
    const response = await fetch(
        `${toHttpUrl(backendUrl)}/livekit/rooms/${encodeURIComponent(roomName)}/caption-token/${encodeURIComponent(provider)}?sessionId=${encodeURIComponent(sessionId)}`,
        { method: 'POST', headers: getControlAuthHeaders() },
    );
    return parseApiResponse<CaptionDeskTokenResponse>(response, 'Failed to open Caption Desk');
}

export async function createApprovedCaptionToken(
    backendUrl: string,
    roomName: string,
): Promise<TranscriptTokenResponse> {
    const response = await fetch(
        `${toHttpUrl(backendUrl)}/livekit/rooms/${encodeURIComponent(roomName)}/caption-token/ws`,
        { method: 'POST', headers: getControlAuthHeaders() },
    );
    return parseApiResponse<TranscriptTokenResponse>(response, 'Failed to generate approved caption link');
}

export async function stopRoomAgent(
    backendUrl: string,
    roomName: string,
    provider: string,
): Promise<void> {
    const response = await fetch(`${toHttpUrl(backendUrl)}/livekit/agent/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getControlAuthHeaders() },
        body: JSON.stringify({ roomName, provider }),
    });
    await parseApiResponse(response, 'Failed to stop agent');
}

export async function removeRoomParticipant(
    backendUrl: string,
    roomName: string,
    identity: string,
): Promise<void> {
    const response = await fetch(
        `${toHttpUrl(backendUrl)}/livekit/rooms/${encodeURIComponent(roomName)}/participants/${encodeURIComponent(identity)}`,
        { method: 'DELETE', headers: getControlAuthHeaders() },
    );
    await parseApiResponse(response, 'Failed to remove participant');
}

export async function deleteRoom(backendUrl: string, roomName: string): Promise<void> {
    const response = await fetch(
        `${toHttpUrl(backendUrl)}/livekit/rooms/${encodeURIComponent(roomName)}`,
        { method: 'DELETE', headers: getControlAuthHeaders() },
    );
    await parseApiResponse(response, 'Failed to delete room');
}

async function parseApiResponse<T = unknown>(response: Response, fallbackMessage: string): Promise<T> {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : `${fallbackMessage}: ${response.status}`);
    }
    return data as T;
}
