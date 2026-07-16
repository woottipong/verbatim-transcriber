import React from 'react';

interface VisualizerProps {
  bars: number[];
  isActive: boolean;
  isListening: boolean;
}

const Visualizer: React.FC<VisualizerProps> = ({ bars, isActive, isListening }) => (
  <div
    className={`audio-waveform${isListening ? ' audio-waveform--listening' : ''}`}
    role="img"
    aria-label={isListening ? 'Live microphone input level' : 'Microphone input is off'}
  >
    <span className="audio-waveform__axis" aria-hidden="true" />
    {bars.map((value, index) => (
      <span
        // The positions are stable and have no semantic identity.
        key={index}
        className={`audio-waveform__bar${isActive ? ' audio-waveform__bar--active' : ''}`}
        style={{ transform: `scaleY(${isListening ? Math.max(0.12, value) : 0})` }}
        aria-hidden="true"
      />
    ))}
  </div>
);

export default Visualizer;
