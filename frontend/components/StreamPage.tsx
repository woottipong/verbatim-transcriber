import React, { useCallback, useEffect, useState } from 'react';
import { Mic2, MonitorUp, Radio } from 'lucide-react';
import { useAudioDevices } from '../hooks/useAudioDevices';
import { useLiveKit } from '../hooks/useLiveKit';
import LiveKitPanel from './LiveKitPanel';
import MicrophoneInputStrip from './MicrophoneInputStrip';
import { AppConfig, AudioSource, ConnectionState } from '../types';
import { toHttpUrl } from '../lib/runtime';
import { buildStreamUrl } from '../lib/appRoutes';
import { AUDIO_SOURCE_LABELS } from '../lib/audioSources';

interface StreamPageProps {
  config: AppConfig;
  initialRoomName: string;
  onConfigSave: (config: AppConfig) => void;
}

export default function StreamPage({ config, initialRoomName, onConfigSave }: StreamPageProps) {
  const [livekitRoomName, setLivekitRoomName] = useState(initialRoomName);
  const [audioSource, setAudioSource] = useState<AudioSource>('microphone');
  const { devices: audioDevices } = useAudioDevices();
  const livekitHook = useLiveKit({
    serverUrl: import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880',
    tokenEndpoint: `${toHttpUrl(config.backendUrl)}/livekit/token`,
    roomName: livekitRoomName,
    audioDeviceId: config.audioDeviceId,
    audioSource,
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

  const canChangeAudioSource = livekitHook.connectionState === ConnectionState.DISCONNECTED;

  return (
    <div className="app-shell">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-teal-700 focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-white focus:outline-none">
        Skip to content
      </a>
      <header className="app-header">
        <div className="app-header__content stream-navbar mx-auto max-w-7xl px-4 py-3 sm:px-6">
          <div className="stream-navbar__brand flex min-w-0 items-center gap-3">
            <img src="/captionlive-mark.svg" alt="" className="h-10 w-10 shrink-0 rounded-lg" aria-hidden="true" />
            <div className="min-w-0">
              <h1 className="flex min-w-0 items-center gap-2 truncate text-lg font-semibold tracking-tight text-slate-50 sm:text-xl">
                <span className="shrink-0 text-teal-200">CaptionLive</span>
                <span className="h-4 w-px shrink-0 bg-slate-700" aria-hidden="true" />
                <span className="truncate">Audio Source</span>
              </h1>
              <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-slate-400">
                <span className="truncate" aria-label={livekitRoomName ? `Room ${livekitRoomName}` : 'Room ID is missing'}>
                  Room <strong className="font-semibold text-slate-200">{livekitRoomName || 'Required'}</strong>
                </span>
                {livekitRoomName && livekitHook.connectionState === ConnectionState.DISCONNECTED && (
                  <>
                    <span className="text-slate-700" aria-hidden="true">·</span>
                    <button
                      onClick={() => {
                        setLivekitRoomName('');
                        const nextUrl = buildStreamUrl(window.location.origin + window.location.pathname, '');
                        window.location.hash = new URL(nextUrl).hash;
                      }}
                      className="stream-navbar__inline-action inline-flex items-center px-1 text-xs font-medium text-teal-300 underline hover:text-teal-200"
                      aria-label="Change room"
                    >
                      Change
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <MicrophoneInputStrip
            mediaStream={livekitHook.mediaStream}
            audioSource={audioSource}
            sourceLabel={livekitHook.audioSourceLabel}
            isAudioInputEnabled={livekitHook.isAudioInputEnabled}
            isAudioInputStopped={livekitHook.isAudioInputStopped}
            connectionState={livekitHook.connectionState}
            variant="navbar"
            showIdentity={false}
          />

          <div className="stream-navbar__controls flex items-center gap-1.5 sm:gap-2">
            {audioSource === 'microphone' && audioDevices.length > 1 && (
              <div className="hidden h-11 items-center gap-2 rounded-lg border border-slate-700/70 bg-slate-800/70 px-2.5 lg:flex">
                <Mic2 size={14} className="text-slate-400" />
                <select
                  value={config.audioDeviceId || 'default'}
                  onChange={event => handleAudioDeviceChange(event.target.value)}
                  disabled={!canChangeAudioSource}
                  className="max-w-[120px] cursor-pointer truncate bg-transparent text-sm font-medium text-slate-200 focus:outline-none disabled:opacity-50"
                  aria-label="Input Device"
                >
                  <option value="default" className="bg-slate-800">System Default</option>
                  {audioDevices.map(device => <option key={device.deviceId} value={device.deviceId} className="bg-slate-800">{device.label}</option>)}
                </select>
              </div>
            )}

            <div className="flex shrink-0 items-center rounded-lg border border-slate-700 bg-slate-950/45" role="group" aria-label="Audio source">
              {(['microphone', 'chrome-tab'] as const).map(source => {
                const SourceIcon = source === 'chrome-tab' ? MonitorUp : Mic2;
                const isSelected = audioSource === source;
                return (
                  <button
                    key={source}
                    type="button"
                    onClick={() => setAudioSource(source)}
                    disabled={!canChangeAudioSource}
                    aria-pressed={isSelected}
                    aria-label={AUDIO_SOURCE_LABELS[source]}
                    className={`flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 disabled:cursor-not-allowed disabled:opacity-60 ${isSelected
                      ? 'bg-teal-700 text-white'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                    }`}
                  >
                    <SourceIcon size={14} aria-hidden="true" />
                    <span className={source === 'chrome-tab' ? 'hidden xl:inline' : 'hidden sm:inline'}>{AUDIO_SOURCE_LABELS[source]}</span>
                  </button>
                );
              })}
            </div>

          </div>
        </div>
      </header>

      <main id="main-content" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {!livekitRoomName ? (
          <div className="mx-auto max-w-md app-panel p-6 text-center my-8">
            <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-teal-400/10 text-teal-200">
              <Radio size={22} className="animate-pulse" />
            </span>
            <h2 className="text-lg font-semibold text-white">Join Transcription Room</h2>
            <p className="mt-2 text-sm text-slate-400">Enter the room name provided by your administrator to start sending audio.</p>
            <form onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const input = form.elements.namedItem('roomName') as HTMLInputElement;
              if (input?.value.trim()) {
                const room = input.value.trim();
                setLivekitRoomName(room);
                const nextUrl = buildStreamUrl(window.location.origin + window.location.pathname, room);
                window.location.hash = new URL(nextUrl).hash;
              }
            }} className="mt-6 flex flex-col gap-3">
              <input
                name="roomName"
                placeholder="Enter room name..."
                required
                className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 text-sm text-white placeholder:text-slate-500 focus:border-teal-500/70 focus:outline-none"
              />
              <button type="submit" className="control-button control-button--primary h-11 w-full font-medium">
                Continue to Room
              </button>
            </form>
          </div>
        ) : (
          <section aria-label="LiveKit transcription">
              <LiveKitPanel
                transcripts={livekitHook.transcripts}
                interimTranscripts={livekitHook.interimTranscripts}
                connectionState={livekitHook.connectionState}
                isAgentConnected={livekitHook.isAgentConnected}
                agentIdentity={livekitHook.agentIdentity}
                audioSource={audioSource}
                isAudioInputEnabled={livekitHook.isAudioInputEnabled}
                isAudioInputStopped={livekitHook.isAudioInputStopped}
                participantCount={livekitHook.participants.length + 1}
                error={livekitHook.error}
                roomName={livekitRoomName}
                onConnect={livekitHook.connect}
                onDisconnect={livekitHook.disconnect}
                onToggleAudioInput={livekitHook.toggleAudioInput}
                onClear={livekitHook.clearTranscripts}
              />
          </section>
        )}
      </main>

    </div>
  );
}
