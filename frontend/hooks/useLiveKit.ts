/**
 * useLiveKit Hook
 * Provides LiveKit room connection for real-time Thai transcription via WebRTC
 * 
 * Architecture:
 * Browser → WebRTC → LiveKit Server → Go Agent → ASR API → Data Channel → Browser
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Room, RoomEvent, DataPacket_Kind, LocalParticipant, RemoteParticipant, Track } from 'livekit-client';
import { ConnectionState, TranscriptSegment } from '../types';
import { TranscriptUpdateBuffer } from '../lib/transcriptUpdates';
import { appendBounded } from '../lib/runtime';
import {
    InterimTranscript,
    TranscriptMessage,
    clearInterimsBySource,
    getTranscriptKey,
    parseTranscriptMessage,
    removeInterim,
    upsertInterim,
} from '../lib/transcriptMessages';

interface BufferedTranscriptMessage extends TranscriptMessage {
    key: string;
    sourceIdentity: string;
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
    interimTranscripts: Map<string, InterimTranscript>;
    error: string | null;
    room: Room | null;
    localParticipant: LocalParticipant | null;
    mediaStream: MediaStream | null;
    isMicrophoneEnabled: boolean;
    participants: RemoteParticipant[];
    connect: () => Promise<void>;
    disconnect: () => void;
    toggleMicrophone: () => Promise<void>;
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
    const [interimTranscripts, setInterimTranscripts] = useState<Map<string, InterimTranscript>>(new Map());
    const [error, setError] = useState<string | null>(null);
    const [room, setRoom] = useState<Room | null>(null);
    const [localParticipant, setLocalParticipant] = useState<LocalParticipant | null>(null);
    const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
    const [isMicrophoneEnabled, setIsMicrophoneEnabled] = useState(false);
    const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
    const [isAgentConnected, setIsAgentConnected] = useState(false);
    const [agentIdentity, setAgentIdentity] = useState<string | null>(null);

    // Refs
    const roomRef = useRef<Room | null>(null);
    const reconnectAttemptsRef = useRef(0);
    const segmentIdRef = useRef(0);
    const connectionAttemptRef = useRef(0);

    const applyTranscriptUpdate = useCallback((message: BufferedTranscriptMessage) => {
        if (message.isFinal) {
            segmentIdRef.current++;
            const segment: TranscriptSegment = {
                id: `lk-${segmentIdRef.current}`,
                text: message.text,
                isFinal: true,
                timestamp: message.timestamp || Date.now(),
                provider: message.provider,
                speaker: message.speaker,
            };
            setTranscripts(prev => appendBounded(prev, segment));
            setInterimTranscripts(prev => removeInterim(prev, message.key));
            return;
        }

        setInterimTranscripts(prev => upsertInterim(prev, {
            key: message.key,
            text: message.text,
            provider: message.provider || 'unknown',
            speaker: message.speaker || message.sourceIdentity,
            sourceIdentity: message.sourceIdentity,
        }));
    }, []);

    const transcriptUpdatesRef = useRef<TranscriptUpdateBuffer<BufferedTranscriptMessage> | null>(null);
    if (transcriptUpdatesRef.current === null) {
        transcriptUpdatesRef.current = new TranscriptUpdateBuffer<BufferedTranscriptMessage>(
            applyTranscriptUpdate,
            50,
            undefined,
            undefined,
            message => message.isFinal,
            message => message.key,
        );
    }

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
            const message = parseTranscriptMessage(JSON.parse(decoder.decode(payload)));
            if (!message) return;
            const sourceIdentity = participant?.identity || 'unknown';
            transcriptUpdatesRef.current?.push({
                ...message,
                key: getTranscriptKey(message, sourceIdentity),
                sourceIdentity,
            });
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
            setInterimTranscripts(prev => clearInterimsBySource(prev, participant.identity));
            console.log('[LiveKit] 🤖 Agent disconnected');
        }
    }, []);

    // Connect to LiveKit room
    const connect = useCallback(async () => {
        const connectionAttempt = ++connectionAttemptRef.current;
        let newRoom: Room | null = null;

        try {
            setConnectionState(ConnectionState.CONNECTING);
            setError(null);

            // Get token
            const token = await fetchToken();
            if (connectionAttempt !== connectionAttemptRef.current) return;
            console.log('[LiveKit] 🎫 Token received');

            // Create and configure room
            newRoom = new Room({
                adaptiveStream: true,
                dynacast: true,
                audioCaptureDefaults: {
                    // สำหรับ verbatim transcription: ปิด browser audio processing
                    // ให้ ASR model (Google/Azure) จัดการ noise เอง
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: true,
                    sampleRate: 48000,
                    channelCount: 1,
                },
            });

            // Set up event listeners
            newRoom.on(RoomEvent.Connected, () => {
                if (roomRef.current !== newRoom) return;
                console.log('[LiveKit] ✅ Connected to room:', roomName);
                setLocalParticipant(newRoom.localParticipant);
                reconnectAttemptsRef.current = 0;
            });

            newRoom.on(RoomEvent.Disconnected, () => {
                if (roomRef.current !== newRoom) return;
                console.log('[LiveKit] ❌ Disconnected from room');
                roomRef.current = null;
                transcriptUpdatesRef.current?.clear();
                setInterimTranscripts(new Map());
                setRoom(null);
                setLocalParticipant(null);
                setMediaStream(null);
                setIsMicrophoneEnabled(false);
                setParticipants([]);
                setConnectionState(ConnectionState.DISCONNECTED);
                setIsAgentConnected(false);
                setAgentIdentity(null);
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

            roomRef.current = newRoom;

            // Connect to room with audio enabled
            await newRoom.connect(serverUrl, token, {
                autoSubscribe: true,
            });
            if (connectionAttempt !== connectionAttemptRef.current) {
                newRoom.disconnect();
                return;
            }

            // Enable microphone
            const microphonePublication = await newRoom.localParticipant.setMicrophoneEnabled(true);
            if (connectionAttempt !== connectionAttemptRef.current) {
                newRoom.disconnect();
                return;
            }
            console.log('[LiveKit] 🎤 Microphone enabled');

            const microphoneTrack = microphonePublication?.track?.mediaStreamTrack
                ?? newRoom.localParticipant
                    .getTrackPublication(Track.Source.Microphone)
                    ?.track
                    ?.mediaStreamTrack;
            setMediaStream(microphoneTrack ? new MediaStream([microphoneTrack]) : null);
            setIsMicrophoneEnabled(true);
            setConnectionState(ConnectionState.CONNECTED);

            setRoom(newRoom);

            // Check for existing participants (agent might already be there)
            const existingParticipants = Array.from(newRoom.remoteParticipants.values());
            setParticipants(existingParticipants);

            const agent = existingParticipants.find(
                p => p.identity.startsWith('agent-') || p.identity === 'asr-agent'
            );
            if (agent) {
                setIsAgentConnected(true);
                setAgentIdentity(agent.identity);
                console.log('[LiveKit] 🤖 Agent already in room');
            }

        } catch (err) {
            if (newRoom) {
                if (roomRef.current === newRoom) {
                    roomRef.current = null;
                }
                newRoom.disconnect();
            }
            if (connectionAttempt !== connectionAttemptRef.current) return;
            console.error('[LiveKit] Connection failed:', err);
            setError(err instanceof Error ? err.message : 'Connection failed');
            setLocalParticipant(null);
            setMediaStream(null);
            setIsMicrophoneEnabled(false);
            setConnectionState(ConnectionState.ERROR);
        }
    }, [serverUrl, fetchToken, roomName, handleDataReceived, handleParticipantConnected, handleParticipantDisconnected]);

    const toggleMicrophone = useCallback(async () => {
        const currentRoom = roomRef.current;
        if (!currentRoom || connectionState !== ConnectionState.CONNECTED) return;

        const shouldEnable = !isMicrophoneEnabled;
        try {
            setError(null);
            const publication = await currentRoom.localParticipant.setMicrophoneEnabled(shouldEnable);
            if (roomRef.current !== currentRoom) return;

            const microphoneTrack = publication?.track?.mediaStreamTrack
                ?? currentRoom.localParticipant
                    .getTrackPublication(Track.Source.Microphone)
                    ?.track
                    ?.mediaStreamTrack;

            setIsMicrophoneEnabled(shouldEnable);
            setMediaStream(shouldEnable && microphoneTrack ? new MediaStream([microphoneTrack]) : null);
        } catch (microphoneError) {
            console.error('[LiveKit] Failed to update microphone:', microphoneError);
            setError(microphoneError instanceof Error ? microphoneError.message : 'Failed to update microphone');
        }
    }, [connectionState, isMicrophoneEnabled]);

    // Disconnect from room
    const disconnect = useCallback(() => {
        connectionAttemptRef.current++;
        transcriptUpdatesRef.current?.clear();
        setInterimTranscripts(new Map());
        const currentRoom = roomRef.current;
        roomRef.current = null;
        if (currentRoom) {
            console.log('[LiveKit] 🔌 Disconnecting...');
            currentRoom.disconnect();
        }
        setRoom(null);
        setLocalParticipant(null);
        setMediaStream(null);
        setIsMicrophoneEnabled(false);
        setParticipants([]);
        setIsAgentConnected(false);
        setAgentIdentity(null);
        setConnectionState(ConnectionState.DISCONNECTED);
    }, []);

    // Clear transcripts
    const clearTranscripts = useCallback(() => {
        transcriptUpdatesRef.current?.clear();
        setTranscripts([]);
        setInterimTranscripts(new Map());
        segmentIdRef.current = 0;
    }, []);

    // Auto-connect on mount if enabled
    useEffect(() => {
        if (autoConnect) {
            connect();
        }

        // Cleanup on unmount
        return () => {
            connectionAttemptRef.current++;
            transcriptUpdatesRef.current?.clear();
            if (roomRef.current) {
                roomRef.current.disconnect();
            }
        };
    }, [autoConnect]); // eslint-disable-line react-hooks/exhaustive-deps

    return {
        connectionState,
        transcripts,
        interimTranscripts,
        error,
        room,
        localParticipant,
        mediaStream,
        isMicrophoneEnabled,
        participants,
        connect,
        disconnect,
        toggleMicrophone,
        clearTranscripts,
        isAgentConnected,
        agentIdentity,
        currentRoomName: roomName,
    };
}
