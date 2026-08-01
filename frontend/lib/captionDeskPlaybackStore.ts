import {
    completeVisibleCaption,
    createCaptionPlaybackState,
    enqueueCaptionPublications,
    getVisibleCaptionText,
    progressiveRevealRate,
    revealCaptionGraphemes,
    SUBTITLE_PLAYBACK_RATE_MAX,
    SUBTITLE_PLAYBACK_RATE_MIN,
    type CaptionPlaybackPublication,
    type CaptionPlaybackState,
} from './progressiveText.ts';

type PlaybackListener = () => void;
const PLAYBACK_RENDER_INTERVAL_MS = 40;
// Keep DOM measurement bounded to four two-line caption windows. Overflow
// remains in the FIFO queue and advances only after the active cue is read.
const MAX_ACTIVE_CUE_GRAPHEMES = 35 * 2 * 4;

export interface CaptionDeskPlaybackClock {
    requestFrame: (callback: (now: number) => void) => number;
    cancelFrame: (frameId: number) => void;
    now: () => number;
    prefersReducedMotion: () => boolean;
}

export interface CaptionDeskPlaybackStore {
    enqueue: (publication: CaptionPlaybackPublication) => void;
    clear: () => void;
    completeCue: () => boolean;
    subscribe: (listener: PlaybackListener) => () => void;
    getSnapshot: () => string;
    hasPendingText: () => boolean;
    hasContent: () => boolean;
    getPendingGraphemeCount: () => number;
    getPendingCueCount: () => number;
    getPendingPreview: (maximumGraphemes?: number) => string;
    setActive: (active: boolean) => void;
    setPaused: (paused: boolean) => void;
    setPlaybackRate: (playbackRate: number) => void;
}

function browserPlaybackClock(): CaptionDeskPlaybackClock {
    return {
        requestFrame: callback => window.requestAnimationFrame(callback),
        cancelFrame: frameId => window.cancelAnimationFrame(frameId),
        now: () => performance.now(),
        prefersReducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
}

export function createCaptionDeskPlaybackStore(
    clock: CaptionDeskPlaybackClock = browserPlaybackClock(),
): CaptionDeskPlaybackStore {
    let playback: CaptionPlaybackState = createCaptionPlaybackState();
    let visibleText = '';
    let active = false;
    let paused = false;
    let playbackRate = 1;
    let frameId: number | null = null;
    let carry = 0;
    let previousTime = 0;
    let previousPublishTime = 0;
    let cueComplete = false;
    const listeners = new Set<PlaybackListener>();

    const notify = () => listeners.forEach(listener => listener());

    const stopAnimation = () => {
        if (frameId !== null) clock.cancelFrame(frameId);
        frameId = null;
        carry = 0;
    };

    const publishVisibleText = () => {
        const nextText = getVisibleCaptionText(playback);
        if (nextText === visibleText) return;
        visibleText = nextText;
        notify();
    };

    const animate = (now: number) => {
        frameId = null;
        if (!active || paused) return;

        const remaining = playback.pendingGraphemeCount;
        if (remaining <= 0) return;

        carry += ((now - previousTime) / 1_000) * progressiveRevealRate(remaining, playbackRate);
        previousTime = now;
        const revealCount = Math.floor(carry);
        if (revealCount > 0 && now - previousPublishTime >= PLAYBACK_RENDER_INTERVAL_MS) {
            carry -= revealCount;
            playback = revealCaptionGraphemes(
                playback,
                revealCount,
                MAX_ACTIVE_CUE_GRAPHEMES,
            );
            previousPublishTime = now;
            publishVisibleText();
        }
        if (
            playback.pendingGraphemeCount > 0
            && playback.visibleGraphemeCount < MAX_ACTIVE_CUE_GRAPHEMES
        ) {
            frameId = clock.requestFrame(animate);
        }
    };

    const startAnimation = () => {
        if (!active || paused || frameId !== null) return;
        const remaining = playback.pendingGraphemeCount;
        if (remaining <= 0 || playback.visibleGraphemeCount >= MAX_ACTIVE_CUE_GRAPHEMES) return;

        if (clock.prefersReducedMotion()) {
            playback = revealCaptionGraphemes(
                playback,
                remaining,
                MAX_ACTIVE_CUE_GRAPHEMES,
            );
            publishVisibleText();
            return;
        }

        previousTime = clock.now();
        previousPublishTime = previousTime - PLAYBACK_RENDER_INTERVAL_MS;
        frameId = clock.requestFrame(animate);
    };

    const advanceCompletedCue = () => {
        if (!cueComplete || playback.pendingGraphemeCount === 0) return false;
        playback = completeVisibleCaption(playback);
        cueComplete = false;
        const initialRevealCount = clock.prefersReducedMotion()
            ? playback.pendingGraphemeCount
            : 1;
        playback = revealCaptionGraphemes(
            playback,
            initialRevealCount,
            MAX_ACTIVE_CUE_GRAPHEMES,
        );
        publishVisibleText();
        startAnimation();
        return true;
    };

    return {
        enqueue(publication) {
            const next = enqueueCaptionPublications(playback, [publication]);
            if (next === playback) return;
            playback = next;
            if (cueComplete && playback.visibleGraphemeCount < MAX_ACTIVE_CUE_GRAPHEMES) {
                cueComplete = false;
                startAnimation();
                return;
            }
            if (!advanceCompletedCue()) startAnimation();
        },
        clear() {
            stopAnimation();
            playback = createCaptionPlaybackState();
            cueComplete = false;
            if (!visibleText) return;
            visibleText = '';
            notify();
        },
        completeCue() {
            cueComplete = true;
            return advanceCompletedCue();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        getSnapshot: () => visibleText,
        hasPendingText: () => playback.pendingGraphemeCount > 0,
        hasContent: () => Boolean(playback.visibleText) || playback.pendingGraphemeCount > 0,
        getPendingGraphemeCount: () => playback.pendingGraphemeCount,
        getPendingCueCount: () => Math.ceil(playback.pendingGraphemeCount / MAX_ACTIVE_CUE_GRAPHEMES),
        getPendingPreview(maximumGraphemes = 48) {
            const preview: string[] = [];
            let remaining = Math.max(0, maximumGraphemes);
            for (let index = 0; index < playback.pendingChunks.length && remaining > 0; index += 1) {
                const chunk = playback.pendingChunks[index];
                const offset = index === 0 ? playback.pendingChunkOffset : 0;
                const part = chunk.slice(offset, offset + remaining);
                preview.push(...part);
                remaining -= part.length;
            }
            return preview.join('');
        },
        setActive(nextActive) {
            active = nextActive;
            if (!active) stopAnimation();
            else startAnimation();
        },
        setPaused(nextPaused) {
            paused = nextPaused;
            if (paused) stopAnimation();
            else startAnimation();
        },
        setPlaybackRate(nextPlaybackRate) {
            playbackRate = Math.max(SUBTITLE_PLAYBACK_RATE_MIN, Math.min(SUBTITLE_PLAYBACK_RATE_MAX, nextPlaybackRate));
        },
    };
}
