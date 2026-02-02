/**
 * Azure Speech Service Hook
 * Backend relay for audio transcription via Go server (16kHz PCM)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { ConnectionState, TranscriptSegment, AppConfig } from '../types';
import {
    SharedVADProps,
    float32ToInt16,
    getMicrophoneConstraints,
    createAudioProcessor,
    shouldSendAudio,
    cleanupAudio,
    cleanupWebSocket,
    addFinalTranscript,
    cleanThaiText,
} from '../lib/audio';

export const useAzure = (config: AppConfig, sharedVAD?: SharedVADProps) => {
    const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
    const [transcripts, setTranscripts] = useState<TranscriptSegment[]>([]);
    const [interimTranscript, setInterimTranscript] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

    const socketRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const localStreamingRef = useRef<boolean>(false);
    const isStreamingRef = sharedVAD?.isVADStreamingRef || localStreamingRef;

    const handleMessage = useCallback((event: MessageEvent) => {
        try {
            const data = JSON.parse(event.data);

            switch (data.type) {
                case 'connected':
                    break;

                case 'started':
                    setConnectionState(ConnectionState.CONNECTED);
                    break;

                case 'transcript':
                    if (data.text) {
                        const text = cleanThaiText(data.text);
                        if (text) {
                            if (data.isFinal) {
                                addFinalTranscript(setTranscripts, text);
                                setInterimTranscript('');
                            } else {
                                setInterimTranscript(text);
                            }
                        }
                    }
                    break;

                case 'error':
                    setError(data.error || 'Unknown error');
                    setConnectionState(ConnectionState.ERROR);
                    break;

                case 'stopped':
                    break;
            }
        } catch (err) {
            console.error('[Azure] Parse error:', err);
        }
    }, []);

    const stopStreaming = useCallback(() => {
        cleanupAudio({
            socket: socketRef.current,
            audioContext: audioContextRef.current,
            processor: processorRef.current,
            source: sourceRef.current,
            stream: streamRef.current,
        });

        audioContextRef.current = null;
        processorRef.current = null;
        sourceRef.current = null;
        streamRef.current = null;
        setMediaStream(null);

        cleanupWebSocket(socketRef.current, true);
        socketRef.current = null;

        setConnectionState(ConnectionState.DISCONNECTED);
        setInterimTranscript('');
    }, []);

    const startStreaming = useCallback(async () => {
        setError(null);

        try {
            // 16kHz for Azure
            const constraints = getMicrophoneConstraints(config.audioDeviceId, 16000);
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            streamRef.current = stream;
            setMediaStream(stream);

            setConnectionState(ConnectionState.CONNECTING);
            const wsUrl = `${config.backendUrl}/azure`;
            const socket = new WebSocket(wsUrl);
            socketRef.current = socket;

            socket.onopen = () => {
                socket.send(JSON.stringify({ type: 'start' }));

                const { audioContext, processor, source } = createAudioProcessor(stream, 16000);
                audioContextRef.current = audioContext;
                processorRef.current = processor;
                sourceRef.current = source;

                if (!config.vadConfig?.enabled) {
                    isStreamingRef.current = true;
                }

                processor.onaudioprocess = (e) => {
                    if (shouldSendAudio(socket, !!config.vadConfig?.enabled, isStreamingRef.current)) {
                        socket.send(float32ToInt16(e.inputBuffer.getChannelData(0)).buffer);
                    }
                };
            };

            socket.onmessage = handleMessage;

            socket.onclose = (event) => {
                if (event.code !== 1000 && event.code !== 1005) {
                    setError(`Connection closed: ${event.reason || 'Unknown'}`);
                }
                stopStreaming();
            };

            socket.onerror = () => {
                setConnectionState(ConnectionState.ERROR);
                setError('Failed to connect to Azure backend');
            };
        } catch (err: any) {
            setError(err.message || 'Failed to start streaming');
            setConnectionState(ConnectionState.ERROR);
            stopStreaming();
        }
    }, [config, handleMessage, stopStreaming]);

    const clearTranscripts = useCallback(() => {
        setTranscripts([]);
        setInterimTranscript('');
    }, []);

    useEffect(() => {
        return () => stopStreaming();
    }, [stopStreaming]);

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
};
