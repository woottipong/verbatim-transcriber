/**
 * Gemini Multimodal Live API Hook
 * Real-time audio streaming and transcription using Gemini 2.0 Flash
 */

import { useState, useEffect, useRef, useCallback, MutableRefObject } from 'react';
import { ConnectionState, TranscriptSegment, AppConfig } from '../types';
import { GEMINI_CONFIG } from '../lib/constants';
import { generateId } from '../lib/utils';

// Shared VAD props from App.tsx
interface SharedVADProps {
    vad: {
        isReady: boolean;
        isLoading: boolean;
        isSpeaking: boolean;
        start: () => Promise<void>;
        pause: () => void;
    };
    isVADStreamingRef: MutableRefObject<boolean>;
}

export const useGemini = (config: AppConfig, sharedVAD?: SharedVADProps) => {
    // State
    const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
    const [transcripts, setTranscripts] = useState<TranscriptSegment[]>([]);
    const [interimTranscript, setInterimTranscript] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

    // Refs
    const socketRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    // Use shared VAD streaming ref if provided, otherwise create local one
    const localStreamingRef = useRef<boolean>(false);
    const isStreamingRef = sharedVAD?.isVADStreamingRef || localStreamingRef;
    const vad = sharedVAD?.vad;

    /**
     * Clean Gemini transcription output
     */
    const cleanTranscription = useCallback((text: string): string => {
        if (!text) return '';

        let cleaned = text
            // Remove greeting words
            .replace(/^(สวัสดีค่ะ|สวัสดีครับ|สวัสดี)[\s,]*/gi, '')
            .replace(/[\s,]*(สวัสดีค่ะ|สวัสดีครับ)[\s,]*/gi, ' ')
            // Remove timestamps
            .replace(/\[?\(?\d{1,2}:\d{2}(:\d{2})?\)?\]?/g, '')
            // Remove markdown
            .replace(/```[\s\S]*?```/g, '')
            .replace(/`/g, '')
            // Remove periods after Thai text
            .replace(/([\u0E00-\u0E7F])\./g, '$1')
            // Remove extra whitespace
            .replace(/\s+/g, ' ')
            .trim();

        return cleaned;
    }, []);

    /**
     * Handle WebSocket messages
     */
    const handleSocketMessage = useCallback((event: MessageEvent) => {
        try {
            const data = JSON.parse(event.data);

            switch (data.type) {
                case 'connected':
                    console.log('✅ Connected to Gemini');
                    break;

                case 'started':
                    setConnectionState(ConnectionState.CONNECTED);
                    break;

                case 'transcript':
                    if (data.text) {
                        const cleanedText = cleanTranscription(data.text);
                        if (cleanedText) {
                            if (data.isFinal) {
                                setTranscripts(prev => [
                                    ...prev,
                                    {
                                        id: generateId(),
                                        text: cleanedText,
                                        isFinal: true,
                                        timestamp: Date.now(),
                                    }
                                ]);
                                setInterimTranscript('');
                            } else {
                                setInterimTranscript(cleanedText);
                            }
                        }
                    }
                    break;

                case 'error':
                    setError(data.error || 'Unknown error from Gemini');
                    setConnectionState(ConnectionState.ERROR);
                    break;

                case 'stopped':
                    console.log('Gemini session stopped');
                    break;

                default:
                    console.log('Unknown message type:', data.type);
            }
        } catch (err) {
            console.error('Error parsing Gemini message:', err);
        }
    }, [cleanTranscription]);

    /**
     * Stop streaming
     */
    const stopStreaming = useCallback(() => {
        // Note: VAD is managed by App.tsx now, don't stop it here

        // Stop audio processing
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
        }

        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }

        // Stop audio tracks
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
            setMediaStream(null);
        }

        // Stop WebSocket
        if (socketRef.current) {
            if (socketRef.current.readyState === WebSocket.OPEN) {
                socketRef.current.send(JSON.stringify({ type: 'stop' }));
                socketRef.current.close(1000, 'User stopped streaming');
            }
            socketRef.current = null;
        }

        setConnectionState(ConnectionState.DISCONNECTED);
        setInterimTranscript('');
    }, []);

    /**
     * Start streaming
     */
    const startStreaming = useCallback(async () => {
        setError(null);

        try {
            // 1. Get microphone access
            const constraints: MediaStreamConstraints = {
                audio: config.audioDeviceId
                    ? {
                        deviceId: { exact: config.audioDeviceId },
                        channelCount: 1,
                        sampleRate: 16000,
                        echoCancellation: true,
                        noiseSuppression: true,
                    }
                    : {
                        channelCount: 1,
                        sampleRate: 16000,
                        echoCancellation: true,
                        noiseSuppression: true,
                    },
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            streamRef.current = stream;
            setMediaStream(stream);

            // 2. Connect to Gemini WebSocket
            setConnectionState(ConnectionState.CONNECTING);
            const wsUrl = config.useBackend
                ? `${config.backendUrl}/gemini`
                : GEMINI_CONFIG.API_BASE_URL;

            const socket = new WebSocket(wsUrl);
            socketRef.current = socket;

            socket.onopen = () => {
                console.log('WebSocket connected to Gemini');

                // Start streaming session
                socket.send(JSON.stringify({
                    type: 'start',
                    apiKey: config.providerConfig?.gemini?.apiKey || config.apiKey,
                }));

                // 3. Setup AudioContext for PCM audio streaming (same as Deepgram)
                const audioContext = new AudioContext({ sampleRate: 16000 });
                audioContextRef.current = audioContext;

                const source = audioContext.createMediaStreamSource(stream);
                const processor = audioContext.createScriptProcessor(2048, 1, 1);
                processorRef.current = processor;

                // VAD is started by App.tsx
                // Only set isStreamingRef if VAD is disabled
                if (!config.vadConfig?.enabled) {
                    isStreamingRef.current = true;
                    console.log('🎯 [Gemini] VAD disabled, streaming all audio');
                } else {
                    // VAD controls isStreamingRef via callbacks
                    console.log('🎯 [Gemini] Using shared VAD, current isStreaming:', isStreamingRef.current);
                }

                processor.onaudioprocess = (e) => {
                    // Only send audio if:
                    // 1. Socket is open AND
                    // 2. VAD is disabled OR VAD detected speech
                    const shouldSend = socket.readyState === WebSocket.OPEN &&
                        (!config.vadConfig?.enabled || isStreamingRef.current);

                    if (shouldSend) {
                        const inputData = e.inputBuffer.getChannelData(0);

                        // Convert Float32 to Int16 PCM
                        const pcmData = new Int16Array(inputData.length);
                        for (let i = 0; i < inputData.length; i++) {
                            const s = Math.max(-1, Math.min(1, inputData[i]));
                            pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                        }

                        // Send PCM data
                        socket.send(pcmData.buffer);
                    }
                };

                source.connect(processor);
                processor.connect(audioContext.destination);
            };

            socket.onmessage = handleSocketMessage;

            socket.onclose = (event) => {
                if (event.code !== 1000 && event.code !== 1005) {
                    console.warn('Gemini WebSocket closed:', event.code, event.reason);
                    setError(`Connection closed: ${event.reason || 'Unknown error'}`);
                }
                stopStreaming();
            };

            socket.onerror = () => {
                setConnectionState(ConnectionState.ERROR);
                setError('Failed to connect to Gemini. Check API key or network.');
            };

        } catch (err: any) {
            setError(err.message || 'Failed to start Gemini streaming');
            setConnectionState(ConnectionState.ERROR);
            stopStreaming();
        }
    }, [config, handleSocketMessage, stopStreaming]);

    /**
     * Clear transcripts
     */
    const clearTranscripts = useCallback(() => {
        setTranscripts([]);
        setInterimTranscript('');
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stopStreaming();
        };
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
