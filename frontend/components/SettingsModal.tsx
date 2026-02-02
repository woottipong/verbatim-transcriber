import React, { useState } from 'react';
import { X, Server, Mic, Gauge } from 'lucide-react';
import { AppConfig } from '../types';
import VADInfoBadge from './VADInfoBadge';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: AppConfig;
  onSave: (config: AppConfig) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, config, onSave }) => {
  const [localConfig, setLocalConfig] = useState(config);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(localConfig);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl shadow-2xl border border-slate-700 w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-700 bg-slate-800/50 backdrop-blur-sm">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <Server size={24} className="text-indigo-400" />
              Settings
            </h2>
            <p className="text-xs text-slate-400 mt-1">Configure your transcription settings</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-700 rounded-full transition-colors"
            aria-label="Close settings"
          >
            <X size={24} className="text-slate-400 hover:text-slate-200" />
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Backend Connection */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Server size={18} className="text-indigo-400" />
                <h3 className="text-lg font-semibold text-slate-200">Backend Server</h3>
              </div>

              <div className="p-4 rounded-xl bg-indigo-500/10 border-2 border-indigo-500/50">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Server size={16} className="text-indigo-400" />
                    <span className="font-semibold text-slate-200">WebSocket URL</span>
                  </div>
                  <p className="text-sm text-slate-400">Connect to the Go backend server for secure transcription</p>

                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-300">Backend URL:</label>
                    <input
                      type="text"
                      value={localConfig.backendUrl}
                      onChange={(e) => setLocalConfig({ ...localConfig, backendUrl: e.target.value })}
                      placeholder="ws://localhost:3000"
                      className="w-full px-3 py-2.5 text-sm border-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-900 border-slate-600 text-slate-100 placeholder-slate-500"
                    />
                    <p className="text-xs text-slate-500 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                      Default: ws://localhost:3000
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* VAD Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Mic size={18} className="text-purple-400" />
                <h3 className="text-lg font-semibold text-slate-200">Voice Activity Detection</h3>
              </div>

              {/* VAD Toggle */}
              <label className={`group flex items-center justify-between p-4 rounded-xl cursor-pointer transition-all border-2 ${localConfig.vadConfig?.enabled
                ? 'bg-purple-500/10 border-purple-500/50 shadow-lg shadow-purple-500/20'
                : 'bg-slate-800/30 border-slate-700/50 hover:border-slate-600'
                }`}>
                <div className="flex items-start gap-3 flex-1">
                  <div className={`p-2 rounded-lg ${localConfig.vadConfig?.enabled ? 'bg-purple-500/20' : 'bg-slate-700/50'}`}>
                    <Mic size={20} className={localConfig.vadConfig?.enabled ? 'text-purple-400' : 'text-slate-400'} />
                  </div>
                  <div className="flex-1">
                    <span className="font-semibold text-slate-200 block">Enable VAD</span>
                    <p className="text-sm text-slate-400 mt-1">Automatically detect speech and reduce unnecessary data transmission</p>
                  </div>
                </div>
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={localConfig.vadConfig?.enabled || false}
                    onChange={(e) => setLocalConfig({
                      ...localConfig,
                      vadConfig: {
                        ...localConfig.vadConfig,
                        enabled: e.target.checked,
                        threshold: localConfig.vadConfig?.threshold || 0.4,
                      },
                    })}
                    className="sr-only peer"
                  />
                  <div className="w-14 h-8 bg-slate-600 rounded-full peer peer-checked:bg-purple-500 transition-colors"></div>
                  <div className="absolute left-1 top-1 w-6 h-6 bg-white rounded-full transition-transform peer-checked:translate-x-6 shadow-lg"></div>
                </div>
              </label>

              {/* VAD Threshold Settings */}
              {localConfig.vadConfig?.enabled && (
                <div className="ml-4 p-4 rounded-xl bg-slate-800/50 border border-slate-700/50 space-y-4">
                  <div className="flex items-center gap-2">
                    <Gauge size={16} className="text-purple-400" />
                    <label className="text-sm font-semibold text-slate-200">
                      Sensitivity Threshold
                    </label>
                  </div>

                  <div className="space-y-3">
                    <input
                      type="range"
                      min="0.1"
                      max="0.9"
                      step="0.05"
                      value={localConfig.vadConfig?.threshold || 0.4}
                      onChange={(e) => setLocalConfig({
                        ...localConfig,
                        vadConfig: {
                          ...localConfig.vadConfig,
                          enabled: localConfig.vadConfig?.enabled || false,
                          threshold: parseFloat(e.target.value),
                        },
                      })}
                      className="w-full h-3 bg-slate-700 rounded-full appearance-none cursor-pointer accent-purple-500"
                      style={{
                        background: `linear-gradient(to right, rgb(168 85 247) 0%, rgb(168 85 247) ${(localConfig.vadConfig?.threshold || 0.4) * 100}%, rgb(51 65 85) ${(localConfig.vadConfig?.threshold || 0.4) * 100}%, rgb(51 65 85) 100%)`
                      }}
                    />
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500">Very Sensitive</span>
                      <div className="px-3 py-1 bg-purple-500/20 rounded-full">
                        <span className="font-bold text-purple-400">
                          {((localConfig.vadConfig?.threshold || 0.4) * 100).toFixed(0)}%
                        </span>
                      </div>
                      <span className="text-slate-500">Less Sensitive</span>
                    </div>
                  </div>

                  <div className="mt-3 p-3 bg-slate-900/50 rounded-lg border border-slate-700/30">
                    <p className="text-xs text-slate-300 leading-relaxed">
                      <span className="font-semibold text-purple-400">💡 Tip:</span><br />
                      • <span className="font-medium">Low (10-30%)</span>: Captures everything including background noise<br />
                      • <span className="font-medium">Medium (40-60%)</span>: Balanced - Recommended for most cases<br />
                      • <span className="font-medium">High (70-90%)</span>: Only clear speech, may miss quiet audio
                    </p>
                  </div>

                  {/* VAD Preview */}
                  <div className="mt-4 pt-4 border-t border-slate-700/50">
                    <p className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1">
                      <Gauge size={12} className="text-purple-400" />
                      Live Preview:
                    </p>
                    <VADInfoBadge
                      enabled={localConfig.vadConfig?.enabled || false}
                      threshold={localConfig.vadConfig?.threshold || 0.4}
                      isReady={false}
                      isLoading={false}
                      isSpeaking={false}
                    />
                  </div>
                </div>
              )}
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-700 px-6 py-4 bg-slate-800/50 backdrop-blur-sm flex justify-between items-center">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            className="px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all font-medium shadow-lg shadow-indigo-500/30 hover:shadow-xl hover:shadow-indigo-500/40"
          >
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;