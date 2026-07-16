import { useEffect, useState } from 'react';
import {
  InputSignalState,
  calculateRms,
  createInputSignalMonitor,
  smoothWaveformBars,
  toFrequencyBars,
} from '../lib/audioSignal';

const BAR_COUNT = 64;
const FRAME_INTERVAL_MS = 1000 / 18;
const EMPTY_BARS = new Array<number>(BAR_COUNT).fill(0);

export interface AudioVisualizerState {
  bars: number[];
  level: number;
  signalState: InputSignalState;
  error: string | null;
}

const INITIAL_STATE: AudioVisualizerState = {
  bars: EMPTY_BARS,
  level: 0,
  signalState: 'listening',
  error: null,
};

export function useAudioVisualizer(
  mediaStream: MediaStream | null,
  isListening: boolean,
): AudioVisualizerState {
  const [visualizerState, setVisualizerState] = useState<AudioVisualizerState>(INITIAL_STATE);

  useEffect(() => {
    if (!mediaStream || !isListening) {
      setVisualizerState(INITIAL_STATE);
      return;
    }

    let cancelled = false;
    let animationFrame: number | null = null;
    let lastFrameAt = 0;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let audioContext: AudioContext | null = null;
    let smoothedBars = EMPTY_BARS;

    const monitor = createInputSignalMonitor();

    try {
      const AudioContextConstructor = window.AudioContext;
      audioContext = new AudioContextConstructor();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.88;

      source = audioContext.createMediaStreamSource(mediaStream);
      source.connect(analyser);

      const timeSamples = new Uint8Array(analyser.fftSize);
      // Speech energy is concentrated in the lower frequencies. Ignoring the
      // mostly-empty upper range gives every bar useful visual resolution.
      const frequencySamples = new Uint8Array(
        Math.max(BAR_COUNT, Math.floor(analyser.frequencyBinCount / 3)),
      );
      const draw = (timestamp: number) => {
        if (cancelled || !analyser) return;

        if (timestamp - lastFrameAt >= FRAME_INTERVAL_MS) {
          analyser.getByteTimeDomainData(timeSamples);
          analyser.getByteFrequencyData(frequencySamples);
          const level = calculateRms(timeSamples);
          smoothedBars = smoothWaveformBars(
            smoothedBars,
            toFrequencyBars(frequencySamples, BAR_COUNT),
          );
          setVisualizerState({
            bars: smoothedBars,
            level,
            signalState: monitor.update(level, timestamp),
            error: null,
          });
          lastFrameAt = timestamp;
        }

        animationFrame = requestAnimationFrame(draw);
      };

      animationFrame = requestAnimationFrame(draw);
    } catch (error) {
      setVisualizerState({
        ...INITIAL_STATE,
        error: error instanceof Error ? error.message : 'Unable to monitor microphone input',
      });
    }

    return () => {
      cancelled = true;
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      source?.disconnect();
      analyser?.disconnect();
      if (audioContext && audioContext.state !== 'closed') {
        void audioContext.close();
      }
    };
  }, [isListening, mediaStream]);

  return visualizerState;
}
