import React, { useState, useCallback, useEffect } from 'react';
import { Settings, Eye, Wrench, Mic2, Radio } from 'lucide-react';
import { useLiveKit } from './hooks/useLiveKit';
import { useGoogle } from './hooks/useGoogle';
import { useAzure } from './hooks/useAzure';
import { useAudioDevices } from './hooks/useAudioDevices';
import SettingsModal from './components/SettingsModal';
import LiveKitPanel from './components/LiveKitPanel';
import TranscriptPanel from './components/TranscriptPanel';
import RecordButton from './components/RecordButton';
import ViewerPage from './components/ViewerPage';
import AdminPage from './components/AdminPage';
import { AppConfig, ConnectionState } from './types';
import { STORAGE_KEYS, DEFAULT_CONFIG } from './lib/constants';
import { safeJsonParse } from './lib/utils';

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
  const parsedConfig = saved ? safeJsonParse<AppConfig>(saved, DEFAULT_CONFIG) : DEFAULT_CONFIG;

  return {
    ...parsedConfig,
    backendUrl: import.meta.env.VITE_BACKEND_URL || parsedConfig.backendUrl,
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
    tokenEndpoint: `${config.backendUrl.replace('ws://', 'http://').replace('wss://', 'https://')}/livekit/token`,
    roomName: livekitRoomName,
    autoConnect: false,
  });

  // Google Cloud Speech-to-Text hook (original provider)
  const googleHook = useGoogle(config);

  // Azure Speech Services hook (original provider)
  const azureHook = useAzure(config);

  // Handlers
  const handleConfigSave = useCallback((newConfig: AppConfig) => {
    setConfig(newConfig);
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(newConfig));
  }, []);

  const handleAudioDeviceChange = useCallback((deviceId: string) => {
    const newConfig = { ...config, audioDeviceId: deviceId };
    setConfig(newConfig);
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(newConfig));
  }, [config]);

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

  const isAnyConnected = livekitHook.connectionState === ConnectionState.CONNECTED ||
    googleHook.connectionState === ConnectionState.CONNECTED ||
    azureHook.connectionState === ConnectionState.CONNECTED;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="border-b border-slate-700/50 backdrop-blur-sm bg-slate-900/50 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="bg-gradient-to-r from-purple-500 to-pink-500 text-white p-2.5 rounded-xl shadow-lg">
              <Radio size={20} />
            </span>
            <div>
              <h1 className="text-xl font-bold text-white">Thai Transcription</h1>
              <p className="text-xs text-slate-400">LiveKit vs Traditional ASR Comparison</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Navigation Buttons */}
            <button
              onClick={openViewerTab}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-lg border border-emerald-500/30 transition"
              title="Open Viewer"
            >
              <Eye size={16} />
              <span className="hidden sm:inline">Viewer</span>
            </button>

            <button
              onClick={openAdminTab}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-orange-400 hover:text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 rounded-lg border border-orange-500/30 transition"
              title="Open Admin"
            >
              <Wrench size={16} />
              <span className="hidden sm:inline">Admin</span>
            </button>

            {/* Audio Device Selector + LiveKit Record Button */}
            <div className="flex items-center gap-2">
              {audioDevices.length > 1 && (
                <div className="hidden md:flex items-center gap-2 bg-slate-800/50 rounded-lg px-3 py-2 border border-slate-700/50">
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

              {/* Record Button for LiveKit (WebRTC) */}
              <RecordButton
                isConnected={livekitHook.connectionState === ConnectionState.CONNECTED}
                isConnecting={livekitHook.connectionState === ConnectionState.CONNECTING}
                onClick={livekitHook.connectionState === ConnectionState.CONNECTED ? livekitHook.disconnect : livekitHook.connect}
                size="sm"
              />
            </div>

            <button
              onClick={handleOpenSettings}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
              title="Settings"
            >
              <Settings size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {/* Stacked Layout */}
        <div className="space-y-8">
          {/* Top: LiveKit Panel */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-1 bg-purple-500/20 text-purple-400 text-xs font-semibold rounded-full border border-purple-500/30">
                WebRTC
              </span>
              <h2 className="text-lg font-semibold text-white">LiveKit Streaming</h2>
            </div>
            <LiveKitPanel
              transcripts={livekitHook.transcripts}
              interimTranscript={livekitHook.interimTranscript}
              connectionState={livekitHook.connectionState}
              isAgentConnected={livekitHook.isAgentConnected}
              agentName={livekitHook.agentIdentity}
              participantCount={livekitHook.participants.length + 1}
              error={livekitHook.error}
              roomName={livekitRoomName}
              onRoomNameChange={setLivekitRoomName}
              onConnect={livekitHook.connect}
              onDisconnect={livekitHook.disconnect}
              onClear={livekitHook.clearTranscripts}
              roomPlaceholder="Enter room name..."
            />
          </div>

          {/* Bottom: Traditional ASR (Google + Azure) */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs font-semibold rounded-full border border-blue-500/30">
                WebSocket
              </span>
              <h2 className="text-lg font-semibold text-white">Traditional ASR</h2>
            </div>

            {/* Google + Azure side by side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Google Panel */}
              <div className="relative">
                <div className="absolute -top-1 left-4 px-2 py-0.5 bg-slate-800 text-xs font-medium text-blue-400 rounded z-10">
                  Google Cloud STT
                </div>
                <TranscriptPanel
                  transcripts={googleHook.transcripts}
                  interimTranscript={googleHook.interimTranscript}
                  onClear={googleHook.clearTranscripts}
                  connectionState={googleHook.connectionState}
                  onStart={googleHook.startStreaming}
                  onStop={googleHook.stopStreaming}
                  microphoneActive={true}
                />
              </div>

              {/* Azure Panel */}
              <div className="relative">
                <div className="absolute -top-1 left-4 px-2 py-0.5 bg-slate-800 text-xs font-medium text-cyan-400 rounded z-10">
                  Azure Speech
                </div>
                <TranscriptPanel
                  transcripts={azureHook.transcripts}
                  interimTranscript={azureHook.interimTranscript}
                  onClear={azureHook.clearTranscripts}
                  connectionState={azureHook.connectionState}
                  onStart={azureHook.startStreaming}
                  onStop={azureHook.stopStreaming}
                  microphoneActive={true}
                />
              </div>
            </div>
          </div>
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
