/**
 * ViewerPage Component
 * A dedicated page for viewing LiveKit room transcriptions
 * - Lists available rooms
 * - Shows active ASR agents
 * - Filters transcripts by provider
 * - Read-only (no microphone)
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, Users, Radio, Trash2, X, Bot, Eye, Volume2, VolumeX } from 'lucide-react';
import { useRoomViewer } from '../hooks/useRoomViewer';
import { ConnectionState } from '../types';
import { toHttpUrl } from '../lib/runtime';
import { shouldStickToLatest } from '../lib/transcriptViewport';
import TranslationBlock from './TranslationBlock';
import { formatLanguageLabel, groupFinalTranscriptRows, isTranscriptTurnLive, normalizeLanguageTag } from '../lib/transcriptMessages';
import { shouldAutoConnectViewer } from '../lib/viewerLaunch';
import ConnectionBadge from './ConnectionBadge';
import { buildViewerUrl } from '../lib/appRoutes';
import { formatProviderName, getProviderPresentation, hasSourceLanguageLabel } from '../lib/providers';
import ToastViewport from './ToastViewport';

interface RoomInfo {
    name: string;
    numParticipants: number;
    creationTime: number;
}

interface ViewerPageProps {
    onBack?: () => void;
    backendUrl: string;
    initialRoomName?: string;
    autoConnect?: boolean;
}

export default function ViewerPage({ onBack, backendUrl, initialRoomName = '', autoConnect = false }: ViewerPageProps) {
    // Room list state
    const [rooms, setRooms] = useState<RoomInfo[]>([]);
    const [isLoadingRooms, setIsLoadingRooms] = useState(false);
    const [roomsError, setRoomsError] = useState<string | null>(null);

    // Provider filter - simple select: 'all' or specific provider name
    const [filterProvider, setFilterProvider] = useState<string>('all');
    const [isFollowingLatest, setIsFollowingLatest] = useState(true);
    const transcriptScrollRef = useRef<HTMLDivElement>(null);
    const autoConnectAttemptedRef = useRef<string | null>(null);

    const scrollToLatest = useCallback(() => {
        const scroller = transcriptScrollRef.current;
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
    }, []);

    // Convert backend URL to HTTP
    const httpBackendUrl = toHttpUrl(backendUrl);

    // Room viewer hook
    const viewer = useRoomViewer({
        tokenEndpoint: `${httpBackendUrl}/livekit/token`,
    });

    useEffect(() => {
        const attempted = autoConnectAttemptedRef.current === initialRoomName;
        if (!shouldAutoConnectViewer({
            autoConnect,
            roomName: initialRoomName,
            attempted,
            connected: viewer.connectionState !== ConnectionState.DISCONNECTED,
        })) {
            return;
        }

        autoConnectAttemptedRef.current = initialRoomName;
        void viewer.connect(initialRoomName);
    }, [autoConnect, initialRoomName, viewer.connect, viewer.connectionState]);

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
        let disposed = false;
        let nextPoll: number | undefined;
        const poll = async () => {
            await fetchRooms();
            if (!disposed) nextPoll = window.setTimeout(poll, 10000);
        };
        void poll();
        return () => {
            disposed = true;
            if (nextPoll !== undefined) window.clearTimeout(nextPoll);
        };
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
        viewer.interimTranscripts.forEach(interim => providers.add(interim.provider));
        return Array.from(providers).sort();
    }, [viewer.agents, viewer.interimTranscripts, viewer.transcripts]);

    // Filter transcripts by selected provider
    const filteredTranscripts = useMemo(() => {
        const matching = filterProvider === 'all'
            ? viewer.transcripts
            : viewer.transcripts.filter(t => t.provider === filterProvider);
        return groupFinalTranscriptRows(matching);
    }, [viewer.transcripts, filterProvider]);

    const filteredInterims = useMemo(() => {
        const interims = Array.from(viewer.interimTranscripts.values());
        return filterProvider === 'all'
            ? interims
            : interims.filter(interim => interim.provider === filterProvider);
    }, [filterProvider, viewer.interimTranscripts]);

    useEffect(() => {
        if (!isFollowingLatest) return;

        const frame = window.requestAnimationFrame(scrollToLatest);
        return () => window.cancelAnimationFrame(frame);
    }, [filteredInterims, filteredTranscripts, isFollowingLatest, scrollToLatest]);

    return (
        <div className="app-shell">
            <ToastViewport notices={[
                roomsError && { id: `rooms-error-${roomsError}`, tone: 'error', title: 'Rooms unavailable', message: roomsError, onDismiss: () => setRoomsError(null) },
                viewer.error && { id: `viewer-error-${viewer.error}`, tone: 'error', title: 'Connection error', message: viewer.error },
            ]} />
            <span className="sr-only" aria-live="polite" aria-atomic="true">{viewer.transcripts.at(-1)?.text ?? ''}</span>
            {/* Header */}
            <header className="app-header">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        {onBack && (
                            <button
                                onClick={onBack}
                                className="control-button control-button--quiet !min-h-11 !px-2.5"
                                title="Close Viewer"
                            >
                                <X size={20} />
                            </button>
                        )}
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-400/35 bg-emerald-400/10 text-emerald-200">
                            <Eye size={18} />
                        </span>
                        <div>
                            <h1 className="text-lg font-bold text-white">Transcript Viewer</h1>
                            <p className="text-xs text-slate-400">Watch live transcriptions</p>
                        </div>
                    </div>

                    {/* Connection Status & Audio Control */}
                    {viewer.currentRoomName && (
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-slate-400">
                                Room: <span className="text-white font-medium">{viewer.currentRoomName}</span>
                            </span>

                            {/* Audio Mute Button */}
                            {viewer.audioParticipants.length > 0 && (
                                <button
                                    onClick={viewer.toggleAudioMute}
                                    className={`min-h-11 min-w-11 rounded-lg p-2 transition ${viewer.isAudioMuted
                                        ? 'text-red-400 hover:text-red-300 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30'
                                        : 'text-emerald-400 hover:text-emerald-300 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30'
                                        }`}
                                    title={viewer.isAudioMuted ? 'Unmute audio' : 'Mute audio'}
                                >
                                    {viewer.isAudioMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                                </button>
                            )}

                            <ConnectionBadge state={viewer.connectionState} />
                        </div>
                    )}
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
                    {/* Left Sidebar - Room List */}
                    <div className="lg:col-span-1 space-y-4">
                        {/* Room List Card */}
                        <section className="app-panel p-4">
                            <div className="mb-4 flex items-center justify-between">
                                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                                    <Radio size={14} className="text-emerald-400" />
                                    Active Rooms
                                </h2>
                                <button
                                    onClick={fetchRooms}
                                    disabled={isLoadingRooms}
                                    className="control-button control-button--quiet !min-h-11 !px-2 disabled:opacity-50"
                                    title="Refresh rooms"
                                >
                                    <RefreshCw size={14} className={isLoadingRooms ? 'animate-spin' : ''} />
                                </button>
                            </div>

                            {rooms.length === 0 ? (
                                <p className="text-center text-sm text-slate-400 py-4">
                                    {isLoadingRooms ? 'Loading...' : 'No active rooms'}
                                </p>
                            ) : (
                                <div className="space-y-1.5">
                                    {rooms.map(room => (
                                        <button
                                            key={room.name}
                                            onClick={() => {
                                                void viewer.connect(room.name);
                                                const nextUrl = buildViewerUrl(window.location.origin + window.location.pathname, room.name);
                                                window.location.hash = new URL(nextUrl).hash;
                                            }}
                                            disabled={viewer.connectionState === ConnectionState.CONNECTING}
                                            className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${viewer.currentRoomName === room.name
                                                ? 'border-violet-400/55 bg-violet-400/10 text-white'
                                                : 'border-slate-700 bg-slate-950/20 text-slate-300 hover:bg-slate-700/35'
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
                                    onClick={() => {
                                        viewer.disconnect();
                                        const nextUrl = buildViewerUrl(window.location.origin + window.location.pathname, '');
                                        window.location.hash = new URL(nextUrl).hash;
                                    }}
                                    className="control-button control-button--danger mt-4 w-full"
                                >
                                    Disconnect
                                </button>
                            )}
                        </section>

                        {/* Active Agents Card */}
                        {viewer.connectionState === ConnectionState.CONNECTED && (
                            <section className="app-panel p-4">
                                <h2 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                                    <Bot size={14} className="text-purple-400" />
                                    Active Agents
                                </h2>

                                {viewer.agents.length === 0 ? (
                                    <p className="text-center text-sm text-slate-400 py-2">
                                        No agents connected
                                    </p>
                                ) : (
                                    <div className="space-y-2">
                                        {viewer.agents.map(agent => (
                                            <div
                                                key={agent.identity}
                                                className={`flex items-center justify-between rounded-lg border px-2.5 py-2 ${getProviderPresentation(agent.provider).badge}`}
                                            >
                                                <span className="text-sm font-medium">{formatProviderName(agent.provider)}</span>
                                                <span className="status-dot status-dot--live" aria-hidden="true" />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>
                        )}

                        {/* Audio Playback Card */}
                        {viewer.connectionState === ConnectionState.CONNECTED && viewer.audioParticipants.length > 0 && (
                            <section className="app-panel p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                                        {viewer.isAudioMuted ? (
                                            <VolumeX size={14} className="text-red-400" />
                                        ) : (
                                            <Volume2 size={14} className="text-emerald-400" />
                                        )}
                                        Audio
                                    </h2>
                                    <button
                                        onClick={viewer.toggleAudioMute}
                                        className={`control-button !min-h-11 !px-2.5 ${viewer.isAudioMuted
                                            ? 'control-button--danger'
                                            : 'control-button--quiet text-emerald-200'
                                            }`}
                                    >
                                        {viewer.isAudioMuted ? 'Unmute' : 'Mute'}
                                    </button>
                                </div>

                                <div className="space-y-1">
                                    {viewer.audioParticipants.map(participant => (
                                        <div
                                            key={participant}
                                            className="flex items-center gap-2 text-xs text-slate-300"
                                        >
                                            <span className={`status-dot ${viewer.isAudioMuted ? '' : 'status-dot--live'}`} aria-hidden="true" />
                                            <span className="truncate">{participant}</span>
                                        </div>
                                    ))}
                                </div>

                                {!viewer.isAudioMuted && (
                                    <p className="text-xs text-emerald-400 mt-2">🔊 Listening to room audio</p>
                                )}
                            </section>
                        )}
                    </div>

                    {/* Main Content - Transcript Area */}
                    <div className="lg:col-span-3">
                        <section className="app-panel relative overflow-hidden">
                            {/* Toolbar */}
                            <div className="panel-header flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                                <div className="flex items-center gap-3">
                                    <h2 className="text-sm font-semibold text-white">
                                        Transcripts
                                    </h2>
                                    <span className="text-xs text-slate-400">
                                        {filteredTranscripts.length} segment{filteredTranscripts.length !== 1 ? 's' : ''}
                                    </span>
                                </div>

                                <div className="flex items-center gap-2">
                                    {/* Provider Filter */}
                                    {/* Provider Filter - Simple Select */}
                                    {availableProviders.length > 0 && (
                                        <select
                                            value={filterProvider}
                                            onChange={(e) => setFilterProvider(e.target.value)}
                                            aria-label="Filter transcripts by provider"
                                            className="h-11 rounded-lg border border-slate-600 bg-slate-950/40 px-3 text-xs font-medium text-white"
                                        >
                                            <option value="all">All Providers</option>
                                            {availableProviders.map(provider => (
                                                <option key={provider} value={provider}>
                                                    {formatProviderName(provider)}
                                                </option>
                                            ))}
                                        </select>
                                    )}

                                    {/* Clear Button */}
                                    <button
                                        onClick={viewer.clearTranscripts}
                                        disabled={viewer.transcripts.length === 0 && viewer.interimTranscripts.size === 0}
                                        className="control-button control-button--quiet disabled:opacity-40"
                                    >
                                        <Trash2 size={12} />
                                        Clear
                                    </button>
                                </div>
                            </div>

                            {/* Transcript List */}
                            <div
                                ref={transcriptScrollRef}
                                className="transcript-scroller h-[clamp(24rem,65dvh,52rem)] overflow-y-auto px-4 py-2"
                                onScroll={(event) => setIsFollowingLatest(shouldStickToLatest(event.currentTarget))}
                            >
                                {viewer.connectionState !== ConnectionState.CONNECTED ? (
                                    <div className="flex h-full flex-col items-center justify-center text-slate-400">
                                        <Radio size={32} className="mb-3 opacity-50" />
                                        <p className="text-sm">Select a room to start viewing</p>
                                    </div>
                                ) : filteredTranscripts.length === 0 && filteredInterims.length === 0 ? (
                                    <div className="flex h-full flex-col items-center justify-center text-slate-400">
                                        <Bot size={32} className="mb-3 opacity-50" />
                                        <p className="text-sm">Waiting for transcripts...</p>
                                        {viewer.agents.length === 0 && (
                                            <p className="mt-1 text-xs text-slate-400">No agents connected yet</p>
                                        )}
                                    </div>
                                ) : (
                                    <>
                                        {/* Final transcripts */}
                                        {filteredTranscripts.map(segment => {
                                            const isTurnLive = isTranscriptTurnLive(segment);
                                            return (
                                                <div
                                                    key={segment.id}
                                                    className="transcript-row transcript-turn grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 py-3"
                                                >
                                                    {segment.provider && (
                                                        <span className={`h-fit shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${getProviderPresentation(segment.provider).badge}`}>
                                                            {formatProviderName(segment.provider)}
                                                        </span>
                                                    )}
                                                    <div className="transcript-bilingual min-w-0">
                                                        <p
                                                            className={`transcript-source-line break-words text-[1rem] leading-7 text-slate-100 ${hasSourceLanguageLabel(segment.provider, segment.languageCode) ? 'transcript-source-line--labeled' : ''}`}
                                                            lang={normalizeLanguageTag(segment.languageCode)}
                                                            dir="auto"
                                                        >
                                                            {hasSourceLanguageLabel(segment.provider, segment.languageCode) && (
                                                                <span className="source-language-label" title={formatLanguageLabel(segment.languageCode)} aria-hidden="true">
                                                                    <span className="language-label__text">{formatLanguageLabel(segment.languageCode)}</span>
                                                                </span>
                                                            )}
                                                            <span className="transcript-source-line__text">{segment.text}</span>
                                                        </p>
                                                        <TranslationBlock translation={segment.translation} />
                                                    </div>
                                                    <time
                                                        className="transcript-turn__time shrink-0 text-[10px] text-slate-400"
                                                        dateTime={new Date(segment.timestamp).toISOString()}
                                                    >
                                                        {isTurnLive && (
                                                            <>
                                                                <span className="sr-only">Live turn. </span>
                                                                <span className="transcript-live-dot transcript-turn__live-dot" aria-hidden="true" />
                                                            </>
                                                        )}
                                                        {new Date(segment.timestamp).toLocaleTimeString()}
                                                    </time>
                                                </div>
                                            );
                                        })}

                                        {/* Interim transcripts (per agent) */}
                                        {filteredInterims.map(interim => (
                                            <div
                                                key={interim.key}
                                                className="transcript-row transcript-row--interim transcript-turn transcript-turn--draft grid grid-cols-[auto_minmax(0,1fr)] gap-2 py-3 sm:gap-3"
                                            >
                                                <div className="flex flex-col items-start gap-1">
                                                    <span className={`h-fit shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${getProviderPresentation(interim.provider).badge}`}>
                                                        {formatProviderName(interim.provider)}
                                                    </span>
                                                    <span className="transcript-draft-indicator">
                                                        <span className="transcript-live-dot" aria-hidden="true" />
                                                        Draft
                                                    </span>
                                                </div>
                                                <div className="transcript-bilingual col-span-2 min-w-0 sm:col-span-1">
                                                    <p
                                                        className={`transcript-source-line break-words text-[1rem] leading-7 text-slate-300 ${hasSourceLanguageLabel(interim.provider, interim.languageCode) ? 'transcript-source-line--labeled' : ''}`}
                                                        lang={normalizeLanguageTag(interim.languageCode)}
                                                        dir="auto"
                                                    >
                                                        <span className="sr-only">Live interim transcript from {interim.speaker}: </span>
                                                        {hasSourceLanguageLabel(interim.provider, interim.languageCode) && (
                                                            <span className="source-language-label" title={formatLanguageLabel(interim.languageCode)} aria-hidden="true">
                                                                <span className="language-label__text">{formatLanguageLabel(interim.languageCode)}</span>
                                                            </span>
                                                        )}
                                                        <span className="transcript-source-line__text">{interim.text}</span>
                                                    </p>
                                                    <TranslationBlock translation={interim.translation} />
                                                </div>
                                            </div>
                                        ))}
                                    </>
                                )}
                            </div>
                            {!isFollowingLatest && (filteredTranscripts.length > 0 || filteredInterims.length > 0) && (
                                <button
                                    type="button"
                                    className="control-button control-button--quiet absolute bottom-3 right-4 bg-slate-900/95 shadow-lg"
                                    onClick={() => {
                                        scrollToLatest();
                                        setIsFollowingLatest(true);
                                    }}
                                >
                                    Jump to latest
                                </button>
                            )}
                        </section>

                    </div>
                </div>
            </main>
        </div>
    );
}
