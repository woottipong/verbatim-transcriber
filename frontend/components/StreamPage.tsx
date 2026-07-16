import React, { useCallback, useEffect, useState } from 'react';
import { Hash, Mic2, Radio, Settings } from 'lucide-react';
import { useAudioDevices } from '../hooks/useAudioDevices';
import { useLiveKit } from '../hooks/useLiveKit';
import SettingsModal from './SettingsModal';
import LiveKitPanel from './LiveKitPanel';
import MicrophoneInputStrip from './MicrophoneInputStrip';
import { AppConfig, ConnectionState } from '../types';
import { toHttpUrl } from '../lib/runtime';

interface StreamPageProps {
  config: AppConfig;
  initialRoomName: string;
  onConfigSave: (config: AppConfig) => void;
}

export default function StreamPage({ config, initialRoomName, onConfigSave }: StreamPageProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [livekitRoomName, setLivekitRoomName] = useState(initialRoomName);
  const { devices: audioDevices } = useAudioDevices();
  const livekitHook = useLiveKit({
    serverUrl: import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880',
    tokenEndpoint: `${toHttpUrl(config.backendUrl)}/livekit/token`,
    roomName: livekitRoomName,
    audioDeviceId: config.audioDeviceId,
    autoConnect: false,
  });

  useEffect(() => {
    if (livekitHook.connectionState === ConnectionState.DISCONNECTED) {
      setLivekitRoomName(initialRoomName);
    }
  }, [initialRoomName, livekitHook.connectionState]);

  const handleAudioDeviceChange = useCallback((deviceId: string) => {
    onConfigSave({ ...config, audioDeviceId: deviceId });
  }, [config, onConfigSave]);

  const isAnyConnected = livekitHook.connectionState === ConnectionState.CONNECTED;
  const microphoneSource = livekitHook.mediaStream
    ? { mediaStream: livekitHook.mediaStream, label: 'LiveKit', isMicrophoneEnabled: livekitHook.isMicrophoneEnabled }
    : { mediaStream: null, label: null, isMicrophoneEnabled: false };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="stream-navbar mx-auto max-w-7xl px-4 py-3 sm:px-6">
          <div className="stream-navbar__brand flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-violet-400/45 bg-violet-500/20 text-violet-200">
              <Radio size={19} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-tight text-slate-50 sm:text-xl">Stream publisher</h1>
              <p className="truncate text-xs text-slate-400">Join a prepared room to start transcription</p>
            </div>
          </div>

          <div className="stream-room-nav" aria-label={livekitRoomName ? `Room ${livekitRoomName}` : 'Room link is missing'}>
            <span className="stream-room-nav__icon" aria-hidden="true">
              <Hash size={16} />
            </span>
            <div className="min-w-0">
              <code title={livekitRoomName || 'Room link is missing'}>{livekitRoomName || 'Room link required'}</code>
            </div>
          </div>

          <MicrophoneInputStrip
            mediaStream={microphoneSource.mediaStream}
            sourceLabel={microphoneSource.label}
            isMicrophoneEnabled={microphoneSource.isMicrophoneEnabled}
            connectionState={livekitHook.connectionState}
            variant="navbar"
            showIdentity={false}
          />

          <div className="stream-navbar__controls flex items-center gap-1.5 sm:gap-2">
            {audioDevices.length > 1 && (
              <div className="hidden items-center gap-2 rounded-lg border border-slate-700/70 bg-slate-800/70 px-2.5 py-2 lg:flex">
                <Mic2 size={14} className="text-slate-400" />
                <select
                  value={config.audioDeviceId || 'default'}
                  onChange={event => handleAudioDeviceChange(event.target.value)}
                  disabled={isAnyConnected}
                  className="max-w-[120px] cursor-pointer truncate bg-transparent text-sm font-medium text-slate-200 focus:outline-none disabled:opacity-50"
                  aria-label="Microphone input"
                >
                  <option value="default" className="bg-slate-800">Default</option>
                  {audioDevices.map(device => <option key={device.deviceId} value={device.deviceId} className="bg-slate-800">{device.label}</option>)}
                </select>
              </div>
            )}

            <button onClick={() => setIsSettingsOpen(true)} className="control-button control-button--quiet !min-h-10 !px-2.5" title="Settings" aria-label="Open settings">
              <Settings size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <section aria-label="LiveKit transcription">
            <LiveKitPanel
              transcripts={livekitHook.transcripts}
              interimTranscripts={livekitHook.interimTranscripts}
              connectionState={livekitHook.connectionState}
              isAgentConnected={livekitHook.isAgentConnected}
              isMicrophoneEnabled={livekitHook.isMicrophoneEnabled}
              participantCount={livekitHook.participants.length + 1}
              error={livekitHook.error}
              roomName={livekitRoomName}
              onConnect={livekitHook.connect}
              onDisconnect={livekitHook.disconnect}
              onToggleMicrophone={livekitHook.toggleMicrophone}
              onClear={livekitHook.clearTranscripts}
            />
        </section>
      </main>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={config}
        onSave={onConfigSave}
      />
    </div>
  );
}
