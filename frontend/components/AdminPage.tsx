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
    Radio,
    Settings,
    UserMinus,
    Clock,
    ChevronDown,
    ChevronRight,
    AlertTriangle,
    ArrowLeft,
} from 'lucide-react';
import { toHttpUrl } from '../lib/runtime';

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

interface RunningAgent {
    key: string;
    running: boolean;
    provider: string;
    room: string;
}

interface AgentStatus {
    count: number;
    agents: RunningAgent[];
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
    const [agentProvider, setAgentProvider] = useState<'google' | 'gemini' | 'azure'>('google');
    const [isStartingAgent, setIsStartingAgent] = useState(false);
    const [isStoppingAgent, setIsStoppingAgent] = useState(false);

    // Delete confirmation
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    // Convert backend URL to HTTP
    const httpBackendUrl = toHttpUrl(backendUrl);

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

    useEffect(() => {
        if (!deleteConfirm) return undefined;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setDeleteConfirm(null);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [deleteConfirm]);

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
                `${httpBackendUrl}/livekit/agent/start`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        roomName: agentRoom,
                        provider: agentProvider
                    })
                }
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
    const stopAgent = async (roomName: string, provider: string) => {
        setIsStoppingAgent(true);
        setError(null);

        try {
            const response = await fetch(`${httpBackendUrl}/livekit/agent/stop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomName, provider })
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
        <div className="app-shell">
            {/* Header */}
            <header className="app-header">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        {onBack && (
                            <button
                                onClick={onBack}
                                className="control-button control-button--quiet !min-h-10 !px-2.5"
                                title="Back to Stream"
                            >
                                <ArrowLeft size={20} />
                            </button>
                        )}
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-orange-400/35 bg-orange-400/10 text-orange-200">
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
                        className="control-button control-button--quiet disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
                {/* Error Banner */}
                {error && (
                    <div className="mb-5 flex items-center gap-3 rounded-lg border border-red-400/35 bg-red-950/35 p-4" role="alert">
                        <AlertTriangle size={20} className="text-red-400" />
                        <p className="text-sm text-red-400 flex-1">{error}</p>
                        <button
                            onClick={() => setError(null)}
                            className="control-button control-button--quiet !min-h-8 !px-2 text-red-200"
                            aria-label="Dismiss error"
                        >
                            ×
                        </button>
                    </div>
                )}

                <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                    {/* Left: Rooms List */}
                    <div className="lg:col-span-2 space-y-4">
                        <section className="app-panel overflow-hidden">
                            <div className="panel-header flex items-center justify-between px-4 py-3">
                                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                                    <Radio size={14} className="text-emerald-400" />
                                    Active Rooms
                                    <span className="rounded-md border border-slate-600 bg-slate-950/30 px-1.5 py-0.5 text-xs tabular-nums text-slate-300">
                                        {rooms.length}
                                    </span>
                                </h2>
                            </div>

                            <div className="divide-y divide-slate-700/70">
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
                                    <div key={room.name}>
                                            <div className="flex items-center justify-between px-2 py-2">
                                            <button
                                                type="button"
                                                className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1 text-left transition-colors hover:bg-slate-700/30"
                                                onClick={() => toggleRoom(room.name)}
                                                aria-expanded={expandedRooms.has(room.name)}
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

                                            </button>
                                            <button
                                                    type="button"
                                                    onClick={() => setDeleteConfirm(room.name)}
                                                    className="control-button control-button--quiet !min-h-8 !px-2 text-slate-400 hover:!text-red-200"
                                                    title="Delete Room"
                                                    aria-label={`Delete room ${room.name}`}
                                                >
                                                    <Trash2 size={16} />
                                            </button>
                                            </div>

                                            {/* Extended: Participants List */}
                                            {expandedRooms.has(room.name) && room.participants.length > 0 && (
                                                <div className="px-4 pb-3 pl-10">
                                                    <div className="divide-y divide-slate-700/70 rounded-lg border border-slate-700 bg-slate-950/20">
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
                                                                    className="control-button control-button--quiet !min-h-7 !px-1.5 text-slate-500 hover:!text-red-200"
                                                                    title="Remove Participant"
                                                                    aria-label={`Remove ${p.identity}`}
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
                        </section>
                    </div>

                    {/* Right: Agent Control */}
                    <div className="space-y-4">
                        {/* Running Agents */}
                        {agentStatus && agentStatus.count > 0 && (
                            <section className="app-panel p-4">
                                <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
                                    <Bot size={14} className="text-green-400" />
                                    Active Agents ({agentStatus.count})
                                </h2>
                                <div className="space-y-2">
                                    {agentStatus.agents.map(agent => (
                                        <div key={agent.key} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/20 p-2.5">
                                            <div className="flex items-center gap-2">
                                                <span className="status-dot status-dot--live" aria-label="Running" />
                                                <span className="text-sm text-white">{agent.room}</span>
                                                <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase border ${getProviderColor(agent.provider)}`}>
                                                    {agent.provider}
                                                </span>
                                            </div>
                                            <button
                                                onClick={() => stopAgent(agent.room, agent.provider)}
                                                disabled={isStoppingAgent}
                                                className="control-button control-button--quiet !min-h-8 !px-2 text-red-200 disabled:opacity-50"
                                                title="Remove Agent"
                                                aria-label={`Stop ${agent.provider} agent in ${agent.room}`}
                                            >
                                                <UserMinus size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* Add Agent Form - Always visible */}
                        <section className="app-panel p-4">
                            <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-4">
                                <Bot size={14} className="text-purple-400" />
                                Add Agent to Room
                            </h2>

                            <div className="space-y-3">
                                <div>
                                    <label htmlFor="agent-room" className="mb-1 block text-xs font-medium text-slate-400">Select room</label>
                                    {rooms.length > 0 ? (
                                        <select
                                            value={agentRoom}
                                            onChange={(e) => setAgentRoom(e.target.value)}
                                            id="agent-room"
                                            className="h-10 w-full rounded-lg border border-slate-600 bg-slate-950/40 px-3 text-sm text-white"
                                        >
                                            <option value="">-- Select a room --</option>
                                            {rooms.map(room => (
                                                <option key={room.name} value={room.name}>
                                                    {room.name} ({room.numParticipants} users)
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <input
                                            type="text"
                                            value={agentRoom}
                                            onChange={(e) => setAgentRoom(e.target.value)}
                                            placeholder="Enter room name..."
                                            id="agent-room"
                                            className="h-10 w-full rounded-lg border border-slate-600 bg-slate-950/40 px-3 text-sm text-white placeholder-slate-500"
                                        />
                                    )}
                                </div>
                                <div>
                                    <label htmlFor="agent-provider" className="mb-1 block text-xs font-medium text-slate-400">Provider</label>
                                    <select
                                        value={agentProvider}
                                        onChange={(e) => setAgentProvider(e.target.value as 'google' | 'gemini' | 'azure')}
                                        id="agent-provider"
                                        className="h-10 w-full rounded-lg border border-slate-600 bg-slate-950/40 px-3 text-sm text-white"
                                    >
                                        <option value="google">Google Cloud STT</option>
                                        <option value="gemini">Gemini Live STT (text)</option>
                                        <option value="azure">Azure Speech</option>
                                    </select>
                                </div>
                                <button
                                    onClick={startAgent}
                                    disabled={!agentRoom || isStartingAgent}
                                    className="control-button control-button--primary w-full disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {isStartingAgent ? (
                                        <RefreshCw size={14} className="animate-spin" />
                                    ) : (
                                        <Bot size={14} />
                                    )}
                                    Inject Agent
                                </button>
                            </div>
                        </section>

                        {/* Quick Inject */}
                        {rooms.length > 0 && (
                            <section className="app-panel p-4">
                                <h2 className="text-sm font-semibold text-white mb-3">Quick Inject</h2>
                                <div className="space-y-2">
                                    {rooms.map(room => (
                                        <button
                                            key={room.name}
                                            onClick={() => {
                                                setAgentRoom(room.name);
                                            }}
                                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-300 transition-colors hover:bg-violet-400/10 hover:text-violet-200"
                                        >
                                            <Bot size={14} />
                                            Add agent to "{room.name}"
                                        </button>
                                    ))}
                                </div>
                            </section>
                        )}
                    </div>
                </div>
            </main>

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" role="presentation" onMouseDown={() => setDeleteConfirm(null)}>
                    <div className="app-panel w-full max-w-md p-5" role="dialog" aria-modal="true" aria-labelledby="delete-room-title" onMouseDown={(event) => event.stopPropagation()}>
                        <h3 id="delete-room-title" className="mb-2 text-lg font-semibold text-white">Delete room</h3>
                        <p className="text-slate-400 mb-4">
                            Are you sure you want to delete room <span className="text-white font-medium">"{deleteConfirm}"</span>?
                            This will disconnect all participants.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setDeleteConfirm(null)}
                                className="control-button control-button--quiet flex-1"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => deleteRoom(deleteConfirm)}
                                className="control-button control-button--danger flex-1"
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
