const SUBTITLE_READING_SPEED_CPS = 17;
const SUBTITLE_MIN_PAGE_MS = 2_000;
const SUBTITLE_MAX_PAGE_MS = 6_800;
const SUBTITLE_IDLE_CLEAR_MS = 5_000;
const SUBTITLE_PAGE_TRANSITION_GRACE_MS = 200;
const SUBTITLE_BACKLOG_READING_SPEED_CPS = 34;
const SUBTITLE_BACKLOG_MIN_PAGE_MS = 900;
const SUBTITLE_BACKLOG_MAX_PAGE_MS = 1_800;
export const NBTC_MAX_CAPTION_LINE_CHARACTERS = 35;

type SegmenterConstructor = new (
    locales?: string | string[],
    options?: { granularity: 'grapheme' | 'word' },
) => {
    segment(input: string): Iterable<{ segment: string; index: number; isWordLike?: boolean }>;
};

const segmenters = new Map<string, InstanceType<SegmenterConstructor>>();

function getSegmenter(granularity: 'grapheme' | 'word', locale?: string) {
    const Segmenter = (Intl as typeof Intl & { Segmenter?: SegmenterConstructor }).Segmenter;
    if (!Segmenter) return null;
    const key = `${granularity}:${locale ?? ''}`;
    const cached = segmenters.get(key);
    if (cached) return cached;
    const segmenter = new Segmenter(locale || undefined, { granularity });
    segmenters.set(key, segmenter);
    return segmenter;
}

export function countSubtitleCharacters(text: string): number {
    const normalized = text.trim();
    if (!normalized) return 0;

    const segmenter = getSegmenter('grapheme');
    const graphemes = segmenter
        ? Array.from(segmenter.segment(normalized), part => part.segment)
        : Array.from(normalized);
    return graphemes.filter(grapheme => !/^\s+$/u.test(grapheme)).length;
}

export function countSubtitleLineCharacters(text: string): number {
    if (!text) return 0;
    const segmenter = getSegmenter('grapheme');
    return segmenter
        ? Array.from(segmenter.segment(text)).length
        : Array.from(text).length;
}

export function fitsNbtcCaptionLine(text: string): boolean {
    return countSubtitleLineCharacters(text) <= NBTC_MAX_CAPTION_LINE_CHARACTERS;
}

export function calculateSubtitlePageDurationMs(sourceText: string, translationText = ''): number {
    const readableCharacters = Math.max(
        countSubtitleCharacters(sourceText),
        countSubtitleCharacters(translationText),
    );
    const readingTimeMs = Math.ceil((readableCharacters / SUBTITLE_READING_SPEED_CPS) * 1_000);
    return Math.min(SUBTITLE_MAX_PAGE_MS, Math.max(SUBTITLE_MIN_PAGE_MS, readingTimeMs));
}

export function calculateQueuedSubtitlePageDurationMs(
    sourceText: string,
    translationText = '',
    hasBacklog = false,
): number {
    if (!hasBacklog) return calculateSubtitlePageDurationMs(sourceText, translationText);
    const readableCharacters = Math.max(
        countSubtitleCharacters(sourceText),
        countSubtitleCharacters(translationText),
    );
    const readingTimeMs = Math.ceil((readableCharacters / SUBTITLE_BACKLOG_READING_SPEED_CPS) * 1_000);
    return Math.min(
        SUBTITLE_BACKLOG_MAX_PAGE_MS,
        Math.max(SUBTITLE_BACKLOG_MIN_PAGE_MS, readingTimeMs),
    );
}

export function calculateSubtitleIdleTimeoutMs(pageDurationMs: number): number {
    return Math.max(SUBTITLE_IDLE_CLEAR_MS, pageDurationMs + SUBTITLE_PAGE_TRANSITION_GRACE_MS);
}

export function resolveSubtitlePageIndex({
    previousIndex,
    pageCount,
    isDraft,
    isSameCue,
    followLiveEdge = false,
}: {
    previousIndex: number;
    pageCount: number;
    isDraft: boolean;
    isSameCue: boolean;
    followLiveEdge?: boolean;
}): number {
    if (pageCount <= 0) return 0;
    if (followLiveEdge) return pageCount - 1;
    const firstTwoLines = Math.min(1, pageCount - 1);
    if (!isSameCue) return firstTwoLines;
    if (previousIndex === 0 && pageCount > 1) return 1;
    if (isSameCue) return Math.min(previousIndex, pageCount - 1);
    return firstTwoLines;
}

export function splitSubtitleTextByFit(
    text: string,
    fits: (candidate: string) => boolean,
    locale?: string,
): string[] {
    return splitSubtitleTextIntoLines(text, fits, locale).map(fragment => fragment.text);
}

export function splitSubtitleTextIntoRollingWindows(
    text: string,
    fitsOneLine: (candidate: string) => boolean,
    locale?: string,
    preserveWhitespace = false,
): string[] {
    const lines = splitSubtitleTextIntoLines(text, fitsOneLine, locale, preserveWhitespace);
    return lines.map((_, index) => joinSubtitleFragments(lines.slice(Math.max(0, index - 1), index + 1)));
}

export interface SubtitleLineFragment {
    text: string;
    separatorAfter: string;
}

export function splitSubtitleTextIntoLines(
    text: string,
    fits: (candidate: string) => boolean,
    locale?: string,
    preserveWhitespace = false,
): SubtitleLineFragment[] {
    if (preserveWhitespace) return splitVerbatimSubtitleTextIntoLines(text, fits, locale);
    let remaining = text.trim();
    if (!remaining) return [];

    const fragments: SubtitleLineFragment[] = [];
    while (remaining) {
        if (fits(remaining)) {
            fragments.push({ text: remaining, separatorAfter: '' });
            break;
        }

        const maxBoundary = findFittingBoundary(remaining, fits, locale);
        let fittingBoundary = maxBoundary;

        // Netflix / Broadcast Subtitle Balancing: When text breaks into 2 lines,
        // balance the length between Line 1 and Line 2 instead of greedily
        // packing Line 1 and leaving a short 2nd line.
        const idealMidpoint = Math.floor(remaining.length / 2);
        if (idealMidpoint > 0 && idealMidpoint < maxBoundary) {
            const balancedBreak = findNaturalBreak(remaining, idealMidpoint, locale);
            if (balancedBreak > 0 && balancedBreak < maxBoundary) {
                const testLine1 = remaining.slice(0, balancedBreak).trim();
                const testLine2 = remaining.slice(balancedBreak).trim();
                if (testLine1 && testLine2 && fits(testLine1) && fits(testLine2)) {
                    fittingBoundary = balancedBreak;
                }
            }
        }

        const breakAt = findNaturalBreak(remaining, fittingBoundary, locale);
        const rawPage = remaining.slice(0, breakAt);
        const page = rawPage.trim();
        if (!page) {
            fragments.push({ text: remaining, separatorAfter: '' });
            break;
        }
        const tail = remaining.slice(breakAt);
        fragments.push({
            text: page,
            separatorAfter: /\s$/u.test(rawPage) || /^\s/u.test(tail) ? ' ' : '',
        });
        remaining = tail.trim();
    }

    return coalesceSubtitleLineFragments(fragments, fits);
}

function coalesceSubtitleLineFragments(
    fragments: SubtitleLineFragment[],
    fits: (candidate: string) => boolean,
): SubtitleLineFragment[] {
    if (fragments.length <= 1) return fragments;
    const merged: SubtitleLineFragment[] = [];
    for (let index = 0; index < fragments.length; index += 1) {
        const current = fragments[index];
        const previous = merged[merged.length - 1];
        if (previous) {
            const candidate = previous.text + (previous.separatorAfter || '') + current.text;
            if (fits(candidate)) {
                merged[merged.length - 1] = {
                    text: candidate,
                    separatorAfter: current.separatorAfter,
                };
                continue;
            }
        }
        merged.push(current);
    }
    return merged;
}

function splitVerbatimSubtitleTextIntoLines(
    text: string,
    fits: (candidate: string) => boolean,
    locale?: string,
): SubtitleLineFragment[] {
    let remaining = text;
    const fragments: SubtitleLineFragment[] = [];
    while (remaining) {
        const newline = /\r\n|\r|\n/u.exec(remaining);
        const beforeNewline = newline ? remaining.slice(0, newline.index) : remaining;
        if (newline && fits(beforeNewline)) {
            fragments.push({ text: beforeNewline, separatorAfter: newline[0] });
            remaining = remaining.slice(newline.index + newline[0].length);
            continue;
        }
        if (!newline && fits(remaining)) {
            fragments.push({ text: remaining, separatorAfter: '' });
            break;
        }

        const candidate = newline ? beforeNewline : remaining;
        const fittingBoundary = findFittingBoundary(candidate, fits, locale);
        const breakAt = findNaturalBreak(candidate, fittingBoundary, locale);
        const page = remaining.slice(0, Math.max(1, breakAt));
        fragments.push({ text: page, separatorAfter: '' });
        remaining = remaining.slice(page.length);
    }
    return fragments;
}

function findFittingBoundary(
    text: string,
    fits: (candidate: string) => boolean,
    locale?: string,
): number {
    const graphemeBoundaries = getGraphemeBoundaries(text, locale);
    let low = 1;
    let high = graphemeBoundaries.length;
    let fittingBoundary = graphemeBoundaries[0] ?? 1;

    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const boundary = graphemeBoundaries[middle - 1];
        if (fits(text.slice(0, boundary))) {
            fittingBoundary = boundary;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    return fittingBoundary;
}

function joinSubtitleFragments(fragments: SubtitleLineFragment[]): string {
    return fragments.map((fragment, index) => (
        index < fragments.length - 1 ? fragment.text + fragment.separatorAfter : fragment.text
    )).join('');
}

export function alignSubtitlePagePairs(sourcePages: string[], translationPages: string[]): Array<{
    sourceText: string;
    translationText: string;
}> {
    const pageCount = Math.max(1, sourcePages.length, translationPages.length);
    return Array.from({ length: pageCount }, (_, index) => ({
        sourceText: pageAtProgress(sourcePages, index, pageCount),
        translationText: pageAtProgress(translationPages, index, pageCount),
    }));
}

function pageAtProgress(pages: string[], index: number, pageCount: number): string {
    if (pages.length === 0) return '';
    const pageIndex = Math.min(
        pages.length - 1,
        Math.floor(((index + 0.5) * pages.length) / pageCount),
    );
    return pages[pageIndex];
}

function getGraphemeBoundaries(text: string, locale?: string): number[] {
    const segmenter = getSegmenter('grapheme', locale);
    if (!segmenter) {
        const boundaries: number[] = [];
        let offset = 0;
        Array.from(text).forEach(character => {
            offset += character.length;
            boundaries.push(offset);
        });
        return boundaries;
    }

    return Array.from(segmenter.segment(text), part => part.index + part.segment.length);
}

function findNaturalBreak(text: string, maximumBoundary: number, locale?: string): number {
    const candidates = new Set<number>();
    const wordSegmenter = getSegmenter('word', locale);

    if (wordSegmenter) {
        for (const part of wordSegmenter.segment(text)) {
            const boundary = part.index + part.segment.length;
            if (boundary <= maximumBoundary) candidates.add(boundary);
        }
    }

    for (let index = 0; index < Math.min(maximumBoundary, text.length); index += 1) {
        if (/\s|[,.!?;:…。！？、]/u.test(text[index])) candidates.add(index + 1);
    }

    const preferredCandidates = Array.from(candidates)
        .filter(boundary => boundary > 0 && boundary <= maximumBoundary)
        .sort((left, right) => right - left);
    const preferred = preferredCandidates[0];
    if (
        preferred
        && text.length - preferred < maximumBoundary * 0.25
        && preferredCandidates[1]
        && preferredCandidates[1] >= maximumBoundary * 0.55
    ) {
        return preferredCandidates[1];
    }
    return preferred ?? maximumBoundary;
}
