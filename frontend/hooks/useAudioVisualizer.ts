import { useEffect, useRef, useState } from 'react';

export const useAudioVisualizer = (mediaStream: MediaStream | null, isListening: boolean) => {
  const [audioData, setAudioData] = useState<number[]>(new Array(20).fill(0));
  const animationRef = useRef<number | undefined>(undefined);
  const audioContextRef = useRef<AudioContext | undefined>(undefined);
  const analyserRef = useRef<AnalyserNode | undefined>(undefined);
  const sourceRef = useRef<MediaStreamAudioSourceNode | undefined>(undefined);

  useEffect(() => {
    const cleanupAudio = () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = undefined;
      }
      
      if (audioContextRef.current) {
        // Only call close if the context is not already closed
        if (audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close().catch(e => console.warn("Error closing AudioContext:", e));
        }
        audioContextRef.current = undefined;
      }
      
      analyserRef.current = undefined;
      sourceRef.current = undefined;
    };

    if (!mediaStream || !isListening) {
      cleanupAudio();
      setAudioData(new Array(20).fill(0));
      return;
    }

    const initAudio = async () => {
      // Ensure any previous instance is cleaned up
      cleanupAudio();

      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioContext = new AudioContextClass();
        audioContextRef.current = audioContext;

        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 64; // Low resolution for simple visualizer
        analyser.smoothingTimeConstant = 0.8;
        analyserRef.current = analyser;

        const source = audioContext.createMediaStreamSource(mediaStream);
        source.connect(analyser);
        sourceRef.current = source;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
          if (!analyserRef.current) return;
          
          analyserRef.current.getByteFrequencyData(dataArray);
          
          // Normalize and pick a subset for the visualizer
          const bars = [];
          const step = Math.floor(bufferLength / 20); 
          for (let i = 0; i < 20; i++) {
            const val = dataArray[i * step];
            bars.push(val / 255); // Normalize 0-1
          }
          
          setAudioData(bars);
          animationRef.current = requestAnimationFrame(draw);
        };

        draw();
      } catch (err) {
        console.error("Audio visualizer initialization failed:", err);
      }
    };

    initAudio();

    return cleanupAudio;
  }, [mediaStream, isListening]);

  return audioData;
};