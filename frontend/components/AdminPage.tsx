/**
 * AdminPage Component
 * LiveKit Room Management Dashboard
 * - List all rooms with details
 * - Delete rooms
 * - Remove participants
 * - Start/Stop ASR agents
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    RefreshCw,
    Users,
    Trash2,
    Bot,
    Play,
    Square,
    Radio,
    Settings,
    UserMinus,
    Clock,
    ChevronDown,
    ChevronRight,
    AlertTriangle,
    ArrowLeft,
} from 'lucide-react';
import { ConnectionState } from '../types';

interface ParticipantInfo {
    identity: string;
    name: string;
    isAgent: boolean;
    state: string;
}

interface DetailedRoom {
    name: string;
    numParticipants: number;
    maxParticipants: number;
    creationTime: number;
    emptyTimeout: number;
    participants: ParticipantInfo[];
}

interface AgentStatus {
    isRunning: boolean;
    room: string;
    provider: string;
    startedAt?: number;
}

interface AdminPageProps {
    onBack?: () => void;
    backendUrl: string;
}

export default function AdminPage({ onBack, backendUrl }: AdminPageProps) {
    // State
    const [rooms, setRooms] = useState<DetailedRoom[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
    const [expandedRooms, setExpandedRooms] = useState<Set<string>>(new Set());

    // Agent start form
    const [agentRoom, setAgentRoom] = useState('');
    const [agentProvider, setAgentProvider] = useState<'google' | 'azure'>('google');
    const [isStartingAgent, setIsStartingAgent] = useState(false);
    const [isStoppingAgent, setIsStoppingAgent] = useState(false);

    // Delete confirmation
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    // Convert backend URL to HTTP
    const httpBackendUrl = backendUrl.replace('ws://', 'http://').replace('wss://', 'https://');

    // Fetch rooms
    const fetchRooms = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch(`${httpBackendUrl}/livekit/rooms/detailed`);
            if (!response.ok) {
                throw new Error(`Failed to fetch rooms: ${response.status}`);
            }
            const data = await response.json();
            setRooms(data.rooms || []);
        } catch (err) {
            console.error('[Admin] Failed to fetch rooms:', err);
            setError(err instanceof Error ? err.message : 'Failed to fetch rooms');
        } finally {
            setIsLoading(false);
        }
    }, [httpBackendUrl]);

    // Fetch agent status
    const fetchAgentStatus = useCallback(async () => {
        try {
            const response = await fetch(`${httpBackendUrl}/livekit/agent/status`);
            if (response.ok) {
                const data = await response.json();
                setAgentStatus(data);
            }
        } catch (err) {
            console.error('[Admin] Failed to fetch agent status:', err);
        }
    }, [httpBackendUrl]);

    // Initial fetch and polling
    useEffect(() => {
        fetchRooms();
        fetchAgentStatus();
        const interval = setInterval(() => {
            fetchRooms();
            fetchAgentStatus();
        }, 5000);
        return () => clearInterval(interval);
    }, [fetchRooms, fetchAgentStatus]);

    // Delete room
    const deleteRoom = async (roomName: string) => {
        try {
            const response = await fetch(`${httpBackendUrl}/livekit/rooms/${encodeURIComponent(roomName)}`, {
                method: 'DELETE',
            });
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to delete room');
            }
            setDeleteConfirm(null);
            fetchRooms();
        } catch (err) {
            console.error('[Admin] Failed to delete room:', err);
            setError(err instanceof Error ? err.message : 'Failed to delete room');
        }
    };

    // Remove participant
    const removeParticipant = async (roomName: string, identity: string) => {
        try {
            const response = await fetch(
                `${httpBackendUrl}/livekit/rooms/${encodeURIComponent(roomName)}/participants/${encodeURIComponent(identity)}`,
                { method: 'DELETE' }
            );
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to remove participant');
            }
            fetchRooms();
        } catch (err) {
            console.error('[Admin] Failed to remove participant:', err);
            setError(err instanceof Error ? err.message : 'Failed to remove participant');
        }
    };

    // Start agent
    const startAgent = async () => {
        if (!agentRoom) return;

        setIsStartingAgent(true);
        setError(null);

        try {
            const response = await fetch(
                `${httpBackendUrl}/livekit/agent/start?room=${encodeURIComponent(agentRoom)}&provider=${agentProvider}`,
                { method: 'POST' }
            );
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to start agent');
            }
            fetchAgentStatus();
            setAgentRoom('');
        } catch (err) {
            console.error('[Admin] Failed to start agent:', err);
            setError(err instanceof Error ? err.message : 'Failed to start agent');
        } finally {
            setIsStartingAgent(false);
        }
    };

    // Stop agent
    const stopAgent = async () => {
        setIsStoppingAgent(true);
        setError(null);

        try {
            const response = await fetch(`${httpBackendUrl}/livekit/agent/stop`, {
                method: 'POST',
            });
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to stop agent');
            }
            fetchAgentStatus();
        } catch (err) {
            console.error('[Admin] Failed to stop agent:', err);
            setError(err instanceof Error ? err.message : 'Failed to stop agent');
        } finally {
            setIsStoppingAgent(false);
        }
    };

    // Toggle room expansion
    const toggleRoom = (roomName: string) => {
        setExpandedRooms(prev => {
            const next = new Set(prev);
            if (next.has(roomName)) {
                next.delete(roomName);
            } else {
                next.add(roomName);
            }
            return next;
        });
    };

    // Format timestamp
    const formatTime = (timestamp: number) => {
        return new Date(timestamp * 1000).toLocaleString();
    };

    // Get provider badge color
    const getProviderColor = (provider: string) => {
        switch (provider?.toLowerCase()) {
            case 'google':
                return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
            case 'azure':
                return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
            default:
                return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
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
                                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
                                title="Back to Stream"
                            >
                                <ArrowLeft size={20} />
                            </button>
                        )}
                        <span className="bg-gradient-to-r from-orange-500 to-red-500 text-white p-2 rounded-lg shadow-lg">
                            <Settings size={18} />
                        </span>
                        <div>
                            <h1 className="text-lg font-bold text-white">LiveKit Admin</h1>
                            <p className="text-xs text-slate-400">Room & Agent Management</p>
                        </div>
                    </div>

                    <button
                        onClick={() => {
                            fetchRooms();
                            fetchAgentStatus();
                        }}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-300 hover:text-white bg-slate-700/50 hover:bg-slate-700 rounded-lg border border-slate-600/50 transition disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
                {/* Error Banner */}
                {error && (
                    <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-3">
                        <AlertTriangle size={20} className="text-red-400" />
                        <p className="text-sm text-red-400 flex-1">{error}</p>
                        <button
                            onClick={() => setError(null)}
                            className="text-red-400 hover:text-red-300"
                        >
                            ×
                        </button>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Left: Rooms List */}
                    <div className="lg:col-span-2 space-y-4">
                        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 overflow-hidden">
                            <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
                                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                                    <Radio size={14} className="text-emerald-400" />
                                    Active Rooms
                                    <span className="px-2 py-0.5 text-xs bg-slate-700 rounded-full">
                                        {rooms.length}
                                    </span>
                                </h2>
                            </div>

                            <div className="divide-y divide-slate-700/50">
                                {rooms.length === 0 ? (
                                    <div className="p-8 text-center text-slate-500">
                                        {isLoading ? (
                                            <div className="flex items-center justify-center gap-2">
                                                <RefreshCw size={16} className="animate-spin" />
                                                Loading...
                                            </div>
                                        ) : (
                                            'No active rooms'
                                        )}
                                    </div>
                                ) : (
                                    rooms.map(room => (
                                        <div key={room.name} className="bg-slate-800/30">
                                            {/* Room Header */}
                                            <div
                                                className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-slate-700/30 transition"
                                                onClick={() => toggleRoom(room.name)}
                                            >
                                                <div className="flex items-center gap-3">
                                                    {expandedRooms.has(room.name) ? (
                                                        <ChevronDown size={16} className="text-slate-400" />
                                                    ) : (
                                                        <ChevronRight size={16} className="text-slate-400" />
                                                    )}
                                                    <div>
                                                        <p className="font-medium text-white">{room.name}</p>
                                                        <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                                                            <span className="flex items-center gap-1">
                                                                <Users size={12} />
                                                                {room.numParticipants} participant{room.numParticipants !== 1 ? 's' : ''}
                                                            </span>
                                                            <span className="flex items-center gap-1">
                                                                <Clock size={12} />
                                                                {formatTime(room.creationTime)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Delete Button */}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setDeleteConfirm(room.name);
                                                    }}
                                                    className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition"
                                                    title="Delete Room"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>

                                            {/* Extended: Participants List */}
                                            {expandedRooms.has(room.name) && room.participants.length > 0 && (
                                                <div className="px-4 pb-3 pl-10">
                                                    <div className="bg-slate-700/30 rounded-lg divide-y divide-slate-600/30">
                                                        {room.participants.map(p => (
                                                            <div
                                                                key={p.identity}
                                                                className="px-3 py-2 flex items-center justify-between"
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    {p.isAgent ? (
                                                                        <Bot size={14} className="text-purple-400" />
                                                                    ) : (
                                                                        <Users size={14} className="text-slate-400" />
                                                                    )}
                                                                    <span className={`text-sm ${p.isAgent ? 'text-purple-300' : 'text-slate-300'}`}>
                                                                        {p.identity}
                                                                    </span>
                                                                    {p.isAgent && (
                                                                        <span className="px-1.5 py-0.5 text-[10px] bg-purple-500/20 text-purple-400 rounded">
                                                                            AGENT
                                                                        </span>
                                                                    )}
                                                                    <span className="text-[10px] text-slate-500">
                                                                        {p.state}
                                                                    </span>
                                                                </div>
                                                                <button
                                                                    onClick={() => removeParticipant(room.name, p.identity)}
                                                                    className="p-1 text-slate-500 hover:text-red-400 transition"
                                                                    title="Remove Participant"
                                                                >
                                                                    <UserMinus size={14} />
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right: Agent Control */}
                    <div className="space-y-4">
                        {/* Agent Status */}
                        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-4">
                            <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
                                <Bot size={14} className="text-purple-400" />
                                ASR Agent
                            </h2>

                            {agentStatus?.isRunning ? (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2">
                                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                                        <span className="text-sm text-green-400 font-medium">Running</span>
                                    </div>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between">
                                            <span className="text-slate-400">Room:</span>
                                            <span className="text-white font-medium">{agentStatus.room}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-slate-400">Provider:</span>
                                            <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase border ${getProviderColor(agentStatus.provider)}`}>
                                                {agentStatus.provider}
                                            </span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={stopAgent}
                                        disabled={isStoppingAgent}
                                        className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 font-medium rounded-lg border border-red-500/30 transition disabled:opacity-50"
                                    >
                                        {isStoppingAgent ? (
                                            <RefreshCw size={14} className="animate-spin" />
                                        ) : (
                                            <Square size={14} />
                                        )}
                                        Stop Agent
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2">
                                        <span className="w-2 h-2 bg-slate-500 rounded-full" />
                                        <span className="text-sm text-slate-400">Not Running</span>
                                    </div>

                                    {/* Start Agent Form */}
                                    <div className="space-y-3 pt-2 border-t border-slate-700/50">
                                        <div>
                                            <label className="block text-xs text-slate-400 mb-1">Room Name</label>
                                            <input
                                                type="text"
                                                value={agentRoom}
                                                onChange={(e) => setAgentRoom(e.target.value)}
                                                placeholder="thai-transcription"
                                                className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600/50 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500/50"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs text-slate-400 mb-1">Provider</label>
                                            <select
                                                value={agentProvider}
                                                onChange={(e) => setAgentProvider(e.target.value as 'google' | 'azure')}
                                                className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600/50 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500/50"
                                            >
                                                <option value="google">Google Cloud STT</option>
                                                <option value="azure">Azure Speech</option>
                                            </select>
                                        </div>
                                        <button
                                            onClick={startAgent}
                                            disabled={!agentRoom || isStartingAgent}
                                            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 font-medium rounded-lg border border-purple-500/30 transition disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isStartingAgent ? (
                                                <RefreshCw size={14} className="animate-spin" />
                                            ) : (
                                                <Play size={14} />
                                            )}
                                            Start Agent
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Quick Actions */}
                        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-4">
                            <h2 className="text-sm font-semibold text-white mb-3">Quick Actions</h2>
                            <div className="space-y-2">
                                {rooms.map(room => (
                                    <button
                                        key={room.name}
                                        onClick={() => {
                                            setAgentRoom(room.name);
                                        }}
                                        disabled={agentStatus?.isRunning}
                                        className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700/50 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Start agent in "{room.name}"
                                    </button>
                                ))}
                                {rooms.length === 0 && (
                                    <p className="text-sm text-slate-500 text-center py-2">
                                        No rooms available
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </main>

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 max-w-md w-full mx-4 shadow-xl">
                        <h3 className="text-lg font-bold text-white mb-2">Delete Room</h3>
                        <p className="text-slate-400 mb-4">
                            Are you sure you want to delete room <span className="text-white font-medium">"{deleteConfirm}"</span>?
                            This will disconnect all participants.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setDeleteConfirm(null)}
                                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => deleteRoom(deleteConfirm)}
                                className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
