import React, { useState, useCallback } from 'react';
import { Mic, MicOff, Loader2, RefreshCw, AlertCircle, Zap } from 'lucide-react';
import { TranscriptionRoom } from './LiveKitRoom';
import LiveTranscript from './LiveTranscript';

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

export default function LiveKitMode() {
    const [token, setToken] = useState<string | null>(null);
    const [wsUrl, setWsUrl] = useState<string>('');
    const [isConnected, setIsConnected] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [roomName, setRoomName] = useState('transcription-room');
    const [backendUrl, setBackendUrl] = useState('http://localhost:3000');
    const [error, setError] = useState<string | null>(null);
    const [transcripts, setTranscripts] = useState<TranscriptMessage[]>([]);

    const handleGetToken = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(`${backendUrl}/livekit/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomName }),
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = (await response.json()) as TokenResponse;
            setToken(data.token);
            setWsUrl(data.wsUrl);
            setError(null);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            setError(`Failed to get token: ${message}`);
            console.error('Error getting token:', err);
        } finally {
            setIsLoading(false);
        }
    }, [backendUrl, roomName]);

    const handleDisconnect = useCallback(() => {
        setToken(null);
        setWsUrl('');
        setIsConnected(false);
        setError(null);
    }, []);

    const handleTranscript = useCallback((msg: TranscriptMessage) => {
        setTranscripts((prev) => {
            // If it's a final transcript, add it
            if (msg.isFinal) {
                return [...prev, msg];
            }
            // If it's interim, update or append
            const lastIndex = prev.length - 1;
            if (lastIndex >= 0 && !prev[lastIndex].isFinal) {
                // Replace last interim with new interim
                return [...prev.slice(0, lastIndex), msg];
            }
            // Append new interim
            return [...prev, msg];
        });
    }, []);

    const handleClearTranscripts = useCallback(() => {
        setTranscripts([]);
    }, []);

    return (
        <div className="max-w-7xl mx-auto px-4 pt-20 pb-8">
            {/* Connection Card */}
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-slate-700/50 p-6 mb-6">
                <div className="flex items-start justify-between mb-6">
                    <div>
                        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
                            <Zap className="text-blue-400" size={28} />
                            LiveKit Real-time Transcription
                        </h2>
                        <p className="text-slate-400 text-sm">
                            Ultra-low latency real-time Thai speech-to-text transcription
                        </p>
                    </div>
                    {isConnected && (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/20 border border-green-500/30 rounded-full">
                            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                            <span className="text-sm font-medium text-green-400">Connected</span>
                        </div>
                    )}
                </div>

                {/* Error Banner */}
                {error && (
                    <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-3">
                        <AlertCircle className="text-red-400 flex-shrink-0 mt-0.5" size={20} />
                        <div className="flex-1">
                            <p className="text-red-400 font-medium mb-1">Connection Error</p>
                            <p className="text-sm text-red-300/80">{error}</p>
                            <p className="text-xs text-slate-400 mt-2">
                                Make sure backend is running on {backendUrl}
                            </p>
                        </div>
                    </div>
                )}

                {!token ? (
                    // Connection Form
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">
                                    Backend URL
                                </label>
                                <input
                                    type="text"
                                    value={backendUrl}
                                    onChange={(e) => setBackendUrl(e.target.value)}
                                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="http://localhost:3000"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">
                                    Room Name
                                </label>
                                <input
                                    type="text"
                                    value={roomName}
                                    onChange={(e) => setRoomName(e.target.value)}
                                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="transcription-room"
                                />
                            </div>
                        </div>

                        <button
                            onClick={handleGetToken}
                            disabled={isLoading}
                            className="w-full md:w-auto px-6 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="animate-spin" size={20} />
                                    <span>Connecting...</span>
                                </>
                            ) : (
                                <>
                                    <Mic size={20} />
                                    <span>Connect & Start</span>
                                </>
                            )}
                        </button>
                    </div>
                ) : (
                    // Connected - Show Room Component
                    <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
                            <div>
                                <p className="text-sm text-slate-400">Room</p>
                                <p className="font-mono text-white">{roomName}</p>
                            </div>
                            <button
                                onClick={handleDisconnect}
                                className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg font-medium transition-colors flex items-center gap-2"
                            >
                                <MicOff size={18} />
                                <span>Disconnect</span>
                            </button>
                        </div>

                        {/* LiveKit Room Connection */}
                        <TranscriptionRoom
                            token={token}
                            serverUrl={wsUrl}
                            onTranscript={handleTranscript}
                            onConnected={() => setIsConnected(true)}
                            onDisconnected={() => {
                                setIsConnected(false);
                                setToken(null);
                            }}
                        />
                    </div>
                )}
            </div>

            {/* Transcripts Panel */}
            {token && (
                <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-slate-700/50 p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-xl font-bold flex items-center gap-2">
                            <span>Live Transcripts</span>
                            {transcripts.length > 0 && (
                                <span className="text-sm text-slate-400">({transcripts.length})</span>
                            )}
                        </h3>
                        <button
                            onClick={handleClearTranscripts}
                            disabled={transcripts.length === 0}
                            className="px-3 py-1.5 bg-slate-700/50 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                        >
                            <RefreshCw size={16} />
                            <span>Clear</span>
                        </button>
                    </div>
                    {transcripts.length > 0 ? (
                        <LiveTranscript transcripts={transcripts} />
                    ) : (
                        <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                            <Mic size={48} className="mb-4 opacity-50" />
                            <p className="text-lg font-medium">Waiting for audio...</p>
                            <p className="text-sm text-slate-600 mt-2">
                                {isConnected ? 'Start speaking to see transcripts' : 'Connecting to LiveKit...'}
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* Info Card */}
            {!token && (
                <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                    <p className="text-sm text-blue-300">
                        <strong>💡 How it works:</strong> LiveKit mode uses the LiveKit framework for ultra-low
                        latency real-time transcription. Your audio is streamed to the LiveKit server, where an
                        agent processes it using Google Cloud Speech-to-Text or Azure Speech Services, then sends
                        back transcriptions via data channels.
                    </p>
                    <div className="mt-3 pt-3 border-t border-blue-500/20 text-xs text-blue-400">
                        <p><strong>Prerequisites:</strong></p>
                        <ul className="mt-1 ml-4 list-disc space-y-1">
                            <li>Backend server running on {backendUrl}</li>
                            <li>LiveKit server running (usually ws://localhost:7880)</li>
                            <li>LiveKit Agent with ASR plugin enabled</li>
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
}
