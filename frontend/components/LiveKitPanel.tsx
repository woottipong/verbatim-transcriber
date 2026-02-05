/**
 * LiveKitPanel Component
 * Displays LiveKit-based transcription with WebRTC connection status
 * 
 * Features:
 * - Real-time WebRTC connection status
 * - Agent connection indicator
 * - Lower latency than WebSocket (200-500ms vs 500-2000ms)
 */

import React, { useRef, useEffect } from 'react';
import { Trash2, Play, Square, Radio, Users } from 'lucide-react';
import { TranscriptSegment, ConnectionState } from '../types';

interface LiveKitPanelProps {
    transcripts: TranscriptSegment[];
    interimTranscript: string;
    connectionState: ConnectionState;
    isAgentConnected: boolean;
    participantCount: number;
    error: string | null;
    onConnect: () => void;
    onDisconnect: () => void;
    onClear: () => void;
}

const LiveKitPanel: React.FC<LiveKitPanelProps> = ({
    transcripts,
    interimTranscript,
    connectionState,
    isAgentConnected,
    participantCount,
    error,
    onConnect,
    onDisconnect,
    onClear,
}) => {
    const scrollRef = useRef<HTMLDivElement>(null);

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
                return isAgentConnected ? 'Connected + Agent' : 'Connected (Waiting for Agent)';
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
                            className="text-xs flex items-center gap-1 text-slate-300 hover:text-purple-400 transition px-3 py-1.5 rounded bg-purple-900/30 hover:bg-purple-900/50"
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
                <div className="px-4 py-2 bg-yellow-900/30 border-b border-yellow-700/30 text-yellow-300 text-xs flex items-center gap-2">
                    <span className="animate-spin">⏳</span>
                    Waiting for ASR Agent to connect... Start agent at backend: POST /livekit/agent/start
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
                        {transcripts.map((segment, index) => (
                            <div
                                key={segment.id}
                                className="text-slate-100 leading-relaxed p-2 rounded-lg hover:bg-purple-700/20 transition-colors border-l-2 border-purple-500/50"
                            >
                                <span className="text-xs text-purple-400 mr-2">#{index + 1}</span>
                                <span className="text-base">{segment.text}</span>
                            </div>
                        ))}

                        {/* Interim transcript */}
                        {interimTranscript && (
                            <div className="text-purple-200/70 italic p-2 rounded-lg bg-purple-900/20 border-l-2 border-purple-400/50 animate-pulse">
                                <span className="text-xs text-purple-500 mr-2">●</span>
                                {interimTranscript}
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
