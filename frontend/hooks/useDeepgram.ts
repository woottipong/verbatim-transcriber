import { useState, useEffect, useRef, useCallback, MutableRefObject } from 'react';
import { ConnectionState, DeepgramResponse, TranscriptSegment, AppConfig } from '../types';
import { DEEPGRAM_CONFIG, MEDIA_RECORDER_CONFIG } from '../lib/constants';
import { getSupportedMimeType, generateId } from '../lib/utils';

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

/**
 * Custom hook for managing Deepgram WebSocket connection and audio streaming
 */
export const useDeepgram = (config: AppConfig, sharedVAD?: SharedVADProps) => {
  // State
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [transcripts, setTranscripts] = useState<TranscriptSegment[]>([]);
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  // Refs for WebSocket and MediaRecorder (not part of render cycle)
  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Use shared VAD streaming ref if provided, otherwise create local one
  const localStreamingRef = useRef<boolean>(false);
  const isStreamingRef = sharedVAD?.isVADStreamingRef || localStreamingRef;
  const vad = sharedVAD?.vad;

  /**
   * Handle incoming WebSocket messages from Deepgram
   */
  const handleSocketMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);

      // Handle error messages from relay server
      if (data.type === 'error') {
        setError(data.message || 'Unknown error from server');
        return;
      }

      // Type guard for Deepgram response
      const deepgramData = data as DeepgramResponse;

      // Handle transcription results
      if (deepgramData.type === 'Results' && deepgramData.channel?.alternatives[0]) {
        const alt = deepgramData.channel.alternatives[0];

        if (deepgramData.is_final) {
          // Final result - add to transcripts
          if (alt.transcript.length > 0) {
            setTranscripts(prev => [
              ...prev,
              {
                id: generateId(),
                text: alt.transcript,
                isFinal: true,
                timestamp: Date.now()
              }
            ]);
          }
          setInterimTranscript('');
        } else {
          // Interim result - show as preview
          setInterimTranscript(alt.transcript);
        }
      }
    } catch (e) {
      console.error('Error parsing WebSocket message:', e);
    }
  }, []);

  /**
   * Stop streaming and clean up resources
   */
  const stopStreaming = useCallback(() => {
    // Note: VAD is managed by App.tsx now, don't stop it here

    // Stop AudioContext
    if (mediaRecorderRef.current) {
      const ctx = (mediaRecorderRef as any).current;
      if (ctx.processor) {
        ctx.processor.disconnect();
        ctx.source?.disconnect();
      }
      if (ctx.audioContext) {
        ctx.audioContext.close();
      }
    }
    mediaRecorderRef.current = null;

    // Stop all audio tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setMediaStream(null);
    }

    // Close WebSocket
    if (socketRef.current) {
      if (socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.close(1000, 'User stopped streaming');
      }
      socketRef.current = null;
    }

    // Update state (preserve ERROR state if already set)
    setConnectionState(prev =>
      prev === ConnectionState.ERROR ? prev : ConnectionState.DISCONNECTED
    );
    setInterimTranscript('');
  }, []);

  /**
   * Build WebSocket URL based on configuration
   */
  const buildWebSocketUrl = useCallback((): string => {
    if (config.useBackend) {
      // Append /deepgram path to backend URL
      const baseUrl = config.backendUrl.replace(/\/$/, ''); // Remove trailing slash
      return `${baseUrl}/deepgram`;
    }

    if (!config.apiKey) {
      throw new Error('Missing API Key. Configure in settings or use backend relay.');
    }

    // Direct connection to Deepgram
    // Using linear16 PCM @ 48kHz for best Thai transcription quality
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
  }, [config]);

  /**
   * Start streaming audio to Deepgram
   */
  const startStreaming = useCallback(async () => {
    setError(null);

    try {
      // 1. Request microphone access with device selection
      const constraints: MediaStreamConstraints = {
        audio: config.audioDeviceId
          ? {
            deviceId: { exact: config.audioDeviceId },
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
          : {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      setMediaStream(stream);

      // 2. Build WebSocket URL and connect
      setConnectionState(ConnectionState.CONNECTING);
      const socketUrl = buildWebSocketUrl();

      // For direct connection, use token subprotocol
      const protocols = config.useBackend ? [] : ['token', config.apiKey];
      const socket = new WebSocket(socketUrl, protocols);
      socketRef.current = socket;

      // 3. Handle WebSocket events
      socket.onopen = () => {
        setConnectionState(ConnectionState.CONNECTED);

        try {
          // Use AudioContext to get raw PCM data at 48kHz for better Thai quality
          const audioContext = new AudioContext({ sampleRate: 48000 });
          const source = audioContext.createMediaStreamSource(stream);
          const processor = audioContext.createScriptProcessor(2048, 1, 1);

          // VAD is started by App.tsx
          // Only set isStreamingRef if VAD is disabled
          if (!config.vadConfig?.enabled) {
            isStreamingRef.current = true;
            console.log('🎯 [Deepgram] VAD disabled, streaming all audio');
          } else {
            // VAD controls isStreamingRef via callbacks
            console.log('🎯 [Deepgram] Using shared VAD, current isStreaming:', isStreamingRef.current);
          }

          processor.onaudioprocess = (e) => {
            // Only send audio if:
            // 1. Socket is open AND
            // 2. VAD is disabled OR VAD detected speech
            const shouldSend = socket.readyState === WebSocket.OPEN &&
              (!config.vadConfig?.enabled || isStreamingRef.current);

            if (shouldSend) {
              const inputData = e.inputBuffer.getChannelData(0);
              // Convert Float32 to Int16 (linear16)
              const int16Data = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                const s = Math.max(-1, Math.min(1, inputData[i]));
                int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
              }
              socket.send(int16Data.buffer);
            }
          };

          source.connect(processor);
          processor.connect(audioContext.destination);

          // Store for cleanup
          (mediaRecorderRef as any).current = { audioContext, processor, source };
        } catch (e: any) {
          setError(`Audio setup error: ${e.message}`);
          stopStreaming();
        }
      };

      socket.onmessage = handleSocketMessage;

      socket.onclose = (event) => {
        // 1000 = normal closure, 1005 = no status
        if (event.code !== 1000 && event.code !== 1005) {
          console.warn('WebSocket closed abnormally:', event.code, event.reason);

          // Set appropriate error message
          const errorMessages: Record<number, string> = {
            1002: 'Protocol Error (1002). Check API usage.',
            1006: 'Connection failed (1006). Check API Key or Network.',
          };
          setError(errorMessages[event.code] || `Disconnected: Code ${event.code}`);
        }

        stopStreaming();
      };

      socket.onerror = () => {
        setConnectionState(ConnectionState.ERROR);
        setError('Connection error. Check API Key validity or network.');
      };

    } catch (err: any) {
      setError(err.message || 'Microphone access denied or error occurred.');
      setConnectionState(ConnectionState.ERROR);
      stopStreaming();
    }
  }, [config, handleSocketMessage, buildWebSocketUrl, stopStreaming, vad]);

  /**
   * Clear all transcripts
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