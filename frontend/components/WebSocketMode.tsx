import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Settings } from 'lucide-react';
import { useDeepgram } from '../hooks/useDeepgram';
import { useGemini } from '../hooks/useGemini';
import { useGoogle } from '../hooks/useGoogle';
import { useAzure } from '../hooks/useAzure';
import { useAudioDevices } from '../hooks/useAudioDevices';
import { useVAD } from '../hooks/useVAD';
import Visualizer from './Visualizer';
import SettingsModal from './SettingsModal';
import ConnectionBadge from './ConnectionBadge';
import RecordButton from './RecordButton';
import ErrorBanner from './ErrorBanner';
import TranscriptPanel from './TranscriptPanel';
import VADInfoBadge from './VADInfoBadge';
import { ConnectionState, AppConfig, ASRProvider } from '../types';
import { STORAGE_KEYS, DEFAULT_CONFIG } from '../lib/constants';
import { safeJsonParse } from '../lib/utils';
import { checkAvailableProviders, isProviderEnabled, ProvidersResponse } from '../lib/api';

// Load initial config from localStorage or use defaults
const getInitialConfig = (): AppConfig => {
    const saved = localStorage.getItem(STORAGE_KEYS.CONFIG);
    const parsedConfig = saved ? safeJsonParse<AppConfig>(saved, DEFAULT_CONFIG) : DEFAULT_CONFIG;

    return {
        ...parsedConfig,
        apiKey: import.meta.env.VITE_DEEPGRAM_API_KEY || parsedConfig.apiKey,
        backendUrl: import.meta.env.VITE_BACKEND_URL || parsedConfig.backendUrl,
    };
};

export default function WebSocketMode() {
    const [config, setConfig] = useState<AppConfig>(getInitialConfig);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [availableProviders, setAvailableProviders] = useState<ProvidersResponse | null>(null);
    const [isCheckingProviders, setIsCheckingProviders] = useState(false);

    const isVADStreamingRef = useRef<boolean>(false);
    const [vadIsSpeaking, setVadIsSpeaking] = useState(false);

    const { devices: audioDevices } = useAudioDevices();

    // Check providers
    useEffect(() => {
        const checkProviders = async () => {
            if (config.useBackend) {
                try {
                    setIsCheckingProviders(true);
                    const providers = await checkAvailableProviders(config.backendUrl);
                    setAvailableProviders(providers);
                } catch (error) {
                    setAvailableProviders(null);
                } finally {
                    setIsCheckingProviders(false);
                }
            }
        };
        checkProviders();
    }, [config.useBackend, config.backendUrl]);

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

    const deepgramHook = useDeepgram(config, { vad, isVADStreamingRef });
    const geminiHook = useGemini(config, { vad, isVADStreamingRef });
    const googleHook = useGoogle(config, { vad, isVADStreamingRef });
    const azureHook = useAzure(config, { vad, isVADStreamingRef });

    const [microphoneActive, setMicrophoneActive] = useState(false);

    const handleConfigSave = useCallback((newConfig: AppConfig) => {
        setConfig(newConfig);
        localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(newConfig));
    }, []);

    const handleToggleMicrophone = useCallback(async () => {
        if (microphoneActive) {
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

    const handleStartProvider = useCallback(
        (provider: 'deepgram' | 'gemini' | 'google' | 'azure') => {
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
        },
        [microphoneActive, deepgramHook, geminiHook, googleHook, azureHook, availableProviders]
    );

    const handleStopProvider = useCallback(
        (provider: 'deepgram' | 'gemini' | 'google' | 'azure') => {
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
        },
        [deepgramHook, geminiHook, googleHook, azureHook]
    );

    return (
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
            {/* Settings Button */}
            <div className="flex justify-end">
                <button
                    onClick={() => setIsSettingsOpen(true)}
                    className="p-2 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors"
                >
                    <Settings size={20} />
                </button>
            </div>

            {/* Control Panel */}
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-slate-700/50 p-6">
                <RecordButton
                    isRecording={microphoneActive}
                    onClick={handleToggleMicrophone}
                    disabled={false}
                />
                {microphoneActive && <Visualizer />}
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

            {/* Transcript Panels */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <TranscriptPanel
                    transcripts={deepgramHook.transcripts}
                    interimTranscript={deepgramHook.interimTranscript}
                    onClear={deepgramHook.clearTranscripts}
                    connectionState={deepgramHook.connectionState}
                    onStart={() => handleStartProvider('deepgram')}
                    onStop={() => handleStopProvider('deepgram')}
                    microphoneActive={microphoneActive}
                />
                <TranscriptPanel
                    transcripts={geminiHook.transcripts}
                    interimTranscript={geminiHook.interimTranscript}
                    onClear={geminiHook.clearTranscripts}
                    connectionState={geminiHook.connectionState}
                    onStart={() => handleStartProvider('gemini')}
                    onStop={() => handleStopProvider('gemini')}
                    microphoneActive={microphoneActive}
                />
                <TranscriptPanel
                    transcripts={googleHook.transcripts}
                    interimTranscript={googleHook.interimTranscript}
                    onClear={googleHook.clearTranscripts}
                    connectionState={googleHook.connectionState}
                    onStart={() => handleStartProvider('google')}
                    onStop={() => handleStopProvider('google')}
                    microphoneActive={microphoneActive}
                />
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

            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                config={config}
                onSave={handleConfigSave}
            />
        </div>
    );
}
