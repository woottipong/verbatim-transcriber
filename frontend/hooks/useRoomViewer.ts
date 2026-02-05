/**
 * useRoomViewer Hook
 * Connects to a LiveKit room as a viewer (no microphone publishing)
 * For watching transcriptions from ASR agents in real-time
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Room, RoomEvent, ConnectionState as LKConnectionState, DataPacket_Kind, RemoteParticipant, RemoteTrackPublication } from 'livekit-client';
import { ConnectionState, TranscriptSegment } from '../types';

// Transcript Message from Agent
export interface TranscriptMessage {
    type?: string;
    text: string;
    isFinal: boolean;
    confidence?: number;
    timestamp?: number;
    provider?: string;
    speaker?: string;
}

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
    interimTranscripts: Map<string, string>;  // Per-agent interim transcripts
    error: string | null;
    room: Room | null;
    currentRoomName: string | null;
    agents: AgentInfo[];
    connect: (roomName: string) => Promise<void>;
    disconnect: () => void;
    clearTranscripts: () => void;
}

export function useRoomViewer(options: UseRoomViewerOptions): UseRoomViewerReturn {
    const { tokenEndpoint } = options;

    // State
    const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
    const [transcripts, setTranscripts] = useState<TranscriptSegment[]>([]);
    const [interimTranscripts, setInterimTranscripts] = useState<Map<string, string>>(new Map());
    const [error, setError] = useState<string | null>(null);
    const [room, setRoom] = useState<Room | null>(null);
    const [currentRoomName, setCurrentRoomName] = useState<string | null>(null);
    const [agents, setAgents] = useState<AgentInfo[]>([]);

    // Refs
    const roomRef = useRef<Room | null>(null);
    const segmentIdRef = useRef(0);

    // Check if participant is an agent
    const isAgent = useCallback((identity: string): boolean => {
        return identity.startsWith('agent-') || identity === 'asr-agent';
    }, []);

    // Extract provider from agent identity (e.g., "agent-google-xxx" -> "google", "agent-google" -> "google")
    const getProviderFromIdentity = useCallback((identity: string): string => {
        if (identity === 'asr-agent') return 'unknown';
        if (!identity.startsWith('agent-')) return 'unknown';

        // Handle formats: "agent-google", "agent-google-xxx", "agent-azure", etc.
        const withoutPrefix = identity.slice(6); // Remove "agent-"
        const parts = withoutPrefix.split('-');
        return parts[0] || 'unknown'; // First part after "agent-" is the provider
    }, []);

    // Fetch token from backend (as viewer, not publishing)
    const fetchToken = useCallback(async (roomName: string): Promise<string> => {
        const identity = `viewer-${Date.now()}`;

        const response = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
        return data.token;
    }, [tokenEndpoint]);

    // Handle incoming transcript data from Agent
    const handleDataReceived = useCallback((
        payload: Uint8Array,
        participant?: RemoteParticipant,
        _kind?: DataPacket_Kind
    ) => {
        try {
            const decoder = new TextDecoder();
            const message: TranscriptMessage = JSON.parse(decoder.decode(payload));
            const agentIdentity = participant?.identity || 'unknown';
            const provider = message.provider || getProviderFromIdentity(agentIdentity);

            console.log('[Viewer] 📝 Transcript:', {
                text: message.text,
                isFinal: message.isFinal,
                provider,
                from: agentIdentity,
            });

            // Update agent provider if we got it from the message
            if (message.provider && isAgent(agentIdentity)) {
                setAgents(prev => prev.map(a =>
                    a.identity === agentIdentity ? { ...a, provider: message.provider! } : a
                ));
            }

            if (message.isFinal && message.text.trim()) {
                // Final transcript - add to list
                segmentIdRef.current++;
                const segment: TranscriptSegment = {
                    id: `view-${segmentIdRef.current}`,
                    text: message.text,
                    isFinal: true,
                    timestamp: message.timestamp || Date.now(),
                    provider: provider,
                    speaker: message.speaker || agentIdentity,
                };
                setTranscripts(prev => [...prev, segment]);

                // Clear interim for this agent
                setInterimTranscripts(prev => {
                    const next = new Map(prev);
                    next.delete(agentIdentity);
                    return next;
                });
            } else if (!message.isFinal && message.text.trim()) {
                // Interim transcript - store per agent
                setInterimTranscripts(prev => {
                    const next = new Map(prev);
                    next.set(agentIdentity, message.text);
                    return next;
                });
            }
        } catch (err) {
            console.error('[Viewer] Failed to parse transcript data:', err);
        }
    }, [getProviderFromIdentity, isAgent]);

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
            setInterimTranscripts(prev => {
                const next = new Map(prev);
                next.delete(participant.identity);
                return next;
            });
            console.log('[Viewer] 🤖 Agent disconnected:', participant.identity);
        }
    }, [isAgent]);

    // Connect to LiveKit room as viewer
    const connect = useCallback(async (roomName: string) => {
        try {
            // Disconnect if already connected
            if (roomRef.current) {
                roomRef.current.disconnect();
            }

            setConnectionState(ConnectionState.CONNECTING);
            setError(null);
            setCurrentRoomName(roomName);

            // Get token
            const token = await fetchToken(roomName);
            console.log('[Viewer] 🎫 Token received for room:', roomName);

            // Create room (viewer mode - no audio capture)
            const newRoom = new Room({
                adaptiveStream: true,
                dynacast: true,
            });

            // Set up event listeners
            newRoom.on(RoomEvent.Connected, () => {
                console.log('[Viewer] ✅ Connected to room:', roomName);
                setConnectionState(ConnectionState.CONNECTED);
            });

            newRoom.on(RoomEvent.Disconnected, () => {
                console.log('[Viewer] ❌ Disconnected from room');
                setConnectionState(ConnectionState.DISCONNECTED);
                setAgents([]);
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

            // Connect (viewer - no local tracks)
            await newRoom.connect(import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880', token, {
                autoSubscribe: true,
            });

            roomRef.current = newRoom;
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
            console.error('[Viewer] Connection failed:', err);
            setError(err instanceof Error ? err.message : 'Connection failed');
            setConnectionState(ConnectionState.ERROR);
        }
    }, [fetchToken, handleDataReceived, handleParticipantConnected, handleParticipantDisconnected, isAgent, getProviderFromIdentity]);

    // Disconnect from room
    const disconnect = useCallback(() => {
        if (roomRef.current) {
            console.log('[Viewer] 🔌 Disconnecting...');
            roomRef.current.disconnect();
            roomRef.current = null;
            setRoom(null);
            setAgents([]);
            setCurrentRoomName(null);
            setConnectionState(ConnectionState.DISCONNECTED);
        }
    }, []);

    // Clear transcripts
    const clearTranscripts = useCallback(() => {
        setTranscripts([]);
        setInterimTranscripts(new Map());
        segmentIdRef.current = 0;
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (roomRef.current) {
                roomRef.current.disconnect();
            }
        };
    }, []);

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
    };
}
