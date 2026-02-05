/**
 * ViewerPage Component
 * A dedicated page for viewing LiveKit room transcriptions
 * - Lists available rooms
 * - Shows active ASR agents
 * - Filters transcripts by provider
 * - Read-only (no microphone)
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Users, Radio, Filter, Trash2, X, Bot, Eye } from 'lucide-react';
import { useRoomViewer, AgentInfo } from '../hooks/useRoomViewer';
import { ConnectionState, TranscriptSegment } from '../types';
import ConnectionBadge from './ConnectionBadge';

interface RoomInfo {
    name: string;
    numParticipants: number;
    creationTime: number;
}

interface ViewerPageProps {
    onBack?: () => void;  // Callback to go back to main app
    backendUrl: string;
}

export default function ViewerPage({ onBack, backendUrl }: ViewerPageProps) {
    // Room list state
    const [rooms, setRooms] = useState<RoomInfo[]>([]);
    const [isLoadingRooms, setIsLoadingRooms] = useState(false);
    const [roomsError, setRoomsError] = useState<string | null>(null);

    // Provider filter
    const [selectedProviders, setSelectedProviders] = useState<Set<string>>(new Set());
    const [showFilterMenu, setShowFilterMenu] = useState(false);

    // Convert backend URL to HTTP
    const httpBackendUrl = backendUrl.replace('ws://', 'http://').replace('wss://', 'https://');

    // Room viewer hook
    const viewer = useRoomViewer({
        tokenEndpoint: `${httpBackendUrl}/livekit/token`,
    });

    // Fetch available rooms
    const fetchRooms = useCallback(async () => {
        setIsLoadingRooms(true);
        setRoomsError(null);

        try {
            const response = await fetch(`${httpBackendUrl}/livekit/rooms`);
            if (!response.ok) {
                throw new Error(`Failed to fetch rooms: ${response.status}`);
            }
            const data = await response.json();
            setRooms(data.rooms || []);
        } catch (err) {
            console.error('[Viewer] Failed to fetch rooms:', err);
            setRoomsError(err instanceof Error ? err.message : 'Failed to fetch rooms');
        } finally {
            setIsLoadingRooms(false);
        }
    }, [httpBackendUrl]);

    // Fetch rooms on mount and periodically
    useEffect(() => {
        fetchRooms();
        const interval = setInterval(fetchRooms, 10000); // Refresh every 10s
        return () => clearInterval(interval);
    }, [fetchRooms]);

    // Get unique providers from agents
    const availableProviders = useMemo(() => {
        const providers = new Set<string>();
        viewer.agents.forEach(agent => {
            if (agent.provider) providers.add(agent.provider);
        });
        // Also check transcripts for providers
        viewer.transcripts.forEach(t => {
            if (t.provider) providers.add(t.provider);
        });
        const result = Array.from(providers).sort();
        console.log('[Viewer Filter] Available providers:', result, 'Agents:', viewer.agents, 'Transcripts count:', viewer.transcripts.length);
        return result;
    }, [viewer.agents, viewer.transcripts]);

    // Filter transcripts by selected providers
    const filteredTranscripts = useMemo(() => {
        console.log('[Viewer Filter] Selected providers:', Array.from(selectedProviders), 'Total transcripts:', viewer.transcripts.length);
        if (selectedProviders.size === 0) {
            return viewer.transcripts; // Show all if no filter
        }
        const filtered = viewer.transcripts.filter(t =>
            t.provider && selectedProviders.has(t.provider)
        );
        console.log('[Viewer Filter] Filtered count:', filtered.length);
        return filtered;
    }, [viewer.transcripts, selectedProviders]);

    // Toggle provider filter
    const toggleProvider = (provider: string) => {
        setSelectedProviders(prev => {
            const next = new Set(prev);
            if (next.has(provider)) {
                next.delete(provider);
            } else {
                next.add(provider);
            }
            return next;
        });
    };

    // Provider color mapping
    const getProviderColor = (provider: string) => {
        switch (provider.toLowerCase()) {
            case 'google': return 'text-blue-400 bg-blue-500/20 border-blue-500/30';
            case 'azure': return 'text-cyan-400 bg-cyan-500/20 border-cyan-500/30';
            case 'deepgram': return 'text-indigo-400 bg-indigo-500/20 border-indigo-500/30';
            case 'gemini': return 'text-purple-400 bg-purple-500/20 border-purple-500/30';
            default: return 'text-slate-400 bg-slate-500/20 border-slate-500/30';
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
            {/* Header */}
            <header className="border-b border-slate-700/50 backdrop-blur-sm bg-slate-900/50 sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        {onBack && (
                            <button
                                onClick={onBack}
                                className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition"
                                title="Close Viewer"
                            >
                                <X size={20} />
                            </button>
                        )}
                        <span className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white p-2 rounded-lg shadow-lg">
                            <Eye size={18} />
                        </span>
                        <div>
                            <h1 className="text-lg font-bold text-white">Transcript Viewer</h1>
                            <p className="text-xs text-slate-400">Watch live transcriptions</p>
                        </div>
                    </div>

                    {/* Connection Status */}
                    {viewer.currentRoomName && (
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-slate-400">
                                Room: <span className="text-white font-medium">{viewer.currentRoomName}</span>
                            </span>
                            <ConnectionBadge state={viewer.connectionState} />
                        </div>
                    )}
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    {/* Left Sidebar - Room List */}
                    <div className="lg:col-span-1 space-y-4">
                        {/* Room List Card */}
                        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-4">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                                    <Radio size={14} className="text-emerald-400" />
                                    Active Rooms
                                </h2>
                                <button
                                    onClick={fetchRooms}
                                    disabled={isLoadingRooms}
                                    className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition disabled:opacity-50"
                                    title="Refresh rooms"
                                >
                                    <RefreshCw size={14} className={isLoadingRooms ? 'animate-spin' : ''} />
                                </button>
                            </div>

                            {roomsError && (
                                <p className="text-xs text-red-400 mb-3">{roomsError}</p>
                            )}

                            {rooms.length === 0 ? (
                                <p className="text-sm text-slate-500 text-center py-4">
                                    {isLoadingRooms ? 'Loading...' : 'No active rooms'}
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {rooms.map(room => (
                                        <button
                                            key={room.name}
                                            onClick={() => viewer.connect(room.name)}
                                            disabled={viewer.connectionState === ConnectionState.CONNECTING}
                                            className={`w-full text-left p-3 rounded-lg border transition ${viewer.currentRoomName === room.name
                                                ? 'bg-emerald-500/20 border-emerald-500/50 text-white'
                                                : 'bg-slate-700/30 border-slate-600/30 text-slate-300 hover:bg-slate-700/50'
                                                }`}
                                        >
                                            <div className="font-medium text-sm">{room.name}</div>
                                            <div className="flex items-center gap-1 text-xs text-slate-400 mt-1">
                                                <Users size={12} />
                                                {room.numParticipants} participant{room.numParticipants !== 1 ? 's' : ''}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}

                            {viewer.connectionState === ConnectionState.CONNECTED && (
                                <button
                                    onClick={viewer.disconnect}
                                    className="w-full mt-4 px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm font-medium rounded-lg border border-red-500/30 transition"
                                >
                                    Disconnect
                                </button>
                            )}
                        </div>

                        {/* Active Agents Card */}
                        {viewer.connectionState === ConnectionState.CONNECTED && (
                            <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-4">
                                <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                                    <Bot size={14} className="text-purple-400" />
                                    Active Agents
                                </h2>

                                {viewer.agents.length === 0 ? (
                                    <p className="text-sm text-slate-500 text-center py-2">
                                        No agents connected
                                    </p>
                                ) : (
                                    <div className="space-y-2">
                                        {viewer.agents.map(agent => (
                                            <div
                                                key={agent.identity}
                                                className={`flex items-center justify-between p-2 rounded-lg border ${getProviderColor(agent.provider)}`}
                                            >
                                                <span className="text-sm font-medium">{agent.provider}</span>
                                                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Main Content - Transcript Area */}
                    <div className="lg:col-span-3">
                        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 overflow-hidden">
                            {/* Toolbar */}
                            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
                                <div className="flex items-center gap-3">
                                    <h2 className="text-sm font-semibold text-white">
                                        Transcripts
                                    </h2>
                                    <span className="text-xs text-slate-500">
                                        {filteredTranscripts.length} segment{filteredTranscripts.length !== 1 ? 's' : ''}
                                    </span>
                                </div>

                                <div className="flex items-center gap-2">
                                    {/* Provider Filter */}
                                    {availableProviders.length > 0 && (
                                        <div className="relative">
                                            <button
                                                onClick={() => setShowFilterMenu(!showFilterMenu)}
                                                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition ${selectedProviders.size > 0
                                                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                                                    : 'bg-slate-700/50 border-slate-600/50 text-slate-300 hover:bg-slate-700'
                                                    }`}
                                            >
                                                <Filter size={12} />
                                                Filter
                                                {selectedProviders.size > 0 && (
                                                    <span className="ml-1 px-1.5 bg-emerald-500 text-white rounded text-[10px]">
                                                        {selectedProviders.size}
                                                    </span>
                                                )}
                                            </button>

                                            {showFilterMenu && (
                                                <div className="absolute right-0 mt-2 w-40 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-10">
                                                    <div className="p-2 space-y-1">
                                                        {availableProviders.map(provider => (
                                                            <button
                                                                key={provider}
                                                                onClick={() => toggleProvider(provider)}
                                                                className={`w-full text-left px-3 py-2 text-sm rounded-lg transition ${selectedProviders.has(provider)
                                                                    ? 'bg-emerald-500/20 text-emerald-400'
                                                                    : 'text-slate-300 hover:bg-slate-700'
                                                                    }`}
                                                            >
                                                                {provider}
                                                            </button>
                                                        ))}
                                                        {selectedProviders.size > 0 && (
                                                            <button
                                                                onClick={() => setSelectedProviders(new Set())}
                                                                className="w-full text-left px-3 py-2 text-sm text-slate-400 hover:text-white rounded-lg transition"
                                                            >
                                                                Clear all
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Clear Button */}
                                    <button
                                        onClick={viewer.clearTranscripts}
                                        disabled={viewer.transcripts.length === 0}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white bg-slate-700/50 hover:bg-slate-700 rounded-lg border border-slate-600/50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        <Trash2 size={12} />
                                        Clear
                                    </button>
                                </div>
                            </div>

                            {/* Transcript List */}
                            <div className="h-[500px] overflow-y-auto p-4 space-y-3">
                                {viewer.connectionState !== ConnectionState.CONNECTED ? (
                                    <div className="flex flex-col items-center justify-center h-full text-slate-500">
                                        <Radio size={32} className="mb-3 opacity-50" />
                                        <p className="text-sm">Select a room to start viewing</p>
                                    </div>
                                ) : filteredTranscripts.length === 0 && viewer.interimTranscripts.size === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full text-slate-500">
                                        <Bot size={32} className="mb-3 opacity-50" />
                                        <p className="text-sm">Waiting for transcripts...</p>
                                        {viewer.agents.length === 0 && (
                                            <p className="text-xs text-slate-600 mt-1">No agents connected yet</p>
                                        )}
                                    </div>
                                ) : (
                                    <>
                                        {/* Final transcripts */}
                                        {filteredTranscripts.map(segment => (
                                            <div
                                                key={segment.id}
                                                className="flex gap-3 p-3 bg-slate-700/30 rounded-lg"
                                            >
                                                {segment.provider && (
                                                    <span className={`shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase rounded ${getProviderColor(segment.provider)}`}>
                                                        {segment.provider}
                                                    </span>
                                                )}
                                                <p className="text-sm text-slate-200 leading-relaxed flex-1">
                                                    {segment.text}
                                                </p>
                                                <span className="shrink-0 text-[10px] text-slate-500">
                                                    {new Date(segment.timestamp).toLocaleTimeString()}
                                                </span>
                                            </div>
                                        ))}

                                        {/* Interim transcripts (per agent) */}
                                        {Array.from(viewer.interimTranscripts.entries()).map(([agentId, text]) => {
                                            const agent = viewer.agents.find(a => a.identity === agentId);
                                            const provider = agent?.provider || 'unknown';

                                            // Skip if filtered out
                                            if (selectedProviders.size > 0 && !selectedProviders.has(provider)) {
                                                return null;
                                            }

                                            return (
                                                <div
                                                    key={`interim-${agentId}`}
                                                    className="flex gap-3 p-3 bg-slate-700/20 rounded-lg border border-dashed border-slate-600/50"
                                                >
                                                    <span className={`shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase rounded opacity-60 ${getProviderColor(provider)}`}>
                                                        {provider}
                                                    </span>
                                                    <p className="text-sm text-slate-400 italic leading-relaxed flex-1">
                                                        {text}
                                                    </p>
                                                </div>
                                            );
                                        })}
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Error Display */}
                        {viewer.error && (
                            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                                <p className="text-sm text-red-400">{viewer.error}</p>
                            </div>
                        )}
                    </div>
                </div>
            </main>

            {/* Click outside to close filter menu */}
            {showFilterMenu && (
                <div
                    className="fixed inset-0 z-0"
                    onClick={() => setShowFilterMenu(false)}
                />
            )}
        </div>
    );
}
