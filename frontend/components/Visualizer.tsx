import React from 'react';
import { useAudioVisualizer } from '../hooks/useAudioVisualizer';

interface VisualizerProps {
  mediaStream: MediaStream | null;
  isListening: boolean;
}

const Visualizer: React.FC<VisualizerProps> = ({ mediaStream, isListening }) => {
  const audioData = useAudioVisualizer(mediaStream, isListening);

  return (
    <div className="flex items-center justify-center gap-[2px] h-12 w-full max-w-xs mx-auto">
      {audioData.map((value, index) => (
        <div
          key={index}
          className="w-2 rounded-full transition-all duration-75 ease-in-out bg-indigo-500"
          style={{
            height: `${Math.max(4, value * 100)}%`,
            opacity: isListening ? 0.6 + (value * 0.4) : 0.2
          }}
        />
      ))}
    </div>
  );
};

export default Visualizer;