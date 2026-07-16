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

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(localConfig);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" role="presentation" onMouseDown={onClose}>
      <div className="app-panel flex max-h-[90vh] w-full max-w-2xl flex-col" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
        {/* Header */}
        <div className="panel-header flex items-center justify-between px-5 py-4 sm:px-6">
          <div>
            <h2 id="settings-title" className="flex items-center gap-2 text-xl font-semibold tracking-tight text-white">
              <Server size={24} className="text-indigo-400" />
              Settings
            </h2>
            <p className="mt-1 text-sm text-slate-400">Configure the connection used for transcription.</p>
          </div>
          <button
            onClick={onClose}
            className="control-button control-button--quiet !min-h-9 !px-2"
            aria-label="Close settings"
          >
            <X size={24} className="text-slate-400 hover:text-slate-200" />
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="transcript-scroller flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <form id="settings-form" onSubmit={handleSubmit} className="space-y-6">
            {/* Backend Connection */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Server size={18} className="text-indigo-400" />
                <h3 className="text-lg font-semibold text-slate-200">Backend Server</h3>
              </div>

              <div className="rounded-lg border border-indigo-400/35 bg-indigo-400/10 p-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Server size={16} className="text-indigo-400" />
                    <span className="font-semibold text-slate-200">WebSocket URL</span>
                  </div>
                  <p className="text-sm text-slate-400">Connect to the Go backend server for secure transcription</p>

                  <div className="space-y-2">
                    <label htmlFor="backend-url" className="block text-xs font-medium text-slate-300">Backend URL</label>
                    <input
                      id="backend-url"
                      type="text"
                      value={localConfig.backendUrl}
                      onChange={(e) => setLocalConfig({ ...localConfig, backendUrl: e.target.value })}
                      placeholder="ws://localhost:3000"
                      className="w-full rounded-lg border border-slate-600 bg-slate-950/50 px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500"
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
        <div className="panel-header flex items-center justify-between px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="control-button control-button--quiet"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="settings-form"
            className="control-button control-button--primary px-4"
          >
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
