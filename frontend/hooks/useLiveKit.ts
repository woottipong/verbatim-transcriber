/**
 * useLiveKit Hook
 * Provides LiveKit room connection for real-time Thai transcription via WebRTC
 * 
 * Architecture:
 * Browser → WebRTC → LiveKit Server → Go Agent → ASR API → Data Channel → Browser
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Room, RoomEvent, DataPacket_Kind, LocalAudioTrack, LocalParticipant, RemoteParticipant, Track } from 'livekit-client';
import { AudioSource, ConnectionState, TranscriptSegment } from '../types';
import { AUDIO_SOURCE_LABELS, captureChromeTabAudio, getChromeTabCaptureError } from '../lib/audioSources';
import {
    GEMINI_TRANSCRIPT_UPDATE_INTERVAL_MS,
    INTERIM_TRANSCRIPT_UPDATE_INTERVAL_MS,
    TranscriptUpdateBuffer,
} from '../lib/transcriptUpdates';
import { appendBounded } from '../lib/runtime';
import { getControlAuthHeaders } from '../lib/runtime';
import {
    InterimTranscript,
    PendingTranslation,
    TranscriptMessage,
    attachTranslation,
    appendTranscriptIfNew,
    clearInterimsBySource,
    clearPendingTranslationsBySource,
    createCommittedTranscript,
    getTranscriptKey,
    getTranscriptTurnKey,
    isAppendOnlyInterimProvider,
    parseTranscriptMessage,
    prunePendingTranslations,
    removeInterim,
    storePendingTranslation,
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
    const [transcripts, setTranscripts] = useState<TranscriptSegment[]>([]);
    const [interimTranscripts, setInterimTranscripts] = useState<Map<string, InterimTranscript>>(new Map());
    const [error, setError] = useState<string | null>(null);
    const [room, setRoom] = useState<Room | null>(null);
    const [localParticipant, setLocalParticipant] = useState<LocalParticipant | null>(null);
    const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
    const [isAudioInputEnabled, setIsAudioInputEnabled] = useState(false);
    const [isAudioInputStopped, setIsAudioInputStopped] = useState(false);
    const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
    const [connectedAgents, setConnectedAgents] = useState<string[]>([]);

    // Refs
    const roomRef = useRef<Room | null>(null);
    const reconnectAttemptsRef = useRef(0);
    const segmentIdRef = useRef(0);
    const connectionAttemptRef = useRef(0);
    const translationsByTurnRef = useRef<Map<string, PendingTranslation>>(new Map());
    const displayStreamRef = useRef<MediaStream | null>(null);
    const tabAudioTrackRef = useRef<LocalAudioTrack | null>(null);

    const cleanupTabCapture = useCallback(() => {
        const localTrack = tabAudioTrackRef.current;
        tabAudioTrackRef.current = null;
        if (localTrack && roomRef.current) {
            void roomRef.current.localParticipant.unpublishTrack(localTrack, false).catch(() => {
                console.warn('[LiveKit] Failed to unpublish Chrome Tab audio during cleanup');
            });
        }
        const displayStream = displayStreamRef.current;
        displayStreamRef.current = null;
        displayStream?.getTracks().forEach(track => track.stop());
    }, []);

    const applyTranscriptUpdate = useCallback((message: BufferedTranscriptMessage) => {
        const provider = message.provider || 'unknown';
        const isAppendOnly = isAppendOnlyInterimProvider(provider);
        if (message.isFinal || isAppendOnly) {
            segmentIdRef.current++;
            const segment = createCommittedTranscript(
                `lk-${segmentIdRef.current}`,
                message,
                provider,
                message.speaker || message.sourceIdentity,
            );
            setTranscripts(prev => {
                let next = isAppendOnly
                    ? appendTranscriptIfNew(prev, segment)
                    : appendBounded(prev, segment);
                if (message.turnId) {
                    translationsByTurnRef.current = prunePendingTranslations(translationsByTurnRef.current);
                    const pending = translationsByTurnRef.current.get(getTranscriptTurnKey(message, message.sourceIdentity));
                    if (pending) next = attachTranslation(next, pending.message, pending.sourceIdentity).transcripts;
                }
                return next;
            });
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
            INTERIM_TRANSCRIPT_UPDATE_INTERVAL_MS,
            undefined,
            undefined,
            message => message.isFinal,
            message => message.key,
        );
    }

    const applyGeminiUpdate = useCallback((message: BufferedTranscriptMessage) => {
        if (message.role === 'translation') {
            translationsByTurnRef.current = storePendingTranslation(
                translationsByTurnRef.current,
                message,
                message.sourceIdentity,
            );
            setTranscripts(prev => attachTranslation(prev, message, message.sourceIdentity).transcripts);
            return;
        }
        applyTranscriptUpdate(message);
    }, [applyTranscriptUpdate]);

    const geminiTranscriptUpdatesRef = useRef<TranscriptUpdateBuffer<BufferedTranscriptMessage> | null>(null);
    if (geminiTranscriptUpdatesRef.current === null) {
        geminiTranscriptUpdatesRef.current = new TranscriptUpdateBuffer<BufferedTranscriptMessage>(
            applyGeminiUpdate,
            GEMINI_TRANSCRIPT_UPDATE_INTERVAL_MS,
            undefined,
            undefined,
            message => message.isFinal,
            message => message.key,
            'immediate',
        );
    }

    // Fetch token from backend
    const fetchToken = useCallback(async (): Promise<string> => {
        const identity = `user-${Date.now()}`;

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
        try {
            const decoder = new TextDecoder();
            const message = parseTranscriptMessage(JSON.parse(decoder.decode(payload)));
            if (!message) return;
            const sourceIdentity = participant?.identity || 'unknown';
            const bufferedMessage = {
                ...message,
                key: getTranscriptKey(message, sourceIdentity),
                sourceIdentity,
            };

            if (isAppendOnlyInterimProvider(message.provider || '')) {
                geminiTranscriptUpdatesRef.current?.push(bufferedMessage);
                return;
            }

            if (message.role === 'translation') {
                translationsByTurnRef.current = storePendingTranslation(
                    translationsByTurnRef.current,
                    message,
                    sourceIdentity,
                );
                setTranscripts(prev => attachTranslation(prev, message, sourceIdentity).transcripts);
                return;
            }

            transcriptUpdatesRef.current?.push(bufferedMessage);
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
            if (participant.identity === 'agent-gemini') {
                geminiTranscriptUpdatesRef.current?.clear();
            }
            setInterimTranscripts(prev => clearInterimsBySource(prev, participant.identity));
            translationsByTurnRef.current = clearPendingTranslationsBySource(
                translationsByTurnRef.current,
                participant.identity,
            );
            console.log('[LiveKit] 🤖 Agent disconnected:', participant.identity);
        }
    }, []);

    // Connect to LiveKit room
    const connect = useCallback(async () => {
        const connectionAttempt = ++connectionAttemptRef.current;
        let newRoom: Room | null = null;
        let capturedTab: Awaited<ReturnType<typeof captureChromeTabAudio>> | null = null;

        try {
            setConnectionState(ConnectionState.CONNECTING);
            setError(null);
            setIsAudioInputStopped(false);

            if (audioSource === 'chrome-tab') {
                capturedTab = await captureChromeTabAudio();
                if (connectionAttempt !== connectionAttemptRef.current) {
                    capturedTab.stream.getTracks().forEach(track => track.stop());
                    return;
                }
                displayStreamRef.current = capturedTab.stream;
            }

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
                    ...(audioDeviceId && audioDeviceId !== 'default' ? { deviceId: audioDeviceId } : {}),
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
                geminiTranscriptUpdatesRef.current?.clear();
                translationsByTurnRef.current.clear();
                setInterimTranscripts(new Map());
                setRoom(null);
                setLocalParticipant(null);
                setMediaStream(null);
                setIsAudioInputEnabled(false);
                setIsAudioInputStopped(false);
                setParticipants([]);
                setConnectedAgents([]);
                setConnectionState(ConnectionState.DISCONNECTED);
                cleanupTabCapture();
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

            if (audioSource === 'chrome-tab') {
                if (!capturedTab) throw new Error('Chrome Tab audio capture was not available.');
                if (capturedTab.audioTrack.readyState === 'ended') {
                    throw new Error('Tab audio stopped before the connection completed.');
                }

                const localTrack = new LocalAudioTrack(capturedTab.audioTrack, undefined, true);
                tabAudioTrackRef.current = localTrack;
                capturedTab.audioTrack.addEventListener('ended', () => {
                    if (displayStreamRef.current !== capturedTab?.stream) return;
                    setMediaStream(null);
                    setIsAudioInputEnabled(false);
                    setIsAudioInputStopped(true);
                }, { once: true });
                await newRoom.localParticipant.publishTrack(localTrack, {
                    source: Track.Source.Microphone,
                    name: 'chrome-tab-audio',
                });
                if (connectionAttempt !== connectionAttemptRef.current) {
                    newRoom.disconnect();
                    cleanupTabCapture();
                    return;
                }
                console.log('[LiveKit] 🔊 Chrome Tab audio enabled');
                setMediaStream(new MediaStream([capturedTab.audioTrack]));
            } else {
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
            }
            setIsAudioInputEnabled(true);
            setConnectionState(ConnectionState.CONNECTED);

            setRoom(newRoom);

            // Check for existing participants (agent might already be there)
            const existingParticipants = Array.from(newRoom.remoteParticipants.values());
            setParticipants(existingParticipants);

            const agents = existingParticipants.filter(
                p => p.identity.startsWith('agent-') || p.identity === 'asr-agent'
            );
            if (agents.length > 0) {
                setConnectedAgents(agents.map(a => a.identity));
                console.log('[LiveKit] 🤖 Agents already in room:', agents.map(a => a.identity));
            }

        } catch (err) {
            transcriptUpdatesRef.current?.clear();
            geminiTranscriptUpdatesRef.current?.clear();
            cleanupTabCapture();
            if (newRoom) {
                if (roomRef.current === newRoom) {
                    roomRef.current = null;
                }
                newRoom.disconnect();
            }
            if (connectionAttempt !== connectionAttemptRef.current) return;
            console.error('[LiveKit] Connection failed:', err);
            setError(audioSource === 'chrome-tab'
                ? getChromeTabCaptureError(err)
                : err instanceof Error ? err.message : 'Connection failed');
            setLocalParticipant(null);
            setMediaStream(null);
            setIsAudioInputEnabled(false);
            setConnectionState(audioSource === 'chrome-tab' && !newRoom
                ? ConnectionState.DISCONNECTED
                : ConnectionState.ERROR);
        }
    }, [serverUrl, fetchToken, roomName, audioDeviceId, audioSource, cleanupTabCapture, handleDataReceived, handleParticipantConnected, handleParticipantDisconnected]);

    const toggleAudioInput = useCallback(async () => {
        const currentRoom = roomRef.current;
        if (!currentRoom || connectionState !== ConnectionState.CONNECTED) return;

        const shouldEnable = !isAudioInputEnabled;
        try {
            setError(null);
            if (audioSource === 'chrome-tab') {
                const track = tabAudioTrackRef.current;
                if (!track || isAudioInputStopped) return;
                if (shouldEnable) await track.unmute();
                else await track.mute();
                if (roomRef.current !== currentRoom) return;
                setIsAudioInputEnabled(shouldEnable);
                return;
            }

            const publication = await currentRoom.localParticipant.setMicrophoneEnabled(shouldEnable);
            if (roomRef.current !== currentRoom) return;

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
    }, [audioSource, connectionState, isAudioInputEnabled, isAudioInputStopped]);

    // Disconnect from room
    const disconnect = useCallback(() => {
        connectionAttemptRef.current++;
        transcriptUpdatesRef.current?.clear();
        geminiTranscriptUpdatesRef.current?.clear();
        translationsByTurnRef.current.clear();
        setInterimTranscripts(new Map());
        const currentRoom = roomRef.current;
        cleanupTabCapture();
        roomRef.current = null;
        if (currentRoom) {
            console.log('[LiveKit] 🔌 Disconnecting...');
            currentRoom.disconnect();
        }
        setRoom(null);
        setLocalParticipant(null);
        setMediaStream(null);
        setIsAudioInputEnabled(false);
        setIsAudioInputStopped(false);
        setParticipants([]);
        setConnectedAgents([]);
        setConnectionState(ConnectionState.DISCONNECTED);
    }, [cleanupTabCapture]);

    // Clear transcripts
    const clearTranscripts = useCallback(() => {
        transcriptUpdatesRef.current?.clear();
        geminiTranscriptUpdatesRef.current?.clear();
        translationsByTurnRef.current.clear();
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
            geminiTranscriptUpdatesRef.current?.clear();
            translationsByTurnRef.current.clear();
            cleanupTabCapture();
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
