/**
 * ViewerPage Component
 * A dedicated page for viewing LiveKit room transcriptions
 * - Connects to the room supplied by the viewer URL
 * - Lets the viewer choose which provider to follow
 * - Presents the transcript as a read-only subtitle surface
 */

import { useState, useEffect, useMemo, useRef, useCallback, type CSSProperties } from 'react';
import { AlertTriangle, ArrowLeft, BadgeCheck, LoaderCircle, LogOut, Pause, Play, Radio, Trash2, Volume2, VolumeX } from 'lucide-react';
import { useRoomViewer } from '../hooks/useRoomViewer';
import { ConnectionState } from '../types';
import { toHttpUrl } from '../lib/runtime';
import { shouldAutoConnectViewer } from '../lib/viewerLaunch';
import ConnectionBadge from './ConnectionBadge';
import { formatProviderName, getProviderPresentation } from '../lib/providers';
import ToastViewport from './ToastViewport';
import { TranscriptRows } from './TranscriptPresentation';
import {
    collectTranscriptProviders,
    buildFinalSubtitleAnnouncement,
    selectCurrentSubtitle,
    selectTranscriptPresentation,
    snapshotCurrentSubtitle,
    type CurrentSubtitlePresentation,
} from '../lib/transcriptPresentation';
import { calculateSubtitleIdleTimeoutMs } from '../lib/subtitlePaging';
import {
    progressiveRevealRate,
    SUBTITLE_PLAYBACK_RATE_MAX,
    SUBTITLE_PLAYBACK_RATE_MIN,
} from '../lib/progressiveText';
import {
    useCaptionDeskPlayback,
    useCaptionDeskPlaybackText,
    type CaptionDeskPlaybackStore,
} from '../hooks/useCaptionDeskPlayback';

interface ViewerPageProps {
    onBack?: () => void;
    backendUrl: string;
    initialRoomName?: string;
    autoConnect?: boolean;
    initialProviderName?: string;
    cleanOutput?: boolean;
}

const CAPTION_DESK_SOURCE = 'caption-desk';
const CAPTION_DESK_LIVE_SEGMENT_ID = 'caption-desk-live';
const SUBTITLE_FADE_OUT_MS = 220;
const VIEWER_DISPLAY_SETTINGS_KEY = 'captionlive.viewer.display';

type SubtitleTextSize = 'small' | 'standard' | 'large';
type SubtitleBackground = 'canvas' | 'lines' | 'transparent';

interface ViewerDisplaySettings {
    textSize: SubtitleTextSize;
    showTranslation: boolean;
    background: SubtitleBackground;
}

const DEFAULT_DISPLAY_SETTINGS: ViewerDisplaySettings = {
    textSize: 'standard',
    showTranslation: true,
    background: 'canvas',
};

function loadViewerDisplaySettings(): ViewerDisplaySettings {
    try {
        const saved = JSON.parse(localStorage.getItem(VIEWER_DISPLAY_SETTINGS_KEY) ?? '{}') as Partial<ViewerDisplaySettings>;
        return {
            textSize: saved.textSize === 'small' || saved.textSize === 'large' ? saved.textSize : 'standard',
            showTranslation: saved.showTranslation !== false,
            background: saved.background === 'lines' || saved.background === 'transparent' ? saved.background : 'canvas',
        };
    } catch {
        return DEFAULT_DISPLAY_SETTINGS;
    }
}

function buildCaptionDeskLiveSegment(text: string, timestamp: number) {
    if (!text) return [];
    return [{
        id: CAPTION_DESK_LIVE_SEGMENT_ID,
        text,
        isFinal: true,
        timestamp,
        provider: CAPTION_DESK_SOURCE,
        role: 'source' as const,
        segmentId: CAPTION_DESK_LIVE_SEGMENT_ID,
    }];
}

function CaptionDeskSubtitleRows({
    playback,
    timestamp,
    paused,
    layoutKey,
    onPageAdvance,
    onPageDuration,
}: {
    playback: CaptionDeskPlaybackStore;
    timestamp: number;
    paused: boolean;
    layoutKey: string;
    onPageAdvance: () => void;
    onPageDuration: (durationMs: number) => void;
}) {
    const text = useCaptionDeskPlaybackText(playback);
    const handleCueComplete = useCallback(() => {
        if (playback.completeCue()) onPageAdvance();
    }, [onPageAdvance, playback]);
    return (
        <TranscriptRows
            transcripts={buildCaptionDeskLiveSegment(text, timestamp)}
            interims={[]}
            variant="subtitle"
            onSubtitlePageAdvance={onPageAdvance}
            onSubtitlePageDuration={onPageDuration}
            onSubtitleCueComplete={handleCueComplete}
            subtitleHasBacklog={playback.hasPendingText()}
            subtitlePaused={paused}
            subtitleFollowLiveEdge
            subtitleShowTranslation={false}
            subtitleLayoutKey={layoutKey}
        />
    );
}

function CaptionDeskQueueStatus({ playback }: { playback: CaptionDeskPlaybackStore }) {
    useCaptionDeskPlaybackText(playback);
    const pendingCount = playback.getPendingGraphemeCount();
    const pendingCueCount = playback.getPendingCueCount();
    const preview = playback.getPendingPreview();
    const visiblePreview = preview.replace(/\r\n|\r|\n/gu, ' ↵ ').replace(/\s+/gu, ' ');

    if (pendingCount === 0) {
        return <span className="viewer-queue-status viewer-queue-status--clear">Queue clear</span>;
    }

    return (
        <span
            className="viewer-queue-status"
            title={`Waiting to display: ${preview}`}
            aria-label={`${pendingCount} characters waiting in approximately ${pendingCueCount} subtitle cues`}
        >
            <span className="viewer-queue-status__count">
                Queued {pendingCount} · {pendingCueCount} {pendingCueCount === 1 ? 'cue' : 'cues'}
            </span>
            <span className="viewer-queue-status__preview" aria-hidden="true">
                “{visiblePreview}”
            </span>
        </span>
    );
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
    const [subtitlePlaybackRate, setSubtitlePlaybackRate] = useState(1);
    const [displaySettings, setDisplaySettings] = useState(loadViewerDisplaySettings);
    const [pausedSubtitle, setPausedSubtitle] = useState<CurrentSubtitlePresentation | null>(null);
    const subtitleSpeedCps = Math.round(progressiveRevealRate(0, subtitlePlaybackRate));
    const subtitleSpeedProfile = subtitlePlaybackRate < 0.88
        ? subtitleSpeedCps < 13 ? 'Accessible' : 'Children pace'
        : subtitlePlaybackRate < 1.1
            ? 'Standard'
            : 'SDH maximum';
    const subtitleSpeedProgress = (
        (subtitlePlaybackRate - SUBTITLE_PLAYBACK_RATE_MIN)
        / (SUBTITLE_PLAYBACK_RATE_MAX - SUBTITLE_PLAYBACK_RATE_MIN)
    ) * 100;
    const autoConnectAttemptedRef = useRef<string | null>(null);
    const isCaptionDeskSource = filterProvider === CAPTION_DESK_SOURCE;
    const captionDeskPlayback = useCaptionDeskPlayback(isCaptionDeskSource, subtitlePaused, subtitlePlaybackRate);

    useEffect(() => {
        localStorage.setItem(VIEWER_DISPLAY_SETTINGS_KEY, JSON.stringify(displaySettings));
    }, [displaySettings]);

    useEffect(() => {
        const useTransparentPage = cleanOutput && displaySettings.background !== 'canvas';
        document.documentElement.classList.toggle('viewer-output-transparent', useTransparentPage);
        document.body.classList.toggle('viewer-output-transparent', useTransparentPage);
        return () => {
            document.documentElement.classList.remove('viewer-output-transparent');
            document.body.classList.remove('viewer-output-transparent');
        };
    }, [cleanOutput, displaySettings.background]);

    const httpBackendUrl = toHttpUrl(backendUrl);
    const viewer = useRoomViewer({
        tokenEndpoint: `${httpBackendUrl}/livekit/viewer-token`,
        fallbackTokenEndpoint: `${httpBackendUrl}/livekit/token`,
        onPublicCaption: captionDeskPlayback.enqueue,
    });
    const roomName = viewer.currentRoomName || initialRoomName;

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
    const providerCounts = useMemo(() => {
        const counts = new Map<string, number>();
        viewer.transcripts.forEach(segment => {
            if (!segment.provider) return;
            counts.set(segment.provider, (counts.get(segment.provider) ?? 0) + 1);
        });
        return counts;
    }, [viewer.transcripts]);
    const activeProviders = useMemo(
        () => new Set(viewer.agents.map(agent => agent.provider)),
        [viewer.agents],
    );

    useEffect(() => {
        setFilterProvider(currentProvider => {
            if (availableProviders.length === 0) return currentProvider;
            if (currentProvider === CAPTION_DESK_SOURCE) return currentProvider;
            if (currentProvider && availableProviders.includes(currentProvider)) return currentProvider;

            const activeProvider = viewer.agents.find(agent => availableProviders.includes(agent.provider))?.provider;
            return activeProvider ?? availableProviders[0];
        });
    }, [availableProviders, viewer.agents]);

    useEffect(() => {
        if (initialProviderName === CAPTION_DESK_SOURCE) {
            viewer.activatePublicCaptions();
        }
    }, [initialProviderName, viewer.activatePublicCaptions]);

    useEffect(() => () => viewer.deactivatePublicCaptions(), [viewer.deactivatePublicCaptions]);

    const handleSelectSource = useCallback((source: string) => {
        if (source === filterProvider) return;
        if (source === CAPTION_DESK_SOURCE) viewer.activatePublicCaptions();
        else viewer.deactivatePublicCaptions();
        setFilterProvider(source);
    }, [filterProvider, viewer.activatePublicCaptions, viewer.deactivatePublicCaptions]);


    useEffect(() => {
        setSubtitlePaused(false);
        setPausedSubtitle(null);
    }, [filterProvider, roomName]);

    const { transcripts: filteredTranscripts, interims: filteredInterims } = useMemo(() => {
        if (filterProvider === CAPTION_DESK_SOURCE) return { transcripts: [], interims: [] };
        return selectTranscriptPresentation(
            viewer.transcripts,
            viewer.interimTranscripts,
            filterProvider,
        );
    }, [filterProvider, viewer.interimTranscripts, viewer.transcripts]);

    const hasTranscript = isCaptionDeskSource
        ? captionDeskPlayback.hasContent()
        : filteredTranscripts.length > 0 || filteredInterims.length > 0;
    const hasAnyTranscript = viewer.transcripts.length > 0
        || viewer.interimTranscripts.size > 0
        || viewer.publicCaptions.length > 0;
    const isConnected = viewer.connectionState === ConnectionState.CONNECTED;
    const liveSubtitle = selectCurrentSubtitle(
        filteredTranscripts,
        filteredInterims,
    );
    const displayedSubtitle = subtitlePaused && pausedSubtitle ? pausedSubtitle : liveSubtitle;
    const subtitleTranscripts = displayedSubtitle.transcripts;
    const subtitleInterims = displayedSubtitle.interims;
    const latestPublicCaption = viewer.publicCaptions.at(-1);
    const latestSubtitleAnnouncement = isCaptionDeskSource
        ? latestPublicCaption?.text ?? ''
        : buildFinalSubtitleAnnouncement(filteredTranscripts.at(-1), displaySettings.showTranslation);
    const handleSubtitlePageAdvance = useCallback(() => {
        setSubtitlePageTick(tick => tick + 1);
    }, []);
    const handleToggleSubtitlePause = useCallback(() => {
        if (subtitlePaused) {
            setSubtitlePaused(false);
            setPausedSubtitle(null);
            return;
        }
        if (!isCaptionDeskSource) setPausedSubtitle(snapshotCurrentSubtitle(liveSubtitle));
        setSubtitlePaused(true);
    }, [isCaptionDeskSource, liveSubtitle, subtitlePaused]);
    const providerSubtitleActivityKey = useMemo(() => [
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
    const subtitleActivityKey = isCaptionDeskSource
        ? `${latestPublicCaption?.id ?? ''}:${subtitlePageTick}`
        : providerSubtitleActivityKey;

    useEffect(() => {
        if (!isConnected || !hasTranscript || !filterProvider) {
            setSubtitleVisible(false);
            return;
        }

        setSubtitleVisible(true);
        if (subtitlePaused) return;
        let clearTimeoutId: number | undefined;
        const timeoutId = window.setTimeout(() => {
            if (isCaptionDeskSource && captionDeskPlayback.hasPendingText()) {
                setSubtitlePageTick(tick => tick + 1);
                return;
            }
            setSubtitleVisible(false);
            if (isCaptionDeskSource) {
                clearTimeoutId = window.setTimeout(
                    () => captionDeskPlayback.clear(),
                    SUBTITLE_FADE_OUT_MS,
                );
            }
        }, calculateSubtitleIdleTimeoutMs(subtitlePageDurationMs));
        return () => {
            window.clearTimeout(timeoutId);
            if (clearTimeoutId !== undefined) window.clearTimeout(clearTimeoutId);
        };
    }, [captionDeskPlayback, filterProvider, hasTranscript, isCaptionDeskSource, isConnected, subtitleActivityKey, subtitlePageDurationMs, subtitlePageTick, subtitlePaused]);

    useEffect(() => {
        if (
            viewer.room === null
            && (viewer.connectionState === ConnectionState.DISCONNECTED || viewer.connectionState === ConnectionState.ERROR)
        ) {
            captionDeskPlayback.clear();
        }
    }, [captionDeskPlayback, viewer.connectionState, viewer.room]);

    const handleClearTranscripts = useCallback(() => {
        captionDeskPlayback.clear();
        viewer.clearTranscripts();
    }, [captionDeskPlayback.clear, viewer.clearTranscripts]);

    const handleDisconnect = useCallback(() => {
        captionDeskPlayback.clear();
        viewer.disconnect();
    }, [captionDeskPlayback.clear, viewer.disconnect]);

    const subtitleSurface = (
        <div
            className={`viewer-subtitle-scroller viewer-subtitle-scroller--size-${displaySettings.textSize} viewer-subtitle-scroller--background-${displaySettings.background} ${displaySettings.showTranslation ? '' : 'viewer-subtitle-scroller--translation-hidden'} transcript-scroller relative overflow-hidden px-4 sm:px-8 ${cleanOutput ? 'viewer-subtitle-scroller--clean' : ''}`}
        >
            <span className="sr-only" aria-live="polite" aria-atomic="true">{latestSubtitleAnnouncement}</span>
            {cleanOutput && (!isConnected || !filterProvider || !hasTranscript) ? null : !isConnected ? (
                <ViewerEmptyState connectionState={viewer.connectionState} roomName={roomName} onConnect={() => roomName && void viewer.connect(roomName)} />
            ) : !filterProvider ? (
                <div className="viewer-subtitle-empty" role="status">
                    <span className="viewer-subtitle-empty__icon viewer-subtitle-empty__icon--neutral" aria-hidden="true"><Radio size={22} /></span>
                    <p className="text-base font-semibold text-slate-200">Choose a transcript source</p>
                    <p className="mt-1 text-sm text-slate-500">Select a provider from the Transcript view.</p>
                </div>
            ) : !hasTranscript ? null : (
                <div
                    className={`viewer-subtitle-stage ${subtitleVisible ? '' : 'viewer-subtitle-stage--expired'}`}
                    aria-hidden={!subtitleVisible}
                >
                    {isCaptionDeskSource ? (
                        <CaptionDeskSubtitleRows
                            playback={captionDeskPlayback}
                            timestamp={latestPublicCaption?.timestamp ?? 0}
                            paused={subtitlePaused}
                            layoutKey={`${displaySettings.textSize}:${displaySettings.background}`}
                            onPageAdvance={handleSubtitlePageAdvance}
                            onPageDuration={setSubtitlePageDurationMs}
                        />
                    ) : (
                        <TranscriptRows
                            transcripts={subtitleTranscripts}
                            interims={subtitleInterims}
                            variant="subtitle"
                            onSubtitlePageAdvance={handleSubtitlePageAdvance}
                            onSubtitlePageDuration={setSubtitlePageDurationMs}
                            subtitlePaused={subtitlePaused}
                            subtitlePlaybackRate={subtitlePlaybackRate}
                            subtitleShowTranslation={displaySettings.showTranslation}
                            subtitleLayoutKey={`${displaySettings.textSize}:${displaySettings.background}`}
                        />
                    )}
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
                                className={`control-button control-button--inline !min-h-11 !min-w-11 !px-2.5 ${viewer.isAudioMuted
                                    ? 'control-button--inline-danger'
                                    : 'control-button--inline-accent'
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
                                    onClick={handleDisconnect}
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
                                    Choose approved captions or a live provider.
                                </p>
                            </div>

                            <div className="space-y-2" role="group" aria-label="Transcript source">
                                <p className="viewer-source-group-label">Approved output</p>
                                <button
                                    type="button"
                                    aria-pressed={isCaptionDeskSource}
                                    onClick={() => handleSelectSource(CAPTION_DESK_SOURCE)}
                                    className={`viewer-provider-option ${isCaptionDeskSource ? 'viewer-provider-option--selected' : ''}`}
                                >
                                    <span className="flex min-w-0 items-center gap-2.5">
                                        <BadgeCheck size={16} className="shrink-0 text-teal-300" aria-hidden="true" />
                                        <span className="min-w-0 truncate">Caption Desk</span>
                                    </span>
                                    <span className="flex shrink-0 items-center gap-2">
                                        <span className="viewer-source-public-label">Public</span>
                                        <span className="viewer-provider-option__count" aria-label={`${viewer.publicCaptions.length} published captions`}>
                                            {viewer.publicCaptions.length}
                                        </span>
                                    </span>
                                </button>

                                <p className="viewer-source-group-label viewer-source-group-label--providers">Live providers</p>
                                {availableProviders.map(provider => {
                                    const isActive = activeProviders.has(provider);
                                    const providerCount = providerCounts.get(provider) ?? 0;
                                    const presentation = getProviderPresentation(provider);
                                    return (
                                        <button
                                            key={provider}
                                            type="button"
                                            aria-pressed={filterProvider === provider}
                                            onClick={() => handleSelectSource(provider)}
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

                        <section className="app-panel viewer-settings-panel" aria-labelledby="viewer-settings-heading">
                            <h2 id="viewer-settings-heading" className="viewer-settings-heading">Subtitle settings</h2>

                            <fieldset className="viewer-settings-speed">
                                <legend className="sr-only">Caption speed</legend>
                                <div className="viewer-setting-label-row">
                                    <span>Speed</span>
                                    <output className="viewer-setting-value" htmlFor="viewer-caption-speed">
                                        {subtitleSpeedCps} cps <span aria-hidden="true">·</span> {subtitleSpeedProfile}
                                    </output>
                                </div>
                                <input
                                    id="viewer-caption-speed"
                                    className="viewer-speed-range"
                                    type="range"
                                    min={SUBTITLE_PLAYBACK_RATE_MIN}
                                    max={SUBTITLE_PLAYBACK_RATE_MAX}
                                    step="0.01"
                                    value={subtitlePlaybackRate}
                                    onChange={event => setSubtitlePlaybackRate(Number(event.currentTarget.value))}
                                    aria-describedby="viewer-speed-detail"
                                    aria-valuetext={`${subtitleSpeedCps} characters per second, ${subtitleSpeedProfile}`}
                                    style={{ '--viewer-speed-progress': `${subtitleSpeedProgress}%` } as CSSProperties}
                                />
                                <div id="viewer-speed-detail" className="viewer-speed-scale">
                                    <span style={{ left: '0%' }}>10</span>
                                    <span style={{ left: '30%' }}>13</span>
                                    <span style={{ left: '70%' }}>17</span>
                                    <span style={{ left: '100%' }}>20 cps</span>
                                </div>
                            </fieldset>

                            <div className="viewer-setting-row" role="group" aria-label="Subtitle text size">
                                <span className="viewer-setting-row__label">Size</span>
                                <div className="viewer-segmented-control">
                                    {([['small', 'S'], ['standard', 'M'], ['large', 'L']] as const).map(([size, label]) => (
                                        <button
                                            key={size}
                                            type="button"
                                            aria-pressed={displaySettings.textSize === size}
                                            aria-label={`${size === 'standard' ? 'Standard' : size[0].toUpperCase() + size.slice(1)} subtitle text`}
                                            title={`${size === 'standard' ? 'Standard' : size[0].toUpperCase() + size.slice(1)} text`}
                                            onClick={() => setDisplaySettings(settings => ({ ...settings, textSize: size }))}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="viewer-setting-row" role="group" aria-label="Translation visibility">
                                <span className="viewer-setting-row__label">Translation</span>
                                <div className="viewer-segmented-control viewer-segmented-control--two">
                                    <button
                                        type="button"
                                        aria-pressed={displaySettings.showTranslation}
                                        onClick={() => setDisplaySettings(settings => ({ ...settings, showTranslation: true }))}
                                    >
                                        Show
                                    </button>
                                    <button
                                        type="button"
                                        aria-pressed={!displaySettings.showTranslation}
                                        onClick={() => setDisplaySettings(settings => ({ ...settings, showTranslation: false }))}
                                    >
                                        Hide
                                    </button>
                                </div>
                            </div>

                            <div className="viewer-setting-row" role="group" aria-label="Subtitle background">
                                <span className="viewer-setting-row__label">Background</span>
                                <div className="viewer-segmented-control">
                                    {([
                                        ['canvas', 'Black'],
                                        ['lines', 'Bands'],
                                        ['transparent', 'None'],
                                    ] as const).map(([background, label]) => (
                                        <button
                                            key={background}
                                            type="button"
                                            aria-pressed={displaySettings.background === background}
                                            aria-label={`${label} subtitle background`}
                                            onClick={() => setDisplaySettings(settings => ({ ...settings, background }))}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </section>

                    </aside>

                    <section className="app-panel viewer-subtitle-panel flex flex-col" aria-labelledby="viewer-subtitle-heading">
                        <div className="panel-header viewer-subtitle-toolbar flex flex-wrap items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2.5">
                                <h2 id="viewer-subtitle-heading" className="text-sm font-semibold text-slate-100">Subtitle</h2>
                                <span className="text-xs text-slate-400">
                                    {isCaptionDeskSource ? viewer.publicCaptions.length : filteredTranscripts.length} {isCaptionDeskSource ? 'published' : 'final'}
                                </span>
                                {isCaptionDeskSource && <CaptionDeskQueueStatus playback={captionDeskPlayback} />}
                            </div>
                            <div className="viewer-subtitle-actions">
                                <button
                                    type="button"
                                    onClick={handleToggleSubtitlePause}
                                    disabled={!hasTranscript}
                                    className="control-button viewer-subtitle-action disabled:opacity-40"
                                    aria-pressed={subtitlePaused}
                                    aria-label={subtitlePaused ? 'Resume subtitles' : 'Pause subtitles'}
                                >
                                    {subtitlePaused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
                                    <span className="viewer-subtitle-action__label">{subtitlePaused ? 'Resume' : 'Pause'}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleClearTranscripts}
                                    disabled={!hasAnyTranscript}
                                    className="control-button viewer-subtitle-action viewer-subtitle-action--clear disabled:opacity-40"
                                    aria-label="Clear transcript"
                                    title="Clear transcript"
                                >
                                    <Trash2 size={14} aria-hidden="true" />
                                    <span className="viewer-subtitle-action__label">Clear</span>
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
