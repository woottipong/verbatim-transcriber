import React, { useState, useCallback, useRef } from 'react';
import { Settings, Mic2 } from 'lucide-react';
import { useDeepgram } from './hooks/useDeepgram';
import { useGemini } from './hooks/useGemini';
import { useAudioDevices } from './hooks/useAudioDevices';
import { useVAD } from './hooks/useVAD';
import Visualizer from './components/Visualizer';
import SettingsModal from './components/SettingsModal';
import ConnectionBadge from './components/ConnectionBadge';
import RecordButton from './components/RecordButton';
import ErrorBanner from './components/ErrorBanner';
import TranscriptPanel from './components/TranscriptPanel';
import VADInfoBadge from './components/VADInfoBadge';
import { ConnectionState, AppConfig, ASRProvider } from './types';
import { STORAGE_KEYS, DEFAULT_CONFIG, ASR_PROVIDERS } from './lib/constants';
import { safeJsonParse } from './lib/utils';

// Load initial config from localStorage or use defaults
const getInitialConfig = (): AppConfig => {
  const saved = localStorage.getItem(STORAGE_KEYS.CONFIG);
  return saved ? safeJsonParse<AppConfig>(saved, DEFAULT_CONFIG) : DEFAULT_CONFIG;
};

export default function App() {
  const [config, setConfig] = useState<AppConfig>(getInitialConfig);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Shared VAD streaming state (controlled by single VAD instance)
  const isVADStreamingRef = useRef<boolean>(false);
  const [vadIsSpeaking, setVadIsSpeaking] = useState(false);

  // Get available audio devices
  const { devices: audioDevices } = useAudioDevices();

  // Single shared VAD instance for both providers
  const vad = useVAD({
    config: config.vadConfig || { enabled: false, threshold: 0.5 },
    audioDeviceId: config.audioDeviceId,
    onSpeechStart: () => {
      console.log('🎤 [Shared VAD] Speech detected');
      isVADStreamingRef.current = true;
      setVadIsSpeaking(true);
    },
    onSpeechEnd: () => {
      console.log('🔇 [Shared VAD] Speech ended');
      isVADStreamingRef.current = false;
      setVadIsSpeaking(false);
    },
    onVADMisfire: () => {
      console.log('⚠️ [Shared VAD] VAD misfire');
    },
  });

  // Use BOTH hooks simultaneously with shared VAD state
  const deepgramHook = useDeepgram(config, { vad, isVADStreamingRef });
  const geminiHook = useGemini(config, { vad, isVADStreamingRef });

  // VAD status from shared VAD
  const vadStatus = {
    isReady: vad.isReady,
    isSpeaking: vadIsSpeaking,
    isLoading: vad.isLoading,
  };

  // Check if either is connected
  const isConnected =
    deepgramHook.connectionState === ConnectionState.CONNECTED ||
    geminiHook.connectionState === ConnectionState.CONNECTED;
  const isConnecting =
    deepgramHook.connectionState === ConnectionState.CONNECTING ||
    geminiHook.connectionState === ConnectionState.CONNECTING;

  // Handlers
  const handleConfigSave = useCallback((newConfig: AppConfig) => {
    setConfig(newConfig);
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(newConfig));
  }, []);

  const handleProviderChange = useCallback((provider: ASRProvider) => {
    const newConfig = { ...config, provider };
    setConfig(newConfig);
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(newConfig));
  }, [config]);

  const handleAudioDeviceChange = useCallback((deviceId: string) => {
    const newConfig = { ...config, audioDeviceId: deviceId };
    setConfig(newConfig);
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(newConfig));
  }, [config]);

  const handleToggleListening = useCallback(async () => {
    if (isConnected || isConnecting) {
      // Stop both + VAD
      deepgramHook.stopStreaming();
      geminiHook.stopStreaming();
      if (config.vadConfig?.enabled) {
        vad.pause();
        isVADStreamingRef.current = false;
      }
    } else {
      // Check VAD status before starting
      if (config.vadConfig?.enabled) {
        if (vad.isLoading) {
          // VAD still loading - stream all as fallback
          console.log('⏳ [App] VAD still loading, streaming all audio as fallback');
          isVADStreamingRef.current = true;
        } else if (vad.isReady) {
          await vad.start();
          console.log('🎯 [App] Shared VAD started');
          // isVADStreamingRef will be set by VAD callbacks
        } else {
          // VAD enabled but failed to init - still allow streaming
          console.log('⚠️ [App] VAD failed to init, streaming all audio');
          isVADStreamingRef.current = true;
        }
      } else {
        // VAD disabled, stream all audio
        console.log('🎯 [App] VAD disabled, streaming all audio');
        isVADStreamingRef.current = true;
      }
      deepgramHook.startStreaming();
      geminiHook.startStreaming();
    }
  }, [isConnected, isConnecting, deepgramHook, geminiHook, config.vadConfig, vad]);

  const handleOpenSettings = useCallback(() => setIsSettingsOpen(true), []);
  const handleCloseSettings = useCallback(() => setIsSettingsOpen(false), []);

  const handleClearTranscripts = useCallback(() => {
    deepgramHook.clearTranscripts();
    geminiHook.clearTranscripts();
  }, [deepgramHook, geminiHook]);

  // Status message
  const statusMessage = isConnecting
    ? 'Connecting to both providers...'
    : isConnected
      ? 'Listening... (Speak Thai)'
      : vad.isLoading
        ? 'Loading VAD... (tap to start anyway)'
        : 'Tap microphone to start';

  // Show config hint when there's an error and no API key configured
  const showConfigHint = !config.apiKey && !config.useBackend;

  // Use Deepgram's media stream for visualizer
  const mediaStream = deepgramHook.mediaStream || geminiHook.mediaStream;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Compact Header */}
      <header className="border-b border-slate-700/50 backdrop-blur-sm bg-slate-900/50 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white p-2 rounded-lg shadow-lg text-sm font-bold">
              TH
            </span>
            <div>
              <h1 className="text-lg font-bold text-white">Verbatim ASR</h1>
              <p className="text-xs text-slate-400">Real-time Thai Transcription</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Dual ASR Badge */}
            <div className="flex items-center gap-2 bg-slate-800/50 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-slate-700/50">
              <span className="text-xs font-medium text-indigo-400">Deepgram</span>
              <span className="text-slate-600">+</span>
              <span className="text-xs font-medium text-purple-400">Gemini</span>
            </div>

            {/* Audio Input Device Selector */}
            {audioDevices.length > 1 && (
              <div className="flex items-center gap-2 bg-slate-800/50 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-slate-700/50">
                <Mic2 size={14} className="text-slate-400" />
                <select
                  value={config.audioDeviceId || 'default'}
                  onChange={(e) => handleAudioDeviceChange(e.target.value)}
                  disabled={isConnected || isConnecting}
                  className="bg-transparent text-sm text-slate-200 font-medium focus:outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed max-w-[150px] truncate"
                  title="Select Microphone"
                >
                  <option value="default" className="bg-slate-800">Default Mic</option>
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
              className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 rounded-full transition"
              title="Connection Settings"
              aria-label="Open settings"
            >
              <Settings size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* Main 2-Column Layout */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Error Banner */}
        {(deepgramHook.error || geminiHook.error) && (
          <div className="mb-4 space-y-2">
            {deepgramHook.error && (
              <ErrorBanner
                error={`Deepgram: ${deepgramHook.error}`}
                showConfigHint={showConfigHint}
                onConfigClick={handleOpenSettings}
              />
            )}
            {geminiHook.error && (
              <ErrorBanner
                error={`Gemini: ${geminiHook.error}`}
                showConfigHint={showConfigHint}
                onConfigClick={handleOpenSettings}
              />
            )}
          </div>
        )}

        {/* 2-Column Grid: Desktop side-by-side, Mobile stacked */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-180px)]">
          {/* Left: Control Panel */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            {/* Visualizer Card */}
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl shadow-xl border border-slate-700/50 p-6 flex flex-col items-center justify-center">
              {/* Audio Visualizer */}
              <div className="w-full mb-6">
                <Visualizer mediaStream={mediaStream} isListening={isConnected} />
              </div>

              {/* Record Button - Larger */}
              <RecordButton
                isConnected={isConnected}
                isConnecting={isConnecting}
                onClick={handleToggleListening}
              />

              {/* Status Text */}
              <p className="mt-4 text-sm font-medium text-slate-300 text-center">
                {statusMessage}
              </p>

              {/* VAD Status Indicator - Only when ready and enabled */}
              {config.vadConfig?.enabled && isConnected && vadStatus?.isReady && (
                <div className="mt-3 flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full transition-colors ${vadStatus.isSpeaking ? 'bg-green-500' : 'bg-slate-600'}`}></div>
                  <span className="text-xs text-slate-400">
                    {vadStatus.isSpeaking ? 'Speaking' : 'Listening'}
                  </span>
                </div>
              )}
            </div>

            {/* Stats Card */}
            <div className="bg-slate-800/30 backdrop-blur-sm rounded-xl border border-slate-700/30 p-4">
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-slate-400 mb-1">Deepgram</p>
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div>
                      <p className="text-xl font-bold text-indigo-400">{deepgramHook.transcripts.length}</p>
                      <p className="text-xs text-slate-500">Segments</p>
                    </div>
                    <div>
                      <p className="text-xl font-bold text-indigo-300">
                        {deepgramHook.transcripts.reduce((acc, t) => acc + t.text.length, 0)}
                      </p>
                      <p className="text-xs text-slate-500">Chars</p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-700/30 pt-3">
                  <p className="text-xs text-slate-400 mb-1">Gemini</p>
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div>
                      <p className="text-xl font-bold text-purple-400">{geminiHook.transcripts.length}</p>
                      <p className="text-xs text-slate-500">Segments</p>
                    </div>
                    <div>
                      <p className="text-xl font-bold text-purple-300">
                        {geminiHook.transcripts.reduce((acc, t) => acc + t.text.length, 0)}
                      </p>
                      <p className="text-xs text-slate-500">Chars</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* VAD Status Badge - Show current settings */}
            {config.vadConfig?.enabled && (
              <VADInfoBadge
                enabled={config.vadConfig.enabled}
                threshold={config.vadConfig.threshold}
                isReady={vad.isReady}
                isLoading={vad.isLoading}
                isSpeaking={vadIsSpeaking}
              />
            )}
          </div>

          {/* Right: Dual Transcript Panels */}
          <div className="lg:col-span-8 grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Deepgram Panel */}
            <div className="flex flex-col">
              <div className="flex items-center justify-between mb-2 px-1">
                <h3 className="text-sm font-semibold text-indigo-400">Deepgram Nova-2</h3>
                <ConnectionBadge state={deepgramHook.connectionState} />
              </div>
              <TranscriptPanel
                transcripts={deepgramHook.transcripts}
                interimTranscript={deepgramHook.interimTranscript}
                onClear={deepgramHook.clearTranscripts}
              />
            </div>

            {/* Gemini Panel */}
            <div className="flex flex-col">
              <div className="flex items-center justify-between mb-2 px-1">
                <h3 className="text-sm font-semibold text-purple-400">Gemini 2.0 Flash</h3>
                <ConnectionBadge state={geminiHook.connectionState} />
              </div>
              <TranscriptPanel
                transcripts={geminiHook.transcripts}
                interimTranscript={geminiHook.interimTranscript}
                onClear={geminiHook.clearTranscripts}
              />
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