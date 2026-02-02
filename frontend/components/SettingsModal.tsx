import React, { useState } from 'react';
import { X, Info } from 'lucide-react';
import { AppConfig, ASRProvider } from '../types';
import { ASR_PROVIDERS } from '../lib/constants';
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

  const selectedProviderInfo = ASR_PROVIDERS[localConfig.provider || ASRProvider.DEEPGRAM];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div className="bg-slate-800 rounded-xl shadow-2xl border border-slate-700 w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-slate-100">Settings</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-full transition">
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Provider Info */}
          <div className="bg-slate-700/30 rounded-lg p-4 border border-slate-700/50">
            <div className="flex items-start gap-2">
              <Info size={16} className="text-indigo-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-slate-200">{selectedProviderInfo.name}</p>
                <p className="text-xs text-slate-400 mt-1">{selectedProviderInfo.description}</p>
              </div>
            </div>
          </div>

          {/* Connection Mode */}
          <div className="space-y-3">
            <label className="block text-sm font-semibold text-slate-200">
              Connection Mode
            </label>

            <label className="flex items-start space-x-3 cursor-pointer p-3 rounded-lg hover:bg-slate-700/30 transition border border-slate-700/30">
              <input
                type="radio"
                checked={localConfig.useBackend}
                onChange={() => setLocalConfig({ ...localConfig, useBackend: true })}
                className="mt-0.5 text-indigo-500 focus:ring-indigo-500 bg-slate-700 border-slate-600"
              />
              <div className="flex-1">
                <span className="font-medium text-slate-200 block">Relay Server (Recommended)</span>
                <p className="text-xs text-slate-400 mt-1">Secure backend proxy</p>
              </div>
            </label>

            <div className="ml-7 space-y-2">
              <input
                type="text"
                value={localConfig.backendUrl}
                onChange={(e) => setLocalConfig({ ...localConfig, backendUrl: e.target.value })}
                disabled={!localConfig.useBackend}
                placeholder="ws://localhost:3000"
                className={`w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-700 border-slate-600 text-slate-100 placeholder-slate-500 ${!localConfig.useBackend ? 'opacity-50' : ''}`}
              />
              <p className="text-xs text-slate-400">
                Requires backend running (see backend/server.ts)
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <label className="flex items-start space-x-3 cursor-pointer p-3 rounded-lg hover:bg-slate-700/30 transition border border-slate-700/30">
              <input
                type="radio"
                checked={!localConfig.useBackend}
                onChange={() => setLocalConfig({ ...localConfig, useBackend: false })}
                className="mt-0.5 text-indigo-500 focus:ring-indigo-500 bg-slate-700 border-slate-600"
              />
              <div className="flex-1">
                <span className="font-medium text-slate-200 block">Direct API (Demo Only)</span>
                <p className="text-xs text-slate-400 mt-1">⚠️ Exposes API key in browser</p>
              </div>
            </label>

            <div className="ml-7 space-y-2">
              <input
                type="password"
                value={localConfig.apiKey}
                onChange={(e) => setLocalConfig({ ...localConfig, apiKey: e.target.value })}
                disabled={localConfig.useBackend}
                placeholder={`Enter ${selectedProviderInfo.name} API Key`}
                className={`w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-700 border-slate-600 text-slate-100 placeholder-slate-500 ${localConfig.useBackend ? 'opacity-50' : ''}`}
              />
            </div>
          </div>

          {/* VAD Configuration */}
          <div className="space-y-3">
            <label className="block text-sm font-semibold text-slate-200">
              Voice Activity Detection (VAD)
            </label>

            {/* Enable/Disable VAD Toggle */}
            <label className="flex items-center justify-between p-3 rounded-lg bg-slate-700/30 border border-slate-700/50 cursor-pointer hover:bg-slate-700/40 transition">
              <div className="flex-1">
                <span className="font-medium text-slate-200 block">เปิดใช้งาน VAD</span>
                <p className="text-xs text-slate-400 mt-1">ตรวจจับเสียงพูดอัตโนมัติ ส่งเฉพาะช่วงที่มีคนพูด</p>
              </div>
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
                className="w-5 h-5 text-indigo-500 bg-slate-700 border-slate-600 rounded focus:ring-indigo-500 focus:ring-2"
              />
            </label>

            {/* VAD Threshold Slider */}
            {localConfig.vadConfig?.enabled && (
              <div className="ml-3 space-y-3 p-4 rounded-lg bg-slate-700/20 border border-slate-700/30">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-200">
                    ความไวในการตรวจจับ (Threshold)
                  </label>
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
                    className="w-full h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer slider"
                  />
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>ไวมาก (0.1)</span>
                    <span className="font-medium text-slate-200">
                      {((localConfig.vadConfig?.threshold || 0.4) * 100).toFixed(0)}%
                    </span>
                    <span>ไวน้อย (0.9)</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    • ไวมาก: จับเสียงทุกอย่าง (อาจรวมเสียงรบกวน)<br />
                    • ไวน้อย: จับเฉพาะเสียงพูดชัดเจน (อาจพลาดเสียงเบา)
                  </p>
                </div>

                {/* VAD Info Badge - Live Preview */}
                <div className="pt-3 border-t border-slate-700/50">
                  <p className="text-xs font-medium text-slate-300 mb-2">ตัวอย่างการแสดงผล:</p>
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

          {/* Save Button */}
          <div className="border-t border-slate-700 pt-4 flex justify-end">
            <button
              type="submit"
              className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium shadow-lg"
            >
              Save Configuration
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SettingsModal;