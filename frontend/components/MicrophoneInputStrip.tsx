import React from 'react';
import { AudioLines, CircleAlert, Mic, MicOff } from 'lucide-react';
import { useAudioVisualizer } from '../hooks/useAudioVisualizer';
import Visualizer from './Visualizer';

interface MicrophoneInputStripProps {
  mediaStream: MediaStream | null;
  sourceLabel: string | null;
}

const MicrophoneInputStrip: React.FC<MicrophoneInputStripProps> = ({
  mediaStream,
  sourceLabel,
}) => {
  const isListening = mediaStream !== null;
  const { bars, signalState, error } = useAudioVisualizer(mediaStream, isListening);

  const status = error
    ? { label: 'Microphone error', tone: 'error', icon: CircleAlert }
    : !isListening
      ? { label: 'Mic off', tone: 'off', icon: MicOff }
      : signalState === 'active'
        ? { label: 'Audio detected', tone: 'active', icon: AudioLines }
        : signalState === 'low'
          ? { label: 'Input too low', tone: 'warning', icon: CircleAlert }
          : { label: 'Listening', tone: 'listening', icon: Mic };
  const StatusIcon = status.icon;

  return (
    <section className="microphone-strip" aria-labelledby="microphone-input-heading">
      <div className="microphone-strip__identity">
        <span className="microphone-strip__icon" aria-hidden="true">
          <Mic size={18} />
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 id="microphone-input-heading" className="truncate text-sm font-semibold text-slate-100">
              Microphone input
            </h2>
            {sourceLabel && <span className="microphone-strip__source">{sourceLabel}</span>}
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            {isListening ? 'Live microphone level' : 'Starts automatically when you join a room'}
          </p>
        </div>
      </div>

      <Visualizer
        bars={bars}
        isActive={signalState === 'active' && isListening && !error}
        isListening={isListening && !error}
      />

      <div
        className={`microphone-strip__status microphone-strip__status--${status.tone}`}
        role="status"
        aria-live="polite"
      >
        <StatusIcon size={15} aria-hidden="true" />
        <span>{status.label}</span>
      </div>
    </section>
  );
};

export default MicrophoneInputStrip;
