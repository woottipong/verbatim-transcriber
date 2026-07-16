/**
 * LiveKitPanel Component
 * Displays LiveKit-based transcription with WebRTC connection status
 * 
 * Features:
 * - Real-time WebRTC connection status
 * - Agent connection indicator
 * - Room name selection
 * - Lower latency than WebSocket (200-500ms vs 500-2000ms)
 */

import React, { useRef, useEffect, useState } from 'react';
import { Trash2, Play, Square, Radio, Users, Copy, Check } from 'lucide-react';
import { TranscriptSegment, ConnectionState } from '../types';

interface LiveKitPanelProps {
    transcripts: TranscriptSegment[];
    interimTranscript: string;
    connectionState: ConnectionState;
    isAgentConnected: boolean;
    agentName: string | null;
    participantCount: number;
    error: string | null;
    roomName: string;
    onRoomNameChange: (name: string) => void;
    onConnect: () => void;
    onDisconnect: () => void;
    onClear: () => void;
    roomPlaceholder?: string;
}

const LiveKitPanel: React.FC<LiveKitPanelProps> = ({
    transcripts,
    interimTranscript,
    connectionState,
    isAgentConnected,
    agentName,
    participantCount,
    error,
    roomName,
    onRoomNameChange,
    onConnect,
    onDisconnect,
    onClear,
    roomPlaceholder = 'Room name',
}) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [copied, setCopied] = useState(false);

    // Auto-scroll to bottom when new transcripts arrive
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [transcripts, interimTranscript]);

    const hasContent = transcripts.length > 0 || interimTranscript;
    const isConnected = connectionState === ConnectionState.CONNECTED;
    const isConnecting = connectionState === ConnectionState.CONNECTING;
    const isActive = isConnected || isConnecting;

    // Status color based on connection state
    const getStatusColor = () => {
        switch (connectionState) {
            case ConnectionState.CONNECTED:
                return isAgentConnected ? 'bg-green-500' : 'bg-yellow-500';
            case ConnectionState.CONNECTING:
                return 'bg-yellow-500 animate-pulse';
            case ConnectionState.ERROR:
                return 'bg-red-500';
            default:
                return 'bg-slate-600';
        }
    };

    const getStatusText = () => {
        switch (connectionState) {
            case ConnectionState.CONNECTED:
                if (isAgentConnected && agentName) {
                    return `✅ Agent: ${agentName}`;
                }
                return isAgentConnected ? 'Connected + Agent' : 'Waiting for Agent...';
            case ConnectionState.CONNECTING:
                return 'Connecting...';
            case ConnectionState.ERROR:
                return 'Error';
            default:
                return 'Disconnected';
        }
    };

    return (
        <div className="bg-gradient-to-br from-purple-900/30 to-slate-800/50 backdrop-blur-sm rounded-2xl shadow-xl border border-purple-700/30 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="px-6 py-3 border-b border-purple-700/30 flex justify-between items-center bg-purple-900/20 flex-shrink-0">
                <div className="flex items-center gap-3">
                    <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                        <Radio size={16} className="text-purple-400" />
                        LiveKit (WebRTC)
                    </h2>
                    {/* Room Name Badge */}
                    {isConnected && (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-purple-800/50 text-xs text-purple-300 font-mono">
                            🏠 {roomName}
                        </div>
                    )}
                    {/* Status Badge */}
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-800/50 text-xs text-slate-400">
                        <span className={`w-2 h-2 rounded-full ${getStatusColor()}`}></span>
                        <span>{getStatusText()}</span>
                    </div>
                    {/* Participant Count */}
                    {isConnected && (
                        <div className="flex items-center gap-1 text-xs text-slate-500">
                            <Users size={12} />
                            <span>{participantCount}</span>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {/* Room Name Input (only when disconnected) */}
                    {!isActive && (
                        <input
                            type="text"
                            value={roomName}
                            onChange={(e) => onRoomNameChange(e.target.value)}
                            placeholder={roomPlaceholder}
                            className="w-40 px-2 py-1 text-xs bg-slate-800/50 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500"
                        />
                    )}
                    {/* Connect/Disconnect Button */}
                    {isActive ? (
                        <button
                            onClick={onDisconnect}
                            className="text-xs flex items-center gap-1 text-slate-300 hover:text-red-400 transition px-3 py-1.5 rounded bg-red-900/20 hover:bg-red-900/40"
                            aria-label="Disconnect from LiveKit"
                        >
                            <Square size={14} fill="currentColor" /> Disconnect
                        </button>
                    ) : (
                        <button
                            onClick={onConnect}
                            disabled={!roomName.trim()}
                            className="text-xs flex items-center gap-1 text-slate-300 hover:text-purple-400 transition px-3 py-1.5 rounded bg-purple-900/30 hover:bg-purple-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
                            aria-label="Connect to LiveKit"
                        >
                            <Play size={14} fill="currentColor" /> Connect
                        </button>
                    )}
                    <button
                        onClick={onClear}
                        className="text-xs flex items-center gap-1 text-slate-400 hover:text-red-400 transition px-3 py-1.5 rounded hover:bg-red-900/20"
                        aria-label="Clear transcripts"
                    >
                        <Trash2 size={14} /> Clear
                    </button>
                </div>
            </div>

            {/* Error Banner */}
            {error && (
                <div className="px-4 py-2 bg-red-900/30 border-b border-red-700/30 text-red-300 text-xs">
                    ⚠️ {error}
                </div>
            )}

            {/* Agent Status Banner */}
            {isConnected && !isAgentConnected && (
                <div className="px-4 py-3 bg-yellow-900/30 border-b border-yellow-700/30 text-yellow-300 text-xs">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="animate-spin">⏳</span>
                        <span>Waiting for ASR Agent... Start agent with:</span>
                    </div>
                    <div className="flex items-center gap-2 bg-slate-900/50 rounded p-2 font-mono text-[10px] text-slate-300">
                        <code className="flex-1 overflow-x-auto whitespace-nowrap">
                            curl -X POST localhost:3000/livekit/agent/start -H "Content-Type: application/json" -d '{`{"roomName":"${roomName}","provider":"google"}`}'
                        </code>
                        <button
                            onClick={() => {
                                navigator.clipboard.writeText(
                                    `curl -X POST localhost:3000/livekit/agent/start -H "Content-Type: application/json" -d '{"roomName":"${roomName}","provider":"google"}'`
                                );
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                            }}
                            className="p-1 hover:bg-slate-700 rounded transition"
                            title="Copy command"
                        >
                            {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                        </button>
                    </div>
                </div>
            )}

            {/* Content - Fixed Height Scrollable */}
            <div
                ref={scrollRef}
                className="h-[160px] p-4 overflow-y-auto custom-scrollbar"
                style={{
                    scrollbarWidth: 'thin',
                    scrollbarColor: '#7c3aed #1e293b'
                }}
            >
                {!hasContent ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-500">
                        {!isConnected ? (
                            <p className="italic text-center text-sm">
                                Click <span className="text-purple-400">Connect</span> to start LiveKit transcription
                                <br />
                                <span className="text-xs text-slate-600 mt-1 block">
                                    Ultra-low latency via WebRTC (200-500ms)
                                </span>
                            </p>
                        ) : (
                            <p className="italic text-center text-sm">
                                {isAgentConnected
                                    ? 'Speak into your microphone to see transcription...'
                                    : 'Waiting for ASR Agent to start processing...'}
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {transcripts.map((segment, index) => {
                            // Provider-specific colors
                            const providerColors: Record<string, string> = {
                                google: 'text-blue-400 bg-blue-900/30',
                                azure: 'text-cyan-400 bg-cyan-900/30',
                            };
                            const providerColor = segment.provider
                                ? providerColors[segment.provider] || 'text-purple-400 bg-purple-900/30'
                                : 'text-purple-400 bg-purple-900/30';

                            return (
                                <div
                                    key={segment.id}
                                    className="text-slate-100 leading-relaxed p-2 rounded-lg hover:bg-purple-700/20 transition-colors border-l-2 border-purple-500/50"
                                >
                                    <span className="text-xs text-purple-400 mr-2">#{index + 1}</span>
                                    {segment.provider && (
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded mr-2 ${providerColor}`}>
                                            {segment.provider.toUpperCase()}
                                        </span>
                                    )}
                                    <span className="text-base">{segment.text}</span>
                                </div>
                            );
                        })}

                        {/* Interim transcript */}
                        {interimTranscript && (
                            <div
                                className="flex items-start gap-2 p-2 rounded-lg bg-purple-900/30 border-l-2 border-purple-400 text-purple-100"
                                aria-live="polite"
                                aria-label="Live interim transcript"
                            >
                                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-purple-400 animate-pulse" />
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-800/60 text-purple-300 font-semibold">
                                    LIVE
                                </span>
                                <span className="text-base leading-relaxed">{interimTranscript}</span>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Footer - Latency Info */}
            <div className="px-4 py-2 border-t border-purple-700/30 bg-purple-900/10 text-xs text-slate-500 flex justify-between items-center">
                <span>🚀 WebRTC Protocol • Target Latency: 200-500ms</span>
                <span className="text-purple-400">
                    {transcripts.length} segments
                </span>
            </div>
        </div>
    );
};

export default LiveKitPanel;
