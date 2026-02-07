/**
 * Shared Audio Utilities for ASR Hooks
 * Centralizes audio processing, WebSocket handling, and cleanup logic
 */

import React, { MutableRefObject } from 'react';
import { ConnectionState, TranscriptSegment } from '../types';
import { generateId } from './utils';

// ============================================================
// Types
// ============================================================

export interface SharedVADProps {
    vad: {
        isReady: boolean;
        isLoading: boolean;
        isSpeaking: boolean;
        start: () => Promise<void>;
        pause: () => void;
    };
    isVADStreamingRef: MutableRefObject<boolean>;
}

export interface AudioRefs {
    socket: WebSocket | null;
    audioContext: AudioContext | null;
    processor: ScriptProcessorNode | null;
    source: MediaStreamAudioSourceNode | null;
    stream: MediaStream | null;
}

export interface TranscriptHandlers {
    setTranscripts: React.Dispatch<React.SetStateAction<TranscriptSegment[]>>;
    setInterimTranscript: React.Dispatch<React.SetStateAction<string>>;
    setError: React.Dispatch<React.SetStateAction<string | null>>;
    setConnectionState: React.Dispatch<React.SetStateAction<ConnectionState>>;
}

// ============================================================
// Audio Processing
// ============================================================

/**
 * Convert Float32 audio samples to Int16 PCM
 */
export function float32ToInt16(float32Array: Float32Array): Int16Array {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16Array;
}

/**
 * Get microphone constraints for a given sample rate
 */
export function getMicrophoneConstraints(
    deviceId: string | undefined,
    sampleRate: number = 48000
): MediaStreamConstraints {
    const audioConstraints: MediaTrackConstraints = {
        channelCount: 1,
        sampleRate,
        echoCancellation: true,
        noiseSuppression: true,
    };

    if (deviceId) {
        audioConstraints.deviceId = { exact: deviceId };
    }

    return { audio: audioConstraints };
}

/**
 * Create AudioContext and ScriptProcessor for PCM streaming
 */
export function createAudioProcessor(
    stream: MediaStream,
    sampleRate: number,
    bufferSize: number = 2048
): { audioContext: AudioContext; processor: ScriptProcessorNode; source: MediaStreamAudioSourceNode } {
    const audioContext = new AudioContext({ sampleRate });
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);

    source.connect(processor);
    processor.connect(audioContext.destination);

    return { audioContext, processor, source };
}

// ============================================================
// WebSocket Helpers
// ============================================================

/**
 * Check if socket should send audio based on VAD state
 */
export function shouldSendAudio(
    socket: WebSocket | null,
    vadEnabled: boolean,
    isVADStreaming: boolean
): boolean {
    return (
        socket !== null &&
        socket.readyState === WebSocket.OPEN &&
        (!vadEnabled || isVADStreaming)
    );
}

/**
 * Send audio data via WebSocket
 */
export function sendAudioData(socket: WebSocket, pcmData: Int16Array): void {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(pcmData.buffer);
    }
}

// ============================================================
// Transcript Handling
// ============================================================

/**
 * Add a final transcript to the list
 */
export function addFinalTranscript(
    setTranscripts: React.Dispatch<React.SetStateAction<TranscriptSegment[]>>,
    text: string
): void {
    if (!text) return;
    setTranscripts(prev => [
        ...prev,
        {
            id: generateId(),
            text,
            isFinal: true,
            timestamp: Date.now(),
        },
    ]);
}

/**
 * Handle standardized transcript message format
 */
export function handleTranscriptMessage(
    data: { type: string; text?: string; isFinal?: boolean; error?: string },
    handlers: TranscriptHandlers,
    cleanFn?: (text: string) => string
): void {
    switch (data.type) {
        case 'connected':
            break;

        case 'started':
            handlers.setConnectionState(ConnectionState.CONNECTED);
            break;

        case 'transcript':
            if (data.text) {
                const text = cleanFn ? cleanFn(data.text) : data.text;
                if (text) {
                    if (data.isFinal) {
                        addFinalTranscript(handlers.setTranscripts, text);
                        handlers.setInterimTranscript('');
                    } else {
                        handlers.setInterimTranscript(text);
                    }
                }
            }
            break;

        case 'error':
            handlers.setError(data.error || 'Unknown error');
            handlers.setConnectionState(ConnectionState.ERROR);
            break;

        case 'stopped':
            break;
    }
}

// ============================================================
// Cleanup
// ============================================================

/**
 * Clean up audio resources
 */
export function cleanupAudio(refs: AudioRefs): void {
    // Disconnect audio nodes
    if (refs.processor) {
        refs.processor.disconnect();
    }
    if (refs.source) {
        refs.source.disconnect();
    }
    if (refs.audioContext) {
        refs.audioContext.close().catch(() => { });
    }

    // Stop media tracks
    if (refs.stream) {
        refs.stream.getTracks().forEach(track => track.stop());
    }
}

/**
 * Clean up WebSocket connection
 */
export function cleanupWebSocket(socket: WebSocket | null, sendStop: boolean = true): void {
    if (!socket) return;

    if (socket.readyState === WebSocket.OPEN) {
        if (sendStop) {
            socket.send(JSON.stringify({ type: 'stop' }));
        }
        socket.close(1000, 'User stopped streaming');
    }
}

// ============================================================
// Text Cleaning
// ============================================================

/**
 * Basic Thai text cleaner (shared patterns)
 */
export function cleanThaiText(text: string): string {
    if (!text) return '';

    return text
        .replace(/\s+/g, ' ')
        .trim();
}
