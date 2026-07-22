import React from 'react';
import { AudioLines, CircleAlert, Mic, MicOff, MonitorUp, VolumeX } from 'lucide-react';
import { useAudioVisualizer } from '../hooks/useAudioVisualizer';
import { AudioSource, ConnectionState } from '../types';
import { AUDIO_SOURCE_LABELS } from '../lib/audioSources';
import Visualizer from './Visualizer';

interface MicrophoneInputStripProps {
  mediaStream: MediaStream | null;
  audioSource: AudioSource;
  sourceLabel: string | null;
  isAudioInputEnabled: boolean;
  isAudioInputStopped: boolean;
  connectionState: ConnectionState;
  variant?: 'default' | 'navbar';
  showIdentity?: boolean;
}

const MicrophoneInputStrip: React.FC<MicrophoneInputStripProps> = ({
  mediaStream,
  audioSource,
  sourceLabel,
  isAudioInputEnabled,
  isAudioInputStopped,
  connectionState,
  variant = 'default',
  showIdentity = true,
}) => {
  const isListening = mediaStream !== null && isAudioInputEnabled && !isAudioInputStopped;
  const isConnecting = connectionState === ConnectionState.CONNECTING;
  const isConnected = connectionState === ConnectionState.CONNECTED;
  const { bars, signalState, error } = useAudioVisualizer(mediaStream, isListening);
  const SourceIcon = audioSource === 'chrome-tab' ? MonitorUp : Mic;
  const InactiveIcon = audioSource === 'chrome-tab' ? VolumeX : MicOff;
  const displaySourceLabel = sourceLabel || AUDIO_SOURCE_LABELS[audioSource];

  const status = error
    ? { label: 'Audio Error', tone: 'error', icon: CircleAlert }
    : isAudioInputStopped
      ? { label: 'Tab Audio Stopped', tone: 'warning', icon: CircleAlert }
    : isConnecting
      ? { label: audioSource === 'chrome-tab' ? 'Choose a Tab...' : 'Starting Mic...', tone: 'listening', icon: SourceIcon }
    : !isListening
      ? { label: isConnected ? 'Muted' : 'Ready', tone: 'off', icon: InactiveIcon }
      : signalState === 'active'
        ? { label: 'Audio Detected', tone: 'active', icon: AudioLines }
        : signalState === 'low'
          ? { label: 'Input too quiet', tone: 'warning', icon: CircleAlert }
          : { label: 'Active', tone: 'listening', icon: SourceIcon };
  const StatusIcon = status.icon;

  return (
    <section className={`microphone-strip microphone-strip--${variant} ${showIdentity ? '' : 'microphone-strip--compact'}`} aria-labelledby={showIdentity ? 'audio-input-heading' : undefined} aria-label={showIdentity ? undefined : 'Audio input waveform and status'}>
      {showIdentity && (
        <div className="microphone-strip__identity">
          <span className="microphone-strip__icon" aria-hidden="true">
            <SourceIcon size={18} />
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h2 id="audio-input-heading" className="truncate text-sm font-semibold text-slate-100">
                Audio Input Status
              </h2>
              <span className="microphone-strip__source">{displaySourceLabel}</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              {isListening
                ? 'Live Level'
                : isConnecting
                  ? audioSource === 'chrome-tab'
                    ? 'Select a tab and enable Share tab audio'
                    : 'Allow microphone access to start'
                  : 'Starts when you connect'}
            </p>
          </div>
        </div>
      )}

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
