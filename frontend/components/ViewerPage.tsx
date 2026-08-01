/**
 * ViewerPage Component
 * A dedicated page for viewing LiveKit room transcriptions
 * - Connects to the room supplied by the viewer URL
 * - Lets the viewer choose which provider to follow
 * - Presents the transcript as a read-only subtitle surface
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AlertTriangle, ArrowLeft, Bot, LoaderCircle, LogOut, Pause, Play, Radio, Trash2, Volume2, VolumeX } from 'lucide-react';
import { useRoomViewer } from '../hooks/useRoomViewer';
import { ConnectionState } from '../types';
import { toHttpUrl } from '../lib/runtime';
import { shouldAutoConnectViewer } from '../lib/viewerLaunch';
import ConnectionBadge from './ConnectionBadge';
import { formatProviderName, getProviderPresentation } from '../lib/providers';
import ToastViewport from './ToastViewport';
import { TranscriptRows } from './TranscriptPresentation';
import { collectTranscriptProviders, selectCurrentSubtitle, selectTranscriptPresentation } from '../lib/transcriptPresentation';
import { calculateSubtitleIdleTimeoutMs } from '../lib/subtitlePaging';

interface ViewerPageProps {
    onBack?: () => void;
    backendUrl: string;
    initialRoomName?: string;
    autoConnect?: boolean;
    initialProviderName?: string;
    cleanOutput?: boolean;
}

export default function ViewerPage({
    onBack,
    backendUrl,
    initialRoomName = '',
    autoConnect = false,
    initialProviderName = '',
    cleanOutput = false,
}: ViewerPageProps) {
    const [filterProvider, setFilterProvider] = useState<string>(initialProviderName);
    const [subtitleVisible, setSubtitleVisible] = useState(false);
    const [subtitlePageTick, setSubtitlePageTick] = useState(0);
    const [subtitlePageDurationMs, setSubtitlePageDurationMs] = useState(5_000);
    const [subtitlePaused, setSubtitlePaused] = useState(false);
    const autoConnectAttemptedRef = useRef<string | null>(null);

    const httpBackendUrl = toHttpUrl(backendUrl);
    const viewer = useRoomViewer({
        tokenEndpoint: `${httpBackendUrl}/livekit/viewer-token`,
        fallbackTokenEndpoint: `${httpBackendUrl}/livekit/token`,
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

        // Defer the first attempt until after React Strict Mode's development
        // mount check. Starting it synchronously lets that check dispose the
        // lifecycle, leaving the URL-launched viewer stuck in CONNECTING.
        const timerId = window.setTimeout(() => {
            if (autoConnectAttemptedRef.current === initialRoomName) return;
            autoConnectAttemptedRef.current = initialRoomName;
            void viewer.connect(initialRoomName);
        }, 0);

        return () => window.clearTimeout(timerId);
    }, [autoConnect, initialRoomName, viewer.connect, viewer.connectionState]);

    const availableProviders = useMemo(() => {
        return collectTranscriptProviders(
            viewer.transcripts,
            viewer.interimTranscripts,
            viewer.agents.map(agent => agent.provider),
        );
    }, [viewer.agents, viewer.interimTranscripts, viewer.transcripts]);

    useEffect(() => {
        setFilterProvider(currentProvider => {
            if (availableProviders.length === 0) return currentProvider;
            if (currentProvider && availableProviders.includes(currentProvider)) return currentProvider;

            const activeProvider = viewer.agents.find(agent => availableProviders.includes(agent.provider))?.provider;
            return activeProvider ?? availableProviders[0];
        });
    }, [availableProviders, viewer.agents]);

    const { transcripts: filteredTranscripts, interims: filteredInterims } = useMemo(() => {
        return selectTranscriptPresentation(
            viewer.transcripts,
            viewer.interimTranscripts,
            filterProvider,
        );
    }, [filterProvider, viewer.interimTranscripts, viewer.transcripts]);

    const roomName = viewer.currentRoomName || initialRoomName;
    const hasTranscript = filteredTranscripts.length > 0 || filteredInterims.length > 0;
    const hasAnyTranscript = viewer.transcripts.length > 0 || viewer.interimTranscripts.size > 0;
    const isConnected = viewer.connectionState === ConnectionState.CONNECTED;
    const { transcripts: subtitleTranscripts, interims: subtitleInterims } = selectCurrentSubtitle(
        filteredTranscripts,
        filteredInterims,
    );
    const latestSubtitle = subtitleInterims.at(-1) ?? subtitleTranscripts.at(-1);
    const latestSubtitleAnnouncement = [
        latestSubtitle?.text,
        latestSubtitle?.translation?.text,
    ].filter(Boolean).join('. ');
    const handleSubtitlePageAdvance = useCallback(() => {
        setSubtitlePageTick(tick => tick + 1);
    }, []);
    const subtitleActivityKey = useMemo(() => [
        ...subtitleTranscripts.map(segment => [
            segment.id,
            segment.text,
            segment.translation?.text ?? '',
            segment.translation?.isFinal ?? '',
        ].join(':')),
        ...subtitleInterims.map(interim => [
            interim.key,
            interim.text,
            interim.translation?.text ?? '',
            interim.translation?.isFinal ?? '',
        ].join(':')),
    ].join('|'), [subtitleInterims, subtitleTranscripts]);

    useEffect(() => {
        if (!isConnected || !hasTranscript || !filterProvider) {
            setSubtitleVisible(false);
            return;
        }

        setSubtitleVisible(true);
        if (subtitlePaused) return;
        const timeoutId = window.setTimeout(() => {
            setSubtitleVisible(false);
        }, calculateSubtitleIdleTimeoutMs(subtitlePageDurationMs));
        return () => window.clearTimeout(timeoutId);
    }, [filterProvider, hasTranscript, isConnected, subtitleActivityKey, subtitlePageDurationMs, subtitlePageTick, subtitlePaused]);

    const subtitleSurface = (
        <div
            className={`viewer-subtitle-scroller transcript-scroller relative overflow-hidden px-4 sm:px-8 ${cleanOutput ? 'viewer-subtitle-scroller--clean' : ''}`}
        >
            <span className="sr-only" aria-live="polite" aria-atomic="true">{latestSubtitleAnnouncement}</span>
            {!isConnected ? (
                <ViewerEmptyState connectionState={viewer.connectionState} roomName={roomName} onConnect={() => roomName && void viewer.connect(roomName)} />
            ) : !filterProvider ? (
                <div className="viewer-subtitle-empty" role="status">
                    <span className="viewer-subtitle-empty__icon viewer-subtitle-empty__icon--neutral" aria-hidden="true"><Radio size={22} /></span>
                    <p className="text-base font-semibold text-slate-200">Choose a transcript source</p>
                    <p className="mt-1 text-sm text-slate-600">Select a provider from the Transcript view.</p>
                </div>
            ) : !hasTranscript ? (
                <div className="viewer-subtitle-empty" role="status">
                    <span className="viewer-subtitle-empty__icon viewer-subtitle-empty__icon--neutral" aria-hidden="true"><Bot size={22} /></span>
                    <p className="text-base font-semibold text-slate-200">Waiting for subtitle text</p>
                    <p className="mt-1 text-sm text-slate-500">
                        {viewer.agents.length === 0 ? 'No transcription provider is connected yet.' : 'Text will appear here as the room speaks.'}
                    </p>
                </div>
            ) : (
                <div
                    className={`viewer-subtitle-stage ${subtitleVisible ? '' : 'viewer-subtitle-stage--expired'}`}
                    aria-hidden={!subtitleVisible}
                >
                    <TranscriptRows
                        transcripts={subtitleTranscripts}
                        interims={subtitleInterims}
                        variant="subtitle"
                        onSubtitlePageAdvance={handleSubtitlePageAdvance}
                        onSubtitlePageDuration={setSubtitlePageDurationMs}
                        subtitlePaused={subtitlePaused}
                    />
                </div>
            )}
        </div>
    );

    if (cleanOutput) {
        return (
            <main id="main-content" className="viewer-clean-output" aria-label="Clean subtitle output">
                {subtitleSurface}
            </main>
        );
    }

    return (
        <div className="app-shell">
            <a href="#main-content" className="app-skip-link">Skip to content</a>
            <ToastViewport notices={[
                viewer.error && { id: `viewer-error-${viewer.error}`, tone: 'error', title: 'Connection error', message: viewer.error },
            ]} />
            <header className="app-header">
                <div className="app-header__content viewer-navbar mx-auto w-full max-w-7xl px-4 py-3 sm:px-6">
                    <div className="viewer-navbar__brand flex min-w-0 items-center gap-3">
                        {onBack && (
                            <button
                                type="button"
                                onClick={onBack}
                                className="control-button control-button--quiet !min-h-11 !px-2.5"
                                title="Close Transcript"
                                aria-label="Close Transcript"
                            >
                                <ArrowLeft size={18} aria-hidden="true" />
                            </button>
                        )}
                        <img src="/captionlive-mark.svg" alt="" className="h-10 w-10 shrink-0 rounded-lg" aria-hidden="true" />
                        <div className="min-w-0">
                            <h1 className="flex min-w-0 items-center gap-2 truncate text-lg font-semibold tracking-tight sm:text-xl">
                                <span className="shrink-0 text-[var(--accent)]">CaptionLive</span>
                                <span className="h-4 w-px shrink-0 bg-[var(--line)]" aria-hidden="true" />
                                <span className="truncate">Transcript</span>
                            </h1>
                            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-sm">
                                {roomName ? (
                                    <>
                                        <span className="shrink-0 text-[var(--muted)]">Room</span>
                                        <strong className="truncate font-semibold text-[var(--ink)]">{roomName}</strong>
                                        <span className="shrink-0 text-[var(--subtle)]" aria-hidden="true">·</span>
                                    </>
                                ) : null}
                                <span className="truncate text-[var(--muted)]">Live dialogue subtitles</span>
                            </p>
                        </div>
                    </div>

                    <div className="viewer-navbar__controls flex min-w-0 items-center justify-end gap-1.5 sm:gap-2">
                        {roomName && <ConnectionBadge state={viewer.connectionState} />}
                        {viewer.audioParticipants.length > 0 && (
                            <button
                                type="button"
                                onClick={viewer.toggleAudioMute}
                                className={`control-button !min-h-11 !min-w-11 !px-2.5 ${viewer.isAudioMuted
                                    ? 'control-button--danger'
                                    : 'control-button--quiet text-emerald-200'
                                    }`}
                                title={viewer.isAudioMuted ? 'Unmute room audio' : 'Mute room audio'}
                                aria-label={viewer.isAudioMuted ? 'Unmute room audio' : 'Mute room audio'}
                            >
                                {viewer.isAudioMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                            </button>
                        )}
                        {isConnected && (
                            <>
                                <span className="viewer-navbar__action-divider" aria-hidden="true" />
                                <button
                                    type="button"
                                    onClick={viewer.disconnect}
                                    className="control-button control-button--inline control-button--inline-danger !min-h-11 !px-2.5 sm:!px-3"
                                    title="Leave room"
                                    aria-label="Leave room"
                                >
                                    <LogOut size={16} aria-hidden="true" />
                                    <span className="hidden lg:inline">Leave room</span>
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </header>

            <main id="main-content" className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-7">
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
                    <aside className="space-y-4">
                        <section className="app-panel p-4">
                            <div className="mb-4">
                                <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                                    <Radio size={14} className="text-teal-300" />
                                    Transcript source
                                </h2>
                                <p className="mt-1 text-xs leading-5 text-slate-400">
                                    Choose one provider to follow. Translation appears below the source when available. This view shows recognized dialogue; non-speech audio is not inferred.
                                </p>
                            </div>

                            <div className="space-y-2" role="group" aria-label="Transcript provider">
                                {availableProviders.map(provider => {
                                    const isActive = viewer.agents.some(agent => agent.provider === provider);
                                    const providerCount = viewer.transcripts.filter(segment => segment.provider === provider).length;
                                    const presentation = getProviderPresentation(provider);
                                    return (
                                        <button
                                            key={provider}
                                            type="button"
                                            aria-pressed={filterProvider === provider}
                                            onClick={() => setFilterProvider(provider)}
                                            className={`viewer-provider-option ${filterProvider === provider ? 'viewer-provider-option--selected' : ''}`}
                                        >
                                            <span className="flex min-w-0 items-center gap-2.5">
                                                <span className={`viewer-provider-option__swatch ${presentation.accent}`} aria-hidden="true" />
                                                <span className="min-w-0 truncate">{formatProviderName(provider)}</span>
                                            </span>
                                            <span className="flex shrink-0 items-center gap-2">
                                                <span className={`status-dot ${isActive ? 'status-dot--live' : ''}`} aria-hidden="true" />
                                                <span className="sr-only">{isActive ? 'Provider live' : 'No active agent'}</span>
                                                <span className="viewer-provider-option__count" aria-label={`${providerCount} finalized segments`}>{providerCount}</span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>

                            {availableProviders.length === 0 && (
                                <div className="viewer-provider-empty" role="status">
                                    <Radio size={18} className="text-slate-500" aria-hidden="true" />
                                    <div>
                                        <p className="text-sm font-medium text-slate-300">Waiting for a provider</p>
                                        <p className="mt-1 text-xs leading-5 text-slate-500">Start an agent in Control Room to make it available here.</p>
                                    </div>
                                </div>
                            )}
                        </section>

                    </aside>

                    <section className="app-panel viewer-subtitle-panel flex flex-col" aria-labelledby="viewer-subtitle-heading">
                        <div className="panel-header viewer-subtitle-toolbar flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
                            <div className="flex min-w-0 items-center gap-3">
                                <h2 id="viewer-subtitle-heading" className="text-sm font-semibold text-slate-100">Subtitle</h2>
                                <span className="text-xs text-slate-400" aria-live="polite">
                                    {filteredTranscripts.length} final
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setSubtitlePaused(paused => !paused)}
                                    disabled={!hasTranscript}
                                    className="control-button control-button--quiet disabled:opacity-40"
                                    aria-pressed={subtitlePaused}
                                    aria-label={subtitlePaused ? 'Resume subtitles' : 'Pause subtitles'}
                                >
                                    {subtitlePaused ? <Play size={12} aria-hidden="true" /> : <Pause size={12} aria-hidden="true" />}
                                    {subtitlePaused ? 'Resume' : 'Pause'}
                                </button>
                                <button
                                    type="button"
                                    onClick={viewer.clearTranscripts}
                                    disabled={!hasAnyTranscript}
                                    className="control-button control-button--quiet disabled:opacity-40"
                                    aria-label="Clear transcript"
                                >
                                    <Trash2 size={12} aria-hidden="true" />
                                    Clear
                                </button>
                            </div>
                        </div>

                        {subtitleSurface}
                    </section>
                </div>
            </main>
        </div>
    );
}

function ViewerEmptyState({
    connectionState,
    roomName,
    onConnect,
}: {
    connectionState: ConnectionState;
    roomName: string;
    onConnect: () => void;
}) {
    const isConnecting = connectionState === ConnectionState.CONNECTING;
    const isError = connectionState === ConnectionState.ERROR;
    return (
        <div className="viewer-subtitle-empty" role={isError ? 'alert' : 'status'}>
            <span className={`viewer-subtitle-empty__icon ${isConnecting ? 'viewer-subtitle-empty__icon--pending' : isError ? 'viewer-subtitle-empty__icon--error' : 'viewer-subtitle-empty__icon--neutral'}`} aria-hidden="true">
                {isConnecting ? <LoaderCircle size={22} className="animate-spin" /> : isError ? <AlertTriangle size={22} /> : <Radio size={22} />}
            </span>
            <p className="text-base font-semibold text-slate-200">
                {isConnecting ? `Connecting to ${roomName || 'room'}` : isError ? 'Connection failed' : 'Room is not connected'}
            </p>
            <p className="mt-1 max-w-sm text-center text-sm text-slate-500">
                {isConnecting ? 'Joining the live subtitle room…' : isError ? `Could not join ${roomName || 'this room'}. Check the connection and try again.` : 'Connect to the room to start receiving subtitles.'}
            </p>
            {!isConnecting && roomName && (
                <button type="button" onClick={onConnect} className="control-button control-button--primary mt-4">
                    {isError ? 'Retry connection' : 'Connect to room'}
                </button>
            )}
        </div>
    );
}
