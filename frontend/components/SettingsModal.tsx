import React, { useEffect, useState } from 'react';
import { X, Server } from 'lucide-react';
import { AppConfig } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: AppConfig;
  onSave: (config: AppConfig) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, config, onSave }) => {
  const [localConfig, setLocalConfig] = useState(config);

  useEffect(() => {
    if (isOpen) {
      setLocalConfig(config);
    }
  }, [config, isOpen]);

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
          <form id="settings-form" onSubmit={handleSubmit} className="space-y-6">
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
            form="settings-form"
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
