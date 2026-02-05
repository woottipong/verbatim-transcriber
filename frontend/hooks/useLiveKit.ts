/**
 * useLiveKit Hook
 * Provides LiveKit room connection for real-time Thai transcription via WebRTC
 * 
 * Architecture:
 * Browser → WebRTC → LiveKit Server → Go Agent → ASR API → Data Channel → Browser
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Room, RoomEvent, ConnectionState as LKConnectionState, DataPacket_Kind, LocalParticipant, RemoteParticipant } from 'livekit-client';
import { ConnectionState, TranscriptSegment } from '../types';

// LiveKit Transcript Message from Agent (via Data Channel)
export interface LiveKitTranscriptMessage {
    type?: string;
    text: string;
    isFinal: boolean;  // matches backend JSON field
    confidence?: number;
    timestamp?: number;
    provider?: string;
    speaker?: string;
}

export interface UseLiveKitOptions {
    serverUrl: string;       // LiveKit server URL (ws://localhost:7880)
    tokenEndpoint: string;   // Backend token endpoint (http://localhost:3000/livekit/token)
    roomName: string;        // Room name for ASR session
    autoConnect?: boolean;   // Auto-connect on mount
}

export interface UseLiveKitReturn {
    connectionState: ConnectionState;
    transcripts: TranscriptSegment[];
    interimTranscript: string;
    error: string | null;
    room: Room | null;
    localParticipant: LocalParticipant | null;
    participants: RemoteParticipant[];
    connect: () => Promise<void>;
    disconnect: () => void;
    clearTranscripts: () => void;
    isAgentConnected: boolean;
    agentIdentity: string | null;  // Agent identity/name
    currentRoomName: string;  // Current room name for display
}

export function useLiveKit(options: UseLiveKitOptions): UseLiveKitReturn {
    const {
        serverUrl,
        tokenEndpoint,
        roomName,
        autoConnect = false,
    } = options;

    // State
    const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
    const [transcripts, setTranscripts] = useState<TranscriptSegment[]>([]);
    const [interimTranscript, setInterimTranscript] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const [room, setRoom] = useState<Room | null>(null);
    const [localParticipant, setLocalParticipant] = useState<LocalParticipant | null>(null);
    const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
    const [isAgentConnected, setIsAgentConnected] = useState(false);
    const [agentIdentity, setAgentIdentity] = useState<string | null>(null);

    // Refs
    const roomRef = useRef<Room | null>(null);
    const reconnectAttemptsRef = useRef(0);
    const segmentIdRef = useRef(0);

    // Fetch token from backend
    const fetchToken = useCallback(async (): Promise<string> => {
        const identity = `user-${Date.now()}`;

        const response = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identity, roomName }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Failed to get token: ${response.status}`);
        }

        const data = await response.json();
        return data.token;
    }, [tokenEndpoint, roomName]);

    // Handle incoming transcript data from Agent
    const handleDataReceived = useCallback((
        payload: Uint8Array,
        participant?: RemoteParticipant,
        _kind?: DataPacket_Kind
    ) => {
        try {
            const decoder = new TextDecoder();
            const message: LiveKitTranscriptMessage = JSON.parse(decoder.decode(payload));

            console.log('[LiveKit] 📝 Transcript received:', {
                text: message.text,
                isFinal: message.isFinal,
                provider: message.provider,
                from: participant?.identity || 'unknown',
            });

            if (message.isFinal && message.text.trim()) {
                // Final transcript - add to list
                segmentIdRef.current++;
                const segment: TranscriptSegment = {
                    id: `lk-${segmentIdRef.current}`,
                    text: message.text,
                    isFinal: true,
                    timestamp: message.timestamp || Date.now(),
                    provider: message.provider,
                    speaker: message.speaker,
                };
                setTranscripts(prev => [...prev, segment]);
                setInterimTranscript('');
            } else if (!message.isFinal && message.text.trim()) {
                // Interim transcript
                setInterimTranscript(message.text);
            }
        } catch (err) {
            console.error('[LiveKit] Failed to parse transcript data:', err);
        }
    }, []);

    // Handle participant connected (check for agent)
    const handleParticipantConnected = useCallback((participant: RemoteParticipant) => {
        console.log('[LiveKit] 👤 Participant connected:', participant.identity);
        setParticipants(prev => [...prev, participant]);

        // Check if it's the agent
        if (participant.identity.startsWith('agent-') || participant.identity === 'asr-agent') {
            setIsAgentConnected(true);
            setAgentIdentity(participant.identity);
            console.log('[LiveKit] 🤖 Agent connected:', participant.identity);
        }
    }, []);

    // Handle participant disconnected
    const handleParticipantDisconnected = useCallback((participant: RemoteParticipant) => {
        console.log('[LiveKit] 👤 Participant disconnected:', participant.identity);
        setParticipants(prev => prev.filter(p => p.sid !== participant.sid));

        if (participant.identity.startsWith('agent-') || participant.identity === 'asr-agent') {
            setIsAgentConnected(false);
            setAgentIdentity(null);
            console.log('[LiveKit] 🤖 Agent disconnected');
        }
    }, []);

    // Connect to LiveKit room
    const connect = useCallback(async () => {
        try {
            setConnectionState(ConnectionState.CONNECTING);
            setError(null);

            // Get token
            const token = await fetchToken();
            console.log('[LiveKit] 🎫 Token received');

            // Create and configure room
            const newRoom = new Room({
                adaptiveStream: true,
                dynacast: true,
                audioCaptureDefaults: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 48000,
                    channelCount: 1,
                },
            });

            // Set up event listeners
            newRoom.on(RoomEvent.Connected, () => {
                console.log('[LiveKit] ✅ Connected to room:', roomName);
                setConnectionState(ConnectionState.CONNECTED);
                setLocalParticipant(newRoom.localParticipant);
                reconnectAttemptsRef.current = 0;
            });

            newRoom.on(RoomEvent.Disconnected, () => {
                console.log('[LiveKit] ❌ Disconnected from room');
                setConnectionState(ConnectionState.DISCONNECTED);
                setIsAgentConnected(false);
            });

            newRoom.on(RoomEvent.Reconnecting, () => {
                console.log('[LiveKit] 🔄 Reconnecting...');
                setConnectionState(ConnectionState.CONNECTING);
            });

            newRoom.on(RoomEvent.Reconnected, () => {
                console.log('[LiveKit] ✅ Reconnected');
                setConnectionState(ConnectionState.CONNECTED);
            });

            newRoom.on(RoomEvent.DataReceived, handleDataReceived);
            newRoom.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
            newRoom.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);

            // Connect to room with audio enabled
            await newRoom.connect(serverUrl, token, {
                autoSubscribe: true,
            });

            // Enable microphone
            await newRoom.localParticipant.setMicrophoneEnabled(true);
            console.log('[LiveKit] 🎤 Microphone enabled');

            roomRef.current = newRoom;
            setRoom(newRoom);

            // Check for existing participants (agent might already be there)
            const existingParticipants = Array.from(newRoom.remoteParticipants.values());
            setParticipants(existingParticipants);

            const agent = existingParticipants.find(
                p => p.identity.startsWith('agent-') || p.identity === 'asr-agent'
            );
            if (agent) {
                setIsAgentConnected(true);
                console.log('[LiveKit] 🤖 Agent already in room');
            }

        } catch (err) {
            console.error('[LiveKit] Connection failed:', err);
            setError(err instanceof Error ? err.message : 'Connection failed');
            setConnectionState(ConnectionState.ERROR);
        }
    }, [serverUrl, fetchToken, roomName, handleDataReceived, handleParticipantConnected, handleParticipantDisconnected]);

    // Disconnect from room
    const disconnect = useCallback(() => {
        if (roomRef.current) {
            console.log('[LiveKit] 🔌 Disconnecting...');
            roomRef.current.disconnect();
            roomRef.current = null;
            setRoom(null);
            setLocalParticipant(null);
            setParticipants([]);
            setIsAgentConnected(false);
            setAgentIdentity(null);
            setConnectionState(ConnectionState.DISCONNECTED);
        }
    }, []);

    // Clear transcripts
    const clearTranscripts = useCallback(() => {
        setTranscripts([]);
        setInterimTranscript('');
        segmentIdRef.current = 0;
    }, []);

    // Auto-connect on mount if enabled
    useEffect(() => {
        if (autoConnect) {
            connect();
        }

        // Cleanup on unmount
        return () => {
            if (roomRef.current) {
                roomRef.current.disconnect();
            }
        };
    }, [autoConnect]); // eslint-disable-line react-hooks/exhaustive-deps

    return {
        connectionState,
        transcripts,
        interimTranscript,
        error,
        room,
        localParticipant,
        participants,
        connect,
        disconnect,
        clearTranscripts,
        isAgentConnected,
        agentIdentity,
        currentRoomName: roomName,
    };
}
