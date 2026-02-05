import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Settings, Mic2 } from 'lucide-react';
import { useDeepgram } from './hooks/useDeepgram';
import { useGemini } from './hooks/useGemini';
import { useGoogle } from './hooks/useGoogle';
import { useAzure } from './hooks/useAzure';
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
import { checkAvailableProviders, isProviderEnabled, ProvidersResponse } from './lib/api';

// Load initial config from localStorage or use defaults
const getInitialConfig = (): AppConfig => {
  const saved = localStorage.getItem(STORAGE_KEYS.CONFIG);
  const parsedConfig = saved ? safeJsonParse<AppConfig>(saved, DEFAULT_CONFIG) : DEFAULT_CONFIG;

  // Always override with env variables if available (env takes priority)
  return {
    ...parsedConfig,
    apiKey: import.meta.env.VITE_DEEPGRAM_API_KEY || parsedConfig.apiKey,
    backendUrl: import.meta.env.VITE_BACKEND_URL || parsedConfig.backendUrl,
  };
};

export default function App() {
  const [config, setConfig] = useState<AppConfig>(getInitialConfig);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [availableProviders, setAvailableProviders] = useState<ProvidersResponse | null>(null);
  const [isCheckingProviders, setIsCheckingProviders] = useState(false);

  // Shared VAD streaming state (controlled by single VAD instance)
  const isVADStreamingRef = useRef<boolean>(false);
  const [vadIsSpeaking, setVadIsSpeaking] = useState(false);

  // Get available audio devices
  const { devices: audioDevices } = useAudioDevices();

  // Check which providers are available on backend
  useEffect(() => {
    const checkProviders = async () => {
      if (config.useBackend) {
        try {
          setIsCheckingProviders(true);
          const providers = await checkAvailableProviders(config.backendUrl);
          setAvailableProviders(providers);
        } catch (error) {
          setAvailableProviders(null); // Fallback to allow all
        } finally {
          setIsCheckingProviders(false);
        }
      }
    };
    checkProviders();
  }, [config.useBackend, config.backendUrl]);

  // Single shared VAD instance for both providers
  const vad = useVAD({
    config: config.vadConfig || { enabled: false, threshold: 0.5 },
    audioDeviceId: config.audioDeviceId,
    onSpeechStart: () => {
      isVADStreamingRef.current = true;
      setVadIsSpeaking(true);
    },
    onSpeechEnd: () => {
      isVADStreamingRef.current = false;
      setVadIsSpeaking(false);
    },
    onVADMisfire: () => { },
  });

  // Use ALL 4 hooks simultaneously with shared VAD state
  const deepgramHook = useDeepgram(config, { vad, isVADStreamingRef });
  const geminiHook = useGemini(config, { vad, isVADStreamingRef });
  const googleHook = useGoogle(config, { vad, isVADStreamingRef });
  const azureHook = useAzure(config, { vad, isVADStreamingRef });

  // VAD status from shared VAD
  const vadStatus = {
    isReady: vad.isReady,
    isSpeaking: vadIsSpeaking,
    isLoading: vad.isLoading,
  };

  // Check if any provider is connected
  const isConnected =
    deepgramHook.connectionState === ConnectionState.CONNECTED ||
    geminiHook.connectionState === ConnectionState.CONNECTED ||
    googleHook.connectionState === ConnectionState.CONNECTED ||
    azureHook.connectionState === ConnectionState.CONNECTED;
  const isConnecting =
    deepgramHook.connectionState === ConnectionState.CONNECTING ||
    geminiHook.connectionState === ConnectionState.CONNECTING ||
    googleHook.connectionState === ConnectionState.CONNECTING ||
    azureHook.connectionState === ConnectionState.CONNECTING;

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

  // Microphone control (separate from ASR providers)
  const [microphoneActive, setMicrophoneActive] = useState(false);

  const handleToggleMicrophone = useCallback(async () => {
    if (microphoneActive) {
      // Stop microphone - this will stop all providers
      setMicrophoneActive(false);
      deepgramHook.stopStreaming();
      geminiHook.stopStreaming();
      googleHook.stopStreaming();
      azureHook.stopStreaming();
      if (config.vadConfig?.enabled) {
        vad.pause();
        isVADStreamingRef.current = false;
      }
    } else {
      // Start microphone only - providers start individually
      setMicrophoneActive(true);
      if (config.vadConfig?.enabled) {
        if (vad.isLoading) {
          isVADStreamingRef.current = true;
        } else if (vad.isReady) {
          await vad.start();
        } else {
          isVADStreamingRef.current = true;
        }
      } else {
        isVADStreamingRef.current = true;
      }
    }
  }, [microphoneActive, deepgramHook, geminiHook, googleHook, azureHook, config.vadConfig, vad]);

  // Individual provider controls
  const handleStartProvider = useCallback((provider: 'deepgram' | 'gemini' | 'google' | 'azure') => {
    if (!microphoneActive || !isProviderEnabled(availableProviders, provider)) return;

    switch (provider) {
      case 'deepgram':
        deepgramHook.startStreaming();
        break;
      case 'gemini':
        geminiHook.startStreaming();
        break;
      case 'google':
        googleHook.startStreaming();
        break;
      case 'azure':
        azureHook.startStreaming();
        break;
    }
  }, [microphoneActive, deepgramHook, geminiHook, googleHook, azureHook, availableProviders]);

  const handleStopProvider = useCallback((provider: 'deepgram' | 'gemini' | 'google' | 'azure') => {
    switch (provider) {
      case 'deepgram':
        deepgramHook.stopStreaming();
        break;
      case 'gemini':
        geminiHook.stopStreaming();
        break;
      case 'google':
        googleHook.stopStreaming();
        break;
      case 'azure':
        azureHook.stopStreaming();
        break;
    }
  }, [deepgramHook, geminiHook, googleHook, azureHook]);

  const handleOpenSettings = useCallback(() => setIsSettingsOpen(true), []);
  const handleCloseSettings = useCallback(() => setIsSettingsOpen(false), []);

  const handleClearTranscripts = useCallback(() => {
    deepgramHook.clearTranscripts();
    geminiHook.clearTranscripts();
    googleHook.clearTranscripts();
    azureHook.clearTranscripts();
  }, [deepgramHook, geminiHook, googleHook, azureHook]);

  // Status message
  const statusMessage = microphoneActive
    ? isConnected
      ? 'Microphone Active - Providers Running'
      : 'Microphone Active - Start providers below'
    : vad.isLoading
      ? 'Loading VAD... (tap to start anyway)'
      : 'Tap microphone to activate';

  // Show config hint when there's an error and no API key configured
  const showConfigHint = !config.apiKey && !config.useBackend;

  // Use any available media stream for visualizer
  const mediaStream = deepgramHook.mediaStream || geminiHook.mediaStream || googleHook.mediaStream || azureHook.mediaStream;

  // Helper to check if provider is available
  // Returns true if we haven't checked yet (null) - fallback to trying all providers
  const checkProviderAvailable = (providerName: string) => {
    if (availableProviders === null) return true; // Haven't checked yet, allow all
    return isProviderEnabled(availableProviders, providerName);
  };

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
              <h1 className="text-lg font-bold text-white">Real-time Thai Transcription</h1>
              <p className="text-xs text-slate-400">Multi-Provider ASR Comparison</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Multi ASR Badge */}
            <div className="flex items-center gap-2 bg-slate-800/50 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-slate-700/50">
              <span className="text-xs font-medium text-indigo-400">Deepgram</span>
              <span className="text-slate-600">+</span>
              <span className="text-xs font-medium text-purple-400">Gemini</span>
              <span className="text-slate-600">+</span>
              <span className="text-xs font-medium text-blue-400">Google</span>
              <span className="text-slate-600">+</span>
              <span className="text-xs font-medium text-cyan-400">Azure</span>
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

      {/* Main Layout */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Error Banner - Only show for enabled providers */}
        {(deepgramHook.error || geminiHook.error || googleHook.error || azureHook.error) && (
          <div className="mb-4 space-y-2">
            {deepgramHook.error && checkProviderAvailable('deepgram') && (
              <ErrorBanner
                error={`Deepgram: ${deepgramHook.error}`}
                showConfigHint={showConfigHint}
                onConfigClick={handleOpenSettings}
              />
            )}
            {geminiHook.error && checkProviderAvailable('gemini') && (
              <ErrorBanner
                error={`Gemini: ${geminiHook.error}`}
                showConfigHint={showConfigHint}
                onConfigClick={handleOpenSettings}
              />
            )}
            {googleHook.error && checkProviderAvailable('google') && (
              <ErrorBanner
                error={`Google: ${googleHook.error}`}
                showConfigHint={showConfigHint}
                onConfigClick={handleOpenSettings}
              />
            )}
            {azureHook.error && checkProviderAvailable('azure') && (
              <ErrorBanner
                error={`Azure: ${azureHook.error}`}
                showConfigHint={showConfigHint}
                onConfigClick={handleOpenSettings}
              />
            )}
          </div>
        )}

        {/* Control Panel - Top Section */}
        <div className="mb-6 bg-slate-800/50 backdrop-blur-sm rounded-2xl shadow-xl border border-slate-700/50 p-6">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
            {/* Left: Visualizer + Record Button */}
            <div className="flex flex-col items-center gap-4 lg:w-1/3">
              <div className="w-full">
                <Visualizer mediaStream={mediaStream} isListening={isConnected} />
              </div>

              <RecordButton
                isConnected={microphoneActive}
                isConnecting={false}
                onClick={handleToggleMicrophone}
              />

              <p className="text-sm font-medium text-slate-300 text-center">
                {statusMessage}
              </p>

              {/* VAD Status Indicator */}
              {config.vadConfig?.enabled && isConnected && vadStatus?.isReady && (
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full transition-colors ${vadStatus.isSpeaking ? 'bg-green-500' : 'bg-slate-600'}`}></div>
                  <span className="text-xs text-slate-400">
                    {vadStatus.isSpeaking ? 'Speaking' : 'Listening'}
                  </span>
                </div>
              )}
            </div>

            {/* Right: Stats Grid */}
            <div className="lg:w-2/3 grid grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Deepgram Stats */}
              <div className={`bg-slate-800/30 backdrop-blur-sm rounded-xl border border-slate-700/30 p-4 ${!checkProviderAvailable('deepgram') ? 'opacity-40' : ''}`}>
                <p className="text-xs font-semibold text-indigo-400 mb-2 flex items-center gap-1">
                  Deepgram Nova-2
                  {!checkProviderAvailable('deepgram') && <span className="text-slate-500 text-[10px]">(disabled)</span>}
                </p>
                <div className="space-y-1">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-indigo-400">{deepgramHook.transcripts.length}</p>
                    <p className="text-xs text-slate-500">Segments</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-indigo-300">
                      {deepgramHook.transcripts.reduce((acc, t) => acc + t.text.length, 0)}
                    </p>
                    <p className="text-xs text-slate-500">Chars</p>
                  </div>
                </div>
              </div>

              {/* Gemini Stats */}
              <div className={`bg-slate-800/30 backdrop-blur-sm rounded-xl border border-slate-700/30 p-4 ${!checkProviderAvailable('gemini') ? 'opacity-40' : ''}`}>
                <p className="text-xs font-semibold text-purple-400 mb-2 flex items-center gap-1">
                  Gemini 2.0 Flash
                  {!checkProviderAvailable('gemini') && <span className="text-slate-500 text-[10px]">(disabled)</span>}
                </p>
                <div className="space-y-1">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-purple-400">{geminiHook.transcripts.length}</p>
                    <p className="text-xs text-slate-500">Segments</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-purple-300">
                      {geminiHook.transcripts.reduce((acc, t) => acc + t.text.length, 0)}
                    </p>
                    <p className="text-xs text-slate-500">Chars</p>
                  </div>
                </div>
              </div>

              {/* Google Stats */}
              <div className={`bg-slate-800/30 backdrop-blur-sm rounded-xl border border-slate-700/30 p-4 ${!checkProviderAvailable('google') ? 'opacity-40' : ''}`}>
                <p className="text-xs font-semibold text-blue-400 mb-2 flex items-center gap-1">
                  Google Cloud STT
                  {!checkProviderAvailable('google') && <span className="text-slate-500 text-[10px]">(disabled)</span>}
                </p>
                <div className="space-y-1">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-blue-400">{googleHook.transcripts.length}</p>
                    <p className="text-xs text-slate-500">Segments</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-blue-300">
                      {googleHook.transcripts.reduce((acc, t) => acc + t.text.length, 0)}
                    </p>
                    <p className="text-xs text-slate-500">Chars</p>
                  </div>
                </div>
              </div>

              {/* Azure Stats */}
              <div className={`bg-slate-800/30 backdrop-blur-sm rounded-xl border border-slate-700/30 p-4 ${!checkProviderAvailable('azure') ? 'opacity-40' : ''}`}>
                <p className="text-xs font-semibold text-cyan-400 mb-2 flex items-center gap-1">
                  Azure Speech
                  {!checkProviderAvailable('azure') && <span className="text-slate-500 text-[10px]">(disabled)</span>}
                </p>
                <div className="space-y-1">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-cyan-400">{azureHook.transcripts.length}</p>
                    <p className="text-xs text-slate-500">Segments</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-cyan-300">
                      {azureHook.transcripts.reduce((acc, t) => acc + t.text.length, 0)}
                    </p>
                    <p className="text-xs text-slate-500">Chars</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* VAD Status Badge */}
          {config.vadConfig?.enabled && (
            <div className="mt-4">
              <VADInfoBadge
                enabled={config.vadConfig.enabled}
                threshold={config.vadConfig.threshold}
                isReady={vad.isReady}
                isLoading={vad.isLoading}
                isSpeaking={vadIsSpeaking}
              />
            </div>
          )}
        </div>

        {/* Transcript Panels - Stacked Grid (2x2 on desktop, stacked on mobile) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Azure Panel */}
          <div className="flex flex-col">
            <div className="flex items-center justify-between mb-2 px-1">
              <h3 className="text-sm font-semibold text-cyan-400">Azure Speech Service</h3>
              <ConnectionBadge state={azureHook.connectionState} />
            </div>
            <TranscriptPanel
              transcripts={azureHook.transcripts}
              interimTranscript={azureHook.interimTranscript}
              onClear={azureHook.clearTranscripts}
              connectionState={azureHook.connectionState}
              onStart={() => handleStartProvider('azure')}
              onStop={() => handleStopProvider('azure')}
              microphoneActive={microphoneActive}
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
              connectionState={geminiHook.connectionState}
              onStart={() => handleStartProvider('gemini')}
              onStop={() => handleStopProvider('gemini')}
              microphoneActive={microphoneActive}
            />
          </div>

          {/* Google Panel */}
          <div className="flex flex-col">
            <div className="flex items-center justify-between mb-2 px-1">
              <h3 className="text-sm font-semibold text-blue-400">Google Cloud STT</h3>
              <ConnectionBadge state={googleHook.connectionState} />
            </div>
            <TranscriptPanel
              transcripts={googleHook.transcripts}
              interimTranscript={googleHook.interimTranscript}
              onClear={googleHook.clearTranscripts}
              connectionState={googleHook.connectionState}
              onStart={() => handleStartProvider('google')}
              onStop={() => handleStopProvider('google')}
              microphoneActive={microphoneActive}
            />
          </div>

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
              connectionState={deepgramHook.connectionState}
              onStart={() => handleStartProvider('deepgram')}
              onStop={() => handleStopProvider('deepgram')}
              microphoneActive={microphoneActive}
            />
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