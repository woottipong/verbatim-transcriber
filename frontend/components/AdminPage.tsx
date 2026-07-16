import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle,
    ArrowLeft,
    Bot,
    Check,
    Copy,
    ExternalLink,
    Eye,
    Link2,
    LoaderCircle,
    Plus,
    Radio,
    RefreshCw,
    Search,
    Settings,
    Trash2,
    UserMinus,
    Users,
    X,
} from 'lucide-react';
import {
    AgentStatus,
    createRoom,
    createTranscriptToken,
    fetchAgentStatus,
    fetchDetailedRooms,
    RoomDetails,
    RunningAgent,
    TranscriptTokenResponse,
} from '../lib/api';
import { buildStreamUrl, buildViewerUrl } from '../lib/appRoutes';
import {
    isTranscriptTokenResponse,
    keepSelectedRoom,
    selectRoomAfterDelete,
    validateRoomName,
} from '../lib/adminRooms';
import { getControlAuthHeaders, toHttpUrl } from '../lib/runtime';

interface AdminPageProps {
    onBack?: () => void;
    backendUrl: string;
}

type AgentProvider = 'google' | 'gemini' | 'azure';

interface Notice {
    tone: 'success' | 'error';
    message: string;
}

interface TranscriptLinkState {
    roomName: string;
    response: TranscriptTokenResponse;
}

const providerLabels: Record<AgentProvider, string> = {
    google: 'Google Cloud STT',
    gemini: 'Gemini Live',
    azure: 'Azure Speech',
};

export default function AdminPage({ onBack, backendUrl }: AdminPageProps) {
    const httpBackendUrl = toHttpUrl(backendUrl);
    const appBaseUrl = `${window.location.origin}${window.location.pathname}`;
    const [rooms, setRooms] = useState<RoomDetails[]>([]);
    const [selectedRoomName, setSelectedRoomName] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [agentStatus, setAgentStatus] = useState<AgentStatus>({ count: 0, agents: [] });
    const [agentProvider, setAgentProvider] = useState<AgentProvider>('google');
    const [isLoadingRooms, setIsLoadingRooms] = useState(false);
    const [isStartingAgent, setIsStartingAgent] = useState(false);
    const [stoppingAgentKey, setStoppingAgentKey] = useState<string | null>(null);
    const [isCreatingRoom, setIsCreatingRoom] = useState(false);
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [newRoomName, setNewRoomName] = useState('');
    const [createRoomError, setCreateRoomError] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [isDeletingRoom, setIsDeletingRoom] = useState(false);
    const [isGeneratingTranscriptLink, setIsGeneratingTranscriptLink] = useState(false);
    const [transcriptLink, setTranscriptLink] = useState<TranscriptLinkState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<Notice | null>(null);
    const createRoomInputRef = useRef<HTMLInputElement>(null);
    const noticeTimerRef = useRef<number | null>(null);
    const roomsRequestRef = useRef(0);
    const agentStatusRequestRef = useRef(0);

    const selectedRoom = rooms.find(room => room.name === selectedRoomName) || null;
    const selectedAgents = useMemo(
        () => agentStatus.agents.filter(agent => agent.room === selectedRoomName),
        [agentStatus.agents, selectedRoomName],
    );
    const filteredRooms = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return rooms;
        return rooms.filter(room => room.name.toLowerCase().includes(query));
    }, [rooms, searchQuery]);
    const activeTranscriptLink = transcriptLink?.roomName === selectedRoomName
        && isTranscriptTokenResponse(transcriptLink.response)
        ? transcriptLink.response
        : null;

    const showNotice = useCallback((nextNotice: Notice) => {
        setNotice(nextNotice);
        if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = window.setTimeout(() => setNotice(null), 3600);
    }, []);

    useEffect(() => {
        return () => {
            if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
        };
    }, []);

    useEffect(() => {
        setSelectedRoomName(current => keepSelectedRoom(current, rooms));
    }, [rooms]);

    useEffect(() => {
        if (!isCreateDialogOpen) return undefined;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !isCreatingRoom) setIsCreateDialogOpen(false);
        };
        window.addEventListener('keydown', handleKeyDown);
        window.setTimeout(() => createRoomInputRef.current?.focus(), 0);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isCreateDialogOpen, isCreatingRoom]);

    const refreshRooms = useCallback(async () => {
        const requestId = ++roomsRequestRef.current;
        setIsLoadingRooms(true);
        try {
            const nextRooms = await fetchDetailedRooms(backendUrl);
            if (requestId !== roomsRequestRef.current) return;
            setRooms(nextRooms);
            setError(null);
        } catch (err) {
            if (requestId !== roomsRequestRef.current) return;
            setError(err instanceof Error ? err.message : 'Failed to load rooms');
        } finally {
            if (requestId === roomsRequestRef.current) setIsLoadingRooms(false);
        }
    }, [backendUrl]);

    const refreshAgentStatus = useCallback(async () => {
        const requestId = ++agentStatusRequestRef.current;
        try {
            const nextStatus = await fetchAgentStatus(backendUrl);
            if (requestId === agentStatusRequestRef.current) setAgentStatus(nextStatus);
        } catch (err) {
            if (requestId !== agentStatusRequestRef.current) return;
            // Agent routes are intentionally absent when no ASR provider is configured.
            console.warn('[Admin] Agent status unavailable:', err);
            setAgentStatus({ count: 0, agents: [] });
        }
    }, [backendUrl]);

    useEffect(() => {
        void refreshRooms();
        void refreshAgentStatus();
        const interval = window.setInterval(() => {
            void refreshRooms();
            void refreshAgentStatus();
        }, 5000);
        return () => window.clearInterval(interval);
    }, [refreshAgentStatus, refreshRooms]);

    const handleCreateRoom = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const normalizedName = newRoomName.trim();
        const validationError = validateRoomName(normalizedName);
        if (validationError) {
            setCreateRoomError(validationError);
            return;
        }

        setIsCreatingRoom(true);
        setCreateRoomError(null);
        try {
            const room = await createRoom(backendUrl, normalizedName);
            setRooms(current => [
                ...current.filter(existing => existing.name !== room.name),
                { ...room, participants: room.participants || [] },
            ]);
            setSelectedRoomName(room.name);
            setNewRoomName('');
            setIsCreateDialogOpen(false);
            showNotice({ tone: 'success', message: `Room “${room.name}” created. Start the agent when ready.` });
        } catch (err) {
            setCreateRoomError(err instanceof Error ? err.message : 'Failed to create room');
        } finally {
            setIsCreatingRoom(false);
        }
    };

    const startAgent = async () => {
        if (!selectedRoom) return;
        setIsStartingAgent(true);
        setError(null);
        try {
            const response = await fetch(`${httpBackendUrl}/livekit/agent/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getControlAuthHeaders() },
                body: JSON.stringify({ roomName: selectedRoom.name, provider: agentProvider }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Failed to start agent');
            await refreshAgentStatus();
            showNotice({ tone: 'success', message: `${providerLabels[agentProvider]} is connecting to “${selectedRoom.name}”.` });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to start agent');
        } finally {
            setIsStartingAgent(false);
        }
    };

    const stopAgent = async (agent: RunningAgent) => {
        setStoppingAgentKey(agent.key);
        setError(null);
        try {
            const response = await fetch(`${httpBackendUrl}/livekit/agent/stop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getControlAuthHeaders() },
                body: JSON.stringify({ roomName: agent.room, provider: agent.provider }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Failed to stop agent');
            await refreshAgentStatus();
            showNotice({ tone: 'success', message: `Agent stopped for “${agent.room}”.` });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to stop agent');
        } finally {
            setStoppingAgentKey(null);
        }
    };

    const removeParticipant = async (roomName: string, identity: string) => {
        try {
            const response = await fetch(
                `${httpBackendUrl}/livekit/rooms/${encodeURIComponent(roomName)}/participants/${encodeURIComponent(identity)}`,
                { method: 'DELETE', headers: getControlAuthHeaders() },
            );
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Failed to remove participant');
            await refreshRooms();
            showNotice({ tone: 'success', message: `${identity} was removed from the room.` });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to remove participant');
        }
    };

    const deleteRoom = async () => {
        if (!deleteConfirm) return;
        const roomToDelete = deleteConfirm;
        setIsDeletingRoom(true);
        try {
            const response = await fetch(`${httpBackendUrl}/livekit/rooms/${encodeURIComponent(roomToDelete)}`, {
                method: 'DELETE',
                headers: getControlAuthHeaders(),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || 'Failed to delete room');
            const remainingRooms = rooms.filter(room => room.name !== roomToDelete);
            setRooms(remainingRooms);
            setSelectedRoomName(selectRoomAfterDelete(roomToDelete, rooms));
            if (transcriptLink?.roomName === roomToDelete) setTranscriptLink(null);
            setDeleteConfirm(null);
            showNotice({ tone: 'success', message: `Room “${roomToDelete}” deleted.` });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete room');
        } finally {
            setIsDeletingRoom(false);
        }
    };

    const getTranscriptLink = async (): Promise<TranscriptTokenResponse | null> => {
        if (!selectedRoom) return null;
        setIsGeneratingTranscriptLink(true);
        try {
            const response = await createTranscriptToken(backendUrl, selectedRoom.name);
            if (!isTranscriptTokenResponse(response)) throw new Error('Backend returned an invalid transcript link');
            setTranscriptLink({ roomName: selectedRoom.name, response });
            return response;
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to generate transcript link');
            return null;
        } finally {
            setIsGeneratingTranscriptLink(false);
        }
    };

    const copyText = async (value: string, label: string) => {
        try {
            await navigator.clipboard.writeText(value);
            showNotice({ tone: 'success', message: `${label} copied to clipboard.` });
        } catch {
            setError(`Could not copy ${label.toLowerCase()}. Check browser clipboard permissions.`);
        }
    };

    const copyTranscriptLink = async () => {
        const response = activeTranscriptLink || await getTranscriptLink();
        if (response) await copyText(response.websocketUrl, 'Transcript WebSocket link');
    };

    const openLink = (url: string) => {
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    const streamUrl = selectedRoom ? buildStreamUrl(appBaseUrl, selectedRoom.name) : '';
    const viewerUrl = selectedRoom ? buildViewerUrl(appBaseUrl, selectedRoom.name) : '';

    return (
        <div className="app-shell admin-workspace">
            <header className="app-header">
                <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
                    <div className="flex min-w-0 items-center gap-3">
                        {onBack && (
                            <button onClick={onBack} className="control-button control-button--quiet !min-h-10 !px-2.5" aria-label="Close admin">
                                <ArrowLeft size={18} />
                            </button>
                        )}
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-violet-400/45 bg-violet-500/20 text-violet-200">
                            <Settings size={19} aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                            <h1 className="truncate text-lg font-semibold tracking-tight text-slate-50 sm:text-xl">Thai Transcription</h1>
                            <div className="flex flex-wrap items-center gap-2 mt-0.5">
                                <p className="truncate text-xs text-slate-400">Room operations</p>
                                <span className="h-2 w-px bg-slate-700 hidden sm:inline" aria-hidden="true" />
                                <div className="hidden items-center gap-1.5 text-[10px] text-slate-500 sm:flex select-none">
                                    <span className="status-dot status-dot--live !h-1.5 !w-1.5" aria-hidden="true" />
                                    <span>LiveKit plane</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => { void refreshRooms(); void refreshAgentStatus(); }} disabled={isLoadingRooms} className="control-button control-button--quiet">
                            <RefreshCw size={15} className={isLoadingRooms ? 'animate-spin' : ''} />
                            <span className="hidden sm:inline">Refresh</span>
                        </button>
                        <button onClick={() => { setCreateRoomError(null); setIsCreateDialogOpen(true); }} className="control-button control-button--primary">
                            <Plus size={16} />
                            Create room
                        </button>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-7">
                {notice && (
                    <div className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm ${notice.tone === 'success' ? 'border-emerald-400/30 bg-emerald-950/30 text-emerald-200' : 'border-red-400/30 bg-red-950/30 text-red-200'}`} role="status" aria-live="polite">
                        {notice.tone === 'success' ? <Check size={16} /> : <AlertTriangle size={16} />}
                        <span>{notice.message}</span>
                    </div>
                )}
                {error && (
                    <div className="mb-4 flex items-center gap-3 rounded-lg border border-red-400/35 bg-red-950/35 p-3" role="alert">
                        <AlertTriangle size={17} className="shrink-0 text-red-300" />
                        <p className="flex-1 text-sm text-red-200">{error}</p>
                        <button onClick={() => setError(null)} className="control-button control-button--quiet !min-h-8 !px-2" aria-label="Dismiss error">
                            <X size={15} />
                        </button>
                    </div>
                )}

                <div className="grid gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
                    <aside className="app-panel flex min-h-[32rem] flex-col">
                        <div className="border-b border-slate-700/70 p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                    <h3 className="text-sm font-semibold text-white">Rooms</h3>
                                    <p className="mt-0.5 text-xs text-slate-500">{rooms.length} available</p>
                                </div>
                                <Radio size={16} className="text-violet-300" aria-hidden="true" />
                            </div>
                            <label className="relative block">
                                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                                <input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search rooms" className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950/35 pl-9 pr-3 text-sm text-white placeholder:text-slate-500" aria-label="Search rooms" />
                            </label>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2">
                            {isLoadingRooms && rooms.length === 0 ? (
                                <div className="flex items-center justify-center gap-2 px-3 py-10 text-sm text-slate-500">
                                    <LoaderCircle size={16} className="animate-spin" /> Loading rooms
                                </div>
                            ) : filteredRooms.length === 0 ? (
                                <div className="px-4 py-10 text-center">
                                    <Radio size={22} className="mx-auto mb-3 text-slate-600" />
                                    <p className="text-sm font-medium text-slate-300">{rooms.length ? 'No matching rooms' : 'No rooms yet'}</p>
                                    <p className="mt-1 text-xs leading-5 text-slate-500">{rooms.length ? 'Try a different search.' : 'Create one to prepare a transcription session.'}</p>
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    {filteredRooms.map(room => {
                                        const isSelected = room.name === selectedRoomName;
                                        const runningAgents = agentStatus.agents.filter(agent => agent.room === room.name);
                                        const runningCount = runningAgents.length;
                                        return (
                                            <button key={room.name} onClick={() => setSelectedRoomName(room.name)} className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${isSelected ? 'border-violet-400/55 bg-violet-400/10' : 'border-transparent hover:border-slate-700 hover:bg-slate-800/55'}`} aria-current={isSelected ? 'page' : undefined}>
                                                <div className="flex items-start justify-between gap-3">
                                                    <span className={`min-w-0 truncate text-sm font-semibold ${isSelected ? 'text-white' : 'text-slate-200'}`}>{room.name}</span>
                                                    <span className={`status-dot shrink-0 ${runningCount > 0 ? 'status-dot--live' : ''}`} aria-label={runningCount > 0 ? 'agent running' : 'agent stopped'} />
                                                </div>
                                                <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-500">
                                                    <span className="inline-flex items-center gap-1"><Users size={12} /> {room.numParticipants}</span>
                                                    <span>{runningCount > 0 ? (runningCount === 1 ? '1 agent active' : `${runningCount} agents active`) : 'Ready'}</span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </aside>

                    <section className="min-w-0">
                        {!selectedRoom ? (
                            <div className="app-panel flex min-h-[32rem] items-center justify-center p-6 text-center">
                                <div className="max-w-sm">
                                    <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-violet-400/10 text-violet-200"><Plus size={22} /></span>
                                    <h3 className="mt-4 text-lg font-semibold text-white">Create your first room</h3>
                                    <p className="mt-2 text-sm leading-6 text-slate-400">A room is the shared channel for the Audio Sender, transcription agent, Viewer, and external transcript consumers.</p>
                                    <button onClick={() => setIsCreateDialogOpen(true)} className="control-button control-button--primary mt-5"><Plus size={16} /> Create room</button>
                                </div>
                            </div>
                        ) : (
                            <div className="app-panel overflow-hidden">
                                <div className="border-b border-slate-700/70 px-4 py-4 sm:px-5">
                                    <div className="flex flex-wrap items-start justify-between gap-4">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="status-dot status-dot--live" aria-hidden="true" />
                                                <span className="text-xs font-medium text-emerald-200">Room ready</span>
                                            </div>
                                            <h3 className="mt-2 truncate text-xl font-semibold text-white">{selectedRoom.name}</h3>
                                            <p className="mt-1 text-xs text-slate-500">{selectedRoom.numParticipants} participant{selectedRoom.numParticipants === 1 ? '' : 's'} · Created {formatRoomTime(selectedRoom.creationTime)}</p>
                                        </div>
                                        <button onClick={() => setDeleteConfirm(selectedRoom.name)} className="control-button control-button--quiet text-red-200 hover:!border-red-400/40 hover:!bg-red-950/30" aria-label={`Delete room ${selectedRoom.name}`}>
                                            <Trash2 size={15} /> Delete room
                                        </button>
                                    </div>
                                </div>

                                <div className="grid gap-5 p-4 sm:p-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                                    <section className="admin-section" aria-labelledby="agent-control-heading">
                                        <SectionHeading id="agent-control-heading" icon={<Bot size={16} />} title="Transcription Agent" detail="Start this separately when the room is ready." />
                                        <div className="mt-4 rounded-lg border border-slate-700/70 bg-slate-950/20 p-3">
                                            <div className="flex items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-xs font-medium text-slate-400">Current state</p>
                                                    <p className="mt-1 text-sm font-semibold text-white">{selectedAgents.length ? `${selectedAgents.length} provider${selectedAgents.length === 1 ? '' : 's'} active` : 'Not started'}</p>
                                                </div>
                                                {selectedAgents.length ? (
                                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-200"><span className="status-dot status-dot--live" />Listening</span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-400"><span className="status-dot" />Idle</span>
                                                )}
                                            </div>
                                            {selectedAgents.length > 0 && (
                                                <div className="mt-3 space-y-2 border-t border-slate-700/60 pt-3">
                                                    {selectedAgents.map(agent => (
                                                        <div key={agent.key} className="flex items-center justify-between gap-3 text-sm">
                                                            <span className="inline-flex min-w-0 items-center gap-2 text-slate-200"><span className="status-dot status-dot--live" />{providerLabels[agent.provider as AgentProvider] || agent.provider}</span>
                                                            <button onClick={() => void stopAgent(agent)} disabled={stoppingAgentKey === agent.key} className="control-button control-button--quiet !min-h-8 !px-2 text-red-200" aria-label={`Stop ${agent.provider} agent`}>
                                                                {stoppingAgentKey === agent.key ? <LoaderCircle size={14} className="animate-spin" /> : <UserMinus size={14} />} Stop
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                                            <label className="sr-only" htmlFor="admin-agent-provider">Provider</label>
                                            <select id="admin-agent-provider" value={agentProvider} onChange={event => setAgentProvider(event.target.value as AgentProvider)} className="h-10 min-w-0 rounded-lg border border-slate-700 bg-slate-950/35 px-3 text-sm text-white">
                                                {(Object.keys(providerLabels) as AgentProvider[]).map(provider => <option key={provider} value={provider}>{providerLabels[provider]}</option>)}
                                            </select>
                                            <button onClick={() => void startAgent()} disabled={isStartingAgent || selectedAgents.some(agent => agent.provider === agentProvider)} className="control-button control-button--primary h-10 whitespace-nowrap">
                                                {isStartingAgent ? <LoaderCircle size={15} className="animate-spin" /> : <Bot size={15} />} {selectedAgents.some(agent => agent.provider === agentProvider) ? 'Running' : 'Start Agent'}
                                            </button>
                                        </div>
                                    </section>

                                    <section className="admin-section" aria-labelledby="share-heading">
                                        <SectionHeading id="share-heading" icon={<Link2 size={16} />} title="Room Access Links" detail="Connect to send audio or view transcripts." />
                                        <div className="mt-4 space-y-2">
                                            <ShareRow icon={<Radio size={16} />} label="Audio Sender" description="Send microphone audio" onOpen={() => openLink(streamUrl)} onCopy={() => void copyText(streamUrl, 'Audio Sender link')} />
                                            <ShareRow icon={<Eye size={16} />} label="Viewer" description="Read-only live transcript" onOpen={() => openLink(viewerUrl)} onCopy={() => void copyText(viewerUrl, 'Viewer link')} />
                                        </div>
                                    </section>

                                    <section className="admin-section xl:col-span-2" aria-labelledby="integration-heading">
                                        <SectionHeading id="integration-heading" icon={<ExternalLink size={16} />} title="External transcript feed" detail="Read-only WebSocket · Interim + Final · No audio" />
                                        <div className="mt-4 rounded-lg border border-slate-700/70 bg-slate-950/20 p-3 sm:p-4">
                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium text-white">Transcript WebSocket</p>
                                                    <p className="mt-1 text-xs leading-5 text-slate-500">Generate a signed room link for an external system. It expires after 24 hours and is kept only in this browser session.</p>
                                                    {activeTranscriptLink && <p className="mt-2 text-xs text-emerald-200">Link ready · expires {formatExpiry(activeTranscriptLink.expiresAt)}</p>}
                                                </div>
                                                <div className="flex shrink-0 flex-wrap gap-2">
                                                    <button onClick={() => void getTranscriptLink()} disabled={isGeneratingTranscriptLink} className="control-button control-button--quiet">
                                                        {isGeneratingTranscriptLink ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />} {activeTranscriptLink ? 'Refresh link' : 'Generate link'}
                                                    </button>
                                                    <button onClick={() => void copyTranscriptLink()} disabled={isGeneratingTranscriptLink} className="control-button control-button--primary"><Copy size={15} /> Copy URL</button>
                                                </div>
                                            </div>
                                        </div>
                                    </section>

                                    <section className="admin-section xl:col-span-2" aria-labelledby="participants-heading">
                                        <SectionHeading id="participants-heading" icon={<Users size={16} />} title="Participants" detail="Manage who is currently connected." />
                                        <div className="mt-4 overflow-hidden rounded-lg border border-slate-700/70">
                                            {selectedRoom.participants.length === 0 ? (
                                                <p className="px-4 py-6 text-center text-sm text-slate-500">No participants connected yet. Share the Stream link to begin.</p>
                                            ) : (
                                                <div className="divide-y divide-slate-700/60">
                                                    {selectedRoom.participants.map(participant => (
                                                        <div key={participant.identity} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                                                            <div className="flex min-w-0 items-center gap-3">
                                                                {participant.isAgent ? (
                                                                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-400/10 text-violet-200"><Bot size={15} /></span>
                                                                ) : (
                                                                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-slate-400"><Users size={15} /></span>
                                                                )}
                                                                <div className="min-w-0">
                                                                    <p className="truncate text-sm font-medium text-slate-200">{participant.name || participant.identity}</p>
                                                                    <p className="truncate text-xs text-slate-500">{participant.identity} · {participant.state}</p>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                {participant.isAgent && <span className="rounded-full bg-violet-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-violet-200">Agent</span>}
                                                                <button onClick={() => void removeParticipant(selectedRoom.name, participant.identity)} className="control-button control-button--quiet !min-h-8 !px-2 text-red-200" aria-label={`Remove ${participant.identity}`}><UserMinus size={14} /> Remove</button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </section>
                                </div>
                            </div>
                        )}
                    </section>
                </div>
            </main>

            <div className="sr-only" aria-live="polite">{notice?.message || ''}</div>

            {isCreateDialogOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" role="presentation" onMouseDown={() => !isCreatingRoom && setIsCreateDialogOpen(false)}>
                    <div className="app-panel w-full max-w-md p-5" role="dialog" aria-modal="true" aria-labelledby="create-room-title" onMouseDown={event => event.stopPropagation()}>
                        <div className="flex items-start justify-between gap-4">
                            <div><h3 id="create-room-title" className="text-lg font-semibold text-white">Create room</h3><p className="mt-1 text-sm leading-5 text-slate-400">Set up the room now. The agent will remain stopped until you start it.</p></div>
                            <button onClick={() => setIsCreateDialogOpen(false)} disabled={isCreatingRoom} className="control-button control-button--quiet !min-h-8 !px-2" aria-label="Close create room dialog"><X size={16} /></button>
                        </div>
                        <form onSubmit={handleCreateRoom} className="mt-5">
                            <label htmlFor="new-room-name" className="mb-2 block text-sm font-medium text-slate-300">Room name</label>
                            <input ref={createRoomInputRef} id="new-room-name" value={newRoomName} onChange={event => { setNewRoomName(event.target.value); setCreateRoomError(null); }} placeholder="e.g. daily-briefing" className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 text-sm text-white placeholder:text-slate-500" aria-describedby="room-name-help room-name-error" aria-invalid={Boolean(createRoomError)} />
                            <p id="room-name-help" className="mt-2 text-xs text-slate-500">Letters, numbers, hyphens, and underscores only.</p>
                            {createRoomError && <p id="room-name-error" className="mt-2 flex items-center gap-2 text-xs text-red-300" role="alert"><AlertTriangle size={14} /> {createRoomError}</p>}
                            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                                <button type="button" onClick={() => setIsCreateDialogOpen(false)} disabled={isCreatingRoom} className="control-button control-button--quiet">Cancel</button>
                                <button type="submit" disabled={isCreatingRoom} className="control-button control-button--primary">{isCreatingRoom ? <LoaderCircle size={15} className="animate-spin" /> : <Plus size={15} />} Create room</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {deleteConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" role="presentation" onMouseDown={() => !isDeletingRoom && setDeleteConfirm(null)}>
                    <div className="app-panel w-full max-w-md p-5" role="dialog" aria-modal="true" aria-labelledby="delete-room-title" onMouseDown={event => event.stopPropagation()}>
                        <h3 id="delete-room-title" className="text-lg font-semibold text-white">Delete room?</h3>
                        <p className="mt-2 text-sm leading-6 text-slate-400">This disconnects all participants and stops the room workflow. The action cannot be undone.</p>
                        <p className="mt-3 rounded-lg bg-red-950/30 px-3 py-2 text-sm font-medium text-red-200">{deleteConfirm}</p>
                        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                            <button onClick={() => setDeleteConfirm(null)} disabled={isDeletingRoom} className="control-button control-button--quiet">Cancel</button>
                            <button onClick={() => void deleteRoom()} disabled={isDeletingRoom} className="control-button control-button--danger">{isDeletingRoom ? <LoaderCircle size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete room</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function SectionHeading({ id, icon, title, detail }: { id: string; icon: React.ReactNode; title: string; detail: string }) {
    return (
        <div>
            <h4 id={id} className="flex items-center gap-2 text-sm font-semibold text-white">{icon}<span>{title}</span></h4>
            <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
        </div>
    );
}

function ShareRow({ icon, label, description, onOpen, onCopy }: { icon: React.ReactNode; label: string; description: string; onOpen: () => void; onCopy: () => void }) {
    return (
        <div className="flex flex-col gap-3 rounded-lg border border-slate-700/70 bg-slate-950/20 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-400/10 text-violet-200">{icon}</span><div className="min-w-0"><p className="text-sm font-medium text-white">{label}</p><p className="text-xs text-violet-100/65">{description}</p></div></div>
            <div className="flex shrink-0 gap-2"><button onClick={onOpen} className="control-button control-button--quiet !min-h-8 !px-2.5"><ExternalLink size={14} /> Open</button><button onClick={onCopy} className="control-button control-button--quiet !min-h-8 !px-2.5"><Copy size={14} /> Copy</button></div>
        </div>
    );
}

function formatRoomTime(timestamp: number): string {
    if (!timestamp) return '—';
    return new Date(timestamp * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatExpiry(value: string): string {
    return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
