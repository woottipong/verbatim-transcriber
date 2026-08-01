export function splitTextGraphemes(text: string): string[] {
    if (typeof Intl.Segmenter !== 'function') return splitTextGraphemesFallback(text);
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), part => part.segment);
}

export function splitTextGraphemesFallback(text: string): string[] {
    const graphemes: string[] = [];
    for (const character of Array.from(text)) {
        if ((/^\p{Mark}$/u.test(character) || character === 'ำ') && graphemes.length > 0) {
            graphemes[graphemes.length - 1] += character;
        } else {
            graphemes.push(character);
        }
    }
    return graphemes;
}

export function reconcileProgressiveTarget(
    visibleText: string,
    targetText: string,
    identityChanged: boolean,
    previousTargetText = '',
): string {
    if (targetText.startsWith(visibleText)) return visibleText;
    const visibleGraphemes = splitTextGraphemes(visibleText);
    const targetGraphemes = splitTextGraphemes(targetText);
    const retainedPrefixLength = findRetainedPrefixLength(visibleGraphemes, targetGraphemes);
    if (retainedPrefixLength > 0) {
        return targetGraphemes.slice(0, retainedPrefixLength).join('');
    }
    if (identityChanged && !isLikelyTranscriptRevision(previousTargetText, targetText)) {
        return targetGraphemes[0] ?? '';
    }
    return targetGraphemes
        .slice(0, Math.min(visibleGraphemes.length, targetGraphemes.length))
        .join('');
}

export function shouldRollProgressiveTarget(previousText: string, nextText: string): boolean {
    if (!previousText || !nextText || nextText.startsWith(previousText)) return false;
    return findRetainedPrefixLength(
        splitTextGraphemes(previousText),
        splitTextGraphemes(nextText),
    ) > 0;
}

function findRetainedPrefixLength(visible: string[], target: string[]): number {
    const maximumLength = Math.min(visible.length, target.length);
    for (let length = maximumLength; length >= 4; length -= 1) {
        const visibleStart = visible.length - length;
        let matches = true;
        for (let index = 0; index < length; index += 1) {
            if (visible[visibleStart + index] !== target[index]) {
                matches = false;
                break;
            }
        }
        if (matches) return length;
    }
    return 0;
}

function isLikelyTranscriptRevision(previousText: string, nextText: string): boolean {
    const previous = splitTextGraphemes(previousText);
    const next = splitTextGraphemes(nextText);
    const shorterLength = Math.min(previous.length, next.length);
    if (shorterLength < 3) return false;

    let sharedPrefixLength = 0;
    while (
        sharedPrefixLength < shorterLength
        && previous[sharedPrefixLength] === next[sharedPrefixLength]
    ) {
        sharedPrefixLength += 1;
    }
    const requiredPrefixLength = Math.min(6, Math.max(3, Math.ceil(shorterLength * 0.2)));
    return sharedPrefixLength >= requiredPrefixLength;
}

export function synchronizeTranslationTarget(
    visibleSource: string,
    sourceTarget: string,
    translationTarget: string,
): string {
    const sourceGraphemes = splitTextGraphemes(sourceTarget);
    if (sourceGraphemes.length === 0) return '';
    const visibleSourceCount = Math.min(
        splitTextGraphemes(visibleSource).length,
        sourceGraphemes.length,
    );
    const translationGraphemes = splitTextGraphemes(translationTarget);
    const visibleTranslationCount = Math.floor(
        (visibleSourceCount / sourceGraphemes.length) * translationGraphemes.length,
    );
    return translationGraphemes.slice(0, visibleTranslationCount).join('');
}

export function progressiveRevealRate(_remainingGraphemes: number, playbackRate = 1): number {
    // Thai timed-text guidance uses 17 visible characters/second for adults
    // and 20 for SDH. Keep the operator-selected rate deterministic and cap
    // it at the SDH ceiling; a backlog adds latency instead of unreadable speed.
    return Math.max(10, Math.min(20, 17 * playbackRate));
}

export interface CaptionPlaybackPublication {
    id: string;
    text: string;
}

export interface CaptionPlaybackState {
    pendingChunks: readonly (readonly string[])[];
    pendingChunkOffset: number;
    pendingGraphemeCount: number;
    visibleText: string;
    visibleGraphemeCount: number;
    seenIds: ReadonlySet<string>;
}

const MAX_SEEN_PUBLICATION_IDS = 500;

export function createCaptionPlaybackState(): CaptionPlaybackState {
    return {
        pendingChunks: [],
        pendingChunkOffset: 0,
        pendingGraphemeCount: 0,
        visibleText: '',
        visibleGraphemeCount: 0,
        seenIds: new Set(),
    };
}

export function enqueueCaptionPublications(
    state: CaptionPlaybackState,
    publications: readonly CaptionPlaybackPublication[],
): CaptionPlaybackState {
    const seenIds = new Set(state.seenIds);
    const pendingChunks = [...state.pendingChunks];
    let pendingGraphemeCount = state.pendingGraphemeCount;
    let changed = false;
    publications.forEach(publication => {
        if (seenIds.has(publication.id)) return;
        seenIds.add(publication.id);
        while (seenIds.size > MAX_SEEN_PUBLICATION_IDS) {
            const oldestId = seenIds.values().next().value;
            if (oldestId === undefined) break;
            seenIds.delete(oldestId);
        }
        const graphemes = splitTextGraphemes(publication.text);
        if (graphemes.length > 0) {
            pendingChunks.push(graphemes);
            pendingGraphemeCount += graphemes.length;
        }
        changed = true;
    });
    if (!changed) return state;
    return { ...state, pendingChunks, pendingGraphemeCount, seenIds };
}

export function revealCaptionGraphemes(
    state: CaptionPlaybackState,
    count: number,
    maximumVisibleGraphemes = Number.POSITIVE_INFINITY,
): CaptionPlaybackState {
    const availableCapacity = maximumVisibleGraphemes - state.visibleGraphemeCount;
    const revealCount = Math.min(count, state.pendingGraphemeCount, availableCapacity);
    if (revealCount <= 0) return state;

    const revealed: string[] = [];
    let remaining = revealCount;
    let chunkIndex = 0;
    let chunkOffset = state.pendingChunkOffset;
    while (remaining > 0 && chunkIndex < state.pendingChunks.length) {
        const chunk = state.pendingChunks[chunkIndex];
        const take = Math.min(remaining, chunk.length - chunkOffset);
        revealed.push(...chunk.slice(chunkOffset, chunkOffset + take));
        remaining -= take;
        chunkOffset += take;
        if (chunkOffset >= chunk.length) {
            chunkIndex += 1;
            chunkOffset = 0;
        }
    }

    return {
        ...state,
        pendingChunks: state.pendingChunks.slice(chunkIndex),
        pendingChunkOffset: chunkOffset,
        pendingGraphemeCount: state.pendingGraphemeCount - revealCount,
        visibleText: state.visibleText + revealed.join(''),
        visibleGraphemeCount: state.visibleGraphemeCount + revealCount,
    };
}

export function completeVisibleCaption(state: CaptionPlaybackState): CaptionPlaybackState {
    if (!state.visibleText) return state;
    return { ...state, visibleText: '', visibleGraphemeCount: 0 };
}

export function retainVisibleCaptionTail(
    state: CaptionPlaybackState,
    retainedGraphemeCount: number,
): CaptionPlaybackState {
    const visible = splitTextGraphemes(state.visibleText);
    const retainedCount = Math.max(0, Math.min(visible.length, retainedGraphemeCount));
    if (retainedCount === visible.length) return state;
    return {
        ...state,
        visibleText: visible.slice(visible.length - retainedCount).join(''),
        visibleGraphemeCount: retainedCount,
    };
}

export function getVisibleCaptionText(state: CaptionPlaybackState): string {
    return state.visibleText;
}
export const SUBTITLE_PLAYBACK_RATE_MIN = 10 / 17;
export const SUBTITLE_PLAYBACK_RATE_MAX = 20 / 17;
