/**
 * useRoomViewer Hook
 * Connects to a LiveKit room as a viewer (no microphone publishing)
 * For watching transcriptions from ASR agents in real-time
 * Supports audio playback from room participants
 */

import { useState, useCallback, useRef, useEffect, useSyncExternalStore } from 'react';
import {
    Room,
    RoomEvent,
    DataPacket_Kind,
    RemoteParticipant,
    RemoteTrackPublication,
    RemoteTrack,
    Track,
} from 'livekit-client';
import { ConnectionState, TranscriptSegment } from '../types';
import { getControlAuthHeaders } from '../lib/runtime';
import type { InterimTranscript } from '../lib/transcriptMessages';
import { providerFromAgentIdentity } from '../lib/providers';
import { TranscriptSession } from '../lib/transcriptSession';
import { LiveKitRoomLifecycle } from '../lib/liveKitRoomLifecycle';
import { buildLegacyViewerTokenRequest, shouldFallbackViewerToken } from '../lib/viewerToken';
import { CAPTION_PUBLIC_TOPIC } from '../lib/captionDeskMessages';

// Agent info with provider
export interface AgentInfo {
    identity: string;
    provider: string;
    isConnected: boolean;
}

export interface UseRoomViewerOptions {
    tokenEndpoint: string;  // Backend token endpoint
    fallbackTokenEndpoint?: string;
}

export interface UseRoomViewerReturn {
    connectionState: ConnectionState;
    transcripts: TranscriptSegment[];
    interimTranscripts: Map<string, InterimTranscript>;
    publicCaptions: TranscriptSegment[];
    error: string | null;
    room: Room | null;
    currentRoomName: string | null;
    agents: AgentInfo[];
    connect: (roomName: string) => Promise<void>;
    disconnect: () => void;
    clearTranscripts: () => void;
    activatePublicCaptions: () => void;
    deactivatePublicCaptions: () => void;
    // Audio playback
    isAudioMuted: boolean;
    toggleAudioMute: () => void;
    audioParticipants: string[];  // Participants with audio tracks
}

const VIEWER_TOKEN_TIMEOUT_MS = 10_000;
const VIEWER_CONNECTION_TIMEOUT_MS = 12_000;
const VIEWER_ATTEMPT_TIMEOUT_MS = 15_000;

function resolveViewerLiveKitUrl(serverUrl: string): string {
    if (typeof window === 'undefined') return serverUrl;

    try {
        const url = new URL(serverUrl);
        const pageHost = window.location.hostname;
        const isLoopbackServer = isLoopbackHost(url.hostname);
        const isLoopbackPage = isLoopbackHost(pageHost);

        if (isLoopbackServer && !isLoopbackPage) {
            url.hostname = pageHost;
            url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        } else if (window.location.protocol === 'https:' && url.protocol === 'ws:') {
            url.protocol = 'wss:';
        }

        return url.toString().replace(/\/$/, '');
    } catch {
        return serverUrl;
    }
}

function isLoopbackHost(hostname: string): boolean {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function useRoomViewer(options: UseRoomViewerOptions): UseRoomViewerReturn {
    const { tokenEndpoint, fallbackTokenEndpoint } = options;

    // State
    const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
    const [error, setError] = useState<string | null>(null);
    const [room, setRoom] = useState<Room | null>(null);
    const [currentRoomName, setCurrentRoomName] = useState<string | null>(null);
    const [agents, setAgents] = useState<AgentInfo[]>([]);

    // Audio playback state
    const [isAudioMuted, setIsAudioMuted] = useState(false);
    const [audioParticipants, setAudioParticipants] = useState<string[]>([]);

    // Refs
    const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
    const isAudioMutedRef = useRef(false);
    const roomLifecycleRef = useRef<LiveKitRoomLifecycle | null>(null);
    if (roomLifecycleRef.current === null) {
        roomLifecycleRef.current = new LiveKitRoomLifecycle();
    }
    const roomLifecycle = roomLifecycleRef.current;
    const transcriptSessionRef = useRef<TranscriptSession | null>(null);
    if (transcriptSessionRef.current === null) {
        transcriptSessionRef.current = new TranscriptSession({ idPrefix: 'view' });
    }
    const transcriptSession = transcriptSessionRef.current;
    const publicCaptionSessionRef = useRef<TranscriptSession | null>(null);
    if (publicCaptionSessionRef.current === null) {
        publicCaptionSessionRef.current = new TranscriptSession({ idPrefix: 'desk' });
    }
    const publicCaptionSession = publicCaptionSessionRef.current;
    const publicCaptionActiveRef = useRef(false);
    const { transcripts, interimTranscripts } = useSyncExternalStore(
        transcriptSession.subscribe,
        transcriptSession.getSnapshot,
        transcriptSession.getSnapshot,
    );
    const { transcripts: publicCaptions } = useSyncExternalStore(
        publicCaptionSession.subscribe,
        publicCaptionSession.getSnapshot,
        publicCaptionSession.getSnapshot,
    );

    const cleanupAudioElements = useCallback(() => {
        audioElementsRef.current.forEach(audioElement => {
            audioElement.pause();
            audioElement.remove();
        });
        audioElementsRef.current.clear();
    }, []);

    // Check if participant is an agent
    const isAgent = useCallback((identity: string): boolean => {
        return identity.startsWith('agent-') || identity === 'asr-agent';
    }, []);

    // Extract provider from agent identity (e.g., "agent-google-xxx" -> "google", "agent-google" -> "google")
    const getProviderFromIdentity = useCallback((identity: string): string => {
        return providerFromAgentIdentity(identity);
    }, []);

    // Fetch token from backend (as viewer, not publishing)
    const fetchToken = useCallback(async (roomName: string): Promise<{ token: string; wsUrl?: string }> => {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), VIEWER_TOKEN_TIMEOUT_MS);
        try {
            let response = await fetch(tokenEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getControlAuthHeaders() },
                body: JSON.stringify({
                    roomName,
                }),
                signal: controller.signal,
            });

            let data = await response.json().catch(() => ({}));
            if (shouldFallbackViewerToken(response.status, data, Boolean(fallbackTokenEndpoint))) {
                response = await fetch(fallbackTokenEndpoint!, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...getControlAuthHeaders() },
                    body: JSON.stringify(buildLegacyViewerTokenRequest(roomName)),
                    signal: controller.signal,
                });
                data = await response.json().catch(() => ({}));
            }
            if (!response.ok) {
                throw new Error(data.error || `Failed to get token: ${response.status}`);
            }
            if (typeof data.token !== 'string' || data.token.length === 0) {
                throw new Error('The backend returned an invalid viewer token.');
            }
            return {
                token: data.token,
                wsUrl: data.wsUrl || data.ws_url,
            };
        } catch (error) {
            if (controller.signal.aborted) {
                throw new Error('The viewer token request timed out. Check that the backend is running.');
            }
            throw error;
        } finally {
            window.clearTimeout(timeoutId);
        }
    }, [fallbackTokenEndpoint, tokenEndpoint]);

    // Handle audio track subscription
    const handleTrackSubscribed = useCallback((
        track: RemoteTrack,
        _publication: RemoteTrackPublication,
        participant: RemoteParticipant
    ) => {
        if (track.kind === Track.Kind.Audio) {
            console.log('[Viewer] 🔊 Audio track subscribed from:', participant.identity);

            // Create audio element for playback
            const audioElement = document.createElement('audio');
            audioElement.autoplay = true;
            audioElement.muted = isAudioMutedRef.current;
            track.attach(audioElement);

            // Store reference
            audioElementsRef.current.set(participant.identity, audioElement);

            // Update audio participants list
            setAudioParticipants(prev => {
                if (!prev.includes(participant.identity)) {
                    return [...prev, participant.identity];
                }
                return prev;
            });
        }
    }, []);

    // Handle audio track unsubscription
    const handleTrackUnsubscribed = useCallback((
        track: RemoteTrack,
        _publication: RemoteTrackPublication,
        participant: RemoteParticipant
    ) => {
        if (track.kind === Track.Kind.Audio) {
            console.log('[Viewer] 🔇 Audio track unsubscribed from:', participant.identity);

            // Remove and cleanup audio element
            const audioElement = audioElementsRef.current.get(participant.identity);
            if (audioElement) {
                track.detach(audioElement);
                audioElement.remove();
                audioElementsRef.current.delete(participant.identity);
            }

            // Update audio participants list
            setAudioParticipants(prev => prev.filter(id => id !== participant.identity));
        }
    }, []);

    // Toggle audio mute for all participants
    const toggleAudioMute = useCallback(() => {
        setIsAudioMuted(currentMuted => {
            const newMuted = !currentMuted;
            isAudioMutedRef.current = newMuted;

            audioElementsRef.current.forEach((audioElement) => {
                audioElement.muted = newMuted;
            });

            console.log('[Viewer] 🔊 Audio', newMuted ? 'muted' : 'unmuted');
            return newMuted;
        });
    }, []);

    // Handle incoming transcript data from Agent
    const handleDataReceived = useCallback((
        payload: Uint8Array,
        participant?: RemoteParticipant,
        _kind?: DataPacket_Kind,
        topic?: string,
    ) => {
        if (topic === CAPTION_PUBLIC_TOPIC) {
            if (publicCaptionActiveRef.current) {
                publicCaptionSession.ingest(payload, participant?.identity || 'caption-desk', {
                    publicCaptionMode: true,
                });
            }
            return;
        }
        // Raw transcript surfaces must not mix operator-approved captions into
        // the provider feed. Approved captions have their own topic and session.
        if (topic) return;
        const agentIdentity = participant?.identity || 'unknown';
        transcriptSession.ingest(payload, agentIdentity, {
            resolveProvider: getProviderFromIdentity,
            onProviderObserved: (sourceIdentity, provider) => {
                if (!isAgent(sourceIdentity)) return;
                setAgents(prev => prev.map(a =>
                    a.identity === sourceIdentity && a.provider !== provider ? { ...a, provider } : a
                ));
            },
        });
    }, [getProviderFromIdentity, isAgent, publicCaptionSession, transcriptSession]);

    // Handle participant connected
    const handleParticipantConnected = useCallback((participant: RemoteParticipant) => {
        console.log('[Viewer] 👤 Participant connected:', participant.identity);

        if (isAgent(participant.identity)) {
            const provider = getProviderFromIdentity(participant.identity);
            setAgents(prev => [
                ...prev.filter(a => a.identity !== participant.identity),
                { identity: participant.identity, provider, isConnected: true }
            ]);
            console.log('[Viewer] 🤖 Agent connected:', participant.identity, 'Provider:', provider);
        }
    }, [isAgent, getProviderFromIdentity]);

    // Handle participant disconnected
    const handleParticipantDisconnected = useCallback((participant: RemoteParticipant) => {
        console.log('[Viewer] 👤 Participant disconnected:', participant.identity);

        if (isAgent(participant.identity)) {
            setAgents(prev => prev.filter(a => a.identity !== participant.identity));
            transcriptSession.removeSource(participant.identity);
            console.log('[Viewer] 🤖 Agent disconnected:', participant.identity);
        }
    }, [isAgent, transcriptSession]);

    // Connect to LiveKit room as viewer
    const connect = useCallback(async (roomName: string) => {
        try {
            setConnectionState(ConnectionState.CONNECTING);
            setError(null);
            setCurrentRoomName(roomName);

            const connectedRoom = await withTimeout<Room | null>(
                roomLifecycle.connect({
                    prepare: async () => {
                        const credentials = await fetchToken(roomName);
                        console.log('[Viewer] 🎫 Token received for room:', roomName);
                        return credentials;
                    },
                    getToken: async credentials => credentials.token,
                    serverUrl: credentials => resolveViewerLiveKitUrl(
                        import.meta.env.VITE_LIVEKIT_URL || credentials.wsUrl || 'ws://localhost:7880',
                    ),
                    connectOptions: {
                        autoSubscribe: true,
                        maxRetries: 0,
                        peerConnectionTimeout: VIEWER_CONNECTION_TIMEOUT_MS,
                        websocketTimeout: VIEWER_CONNECTION_TIMEOUT_MS,
                    },
                    roomOptions: {
                        adaptiveStream: true,
                        dynacast: true,
                    },
                    createRoom: roomOptions => new Room(roomOptions),
                    registerAdapterEvents: lifecycleRoom => {
                        lifecycleRoom.on(RoomEvent.DataReceived, handleDataReceived);
                        lifecycleRoom.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
                        lifecycleRoom.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
                        lifecycleRoom.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
                        lifecycleRoom.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
                    },
                    callbacks: {
                        onConnected: () => {
                            console.log('[Viewer] ✅ Connected to room:', roomName);
                            setConnectionState(ConnectionState.CONNECTED);
                        },
                        onReconnecting: () => setConnectionState(ConnectionState.CONNECTING),
                        onReconnected: () => setConnectionState(ConnectionState.CONNECTED),
                        onEnded: (reason) => {
                            setRoom(null);
                            setAgents([]);
                            transcriptSession.reset();
                            publicCaptionSession.reset(true);
                            cleanupAudioElements();
                            setAudioParticipants([]);
                            if (reason !== 'replaced') setConnectionState(ConnectionState.DISCONNECTED);
                            if (reason === 'manual' || reason === 'disposed') setCurrentRoomName(null);
                        },
                    },
                }),
                VIEWER_ATTEMPT_TIMEOUT_MS,
                'Viewer connection timed out. Check the LiveKit server and try again.',
            );
            if (!connectedRoom || !roomLifecycle.isCurrent(connectedRoom)) return;
            setRoom(connectedRoom);

            // Check for existing agents
            const existingParticipants = Array.from(
                connectedRoom.remoteParticipants.values(),
            ) as RemoteParticipant[];
            const existingAgents = existingParticipants
                .filter(p => isAgent(p.identity))
                .map(p => ({
                    identity: p.identity,
                    provider: getProviderFromIdentity(p.identity),
                    isConnected: true,
                }));

            if (existingAgents.length > 0) {
                setAgents(existingAgents);
                console.log('[Viewer] 🤖 Found existing agents:', existingAgents);
            }

        } catch (err) {
            roomLifecycle.disconnect();
            console.error('[Viewer] Connection failed:', err);
            setError(err instanceof Error ? err.message : 'Connection failed');
            setConnectionState(ConnectionState.ERROR);
        }
    }, [cleanupAudioElements, fetchToken, handleDataReceived, handleParticipantConnected, handleParticipantDisconnected, handleTrackSubscribed, handleTrackUnsubscribed, isAgent, getProviderFromIdentity, publicCaptionSession, transcriptSession, roomLifecycle]);

    // Disconnect from room
    const disconnect = useCallback(() => {
        transcriptSession.reset();
        publicCaptionSession.reset(true);
        publicCaptionActiveRef.current = false;
        roomLifecycle.disconnect();
    }, [publicCaptionSession, roomLifecycle, transcriptSession]);

    // Clear transcripts
    const clearTranscripts = useCallback(() => {
        transcriptSession.reset(true);
        publicCaptionSession.reset(true);
    }, [publicCaptionSession, transcriptSession]);

    const activatePublicCaptions = useCallback(() => {
        publicCaptionSession.reset(true);
        publicCaptionActiveRef.current = true;
    }, [publicCaptionSession]);

    const deactivatePublicCaptions = useCallback(() => {
        publicCaptionActiveRef.current = false;
        publicCaptionSession.reset(true);
    }, [publicCaptionSession]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            transcriptSession.reset();
            publicCaptionSession.reset(true);
            publicCaptionActiveRef.current = false;
            roomLifecycle.dispose();
            cleanupAudioElements();
        };
    }, [cleanupAudioElements, publicCaptionSession, transcriptSession, roomLifecycle]);

    return {
        connectionState,
        transcripts,
        interimTranscripts,
        publicCaptions,
        error,
        room,
        currentRoomName,
        agents,
        connect,
        disconnect,
        clearTranscripts,
        activatePublicCaptions,
        deactivatePublicCaptions,
        // Audio playback
        isAudioMuted,
        toggleAudioMute,
        audioParticipants,
    };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
        promise.then(
            value => {
                window.clearTimeout(timeoutId);
                resolve(value);
            },
            error => {
                window.clearTimeout(timeoutId);
                reject(error);
            },
        );
    });
}
