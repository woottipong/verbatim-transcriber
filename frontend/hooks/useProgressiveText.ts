import { useEffect, useRef, useState } from 'react';
import {
    progressiveRevealRate,
    reconcileProgressiveTarget,
    splitTextGraphemes,
} from '../lib/progressiveText';

const RENDER_INTERVAL_MS = 40;

export function useProgressiveText(
    targetText: string,
    identity: string,
    paused: boolean,
    enabled = true,
    playbackRate = 1,
): string {
    const [visibleText, setVisibleText] = useState(enabled ? '' : targetText);
    const visibleRef = useRef(visibleText);
    const targetRef = useRef(targetText);
    const identityRef = useRef(identity);
    const frameRef = useRef<number | null>(null);
    const previousTimeRef = useRef(0);
    const previousRenderTimeRef = useRef(0);
    const carryRef = useRef(0);
    const pausedRef = useRef(paused);
    pausedRef.current = paused;

    const publish = (text: string) => {
        if (text === visibleRef.current) return;
        visibleRef.current = text;
        setVisibleText(text);
    };

    useEffect(() => {
        const previousTargetText = targetRef.current;
        targetRef.current = targetText;
        if (!enabled) {
            publish(targetText);
            return;
        }

        const identityChanged = identityRef.current !== identity;
        identityRef.current = identity;
        const targetContinuesVisible = targetText.startsWith(visibleRef.current);

        if (identityChanged) {
            carryRef.current = 0;
        }
        if (!targetContinuesVisible) {
            // Interim corrections replace the already-visible span at the same
            // length. A new cue starts at its first grapheme rather than
            // publishing an empty frame between interim and final states.
            publish(reconcileProgressiveTarget(
                visibleRef.current,
                targetText,
                identityChanged,
                previousTargetText,
            ));
        }

        if (pausedRef.current || frameRef.current !== null || visibleRef.current === targetText) return;
        previousTimeRef.current = performance.now();
        previousRenderTimeRef.current = previousTimeRef.current - RENDER_INTERVAL_MS;

        const animate = (now: number) => {
            frameRef.current = null;
            if (pausedRef.current) return;
            const target = targetRef.current;
            const shown = visibleRef.current;
            if (shown === target) return;

            const shownGraphemes = splitTextGraphemes(shown);
            const targetParts = splitTextGraphemes(target);
            if (!target.startsWith(shown)) {
                publish(targetParts.slice(0, Math.min(shownGraphemes.length, targetParts.length)).join(''));
            }
            const currentCount = splitTextGraphemes(visibleRef.current).length;
            const remaining = Math.max(0, targetParts.length - currentCount);
            carryRef.current += ((now - previousTimeRef.current) / 1_000) * progressiveRevealRate(remaining, playbackRate);
            previousTimeRef.current = now;
            const revealCount = Math.floor(carryRef.current);
            if (revealCount > 0 && now - previousRenderTimeRef.current >= RENDER_INTERVAL_MS) {
                carryRef.current -= revealCount;
                publish(targetParts.slice(0, Math.min(targetParts.length, currentCount + revealCount)).join(''));
                previousRenderTimeRef.current = now;
            }
            if (visibleRef.current !== targetRef.current) frameRef.current = requestAnimationFrame(animate);
        };

        frameRef.current = requestAnimationFrame(animate);
        return () => {
            if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
        };
    }, [enabled, identity, paused, playbackRate, targetText]);

    useEffect(() => () => {
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    }, []);

    return visibleText;
}
