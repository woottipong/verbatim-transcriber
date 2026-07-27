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

// Agent info with provider
export interface AgentInfo {
    identity: string;
    provider: string;
    isConnected: boolean;
}

export interface UseRoomViewerOptions {
    tokenEndpoint: string;  // Backend token endpoint
}

export interface UseRoomViewerReturn {
    connectionState: ConnectionState;
    transcripts: TranscriptSegment[];
    interimTranscripts: Map<string, InterimTranscript>;
    error: string | null;
    room: Room | null;
    currentRoomName: string | null;
    agents: AgentInfo[];
    connect: (roomName: string) => Promise<void>;
    disconnect: () => void;
    clearTranscripts: () => void;
    // Audio playback
    isAudioMuted: boolean;
    toggleAudioMute: () => void;
    audioParticipants: string[];  // Participants with audio tracks
}

export function useRoomViewer(options: UseRoomViewerOptions): UseRoomViewerReturn {
    const { tokenEndpoint } = options;

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
    const roomRef = useRef<Room | null>(null);
    const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
    const isAudioMutedRef = useRef(false);
    const connectionAttemptRef = useRef(0);
    const transcriptSessionRef = useRef<TranscriptSession | null>(null);
    if (transcriptSessionRef.current === null) {
        transcriptSessionRef.current = new TranscriptSession({ idPrefix: 'view' });
    }
    const transcriptSession = transcriptSessionRef.current;
    const { transcripts, interimTranscripts } = useSyncExternalStore(
        transcriptSession.subscribe,
        transcriptSession.getSnapshot,
        transcriptSession.getSnapshot,
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
        const identity = `viewer-${Date.now()}`;

        const response = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getControlAuthHeaders() },
            body: JSON.stringify({
                identity,
                roomName,
                canPublish: false,  // Viewer doesn't publish audio
                canSubscribe: true,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Failed to get token: ${response.status}`);
        }

        const data = await response.json();
        return {
            token: data.token,
            wsUrl: data.wsUrl || data.ws_url,
        };
    }, [tokenEndpoint]);

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
        _kind?: DataPacket_Kind
    ) => {
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
    }, [getProviderFromIdentity, isAgent, transcriptSession]);

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
        const connectionAttempt = ++connectionAttemptRef.current;
        let newRoom: Room | null = null;

        try {
            // Disconnect if already connected
            const previousRoom = roomRef.current;
            roomRef.current = null;
            previousRoom?.disconnect();
            cleanupAudioElements();
            setAudioParticipants([]);
            transcriptSession.reset();

            setConnectionState(ConnectionState.CONNECTING);
            setError(null);
            setCurrentRoomName(roomName);

            // Get token
            const { token, wsUrl } = await fetchToken(roomName);
            if (connectionAttempt !== connectionAttemptRef.current) return;
            console.log('[Viewer] 🎫 Token received for room:', roomName);

            // Create room (viewer mode - no audio capture)
            newRoom = new Room({
                adaptiveStream: true,
                dynacast: true,
            });

            // Set up event listeners
            newRoom.on(RoomEvent.Connected, () => {
                if (roomRef.current !== newRoom) return;
                console.log('[Viewer] ✅ Connected to room:', roomName);
                setConnectionState(ConnectionState.CONNECTED);
            });

            newRoom.on(RoomEvent.Disconnected, () => {
                if (roomRef.current !== newRoom) return;
                console.log('[Viewer] ❌ Disconnected from room');
                roomRef.current = null;
                setRoom(null);
                setConnectionState(ConnectionState.DISCONNECTED);
                setAgents([]);
                transcriptSession.reset();
                cleanupAudioElements();
                setAudioParticipants([]);
            });

            newRoom.on(RoomEvent.Reconnecting, () => {
                console.log('[Viewer] 🔄 Reconnecting...');
                setConnectionState(ConnectionState.CONNECTING);
            });

            newRoom.on(RoomEvent.Reconnected, () => {
                console.log('[Viewer] ✅ Reconnected');
                setConnectionState(ConnectionState.CONNECTED);
            });

            newRoom.on(RoomEvent.DataReceived, handleDataReceived);
            newRoom.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
            newRoom.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);

            // Audio track events for playback
            newRoom.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
            newRoom.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);

            roomRef.current = newRoom;

            // Connect (viewer - no local tracks)
            const serverUrl = wsUrl || import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880';
            await newRoom.connect(serverUrl, token, {
                autoSubscribe: true,
            });
            if (connectionAttempt !== connectionAttemptRef.current) {
                newRoom.disconnect();
                return;
            }

            setRoom(newRoom);

            // Check for existing agents
            const existingParticipants = Array.from(newRoom.remoteParticipants.values());
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
            if (newRoom) {
                if (roomRef.current === newRoom) {
                    roomRef.current = null;
                }
                newRoom.disconnect();
            }
            if (connectionAttempt !== connectionAttemptRef.current) return;
            console.error('[Viewer] Connection failed:', err);
            setError(err instanceof Error ? err.message : 'Connection failed');
            setConnectionState(ConnectionState.ERROR);
        }
    }, [cleanupAudioElements, fetchToken, handleDataReceived, handleParticipantConnected, handleParticipantDisconnected, handleTrackSubscribed, handleTrackUnsubscribed, isAgent, getProviderFromIdentity, transcriptSession]);

    // Disconnect from room
    const disconnect = useCallback(() => {
        connectionAttemptRef.current++;
        const currentRoom = roomRef.current;
        roomRef.current = null;
        if (currentRoom) {
            console.log('[Viewer] 🔌 Disconnecting...');
            currentRoom.disconnect();
        }
        setRoom(null);
        setAgents([]);
        transcriptSession.reset();
        setCurrentRoomName(null);
        setConnectionState(ConnectionState.DISCONNECTED);
        cleanupAudioElements();
        setAudioParticipants([]);
    }, [cleanupAudioElements, transcriptSession]);

    // Clear transcripts
    const clearTranscripts = useCallback(() => {
        transcriptSession.reset(true);
    }, [transcriptSession]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            connectionAttemptRef.current++;
            if (roomRef.current) {
                roomRef.current.disconnect();
            }
            transcriptSession.reset();
            cleanupAudioElements();
        };
    }, [cleanupAudioElements, transcriptSession]);

    return {
        connectionState,
        transcripts,
        interimTranscripts,
        error,
        room,
        currentRoomName,
        agents,
        connect,
        disconnect,
        clearTranscripts,
        // Audio playback
        isAudioMuted,
        toggleAudioMute,
        audioParticipants,
    };
}
