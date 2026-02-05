import React, { useState } from 'react';
import { Radio, Zap } from 'lucide-react';
import WebSocketMode from './components/WebSocketMode';
import LiveKitMode from './components/LiveKitMode';

type AppMode = 'websocket' | 'livekit';

export default function App() {
  // Check if user has saved preference
  const savedMode = localStorage.getItem('app-mode') as AppMode;
  const [mode, setMode] = useState<AppMode>(savedMode || 'livekit'); // Default to LiveKit

  const handleModeChange = (newMode: AppMode) => {
    setMode(newMode);
    localStorage.setItem('app-mode', newMode);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      {/* Mode Switcher Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-slate-900/80 backdrop-blur-md border-b border-slate-700/50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <span className="text-2xl">🎙️</span>
            </div>
            <div>
              <h1 className="text-lg font-bold">Thai Verbatim Transcriber</h1>
              <p className="text-xs text-slate-400">Real-time Speech-to-Text</p>
            </div>
          </div>

          {/* Mode Toggle */}
          <div className="flex items-center gap-2 bg-slate-800/50 rounded-lg p-1">
            <button
              onClick={() => handleModeChange('livekit')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md transition-all ${
                mode === 'livekit'
                  ? 'bg-blue-500 text-white shadow-lg'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Zap size={16} />
              <span className="text-sm font-medium">LiveKit</span>
              <span className="text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">Recommended</span>
            </button>
            <button
              onClick={() => handleModeChange('websocket')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md transition-all ${
                mode === 'websocket'
                  ? 'bg-purple-500 text-white shadow-lg'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Radio size={16} />
              <span className="text-sm font-medium">WebSocket</span>
              <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">Legacy</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="pt-20">
        {mode === 'livekit' ? <LiveKitMode /> : <WebSocketMode />}
      </main>
    </div>
  );
}
