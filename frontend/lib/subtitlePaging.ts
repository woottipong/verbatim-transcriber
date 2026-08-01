const SUBTITLE_READING_SPEED_CPS = 17;
const SUBTITLE_MIN_PAGE_MS = 2_000;
const SUBTITLE_MAX_PAGE_MS = 6_800;
const SUBTITLE_IDLE_CLEAR_MS = 5_000;
const SUBTITLE_PAGE_TRANSITION_GRACE_MS = 200;

type SegmenterConstructor = new (
    locales?: string | string[],
    options?: { granularity: 'grapheme' | 'word' },
) => {
    segment(input: string): Iterable<{ segment: string; index: number; isWordLike?: boolean }>;
};

function getSegmenter(granularity: 'grapheme' | 'word', locale?: string) {
    const Segmenter = (Intl as typeof Intl & { Segmenter?: SegmenterConstructor }).Segmenter;
    return Segmenter ? new Segmenter(locale || undefined, { granularity }) : null;
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

export function calculateSubtitlePageDurationMs(sourceText: string, translationText = ''): number {
    const readableCharacters = Math.max(
        countSubtitleCharacters(sourceText),
        countSubtitleCharacters(translationText),
    );
    const readingTimeMs = Math.ceil((readableCharacters / SUBTITLE_READING_SPEED_CPS) * 1_000);
    return Math.min(SUBTITLE_MAX_PAGE_MS, Math.max(SUBTITLE_MIN_PAGE_MS, readingTimeMs));
}

export function calculateSubtitleIdleTimeoutMs(pageDurationMs: number): number {
    return Math.max(SUBTITLE_IDLE_CLEAR_MS, pageDurationMs + SUBTITLE_PAGE_TRANSITION_GRACE_MS);
}

export function resolveSubtitlePageIndex({
    previousIndex,
    pageCount,
    isDraft,
    isSameCue,
}: {
    previousIndex: number;
    pageCount: number;
    isDraft: boolean;
    isSameCue: boolean;
}): number {
    if (pageCount <= 0) return 0;
    if (isDraft) return pageCount - 1;
    if (isSameCue) return Math.min(previousIndex, pageCount - 1);
    return 0;
}

export function splitSubtitleTextByFit(
    text: string,
    fits: (candidate: string) => boolean,
    locale?: string,
): string[] {
    let remaining = text.trim();
    if (!remaining) return [];

    const pages: string[] = [];
    while (remaining) {
        if (fits(remaining)) {
            pages.push(remaining);
            break;
        }

        const graphemeBoundaries = getGraphemeBoundaries(remaining, locale);
        let low = 1;
        let high = graphemeBoundaries.length;
        let fittingBoundary = graphemeBoundaries[0] ?? 1;

        while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            const boundary = graphemeBoundaries[middle - 1];
            if (fits(remaining.slice(0, boundary))) {
                fittingBoundary = boundary;
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }

        const breakAt = findNaturalBreak(remaining, fittingBoundary, locale);
        const page = remaining.slice(0, breakAt).trim();
        if (!page) {
            pages.push(remaining);
            break;
        }
        pages.push(page);
        remaining = remaining.slice(breakAt).trim();
    }

    return pages;
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
