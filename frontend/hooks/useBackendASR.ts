import { useCallback, useEffect, useRef, useState } from 'react';
import { AppConfig, ConnectionState, TranscriptSegment, UseASRReturn } from '../types';
import {
    SharedVADProps,
    addFinalTranscript,
    cleanThaiText,
    cleanupAudio,
    cleanupWebSocket,
    createAudioProcessor,
    float32ToInt16,
    getMicrophoneConstraints,
    shouldSendAudio,
} from '../lib/audio';
import { getErrorMessage, shouldUseVAD, stopMediaStream } from '../lib/runtime';
import { parseTranscriptMessage } from '../lib/transcriptMessages';

interface BackendASROptions {
    providerName: string;
    endpoint: string;
    sampleRate: number;
    bufferSize: number;
    startMessage: (actualSampleRate: number) => Record<string, unknown>;
}

export function useBackendASR(
    config: AppConfig,
    options: BackendASROptions,
    sharedVAD?: SharedVADProps
): UseASRReturn {
    const [connectionState, setConnectionState] = useState(ConnectionState.DISCONNECTED);
    const [transcripts, setTranscripts] = useState<TranscriptSegment[]>([]);
    const [interimTranscript, setInterimTranscript] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

    const socketRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const localStreamingRef = useRef(false);
    const connectionAttemptRef = useRef(0);

    const isStreamingRef = sharedVAD?.isVADStreamingRef || localStreamingRef;
    const vadEnabled = shouldUseVAD(!!config.vadConfig?.enabled, !!sharedVAD);

    const releaseResources = useCallback((sendStop: boolean) => {
        const socket = socketRef.current;
        socketRef.current = null;
        if (socket) {
            socket.onopen = null;
            socket.onmessage = null;
            socket.onclose = null;
            socket.onerror = null;
        }

        cleanupAudio({
            socket,
            audioContext: audioContextRef.current,
            processor: processorRef.current,
            source: sourceRef.current,
            stream: streamRef.current,
        });
        cleanupWebSocket(socket, sendStop);

        audioContextRef.current = null;
        processorRef.current = null;
        sourceRef.current = null;
        streamRef.current = null;
        localStreamingRef.current = false;
        setMediaStream(null);
    }, []);

    const stopStreaming = useCallback(() => {
        connectionAttemptRef.current++;
        releaseResources(true);
        setConnectionState(ConnectionState.DISCONNECTED);
        setInterimTranscript('');
    }, [releaseResources]);

    const handleMessage = useCallback((event: MessageEvent) => {
        try {
            const data: unknown = JSON.parse(event.data);
            if (typeof data !== 'object' || data === null || !('type' in data)) return;
            const message = data as { type: string; text?: unknown; isFinal?: unknown; error?: unknown };

            if (message.type === 'started') {
                setConnectionState(ConnectionState.CONNECTED);
                return;
            }
            if (message.type === 'error') {
                setError(typeof message.error === 'string' ? message.error : 'Unknown error');
                setConnectionState(ConnectionState.ERROR);
                return;
            }
            if (message.type !== 'transcript') return;
            const transcript = parseTranscriptMessage(data);
            if (!transcript) return;

            const text = cleanThaiText(transcript.text);
            if (!text) return;
            if (transcript.isFinal) {
                addFinalTranscript(setTranscripts, text);
                setInterimTranscript('');
            } else {
                setInterimTranscript(text);
            }
        } catch (parseError) {
            console.error(`[${options.providerName}] Parse error:`, parseError);
        }
    }, [options.providerName]);

    const startStreaming = useCallback(async () => {
        const connectionAttempt = ++connectionAttemptRef.current;
        setError(null);
        setConnectionState(ConnectionState.CONNECTING);

        try {
            const constraints = getMicrophoneConstraints(config.audioDeviceId, options.sampleRate);
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            if (connectionAttempt !== connectionAttemptRef.current) {
                stopMediaStream(stream);
                return;
            }

            streamRef.current = stream;
            setMediaStream(stream);

            const socket = new WebSocket(`${config.backendUrl}/${options.endpoint}`);
            socketRef.current = socket;

            socket.onopen = () => {
                if (connectionAttempt !== connectionAttemptRef.current) return;
                try {
                    const { audioContext, processor, source } = createAudioProcessor(
                        stream,
                        options.sampleRate,
                        options.bufferSize
                    );
                    audioContextRef.current = audioContext;
                    processorRef.current = processor;
                    sourceRef.current = source;

                    socket.send(JSON.stringify(options.startMessage(audioContext.sampleRate)));
                    if (!vadEnabled) {
                        isStreamingRef.current = true;
                    }

                    processor.onaudioprocess = event => {
                        if (shouldSendAudio(socket, vadEnabled, isStreamingRef.current)) {
                            socket.send(float32ToInt16(event.inputBuffer.getChannelData(0)).buffer);
                        }
                    };
                } catch (setupError) {
                    releaseResources(false);
                    setError(getErrorMessage(setupError, 'Failed to initialize audio processing'));
                    setConnectionState(ConnectionState.ERROR);
                }
            };

            socket.onmessage = handleMessage;
            socket.onclose = event => {
                if (socketRef.current !== socket) return;
                releaseResources(false);
                setInterimTranscript('');
                if (event.code !== 1000 && event.code !== 1005) {
                    setError(`Connection closed: ${event.reason || 'Unknown'}`);
                    setConnectionState(ConnectionState.ERROR);
                } else {
                    setConnectionState(ConnectionState.DISCONNECTED);
                }
            };
            socket.onerror = () => {
                setError(`Failed to connect to ${options.providerName} backend`);
                setConnectionState(ConnectionState.ERROR);
            };
        } catch (startError) {
            if (connectionAttempt !== connectionAttemptRef.current) return;
            releaseResources(false);
            setError(getErrorMessage(startError, 'Failed to start streaming'));
            setConnectionState(ConnectionState.ERROR);
        }
    }, [config.audioDeviceId, config.backendUrl, handleMessage, isStreamingRef, options, releaseResources, vadEnabled]);

    const clearTranscripts = useCallback(() => {
        setTranscripts([]);
        setInterimTranscript('');
    }, []);

    useEffect(() => () => {
        connectionAttemptRef.current++;
        releaseResources(true);
    }, [releaseResources]);

    return {
        connectionState,
        transcripts,
        interimTranscript,
        error,
        mediaStream,
        startStreaming,
        stopStreaming,
        clearTranscripts,
    };
}
