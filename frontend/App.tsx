import React, { useState, useCallback, useEffect } from 'react';
import { Settings, Eye, Wrench, Mic2, Radio } from 'lucide-react';
import { useLiveKit } from './hooks/useLiveKit';
import { useAudioDevices } from './hooks/useAudioDevices';
import SettingsModal from './components/SettingsModal';
import LiveKitPanel from './components/LiveKitPanel';
import ViewerPage from './components/ViewerPage';
import AdminPage from './components/AdminPage';
import MicrophoneInputStrip from './components/MicrophoneInputStrip';
import { AppConfig, ConnectionState } from './types';
import { STORAGE_KEYS, DEFAULT_CONFIG } from './lib/constants';
import { safeJsonParse } from './lib/utils';
import { normalizeAppConfig, toHttpUrl } from './lib/runtime';

// Page types for routing
type PageType = 'main' | 'viewer' | 'admin';

// Check URL hash to determine initial page
const getInitialPage = (): PageType => {
  const hash = window.location.hash;
  if (hash === '#viewer') return 'viewer';
  if (hash === '#admin') return 'admin';
  return 'main';
};

// Load initial config from localStorage or use defaults
const getInitialConfig = (): AppConfig => {
  const saved = localStorage.getItem(STORAGE_KEYS.CONFIG);
  const parsedConfig = saved ? safeJsonParse<unknown>(saved, DEFAULT_CONFIG) : DEFAULT_CONFIG;
  const config = normalizeAppConfig(parsedConfig, DEFAULT_CONFIG);

  return {
    ...config,
    backendUrl: import.meta.env.VITE_BACKEND_URL || config.backendUrl,
  };
};

export default function App() {
  const [config, setConfig] = useState<AppConfig>(getInitialConfig);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState<PageType>(getInitialPage);

  // Handle hash change for routing
  useEffect(() => {
    const handleHashChange = () => {
      setCurrentPage(getInitialPage());
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Get available audio devices
  const { devices: audioDevices } = useAudioDevices();

  // LiveKit room name state
  const [livekitRoomName, setLivekitRoomName] = useState('');

  // LiveKit WebRTC hook for ultra-low latency transcription
  const livekitHook = useLiveKit({
    serverUrl: import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880',
    tokenEndpoint: `${toHttpUrl(config.backendUrl)}/livekit/token`,
    roomName: livekitRoomName,
    autoConnect: false,
  });

  // Handlers
  const handleConfigSave = useCallback((newConfig: AppConfig) => {
    setConfig(newConfig);
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(newConfig));
  }, []);

  const handleAudioDeviceChange = useCallback((deviceId: string) => {
    setConfig(currentConfig => {
      const newConfig = { ...currentConfig, audioDeviceId: deviceId };
      localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(newConfig));
      return newConfig;
    });
  }, []);

  const handleOpenSettings = useCallback(() => setIsSettingsOpen(true), []);
  const handleCloseSettings = useCallback(() => setIsSettingsOpen(false), []);

  // Open viewer in new tab
  const openViewerTab = useCallback(() => {
    window.open(`${window.location.origin}${window.location.pathname}#viewer`, '_blank');
  }, []);

  // Open admin in new tab
  const openAdminTab = useCallback(() => {
    window.open(`${window.location.origin}${window.location.pathname}#admin`, '_blank');
  }, []);

  // Render Viewer Page
  if (currentPage === 'viewer') {
    return (
      <ViewerPage
        onBack={() => window.close()}
        backendUrl={config.backendUrl}
      />
    );
  }

  // Render Admin Page
  if (currentPage === 'admin') {
    return (
      <AdminPage
        onBack={() => window.close()}
        backendUrl={config.backendUrl}
      />
    );
  }

  const isAnyConnected = livekitHook.connectionState === ConnectionState.CONNECTED;

  const microphoneSource = livekitHook.mediaStream && livekitHook.isMicrophoneEnabled
    ? { mediaStream: livekitHook.mediaStream, label: 'LiveKit', isMicrophoneEnabled: true }
    : livekitHook.mediaStream
      ? { mediaStream: livekitHook.mediaStream, label: 'LiveKit', isMicrophoneEnabled: false }
      : { mediaStream: null, label: null, isMicrophoneEnabled: false };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-violet-400/45 bg-violet-500/20 text-violet-200">
              <Radio size={19} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-tight text-slate-50 sm:text-xl">Thai Transcription</h1>
              <p className="truncate text-xs text-slate-400">Live transcription workspace</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              onClick={openViewerTab}
              className="control-button control-button--quiet !hidden sm:!inline-flex"
              title="Open Viewer"
            >
              <Eye size={16} />
              Viewer
            </button>

            <button
              onClick={openAdminTab}
              className="control-button control-button--quiet !hidden md:!inline-flex"
              title="Open Admin"
            >
              <Wrench size={16} />
              Admin
            </button>

            {audioDevices.length > 1 && (
              <div className="hidden lg:flex items-center gap-2 rounded-lg border border-slate-700/70 bg-slate-800/70 px-2.5 py-2">
                <Mic2 size={14} className="text-slate-400" />
                <select
                  value={config.audioDeviceId || 'default'}
                  onChange={(e) => handleAudioDeviceChange(e.target.value)}
                  disabled={isAnyConnected}
                  className="bg-transparent text-sm text-slate-200 font-medium focus:outline-none cursor-pointer disabled:opacity-50 max-w-[120px] truncate"
                >
                  <option value="default" className="bg-slate-800">Default</option>
                  {audioDevices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId} className="bg-slate-800">
                      {device.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              onClick={handleOpenSettings}
              className="control-button control-button--quiet !min-h-10 !px-2.5"
              title="Settings"
              aria-label="Open settings"
            >
              <Settings size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="space-y-8">
          <MicrophoneInputStrip
            mediaStream={microphoneSource.mediaStream}
            sourceLabel={microphoneSource.label}
            isMicrophoneEnabled={microphoneSource.isMicrophoneEnabled}
          />

          <section className="space-y-3" aria-labelledby="livekit-heading">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-300">WebRTC stream</p>
                <h2 id="livekit-heading" className="mt-1 text-xl font-semibold tracking-tight text-white">LiveKit transcription</h2>
              </div>
              <p className="hidden text-sm text-slate-400 sm:block">Low-latency streaming monitor</p>
            </div>
            <LiveKitPanel
              transcripts={livekitHook.transcripts}
              interimTranscripts={livekitHook.interimTranscripts}
              connectionState={livekitHook.connectionState}
              isAgentConnected={livekitHook.isAgentConnected}
              isMicrophoneEnabled={livekitHook.isMicrophoneEnabled}
              participantCount={livekitHook.participants.length + 1}
              error={livekitHook.error}
              roomName={livekitRoomName}
              onRoomNameChange={setLivekitRoomName}
              onConnect={livekitHook.connect}
              onDisconnect={livekitHook.disconnect}
              onToggleMicrophone={livekitHook.toggleMicrophone}
              onClear={livekitHook.clearTranscripts}
              roomPlaceholder="Enter room name..."
            />
          </section>
        </div>
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={handleCloseSettings}
        config={config}
        onSave={handleConfigSave}
      />
    </div>
  );
}
