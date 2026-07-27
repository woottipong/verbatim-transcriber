import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle,
    ArrowLeft,
    Bot,
    Cable,
    Copy,
    ExternalLink,
    Eye,
    LoaderCircle,
    Plus,
    Radio,
    RefreshCw,
    Search,
    Trash2,
    UserMinus,
    Users,
    X,
} from 'lucide-react';
import ToastViewport from './ToastViewport';
import type { ParticipantInfo, RunningAgent } from '../lib/api';
import { buildStreamUrl, buildViewerUrl } from '../lib/appRoutes';
import {
    canRemoveParticipant,
    deriveAdminReadiness,
    keepSelectedRoom,
    maskTranscriptWebSocketUrl,
    selectRoomAfterDelete,
    validateRoomName,
} from '../lib/adminRooms';
import { providerLabels } from '../lib/providers';
import type { AgentProvider } from '../lib/providers';
import { useControlRoomOperations } from '../hooks/useControlRoomOperations';

interface AdminPageProps {
    onBack?: () => void;
    backendUrl: string;
}

interface Notice {
    tone: 'success' | 'error';
    message: string;
}

function isAgentProvider(value: string): value is AgentProvider {
    return Object.prototype.hasOwnProperty.call(providerLabels, value);
}

const DIALOG_FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[href]',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

function handleDialogKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR))
        .filter(element => element.getAttribute('aria-hidden') !== 'true');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

export default function AdminPage({ onBack, backendUrl }: AdminPageProps) {
    const appBaseUrl = `${window.location.origin}${window.location.pathname}`;
    const [selectedRoomName, setSelectedRoomName] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [agentProvider, setAgentProvider] = useState<AgentProvider>('google');
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [newRoomName, setNewRoomName] = useState('');
    const [createRoomError, setCreateRoomError] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [participantRemoveConfirm, setParticipantRemoveConfirm] = useState<ParticipantInfo | null>(null);
    const [notice, setNotice] = useState<Notice | null>(null);
    const createRoomInputRef = useRef<HTMLInputElement>(null);
    const dialogTriggerRef = useRef<HTMLElement | null>(null);
    const showNotice = useCallback((nextNotice: Notice) => setNotice(nextNotice), []);
    const handleRoomsError = useCallback(
        (message: string) => showNotice({ tone: 'error', message }),
        [showNotice],
    );
    const {
        rooms,
        agentStatus,
        agentStatusError,
        isLoadingRooms,
        isCreatingRoom,
        isStartingAgent,
        stoppingAgentKey,
        isRemovingParticipant,
        isDeletingRoom,
        generatingTranscriptProviders,
        transcriptFeedErrors,
        refreshRooms,
        refreshAgentStatus,
        createRoom,
        startAgent: startAgentOperation,
        stopAgent: stopAgentOperation,
        removeParticipant: removeParticipantOperation,
        deleteRoom: deleteRoomOperation,
        generateTranscriptLink,
        activeTranscriptLink: getActiveTranscriptLink,
    } = useControlRoomOperations({
        backendUrl,
        onRoomsError: handleRoomsError,
    });

    const selectedRoom = rooms.find(room => room.name === selectedRoomName) || null;
    const selectedAgents = useMemo(
        () => agentStatus.agents.filter(agent => agent.room === selectedRoomName),
        [agentStatus.agents, selectedRoomName],
    );
    const runningTranscriptProviders = useMemo(
        () => Array.from(new Set(
            selectedAgents
                .map(agent => agent.provider)
                .filter(isAgentProvider),
        )),
        [selectedAgents],
    );
    const runningAgentCounts = useMemo(() => {
        const counts = new Map<string, number>();
        agentStatus.agents.forEach(agent => {
            counts.set(agent.room, (counts.get(agent.room) ?? 0) + 1);
        });
        return counts;
    }, [agentStatus.agents]);
    const filteredRooms = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return rooms;
        return rooms.filter(room => room.name.toLowerCase().includes(query));
    }, [rooms, searchQuery]);
    const activeTranscriptLink = (provider: AgentProvider) => getActiveTranscriptLink(selectedRoomName, provider);
    const readiness = deriveAdminReadiness(selectedRoom?.participants ?? [], selectedAgents.length);

    const rememberDialogTrigger = (trigger: HTMLElement) => {
        dialogTriggerRef.current = trigger;
    };

    const restoreDialogFocus = () => {
        const trigger = dialogTriggerRef.current;
        dialogTriggerRef.current = null;
        window.setTimeout(() => trigger?.focus(), 0);
    };

    const closeCreateDialog = () => {
        setIsCreateDialogOpen(false);
        restoreDialogFocus();
    };

    const closeDeleteDialog = () => {
        setDeleteConfirm(null);
        restoreDialogFocus();
    };

    const closeParticipantDialog = () => {
        setParticipantRemoveConfirm(null);
        restoreDialogFocus();
    };

    useEffect(() => {
        setSelectedRoomName(current => keepSelectedRoom(current, rooms));
    }, [rooms]);

    useEffect(() => {
        if (!isCreateDialogOpen) return undefined;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !isCreatingRoom) closeCreateDialog();
        };
        window.addEventListener('keydown', handleKeyDown);
        window.setTimeout(() => createRoomInputRef.current?.focus(), 0);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isCreateDialogOpen, isCreatingRoom]);

    const handleCreateRoom = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const normalizedName = newRoomName.trim();
        const validationError = validateRoomName(normalizedName);
        if (validationError) {
            setCreateRoomError(validationError);
            return;
        }

        setCreateRoomError(null);
        try {
            const room = await createRoom(normalizedName);
            setSelectedRoomName(room.name);
            setNewRoomName('');
            setIsCreateDialogOpen(false);
            restoreDialogFocus();
            showNotice({ tone: 'success', message: `Room “${room.name}” created. Start the agent when ready.` });
        } catch (err) {
            setCreateRoomError(err instanceof Error ? err.message : 'Failed to create room');
        }
    };

    const startAgent = async () => {
        if (!selectedRoom) return;
        setNotice(null);
        try {
            await startAgentOperation(selectedRoom.name, agentProvider);
            showNotice({ tone: 'success', message: `${providerLabels[agentProvider]} is connecting to “${selectedRoom.name}”.` });
        } catch (err) {
            showNotice({ tone: 'error', message: err instanceof Error ? err.message : 'Failed to start agent' });
        }
    };

    const stopAgent = async (agent: RunningAgent) => {
        setNotice(null);
        try {
            await stopAgentOperation(agent);
            showNotice({ tone: 'success', message: `Agent stopped for “${agent.room}”.` });
        } catch (err) {
            showNotice({ tone: 'error', message: err instanceof Error ? err.message : 'Failed to stop agent' });
        }
    };

    const removeParticipant = async () => {
        if (!selectedRoom || !participantRemoveConfirm || !canRemoveParticipant(participantRemoveConfirm)) return;
        const roomName = selectedRoom.name;
        const identity = participantRemoveConfirm.identity;
        try {
            await removeParticipantOperation(roomName, identity);
            setParticipantRemoveConfirm(null);
            restoreDialogFocus();
            showNotice({ tone: 'success', message: `${identity} was removed from the room.` });
        } catch (err) {
            showNotice({ tone: 'error', message: err instanceof Error ? err.message : 'Failed to remove participant' });
        }
    };

    const deleteRoom = async () => {
        if (!deleteConfirm) return;
        const roomToDelete = deleteConfirm;
        try {
            await deleteRoomOperation(roomToDelete);
            setSelectedRoomName(selectRoomAfterDelete(roomToDelete, rooms));
            setDeleteConfirm(null);
            restoreDialogFocus();
            showNotice({ tone: 'success', message: `Room “${roomToDelete}” deleted.` });
        } catch (err) {
            showNotice({ tone: 'error', message: err instanceof Error ? err.message : 'Failed to delete room' });
        }
    };

    const getTranscriptLink = async (provider: AgentProvider) => {
        if (!selectedRoom) return null;
        const roomName = selectedRoom.name;
        try {
            return await generateTranscriptLink(roomName, provider);
        } catch {
            showNotice({ tone: 'error', message: 'Could not generate the transcript feed link.' });
            return null;
        }
    };

    const copyText = async (value: string, label: string) => {
        try {
            await navigator.clipboard.writeText(value);
            showNotice({ tone: 'success', message: `${label} copied to clipboard.` });
        } catch {
            showNotice({ tone: 'error', message: `Could not copy ${label.toLowerCase()}. Check browser clipboard permissions.` });
        }
    };

    const copyTranscriptLink = async (provider: AgentProvider) => {
        const response = activeTranscriptLink(provider);
        if (!response) {
            showNotice({ tone: 'error', message: `Generate the ${providerLabels[provider]} link before copying it.` });
            return;
        }
        await copyText(response.websocketUrl, `${providerLabels[provider]} WebSocket link`);
    };

    const openLink = (url: string) => {
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    const streamUrl = selectedRoom ? buildStreamUrl(appBaseUrl, selectedRoom.name) : '';
    const viewerUrl = selectedRoom ? buildViewerUrl(appBaseUrl, selectedRoom.name) : '';

    return (
        <div className="app-shell admin-workspace">
            <ToastViewport notices={[
                notice && { id: `admin-notice-${notice.message}`, tone: notice.tone, message: notice.message, onDismiss: () => setNotice(null) },
            ]} />
            <header className="app-header">
                <div className="app-header__content mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
                    <div className="flex min-w-0 items-center gap-3">
                        {onBack && (
                            <button onClick={onBack} className="control-button control-button--quiet !min-h-11 !px-2.5" aria-label="Close admin">
                                <ArrowLeft size={18} />
                            </button>
                        )}
                        <img src="/captionlive-mark.svg" alt="" className="h-10 w-10 shrink-0 rounded-lg" aria-hidden="true" />
                        <div className="min-w-0">
                            <h1 className="flex min-w-0 items-center gap-2 truncate text-lg font-semibold tracking-tight text-slate-50 sm:text-xl">
                                <span className="shrink-0 text-teal-200">CaptionLive</span>
                                <span className="h-4 w-px shrink-0 bg-slate-700" aria-hidden="true" />
                                <span className="truncate">Control Room</span>
                            </h1>
                            <div className="flex flex-wrap items-center gap-2 mt-0.5">
                                <p className="truncate text-xs text-slate-400">Manage rooms and transcription</p>
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
                        <button onClick={event => { rememberDialogTrigger(event.currentTarget); setCreateRoomError(null); setIsCreateDialogOpen(true); }} className="control-button control-button--primary">
                            <Plus size={16} aria-hidden="true" />
                            Create room
                        </button>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-7">
                <div className="grid gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
                    <aside className="app-panel flex min-h-[16rem] max-h-[20rem] flex-col lg:max-h-none lg:min-h-[32rem]">
                        <div className="border-b border-slate-700/70 p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                    <h3 className="text-sm font-semibold text-white">Rooms</h3>
                                    <p className="mt-0.5 text-xs text-slate-500">{rooms.length} available</p>
                                </div>
                                <Radio size={16} className="text-teal-300" aria-hidden="true" />
                            </div>
                            <label className="relative block">
                                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                                <input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search rooms" className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950/35 pl-9 pr-3 text-sm text-white placeholder:text-slate-500" aria-label="Search rooms" />
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
                                        const runningCount = runningAgentCounts.get(room.name) ?? 0;
                                        return (
                                            <button key={room.name} onClick={() => setSelectedRoomName(room.name)} className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${isSelected ? 'border-teal-400/45 bg-teal-400/10' : 'border-transparent hover:border-slate-700 hover:bg-slate-800/55'}`} aria-current={isSelected ? 'page' : undefined}>
                                                <div className="flex items-start justify-between gap-3">
                                                    <span className={`min-w-0 truncate text-sm font-semibold ${isSelected ? 'text-white' : 'text-slate-200'}`}>{room.name}</span>
                                                    <span className={`status-dot shrink-0 ${runningCount > 0 ? 'status-dot--live' : ''}`} aria-hidden="true" />
                                                </div>
                                                <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-500">
                                                    <span className="inline-flex items-center gap-1"><Users size={12} /> {room.numParticipants}</span>
                                                    <span>{runningCount > 0 ? (runningCount === 1 ? '1 agent active' : `${runningCount} agents active`) : 'Idle'}</span>
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
                                    <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-teal-400/10 text-teal-200"><Plus size={22} /></span>
                                    <h3 className="mt-4 text-lg font-semibold text-white">Create your first room</h3>
                                    <p className="mt-2 text-sm leading-6 text-slate-400">A room is the shared channel for the Audio Source, transcription agent, Transcript, and external transcript consumers.</p>
                                    <button onClick={event => { rememberDialogTrigger(event.currentTarget); setIsCreateDialogOpen(true); }} className="control-button control-button--primary mt-5"><Plus size={16} aria-hidden="true" /> Create room</button>
                                </div>
                            </div>
                        ) : (
                            <div className="app-panel overflow-hidden">
                                <div className="border-b border-slate-700/70 px-4 py-3 sm:px-5">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <h3 className="truncate text-lg font-semibold text-white">{selectedRoom.name}</h3>
                                            <p className="mt-0.5 text-xs text-slate-500">{selectedRoom.numParticipants} participant{selectedRoom.numParticipants === 1 ? '' : 's'} · Created {formatRoomTime(selectedRoom.creationTime)}</p>
                                        </div>
                                        <div className={`admin-status shrink-0 ${
                                            readiness.state === 'active'
                                                ? 'admin-status--success'
                                                : 'admin-status--warning'
                                        }`}>
                                            <span className={`status-dot ${readiness.state === 'active' ? 'status-dot--live' : 'status-dot--pending'}`} aria-hidden="true" />
                                            <span>{readiness.title}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-5 p-4 sm:p-5 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:items-start">
                                    <section className="admin-section" aria-labelledby="connections-heading">
                                        <SectionHeading id="connections-heading" icon={<ExternalLink size={16} />} title="Connections" detail="Connect audio and share the live transcript." />
                                        <div className="mt-4">
                                            <ShareRow icon={<Radio size={16} />} label="Audio Source" description="Microphone or Chrome Tab audio" onOpen={() => openLink(streamUrl)} onCopy={() => void copyText(streamUrl, 'Audio Source link')} />
                                        </div>
                                        <div className="mt-2">
                                            <ShareRow icon={<Eye size={16} />} label="Transcript" description="Open the read-only live transcript" onOpen={() => openLink(viewerUrl)} onCopy={() => void copyText(viewerUrl, 'Transcript link')} />
                                        </div>
                                    </section>

                                    <section className="admin-section order-2" aria-labelledby="agent-control-heading">
                                        <SectionHeading id="agent-control-heading" icon={<Bot size={16} />} title="Transcription" detail="Choose the providers that should listen to this room." />
                                        {agentStatusError && (
                                            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-400/25 bg-amber-950/20 px-3 py-2.5 text-sm text-amber-100" role="alert">
                                                <span className="flex min-w-0 items-start gap-2">
                                                    <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                                                    <span>{agentStatusError}</span>
                                                </span>
                                                <button onClick={() => void refreshAgentStatus()} className="control-button control-button--quiet !min-h-9 !px-2.5">
                                                    <RefreshCw size={14} aria-hidden="true" /> Retry
                                                </button>
                                            </div>
                                        )}
                                        <div className="admin-control-surface mt-4 min-h-[4.5rem] rounded-lg p-3">
                                            <div className="flex items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-xs font-medium text-slate-400">Current state</p>
                                                    <p className="mt-1 text-sm font-semibold text-white">{selectedAgents.length ? `${selectedAgents.length} provider${selectedAgents.length === 1 ? '' : 's'} active` : 'Not started'}</p>
                                                </div>
                                                {selectedAgents.length ? (
                                                    <span className="admin-status admin-status--success"><span className="status-dot status-dot--live" />Listening</span>
                                                ) : (
                                                    <span className="admin-status admin-status--neutral"><span className="status-dot" />Idle</span>
                                                )}
                                            </div>
                                            {selectedAgents.length > 0 && (
                                                <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-700/60 pt-3">
                                                    {selectedAgents.map(agent => (
                                                        <button
                                                            key={agent.key}
                                                            onClick={() => void stopAgent(agent)}
                                                            disabled={stoppingAgentKey === agent.key}
                                                            className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-slate-700 bg-slate-900/40 px-3 text-sm font-medium text-slate-200 transition-colors hover:border-red-400/35 hover:bg-slate-800 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                                                            aria-label={`Stop ${providerLabels[agent.provider as AgentProvider] || agent.provider}`}
                                                            title={`Stop ${providerLabels[agent.provider as AgentProvider] || agent.provider}`}
                                                        >
                                                            <span className="status-dot status-dot--live" aria-hidden="true" />
                                                            <span className="truncate">{providerLabels[agent.provider as AgentProvider] || agent.provider}</span>
                                                            {stoppingAgentKey === agent.key
                                                                ? <LoaderCircle size={14} className="shrink-0 animate-spin" aria-hidden="true" />
                                                                : <X size={14} className="shrink-0 text-slate-500" aria-hidden="true" />}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                                            <label className="sr-only" htmlFor="admin-agent-provider">Provider</label>
                                            <select id="admin-agent-provider" value={agentProvider} onChange={event => setAgentProvider(event.target.value as AgentProvider)} className="h-11 min-w-0 rounded-lg border border-slate-700 bg-slate-950/35 px-3 text-sm text-white">
                                                {(Object.keys(providerLabels) as AgentProvider[]).map(provider => <option key={provider} value={provider}>{providerLabels[provider]}</option>)}
                                            </select>
                                            <button onClick={() => void startAgent()} disabled={isStartingAgent || selectedAgents.some(agent => agent.provider === agentProvider)} className="control-button control-button--primary h-11 whitespace-nowrap">
                                                {isStartingAgent ? <LoaderCircle size={15} className="animate-spin" /> : <Bot size={15} />} {selectedAgents.some(agent => agent.provider === agentProvider) ? 'Running' : 'Start Agent'}
                                            </button>
                                        </div>
                                    </section>

                                    <section className="admin-section order-4 xl:col-span-2" aria-labelledby="external-systems-heading">
                                        <SectionHeading id="external-systems-heading" icon={<Cable size={16} />} title="External systems" detail="Generate one signed feed for each active provider." />
                                        <div className="mt-3 space-y-2">
                                        {runningTranscriptProviders.length === 0 ? (
                                            <div className="rounded-lg bg-slate-950/20 px-4 py-4">
                                                <p className="text-sm font-medium text-slate-200">Start a provider to enable external feeds.</p>
                                            </div>
                                        ) : runningTranscriptProviders.map(provider => {
                                            const link = activeTranscriptLink(provider);
                                            const isGenerating = generatingTranscriptProviders.has(provider);
                                            const error = transcriptFeedErrors[provider]?.roomName === selectedRoomName
                                                ? transcriptFeedErrors[provider]?.message
                                                : null;
                                            return (
                                                <div key={provider} className="admin-control-surface rounded-lg p-3 sm:p-4">
                                                    <div className="grid items-center gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                                                        <p className="text-sm font-medium text-white">{providerLabels[provider]}</p>
                                                        {link && (
                                                            <div className="min-w-0 rounded-md border border-slate-700 bg-slate-950/45 px-3 py-2">
                                                                <code className="block truncate text-xs text-slate-300" title={maskTranscriptWebSocketUrl(link.websocketUrl)}>
                                                                    {maskTranscriptWebSocketUrl(link.websocketUrl)}
                                                                </code>
                                                            </div>
                                                        )}
                                                        <div className="flex shrink-0 flex-wrap gap-2 sm:col-start-3">
                                                            <button
                                                                onClick={() => void getTranscriptLink(provider)}
                                                                disabled={isGenerating}
                                                                className="control-button control-button--inline"
                                                                aria-label={`${error ? 'Retry' : link ? 'Generate new' : 'Generate'} ${providerLabels[provider]} WebSocket link`}
                                                            >
                                                                {isGenerating ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
                                                                {error ? 'Retry' : link ? 'Generate new' : 'Generate link'}
                                                            </button>
                                                            <button
                                                                onClick={() => void copyTranscriptLink(provider)}
                                                                disabled={isGenerating || Boolean(error) || !link}
                                                                className="control-button control-button--inline control-button--inline-accent"
                                                                aria-label={`Copy ${providerLabels[provider]} WebSocket URL`}
                                                            >
                                                                <Copy size={15} aria-hidden="true" /> Copy URL
                                                            </button>
                                                        </div>
                                                    </div>
                                                    {link && (
                                                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5">
                                                            <span className="text-emerald-200">Ready · expires {formatExpiry(link.expiresAt)}</span>
                                                            <span className="text-slate-500">New links do not revoke existing links.</span>
                                                        </div>
                                                    )}
                                                    {error && (
                                                        <p className="mt-2 flex max-w-2xl items-start gap-2 text-sm leading-5 text-red-200" role="alert">
                                                            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                                                            <span>{error}</span>
                                                        </p>
                                                    )}
                                                </div>
                                            );
                                        })}
                                        {runningTranscriptProviders.length > 0 && (
                                            <div className="px-1">
                                                <p className="text-xs leading-5 text-slate-500">Anyone with a signed URL can read that provider’s live transcript until it expires.</p>
                                                <details className="mt-2 text-xs text-slate-400">
                                                    <summary className="cursor-pointer select-none font-medium text-slate-300">Integration details</summary>
                                                    <div className="mt-2 space-y-2 rounded-lg border border-slate-700/70 bg-slate-950/25 p-3 leading-5">
                                                        <p>Connect with the copied URL. Each WebSocket message is a JSON object; replace interim text until <code>isFinal</code> is true.</p>
                                                        <code className="block overflow-x-auto rounded bg-slate-950/60 px-2 py-1.5 text-slate-300">{'{"text":"ผู้ป่วยมีอาการ","isFinal":false}'}</code>
                                                    </div>
                                                </details>
                                            </div>
                                        )}
                                        </div>
                                    </section>

                                    <section className="admin-section order-5 xl:col-span-2" aria-labelledby="participants-heading">
                                        <SectionHeading id="participants-heading" icon={<Users size={16} />} title="Participants" detail="Manage who is currently connected." />
                                        <div className="mt-4 overflow-hidden rounded-lg border border-slate-700/70">
                                            {selectedRoom.participants.length === 0 ? (
                                                <p className="px-4 py-6 text-center text-sm text-slate-500">No participants connected yet. Open the Audio Source link to begin.</p>
                                            ) : (
                                                <div className="divide-y divide-slate-700/60">
                                                    {selectedRoom.participants.map(participant => (
                                                        <div key={participant.identity} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                                                            <div className="flex min-w-0 items-center gap-3">
                                                                {participant.isAgent ? (
                                                                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-400/10 text-teal-200"><Bot size={15} /></span>
                                                                ) : (
                                                                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-slate-400"><Users size={15} /></span>
                                                                )}
                                                                <div className="min-w-0">
                                                                    <p className="truncate text-sm font-medium text-slate-200">{participant.name || participant.identity}</p>
                                                                    <p className="truncate text-xs text-slate-500">{participant.identity} · {participant.state}</p>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                {participant.isAgent ? (
                                                                    <span className="rounded-full bg-teal-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-teal-200">Managed above</span>
                                                                ) : (
                                                                    <button
                                                                        onClick={event => {
                                                                            rememberDialogTrigger(event.currentTarget);
                                                                            setParticipantRemoveConfirm(participant);
                                                                        }}
                                                                        className="control-button control-button--inline control-button--inline-danger !min-h-11"
                                                                        aria-label={`Remove ${participant.identity}`}
                                                                    >
                                                                        <UserMinus size={14} aria-hidden="true" /> Remove
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </section>

                                    <section className="admin-section order-6 xl:col-span-2" aria-labelledby="danger-zone-heading">
                                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                            <div>
                                                <h4 id="danger-zone-heading" className="text-sm font-semibold text-red-200">Danger zone</h4>
                                                <p className="mt-1 text-xs leading-5 text-slate-500">Delete this room and disconnect everyone. This cannot be undone.</p>
                                            </div>
                                            <button
                                                onClick={event => {
                                                    rememberDialogTrigger(event.currentTarget);
                                                    setDeleteConfirm(selectedRoom.name);
                                                }}
                                                className="control-button control-button--quiet shrink-0 text-red-200 hover:!border-red-400/40 hover:!bg-red-950/30"
                                                aria-label={`Delete room ${selectedRoom.name}`}
                                            >
                                                <Trash2 size={15} aria-hidden="true" /> Delete room
                                            </button>
                                        </div>
                                    </section>
                                </div>
                            </div>
                        )}
                    </section>
                </div>
            </main>

            {isCreateDialogOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" role="presentation" onMouseDown={() => !isCreatingRoom && closeCreateDialog()}>
                    <div className="app-panel w-full max-w-md p-5" role="dialog" aria-modal="true" aria-labelledby="create-room-title" onKeyDown={handleDialogKeyDown} onMouseDown={event => event.stopPropagation()}>
                        <div className="flex items-start justify-between gap-4">
                            <div><h3 id="create-room-title" className="text-lg font-semibold text-white">Create room</h3><p className="mt-1 text-sm leading-5 text-slate-400">Set up the room now. The agent will remain stopped until you start it.</p></div>
                            <button onClick={closeCreateDialog} disabled={isCreatingRoom} className="control-button control-button--quiet !min-h-11 !min-w-11 !px-2" aria-label="Close create room dialog"><X size={16} aria-hidden="true" /></button>
                        </div>
                        <form onSubmit={handleCreateRoom} className="mt-5">
                            <label htmlFor="new-room-name" className="mb-2 block text-sm font-medium text-slate-300">Room name</label>
                            <input ref={createRoomInputRef} id="new-room-name" value={newRoomName} onChange={event => { setNewRoomName(event.target.value); setCreateRoomError(null); }} placeholder="e.g. daily-briefing" className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 text-sm text-white placeholder:text-slate-500" aria-describedby={createRoomError ? 'room-name-help room-name-error' : 'room-name-help'} aria-invalid={Boolean(createRoomError)} />
                            <p id="room-name-help" className="mt-2 text-xs text-slate-500">Letters, numbers, hyphens, and underscores only.</p>
                            {createRoomError && <p id="room-name-error" className="mt-2 flex items-center gap-2 text-xs text-red-300" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {createRoomError}</p>}
                            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                                <button type="button" onClick={closeCreateDialog} disabled={isCreatingRoom} className="control-button control-button--quiet">Cancel</button>
                                <button type="submit" disabled={isCreatingRoom} className="control-button control-button--primary">{isCreatingRoom ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />} Create room</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {deleteConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" role="presentation" onMouseDown={() => !isDeletingRoom && closeDeleteDialog()}>
                    <div className="app-panel w-full max-w-md p-5" role="dialog" aria-modal="true" aria-labelledby="delete-room-title" onKeyDown={event => { handleDialogKeyDown(event); if (event.key === 'Escape' && !isDeletingRoom) closeDeleteDialog(); }} onMouseDown={event => event.stopPropagation()}>
                        <h3 id="delete-room-title" className="text-lg font-semibold text-white">Delete room?</h3>
                        <p className="mt-2 text-sm leading-6 text-slate-400">This disconnects all participants and stops the room workflow. The action cannot be undone.</p>
                        <p className="mt-3 rounded-lg bg-red-950/30 px-3 py-2 text-sm font-medium text-red-200">{deleteConfirm}</p>
                        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                            <button onClick={closeDeleteDialog} disabled={isDeletingRoom} className="control-button control-button--quiet">Cancel</button>
                            <button onClick={() => void deleteRoom()} disabled={isDeletingRoom} className="control-button control-button--danger">{isDeletingRoom ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />} Delete room</button>
                        </div>
                    </div>
                </div>
            )}

            {participantRemoveConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" role="presentation" onMouseDown={() => !isRemovingParticipant && closeParticipantDialog()}>
                    <div className="app-panel w-full max-w-md p-5" role="dialog" aria-modal="true" aria-labelledby="remove-participant-title" onKeyDown={event => { handleDialogKeyDown(event); if (event.key === 'Escape' && !isRemovingParticipant) closeParticipantDialog(); }} onMouseDown={event => event.stopPropagation()}>
                        <h3 id="remove-participant-title" className="text-lg font-semibold text-white">Remove participant?</h3>
                        <p className="mt-2 text-sm leading-6 text-slate-400">This immediately disconnects the participant from the room. They may reconnect if they still have access.</p>
                        <p className="mt-3 break-all rounded-lg bg-red-950/30 px-3 py-2 text-sm font-medium text-red-200">{participantRemoveConfirm.identity}</p>
                        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                            <button onClick={closeParticipantDialog} disabled={isRemovingParticipant} className="control-button control-button--quiet">Cancel</button>
                            <button onClick={() => void removeParticipant()} disabled={isRemovingParticipant} className="control-button control-button--danger">
                                {isRemovingParticipant ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <UserMinus size={15} aria-hidden="true" />} Remove participant
                            </button>
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
        <div className="admin-control-surface flex flex-col gap-2 rounded-lg p-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-400/10 text-teal-200">{icon}</span><div className="min-w-0"><p className="text-sm font-medium text-white">{label}</p><p className="text-xs text-teal-100/65">{description}</p></div></div>
            <div className="flex shrink-0 gap-1">
                <button onClick={onOpen} className="control-button control-button--inline !min-h-11"><ExternalLink size={14} aria-hidden="true" /> Open</button>
                <button onClick={onCopy} className="control-button control-button--inline !min-h-11"><Copy size={14} aria-hidden="true" /> Copy</button>
            </div>
        </div>
    );
}

function formatRoomTime(timestamp: number): string {
    if (!timestamp) return '—';
    return new Intl.DateTimeFormat('th-TH-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp * 1000));
}

function formatExpiry(value: string): string {
    return new Intl.DateTimeFormat('th-TH-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
