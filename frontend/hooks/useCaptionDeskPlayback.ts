import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
    createCaptionDeskPlaybackStore,
    type CaptionDeskPlaybackStore,
} from '../lib/captionDeskPlaybackStore';

export type { CaptionDeskPlaybackStore } from '../lib/captionDeskPlaybackStore';

export function useCaptionDeskPlayback(
    active: boolean,
    paused: boolean,
    playbackRate = 1,
): CaptionDeskPlaybackStore {
    const storeRef = useRef<CaptionDeskPlaybackStore | null>(null);
    if (storeRef.current === null) storeRef.current = createCaptionDeskPlaybackStore();
    const store = storeRef.current;

    useEffect(() => {
        store.setActive(active);
        return () => store.setActive(false);
    }, [active, store]);

    useEffect(() => store.setPaused(paused), [paused, store]);
    useEffect(() => store.setPlaybackRate(playbackRate), [playbackRate, store]);

    return store;
}

export function useCaptionDeskPlaybackText(store: CaptionDeskPlaybackStore): string {
    return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
