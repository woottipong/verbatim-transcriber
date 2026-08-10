/**
 * useLiveKit Hook
 * Provides LiveKit room connection for real-time Thai transcription via WebRTC
 * 
 * Architecture:
 * Browser → WebRTC → LiveKit Server → Go Agent → ASR API → Data Channel → Browser
 */

import { useState, useCallback, useRef, useEffect, useSyncExternalStore } from 'react';
import { Room, RoomEvent, DataPacket_Kind, LocalAudioTrack, LocalParticipant, RemoteParticipant, Track } from 'livekit-client';
import { AudioSource, ConnectionState, TranscriptSegment } from '../types';
import { AUDIO_SOURCE_LABELS, captureChromeTabAudio, getChromeTabCaptureError } from '../lib/audioSources';
import { getControlAuthHeaders } from '../lib/runtime';
import type { InterimTranscript } from '../lib/transcriptMessages';
import { TranscriptSession } from '../lib/transcriptSession';
import { LiveKitRoomLifecycle } from '../lib/liveKitRoomLifecycle';

export interface UseLiveKitOptions {
    serverUrl: string;       // LiveKit server URL (ws://localhost:7880)
    tokenEndpoint: string;   // Backend token endpoint (http://localhost:3000/livekit/token)
    roomName: string;        // Room name for ASR session
    audioDeviceId?: string;  // Selected microphone device, or default
    audioSource?: AudioSource;
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
    audioSource: AudioSource;
    audioSourceLabel: string;
    isAudioInputEnabled: boolean;
    isAudioInputStopped: boolean;
    participants: RemoteParticipant[];
    connect: () => Promise<void>;
    disconnect: () => void;
    toggleAudioInput: () => Promise<void>;
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
        audioDeviceId,
        audioSource = 'microphone',
        autoConnect = false,
    } = options;

    // State
    const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
    const [error, setError] = useState<string | null>(null);
    const [room, setRoom] = useState<Room | null>(null);
    const [localParticipant, setLocalParticipant] = useState<LocalParticipant | null>(null);
    const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
    const [isAudioInputEnabled, setIsAudioInputEnabled] = useState(false);
    const [isAudioInputStopped, setIsAudioInputStopped] = useState(false);
    const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
    const [connectedAgents, setConnectedAgents] = useState<string[]>([]);

    // Refs
    const displayStreamRef = useRef<MediaStream | null>(null);
    const tabAudioTrackRef = useRef<LocalAudioTrack | null>(null);
    const roomLifecycleRef = useRef<LiveKitRoomLifecycle | null>(null);
    if (roomLifecycleRef.current === null) {
        roomLifecycleRef.current = new LiveKitRoomLifecycle();
    }
    const roomLifecycle = roomLifecycleRef.current;
    const transcriptSessionRef = useRef<TranscriptSession | null>(null);
    if (transcriptSessionRef.current === null) {
        transcriptSessionRef.current = new TranscriptSession({ idPrefix: 'lk' });
    }
    const transcriptSession = transcriptSessionRef.current;
    const { transcripts, interimTranscripts } = useSyncExternalStore(
        transcriptSession.subscribe,
        transcriptSession.getSnapshot,
        transcriptSession.getSnapshot,
    );

    const cleanupTabCapture = useCallback((activeRoom?: Room) => {
        const localTrack = tabAudioTrackRef.current;
        tabAudioTrackRef.current = null;
        const captureRoom = activeRoom ?? roomLifecycle.room;
        if (localTrack && captureRoom) {
            void captureRoom.localParticipant.unpublishTrack(localTrack, false).catch(() => {
                console.warn('[LiveKit] Failed to unpublish Chrome Tab audio during cleanup');
            });
        }
        const displayStream = displayStreamRef.current;
        displayStreamRef.current = null;
        displayStream?.getTracks().forEach(track => track.stop());
    }, [roomLifecycle]);

    // Fetch token from backend
    const fetchToken = useCallback(async (): Promise<string> => {
        const identity = `audio-source-${roomName}-${Date.now()}`;

        const response = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getControlAuthHeaders() },
            body: JSON.stringify({ identity, roomName }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            if (errorData.code === 'room_not_found') {
                throw new Error('This room is no longer available. Ask the administrator for a new stream link.');
            }
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
        transcriptSession.ingest(payload, participant?.identity || 'unknown');
    }, [transcriptSession]);

    // Handle participant connected (check for agent)
    const handleParticipantConnected = useCallback((participant: RemoteParticipant) => {
        console.log('[LiveKit] 👤 Participant connected:', participant.identity);
        setParticipants(prev => [...prev, participant]);

        // Check if it's the agent
        if (participant.identity.startsWith('agent-') || participant.identity === 'asr-agent') {
            setConnectedAgents(prev => {
                if (prev.includes(participant.identity)) return prev;
                return [...prev, participant.identity];
            });
            console.log('[LiveKit] 🤖 Agent connected:', participant.identity);
        }
    }, []);

    // Handle participant disconnected
    const handleParticipantDisconnected = useCallback((participant: RemoteParticipant) => {
        console.log('[LiveKit] 👤 Participant disconnected:', participant.identity);
        setParticipants(prev => prev.filter(p => p.sid !== participant.sid));

        if (participant.identity.startsWith('agent-') || participant.identity === 'asr-agent') {
            setConnectedAgents(prev => prev.filter(id => id !== participant.identity));
            transcriptSession.removeSource(participant.identity);
            console.log('[LiveKit] 🤖 Agent disconnected:', participant.identity);
        }
    }, [transcriptSession]);

    // Connect to LiveKit room
    const connect = useCallback(async () => {
        try {
            setConnectionState(ConnectionState.CONNECTING);
            setError(null);
            setIsAudioInputStopped(false);

            const connectedRoom = await roomLifecycle.connect({
                serverUrl,
                prepare: async () => {
                    const token = await fetchToken();
                    console.log('[LiveKit] 🎫 Token received');
                    if (audioSource !== 'chrome-tab') {
                        return { token, capturedTab: null };
                    }
                    const capturedTab = await captureChromeTabAudio();
                    displayStreamRef.current = capturedTab.stream;
                    return { token, capturedTab };
                },
                disposePreparation: preparation => {
                    const capturedTab = preparation.capturedTab;
                    capturedTab?.stream.getTracks().forEach(track => track.stop());
                    if (displayStreamRef.current === capturedTab?.stream) displayStreamRef.current = null;
                },
                getToken: async preparation => preparation.token,
                roomOptions: {
                    adaptiveStream: true,
                    dynacast: true,
                    audioCaptureDefaults: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: true,
                        sampleRate: 48000,
                        channelCount: 1,
                        ...(audioDeviceId && audioDeviceId !== 'default' ? { deviceId: audioDeviceId } : {}),
                    },
                },
                createRoom: roomOptions => new Room(roomOptions),
                registerAdapterEvents: lifecycleRoom => {
                    lifecycleRoom.on(RoomEvent.DataReceived, handleDataReceived);
                    lifecycleRoom.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
                    lifecycleRoom.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
                },
                callbacks: {
                    onConnected: lifecycleRoom => {
                        console.log('[LiveKit] ✅ Connected to room:', roomName);
                        setLocalParticipant(lifecycleRoom.localParticipant);
                    },
                    onReconnecting: () => setConnectionState(ConnectionState.CONNECTING),
                    onReconnected: () => setConnectionState(ConnectionState.CONNECTED),
                    onEnded: (_reason, endedRoom) => {
                        transcriptSession.reset();
                        setRoom(null);
                        setLocalParticipant(null);
                        setMediaStream(null);
                        setIsAudioInputEnabled(false);
                        setIsAudioInputStopped(false);
                        setParticipants([]);
                        setConnectedAgents([]);
                        setConnectionState(ConnectionState.DISCONNECTED);
                        cleanupTabCapture(endedRoom);
                    },
                },
                afterConnect: async (lifecycleRoom, preparation) => {
                    const capturedTab = preparation.capturedTab;
                    if (audioSource === 'chrome-tab') {
                        if (!capturedTab) throw new Error('Chrome Tab audio capture was not available.');
                        if (capturedTab.audioTrack.readyState === 'ended') {
                            throw new Error('Tab audio stopped before the connection completed.');
                        }
                        const localTrack = new LocalAudioTrack(capturedTab.audioTrack, undefined, true);
                        tabAudioTrackRef.current = localTrack;
                        capturedTab.audioTrack.addEventListener('ended', () => {
                            if (displayStreamRef.current !== capturedTab.stream) return;
                            setMediaStream(null);
                            setIsAudioInputEnabled(false);
                            setIsAudioInputStopped(true);
                        }, { once: true });
                        await lifecycleRoom.localParticipant.publishTrack(localTrack, {
                            source: Track.Source.Microphone,
                            name: 'chrome-tab-audio',
                        });
                        setMediaStream(new MediaStream([capturedTab.audioTrack]));
                        return;
                    }
                    const microphonePublication = await lifecycleRoom.localParticipant.setMicrophoneEnabled(true);
                    const microphoneTrack = microphonePublication?.track?.mediaStreamTrack
                        ?? lifecycleRoom.localParticipant
                            .getTrackPublication(Track.Source.Microphone)
                            ?.track
                            ?.mediaStreamTrack;
                    setMediaStream(microphoneTrack ? new MediaStream([microphoneTrack]) : null);
                },
            });
            if (!connectedRoom || !roomLifecycle.isCurrent(connectedRoom)) return;
            setIsAudioInputEnabled(true);
            setConnectionState(ConnectionState.CONNECTED);
            setRoom(connectedRoom);

            // Check for existing participants (agent might already be there)
            const existingParticipants = Array.from(
                connectedRoom.remoteParticipants.values(),
            ) as RemoteParticipant[];
            setParticipants(existingParticipants);

            const agents = existingParticipants.filter(
                p => p.identity.startsWith('agent-') || p.identity === 'asr-agent'
            );
            if (agents.length > 0) {
                setConnectedAgents(agents.map(a => a.identity));
                console.log('[LiveKit] 🤖 Agents already in room:', agents.map(a => a.identity));
            }

        } catch (err) {
            transcriptSession.reset();
            console.error('[LiveKit] Connection failed:', err);
            setError(audioSource === 'chrome-tab'
                ? getChromeTabCaptureError(err)
                : err instanceof Error ? err.message : 'Connection failed');
            setLocalParticipant(null);
            setMediaStream(null);
            setIsAudioInputEnabled(false);
            setConnectionState(ConnectionState.ERROR);
        }
    }, [serverUrl, fetchToken, roomName, audioDeviceId, audioSource, cleanupTabCapture, handleDataReceived, handleParticipantConnected, handleParticipantDisconnected, transcriptSession, roomLifecycle]);

    const toggleAudioInput = useCallback(async () => {
        const currentRoom = roomLifecycle.room;
        if (!currentRoom || connectionState !== ConnectionState.CONNECTED) return;

        const shouldEnable = !isAudioInputEnabled;
        try {
            setError(null);
            if (audioSource === 'chrome-tab') {
                const track = tabAudioTrackRef.current;
                if (!track || isAudioInputStopped) return;
                if (shouldEnable) await track.unmute();
                else await track.mute();
                if (!roomLifecycle.isCurrent(currentRoom)) return;
                setIsAudioInputEnabled(shouldEnable);
                return;
            }

            const publication = await currentRoom.localParticipant.setMicrophoneEnabled(shouldEnable);
            if (!roomLifecycle.isCurrent(currentRoom)) return;

            const microphoneTrack = publication?.track?.mediaStreamTrack
                ?? currentRoom.localParticipant
                    .getTrackPublication(Track.Source.Microphone)
                    ?.track
                    ?.mediaStreamTrack;

            setIsAudioInputEnabled(shouldEnable);
            if (shouldEnable && microphoneTrack) {
                setMediaStream(new MediaStream([microphoneTrack]));
            }
        } catch (audioInputError) {
            console.error('[LiveKit] Failed to update audio input:', audioInputError);
            setError(audioInputError instanceof Error ? audioInputError.message : 'Failed to update audio input');
        }
    }, [audioSource, connectionState, isAudioInputEnabled, isAudioInputStopped, roomLifecycle]);

    // Disconnect from room
    const disconnect = useCallback(() => {
        transcriptSession.reset();
        roomLifecycle.disconnect();
    }, [roomLifecycle, transcriptSession]);

    // Clear transcripts
    const clearTranscripts = useCallback(() => {
        transcriptSession.reset(true);
    }, [transcriptSession]);

    // Auto-connect on mount if enabled
    useEffect(() => {
        if (autoConnect) void connect();
    }, [autoConnect, connect]);

    useEffect(() => {
        return () => {
            transcriptSession.reset();
            roomLifecycle.dispose();
            cleanupTabCapture();
        };
    }, [cleanupTabCapture, roomLifecycle, transcriptSession]);

    return {
        connectionState,
        transcripts,
        interimTranscripts,
        error,
        room,
        localParticipant,
        mediaStream,
        audioSource,
        audioSourceLabel: AUDIO_SOURCE_LABELS[audioSource],
        isAudioInputEnabled,
        isAudioInputStopped,
        participants,
        connect,
        disconnect,
        toggleAudioInput,
        clearTranscripts,
        isAgentConnected: connectedAgents.length > 0,
        agentIdentity: connectedAgents.length > 0 ? connectedAgents.join(',') : null,
        currentRoomName: roomName,
    };
}
