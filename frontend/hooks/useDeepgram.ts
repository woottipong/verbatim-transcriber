/**
 * Deepgram Nova-2 Hook
 * Direct browser connection to Deepgram WebSocket API (48kHz PCM)
 */

import { useState, useEffect, useRef, useCallback, MutableRefObject } from 'react';
import { ConnectionState, TranscriptSegment, AppConfig } from '../types';
import { DEEPGRAM_CONFIG } from '../lib/constants';
import {
  SharedVADProps,
  float32ToInt16,
  getMicrophoneConstraints,
  createAudioProcessor,
  shouldSendAudio,
  cleanupAudio,
  addFinalTranscript,
} from '../lib/audio';

export const useDeepgram = (config: AppConfig, sharedVAD?: SharedVADProps) => {
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

      if (data.type === 'error') {
        setError(data.error || 'Unknown error');
        return;
      }

      // Standardized format
      if (data.type === 'transcript' && data.text) {
        if (data.isFinal) {
          addFinalTranscript(setTranscripts, data.text);
          setInterimTranscript('');
        } else {
          setInterimTranscript(data.text);
        }
        return;
      }

      // Deepgram native format
      if (data.channel?.alternatives?.[0]) {
        const { transcript } = data.channel.alternatives[0];
        if (data.is_final && transcript.length > 0) {
          addFinalTranscript(setTranscripts, transcript);
          setInterimTranscript('');
        } else if (!data.is_final) {
          setInterimTranscript(transcript);
        }
      }
    } catch (e) {
      console.error('[Deepgram] Parse error:', e);
    }
  }, []);

  const buildWebSocketUrl = useCallback((): string => {
    if (!config.apiKey) {
      throw new Error('Missing Deepgram API Key. Set VITE_DEEPGRAM_API_KEY in .env');
    }

    const params = new URLSearchParams({
      model: DEEPGRAM_CONFIG.MODEL,
      language: DEEPGRAM_CONFIG.LANGUAGE,
      encoding: 'linear16',
      sample_rate: '48000',
      channels: '1',
      smart_format: String(DEEPGRAM_CONFIG.SMART_FORMAT),
      interim_results: String(DEEPGRAM_CONFIG.INTERIM_RESULTS),
      punctuate: 'false',
      filler_words: 'false',
      diarize: 'false',
      utterances: 'false',
      endpointing: 'false',
      vad_turnoff: '0',
    });

    return `${DEEPGRAM_CONFIG.API_BASE_URL}?${params.toString()}`;
  }, [config.apiKey]);

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

    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.close(1000, 'User stopped streaming');
    }
    socketRef.current = null;

    setConnectionState(prev =>
      prev === ConnectionState.ERROR ? prev : ConnectionState.DISCONNECTED
    );
    setInterimTranscript('');
  }, []);

  const startStreaming = useCallback(async () => {
    setError(null);

    try {
      const constraints = getMicrophoneConstraints(config.audioDeviceId, 48000);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      setMediaStream(stream);

      setConnectionState(ConnectionState.CONNECTING);
      const socket = new WebSocket(buildWebSocketUrl(), ['token', config.apiKey]);
      socketRef.current = socket;

      socket.onopen = () => {
        setConnectionState(ConnectionState.CONNECTED);

        try {
          const { audioContext, processor, source } = createAudioProcessor(stream, 48000);
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
        } catch (e: any) {
          setError(`Audio setup error: ${e.message}`);
          stopStreaming();
        }
      };

      socket.onmessage = handleMessage;

      socket.onclose = (event) => {
        if (event.code !== 1000 && event.code !== 1005) {
          setError(`Disconnected: Code ${event.code}`);
        }
        stopStreaming();
      };

      socket.onerror = () => {
        setConnectionState(ConnectionState.ERROR);
        setError('Connection error. Check API Key or network.');
      };
    } catch (err: any) {
      setError(err.message || 'Microphone access denied');
      setConnectionState(ConnectionState.ERROR);
      stopStreaming();
    }
  }, [config, handleMessage, buildWebSocketUrl, stopStreaming]);

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
