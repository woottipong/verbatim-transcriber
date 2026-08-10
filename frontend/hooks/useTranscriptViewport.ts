import { useCallback, useEffect, useRef, useState } from 'react';
import { shouldStickToLatest } from '../lib/transcriptViewport';

interface UseTranscriptViewportOptions {
    committed: unknown;
    interim: unknown;
    descendantScrollers?: boolean;
}

export function useTranscriptViewport({
    committed,
    interim,
    descendantScrollers = false,
}: UseTranscriptViewportOptions) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isFollowingLatest, setIsFollowingLatest] = useState(true);

    const scrollToLatest = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;
        if (!descendantScrollers) {
            container.scrollTop = container.scrollHeight;
            return;
        }
        container.querySelectorAll<HTMLElement>('[data-transcript-scroller]').forEach(scroller => {
            scroller.scrollTop = scroller.scrollHeight;
        });
    }, [descendantScrollers]);

    useEffect(() => {
        if (!isFollowingLatest || hasActiveTextSelection()) return;
        const frame = window.requestAnimationFrame(scrollToLatest);
        return () => window.cancelAnimationFrame(frame);
    }, [committed, interim, isFollowingLatest, scrollToLatest]);

    const handleScroll = useCallback((metrics: HTMLDivElement) => {
        setIsFollowingLatest(shouldStickToLatest(metrics));
    }, []);

    const jumpToLatest = useCallback(() => {
        scrollToLatest();
        setIsFollowingLatest(true);
    }, [scrollToLatest]);

    return {
        containerRef,
        isFollowingLatest,
        handleScroll,
        jumpToLatest,
    };
}

function hasActiveTextSelection(): boolean {
    const selection = window.getSelection();
    return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}
