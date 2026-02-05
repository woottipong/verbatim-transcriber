import React, { useState } from 'react';
import { Mic, Power, Loader2 } from 'lucide-react';
import { TranscriptionRoom } from './components/LiveKitRoom';
import { LiveTranscript } from './components/LiveTranscript';

interface TokenResponse {
  token: string;
  wsUrl: string;
  expire: number;
}

interface TranscriptMessage {
  text: string;
  isFinal: boolean;
  confidence: number;
  speaker: string;
  timestamp: number;
}

export default function LiveKitTest() {
  const [token, setToken] = useState<string | null>(null);
  const [wsUrl, setWsUrl] = useState<string>('');
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [roomName, setRoomName] = useState('transcription-room');

  const handleGetToken = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('http://localhost:3000/livekit/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName }),
      });

      if (!response.ok) {
        throw new Error('Failed to get token');
      }

      const data = (await response.json()) as TokenResponse;
      setToken(data.token);
      setWsUrl(data.wsUrl);
    } catch (error) {
      console.error('Error getting token:', error);
      alert('Failed to get LiveKit token. Make sure backend is running.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = () => {
    setToken(null);
    setWsUrl('');
    setIsConnected(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-white mb-2">🚀 LiveKit Transcription Test</h1>
          <p className="text-slate-400">
            Real-time Thai transcription using LiveKit + Google Cloud Speech-to-Text
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-slate-900 rounded-lg p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Room Name
                </label>
                <input
                  type="text"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white"
                />
              </div>

              {!token ? (
                <button
                  onClick={handleGetToken}
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 text-white rounded-lg font-medium transition-colors"
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Mic className="w-5 h-5" />
                      Start Session
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={handleDisconnect}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
                >
                  <Power className="w-5 h-5" />
                  End Session
                </button>
              )}

              <div className="text-xs text-slate-400 space-y-1">
                <p>• Backend: http://localhost:3000</p>
                <p>• LiveKit: ws://localhost:7880</p>
                <p>• Room: {roomName}</p>
              </div>
            </div>

            <div className="bg-slate-900 rounded-lg p-4">
              <h3 className="text-sm font-medium text-slate-300 mb-3">Status</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Backend</span>
                  <span className="text-green-400">✓ Running</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">LiveKit Server</span>
                  <span className="text-green-400">✓ Running</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Agent</span>
                  <span className="text-yellow-400">⚠ Start separately</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Connected</span>
                  <span className={isConnected ? 'text-green-400' : 'text-slate-500'}>
                    {isConnected ? '✓ Yes' : '✗ No'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            <LiveTranscript isConnected={isConnected} />
          </div>
        </div>

        {token && wsUrl && (
          <TranscriptionRoom
            token={token}
            serverUrl={wsUrl}
            onTranscript={(msg: TranscriptMessage) => {
              console.log('Received transcript:', msg);
            }}
            onConnected={() => setIsConnected(true)}
            onDisconnected={() => setIsConnected(false)}
          />
        )}
      </div>
    </div>
  );
}
