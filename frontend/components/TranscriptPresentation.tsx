import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TranscriptSegment } from '../types';
import type { InterimTranscript } from '../lib/transcriptMessages';
import {
    formatLanguageLabel,
    isTranscriptTurnLive,
    normalizeLanguageTag,
} from '../lib/transcriptMessages';
import {
    formatProviderName,
    getProviderPresentation,
    hasSourceLanguageLabel,
} from '../lib/providers';
import TranslationBlock from './TranslationBlock';
import { useProgressiveText } from '../hooks/useProgressiveText';
import { shouldRollProgressiveTarget, synchronizeTranslationTarget } from '../lib/progressiveText';
import {
    alignSubtitlePagePairs,
    calculateQueuedSubtitlePageDurationMs,
    fitsNbtcCaptionLine,
    resolveSubtitlePageIndex,
    splitSubtitleTextIntoLines,
    splitSubtitleTextIntoRollingWindows,
} from '../lib/subtitlePaging';

interface TranscriptRowsProps {
    transcripts: readonly TranscriptSegment[];
    interims: readonly InterimTranscript[];
    variant: 'numbered' | 'detailed' | 'subtitle';
    onSubtitlePageAdvance?: () => void;
    onSubtitlePageDuration?: (durationMs: number) => void;
    onSubtitleCueComplete?: () => void;
    subtitleHasBacklog?: boolean;
    subtitlePaused?: boolean;
    subtitleFollowLiveEdge?: boolean;
    subtitlePlaybackRate?: number;
    subtitleShowTranslation?: boolean;
    subtitleLayoutKey?: string;
}

export const TranscriptRows = memo(function TranscriptRows({
    transcripts,
    interims,
    variant,
    onSubtitlePageAdvance,
    onSubtitlePageDuration,
    onSubtitleCueComplete,
    subtitleHasBacklog = false,
    subtitlePaused = false,
    subtitleFollowLiveEdge = false,
    subtitlePlaybackRate = 1,
    subtitleShowTranslation = true,
    subtitleLayoutKey = '',
}: TranscriptRowsProps) {
    if (variant === 'subtitle') {
        return (
            <SubtitleRows
                transcripts={transcripts}
                interims={interims}
                onPageAdvance={onSubtitlePageAdvance}
                onPageDuration={onSubtitlePageDuration}
                onCueComplete={onSubtitleCueComplete}
                hasBacklog={subtitleHasBacklog}
                paused={subtitlePaused}
                followLiveEdge={subtitleFollowLiveEdge}
                playbackRate={subtitlePlaybackRate}
                showTranslation={subtitleShowTranslation}
                layoutKey={subtitleLayoutKey}
            />
        );
    }

    return (
        <>
            {transcripts.map((segment, index) => (
                <FinalTranscriptRow
                    key={segment.id}
                    segment={segment}
                    index={index}
                    variant={variant}
                />
            ))}
            {interims.map((interim, index) => (
                <InterimTranscriptRow
                    key={interim.key}
                    interim={interim}
                    index={transcripts.length + index}
                    variant={variant}
                />
            ))}
        </>
    );
});

function SubtitleRows({
    transcripts,
    interims,
    onPageAdvance,
    onPageDuration,
    onCueComplete,
    hasBacklog,
    paused,
    followLiveEdge,
    playbackRate,
    showTranslation,
    layoutKey,
}: {
    transcripts: readonly TranscriptSegment[];
    interims: readonly InterimTranscript[];
    onPageAdvance?: () => void;
    onPageDuration?: (durationMs: number) => void;
    onCueComplete?: () => void;
    hasBacklog: boolean;
    paused: boolean;
    followLiveEdge: boolean;
    playbackRate: number;
    showTranslation: boolean;
    layoutKey: string;
}) {
    const rawCurrent = interims.at(-1) ?? transcripts.at(-1);
    const currentIdentity = getSubtitleCueIdentity(rawCurrent);
    const progressivelyRevealProvider = Boolean(rawCurrent && rawCurrent.provider !== 'caption-desk');
    const progressiveSourceText = useProgressiveText(
        rawCurrent?.text ?? '',
        `${currentIdentity}:source`,
        paused,
        progressivelyRevealProvider,
        playbackRate,
    );
    const translationTarget = showTranslation ? rawCurrent?.translation?.text ?? '' : '';
    const synchronizedTranslationTarget = synchronizeTranslationTarget(
        progressiveSourceText,
        rawCurrent?.text ?? '',
        translationTarget,
    );
    const progressiveTranslationText = useProgressiveText(
        synchronizedTranslationTarget,
        `${currentIdentity}:translation`,
        paused,
        progressivelyRevealProvider,
        playbackRate,
    );
    const visibleTranslation = showTranslation && rawCurrent?.translation
        ? {
            ...rawCurrent.translation,
            text: progressivelyRevealProvider
                ? progressiveTranslationText
                : rawCurrent.translation.text,
        }
        : undefined;
    const current = rawCurrent ? {
        ...rawCurrent,
        text: progressivelyRevealProvider ? progressiveSourceText : rawCurrent.text,
        ...(visibleTranslation ? {
            // Translation follows the source cue instead of running a second
            // character clock, so it remains live without moving source pages.
            translation: visibleTranslation,
        } : { translation: undefined }),
    } : undefined;
    const shouldFollowLiveEdge = followLiveEdge || progressivelyRevealProvider;
    const currentContent = current
        ? `${current.text}\u0000${current.translation?.text ?? ''}`
        : '';
    const preserveSourceWhitespace = current?.provider === 'caption-desk';
    const sourceLanguageCode = current?.languageCode ?? '';
    const translationLanguageCode = current?.translation?.languageCode ?? '';
    const translationIsFinal = current?.translation?.isFinal ?? false;
    const isDraft = current ? !('isFinal' in current) || current.isFinal === false : false;
    const sourceMeasureRef = useRef<HTMLSpanElement>(null);
    const translationMeasureRef = useRef<HTMLDivElement>(null);
    const measureContainerRef = useRef<HTMLDivElement>(null);
    const [pages, setPages] = useState<SubtitlePage[]>([]);
    const [pageIndex, setPageIndex] = useState(0);
    const previousIdentityRef = useRef('');
    const previousRollingTargetRef = useRef('');
    const previousRollingIdentityRef = useRef('');
    const [rollingCueIdentity, setRollingCueIdentity] = useState('');

    useLayoutEffect(() => {
        const previousTarget = previousRollingTargetRef.current;
        const previousIdentity = previousRollingIdentityRef.current;
        const nextTarget = rawCurrent?.text ?? '';
        if (shouldRollProgressiveTarget(previousTarget, nextTarget)) {
            setRollingCueIdentity(currentIdentity);
        } else if (previousIdentity !== currentIdentity) {
            setRollingCueIdentity('');
        }
        previousRollingTargetRef.current = nextTarget;
        previousRollingIdentityRef.current = currentIdentity;
    }, [currentIdentity, rawCurrent?.text]);

    useLayoutEffect(() => {
        if (!current || !sourceMeasureRef.current || !translationMeasureRef.current) {
            setPages([]);
            return;
        }

        const measurePages = () => {
            const nextPages = buildSubtitlePages(
                current.text,
                createLineFitChecker(sourceMeasureRef.current),
                createLineFitChecker(translationMeasureRef.current),
                current.translation,
                current.languageCode,
                preserveSourceWhitespace,
            );
            setPages(previous => subtitlePagesEqual(previous, nextPages) ? previous : nextPages);
        };

        measurePages();
        const resizeObserver = new ResizeObserver(measurePages);
        if (measureContainerRef.current) resizeObserver.observe(measureContainerRef.current);
        let disposed = false;
        void document.fonts?.ready.then(() => {
            if (!disposed) measurePages();
        });
        return () => {
            disposed = true;
            resizeObserver.disconnect();
        };
    }, [currentContent, currentIdentity, layoutKey, preserveSourceWhitespace, sourceLanguageCode, translationIsFinal, translationLanguageCode]);

    useEffect(() => {
        const isSameCue = previousIdentityRef.current === currentIdentity;
        setPageIndex(previousIndex => resolveSubtitlePageIndex({
            previousIndex,
            pageCount: pages.length,
            isDraft,
            isSameCue,
            followLiveEdge: shouldFollowLiveEdge,
        }));
        previousIdentityRef.current = currentIdentity;
    }, [currentContent, currentIdentity, isDraft, pages.length, shouldFollowLiveEdge]);

    const activePage = pages[Math.min(pageIndex, Math.max(0, pages.length - 1))];
    const activePageDurationMs = activePage
        ? calculateQueuedSubtitlePageDurationMs(
            activePage.sourceText,
            activePage.translation?.text,
            hasBacklog,
        )
        : 0;
    const hasNextPage = pageIndex < pages.length - 1;

    useEffect(() => {
        if (!current || !activePage) return;

        const pageDurationMs = activePageDurationMs;
        onPageDuration?.(pageDurationMs);
        if (paused || (!hasNextPage && !onCueComplete)) return;

        const timeoutId = window.setTimeout(() => {
            if (hasNextPage) {
                setPageIndex(index => Math.min(index + 1, pages.length - 1));
                onPageAdvance?.();
            } else {
                onCueComplete?.();
            }
        }, pageDurationMs);
        return () => window.clearTimeout(timeoutId);
    }, [activePage?.sourceText, activePage?.translation?.text, activePageDurationMs, currentIdentity, hasNextPage, onCueComplete, onPageAdvance, onPageDuration, pageIndex, paused]);

    if (!current) return null;

    const page = pages[Math.min(pageIndex, Math.max(0, pages.length - 1))];
    const translation = current.translation;
    const isRollingCueTransition = rollingCueIdentity === currentIdentity && Boolean(currentIdentity);
    const measurement = (
        <div ref={measureContainerRef} className="transcript-subtitle-measure" aria-hidden="true">
            <div className="transcript-subtitle-row">
                <div className="transcript-subtitle-slot transcript-subtitle-slot--source">
                    <p className="transcript-source-line transcript-subtitle-row__source">
                        <span
                            ref={sourceMeasureRef}
                            className={`transcript-source-line__text ${preserveSourceWhitespace ? 'transcript-source-line__text--verbatim' : ''}`}
                        />
                    </p>
                </div>
                <div className="transcript-subtitle-slot transcript-subtitle-slot--translation">
                    <div className="translation-block">
                        <div ref={translationMeasureRef} className="translation-block__text" />
                    </div>
                </div>
            </div>
        </div>
    );

    if (!page) return measurement;
    return (
        <>
            {measurement}
            <div className={`transcript-subtitle-row transcript-subtitle-row--current ${isDraft ? 'transcript-subtitle-row--draft' : ''}`}>
                <div className="transcript-subtitle-slot transcript-subtitle-slot--source">
                    {page.sourceText && (
                        <p
                            className="transcript-source-line transcript-subtitle-row__source"
                            lang={normalizeLanguageTag(current.languageCode)}
                            dir="auto"
                        >
                            <span
                                key={`${rollingCueIdentity}:${page.sourcePageIndex}:source-lines`}
                                className={`transcript-subtitle-lines ${page.sourcePageIndex > 0 || isRollingCueTransition ? 'transcript-subtitle-lines--rolling' : ''}`}
                            >
                                {page.sourceLines.map((line, index) => (
                                    <span
                                        key={`${page.sourcePageIndex}:source-line:${index}`}
                                        className={`transcript-subtitle-line ${preserveSourceWhitespace ? 'transcript-subtitle-line--verbatim' : ''}`}
                                    >
                                        {line}
                                    </span>
                                ))}
                            </span>
                        </p>
                    )}
                </div>
                <div className={`transcript-subtitle-slot transcript-subtitle-slot--translation ${page.translation ? '' : 'transcript-subtitle-slot--empty'}`}>
                    <TranslationBlock
                        translation={page.translation ? { ...page.translation, languageCode: translation?.languageCode ?? '' } : undefined}
                        showLanguageLabel={false}
                    />
                </div>
            </div>
        </>
    );
}

function getSubtitleCueIdentity(current?: TranscriptSegment | InterimTranscript): string {
    if (!current) return '';
    const stableIdentity = current.turnId || current.segmentId || ('sourceIdentity' in current ? current.sourceIdentity : '');
    return `${current.provider ?? 'unknown'}:${stableIdentity || ('key' in current ? current.key : current.id)}`;
}

interface SubtitlePage {
    sourceText: string;
    sourceLines: string[];
    sourcePageIndex: number;
    translation?: NonNullable<TranscriptSegment['translation']>;
}

function buildSubtitlePages(
    sourceText: string,
    sourceFits: (candidate: string) => boolean,
    translationFits: (candidate: string) => boolean,
    translation?: TranscriptSegment['translation'] | InterimTranscript['translation'],
    sourceLanguageCode?: string,
    preserveSourceWhitespace = false,
): SubtitlePage[] {
    const sourceFitsNbtcLine = (candidate: string) => (
        fitsNbtcCaptionLine(candidate) && sourceFits(candidate)
    );
    const sourcePages = splitSubtitleTextIntoRollingWindows(
        sourceText,
        sourceFitsNbtcLine,
        sourceLanguageCode,
        preserveSourceWhitespace,
    );
    const translationPages = splitSubtitleTextIntoRollingWindows(
        translation?.text ?? '',
        translationFits,
        translation?.languageCode,
    );
    const alignedPages = alignSubtitlePagePairs(sourcePages, translationPages);
    const pageCount = alignedPages.length;

    return alignedPages.map((page, pageIndex) => {
        const sourcePageIndex = pageIndexAtProgress(sourcePages, pageIndex, pageCount);
        const sourceFragments = splitSubtitleTextIntoLines(
            page.sourceText,
            sourceFitsNbtcLine,
            sourceLanguageCode,
            preserveSourceWhitespace,
        );
        return {
            sourceText: page.sourceText,
            sourcePageIndex,
            sourceLines: sourceFragments.map((fragment, index) => (
                index < sourceFragments.length - 1
                    ? fragment.text + fragment.separatorAfter
                    : fragment.text
            )),
            ...(page.translationText
                ? {
                    translation: {
                        text: page.translationText,
                        languageCode: translation?.languageCode ?? '',
                        isFinal: translation?.isFinal ?? false,
                    },
                }
                : {}),
        };
    });
}

function pageIndexAtProgress(pages: string[], index: number, pageCount: number): number {
    if (pages.length === 0) return 0;
    return Math.min(
        pages.length - 1,
        Math.floor(((index + 0.5) * pages.length) / pageCount),
    );
}

function createLineFitChecker(element: HTMLElement): (candidate: string) => boolean {
    const lineHeight = Number.parseFloat(window.getComputedStyle(element).lineHeight);
    const maximumHeight = lineHeight + 1;
    return candidate => {
        element.textContent = candidate;
        return element.getBoundingClientRect().height <= maximumHeight;
    };
}

function subtitlePagesEqual(left: SubtitlePage[], right: SubtitlePage[]): boolean {
    return left.length === right.length && left.every((page, index) => (
        page.sourceText === right[index]?.sourceText
        && page.sourcePageIndex === right[index]?.sourcePageIndex
        && page.sourceLines.length === right[index]?.sourceLines.length
        && page.sourceLines.every((line, lineIndex) => line === right[index]?.sourceLines[lineIndex])
        && page.translation?.text === right[index]?.translation?.text
        && page.translation?.isFinal === right[index]?.translation?.isFinal
    ));
}

interface TranscriptParagraphProps {
    transcripts: readonly TranscriptSegment[];
    interims: readonly InterimTranscript[];
}

export const TranscriptParagraph = memo(function TranscriptParagraph({
    transcripts,
    interims,
}: TranscriptParagraphProps) {
    return (
        <p className="transcript-paragraph-source min-w-0 break-words text-slate-100">
            {transcripts.map(segment => (
                <Fragment key={segment.id}>
                    <span lang={normalizeLanguageTag(segment.languageCode)} dir="auto">{segment.text}</span>{' '}
                </Fragment>
            ))}
            {interims.map(interim => (
                <Fragment key={interim.key}>
                    <span className="transcript-inline-draft">
                        <span className="transcript-inline-draft__dot" aria-hidden="true" />
                        Draft
                    </span>{' '}
                    <span
                        className={`italic ${getProviderPresentation(interim.provider).draftText}`}
                        lang={normalizeLanguageTag(interim.languageCode)}
                        dir="auto"
                    >
                        {interim.text}
                    </span>{' '}
                </Fragment>
            ))}
        </p>
    );
});

const FinalTranscriptRow = memo(function FinalTranscriptRow({
    segment,
    index,
    variant,
}: {
    segment: TranscriptSegment;
    index: number;
    variant: TranscriptRowsProps['variant'];
}) {
    const isTurnLive = isTranscriptTurnLive(segment);
    if (variant === 'numbered') {
        return (
            <div className="transcript-turn transcript-turn--line group -mx-2 flex items-start rounded px-2 transition-colors duration-100 hover:bg-slate-900/25">
                <span className="transcript-turn__index shrink-0 select-none tabular-nums text-slate-400">
                    <span className="sr-only">{isTurnLive ? 'Live turn ' : 'Turn '}</span>
                    <span aria-hidden="true">{formatTurnIndex(index)}</span>
                    {isTurnLive && <span className="transcript-live-dot transcript-turn__live-dot" aria-hidden="true" />}
                </span>
                <div className="transcript-bilingual min-w-0 flex-1">
                    <TranscriptSource segment={segment} className="text-slate-100" />
                    <TranslationBlock translation={segment.translation} />
                </div>
            </div>
        );
    }

    if (variant === 'subtitle') {
        return (
            <div className="transcript-subtitle-row transcript-subtitle-row--current">
                <div className="transcript-subtitle-slot transcript-subtitle-slot--source">
                    <TranscriptSource
                        segment={segment}
                        className="transcript-subtitle-row__source"
                        showLanguageLabel={false}
                    />
                </div>
                <div className={`transcript-subtitle-slot transcript-subtitle-slot--translation ${segment.translation ? '' : 'transcript-subtitle-slot--empty'}`}>
                    <TranslationBlock translation={segment.translation} showLanguageLabel={false} />
                </div>
            </div>
        );
    }

    return (
        <div className="transcript-row transcript-turn grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 py-3">
            {segment.provider && <ProviderBadge provider={segment.provider} />}
            <div className="transcript-bilingual min-w-0">
                <TranscriptSource segment={segment} className="break-words text-[1rem] leading-7 text-slate-100" />
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
});

const InterimTranscriptRow = memo(function InterimTranscriptRow({
    interim,
    index,
    variant,
}: {
    interim: InterimTranscript;
    index: number;
    variant: TranscriptRowsProps['variant'];
}) {
    if (variant === 'numbered') {
        return (
            <div className="transcript-turn transcript-turn--draft transcript-turn--line group -mx-2 flex items-start rounded px-2 hover:bg-slate-900/25">
                <span className="transcript-turn__index shrink-0 select-none tabular-nums text-slate-400">
                    <span className="sr-only">Live draft </span>
                    <span aria-hidden="true">{formatTurnIndex(index)}</span>
                    <span className="transcript-live-dot transcript-turn__live-dot" aria-hidden="true" />
                    <span className="transcript-turn__draft-label" aria-hidden="true">Draft</span>
                </span>
                <div className="transcript-bilingual min-w-0 flex-1">
                    <TranscriptSource segment={interim} className="min-w-0 text-slate-300" />
                    <TranslationBlock translation={interim.translation} />
                </div>
            </div>
        );
    }

    if (variant === 'subtitle') {
        return (
            <div className="transcript-subtitle-row transcript-subtitle-row--draft transcript-subtitle-row--current">
                <div className="transcript-subtitle-slot transcript-subtitle-slot--source">
                    <span className="sr-only">Live interim transcript: </span>
                    <TranscriptSource
                        segment={interim}
                        className="transcript-subtitle-row__source"
                        showLanguageLabel={false}
                    />
                </div>
                <div className={`transcript-subtitle-slot transcript-subtitle-slot--translation ${interim.translation ? '' : 'transcript-subtitle-slot--empty'}`}>
                    <TranslationBlock translation={interim.translation} showLanguageLabel={false} />
                </div>
            </div>
        );
    }

    return (
        <div className="transcript-row transcript-row--interim transcript-turn transcript-turn--draft grid grid-cols-[auto_minmax(0,1fr)] gap-2 py-3 sm:gap-3">
            <div className="flex flex-col items-start gap-1">
                <ProviderBadge provider={interim.provider} />
                <span className="transcript-draft-indicator">
                    <span className="transcript-live-dot" aria-hidden="true" />
                    Draft
                </span>
            </div>
            <div className="transcript-bilingual col-span-2 min-w-0 sm:col-span-1">
                <span className="sr-only">Live interim transcript: </span>
                <TranscriptSource segment={interim} className="break-words text-[1rem] leading-7 text-slate-300" />
                <TranslationBlock translation={interim.translation} />
            </div>
        </div>
    );
});

function TranscriptSource({
    segment,
    className,
    showLanguageLabel = true,
}: {
    segment: Pick<TranscriptSegment, 'provider' | 'text' | 'languageCode'>;
    className: string;
    showLanguageLabel?: boolean;
}) {
    const showLanguage = showLanguageLabel && hasSourceLanguageLabel(segment.provider, segment.languageCode);
    return (
        <p
            className={`transcript-source-line ${className} ${showLanguage ? 'transcript-source-line--labeled' : ''}`}
            lang={normalizeLanguageTag(segment.languageCode)}
            dir="auto"
        >
            {showLanguage && (
                <span className="source-language-label" title={formatLanguageLabel(segment.languageCode)} aria-hidden="true">
                    <span className="language-label__text">{formatLanguageLabel(segment.languageCode)}</span>
                </span>
            )}
            <span className={`transcript-source-line__text ${segment.provider === 'caption-desk' ? 'transcript-source-line__text--verbatim' : ''}`}>
                {segment.text}
            </span>
        </p>
    );
}

function ProviderBadge({ provider }: { provider: string }) {
    return (
        <span className={`h-fit shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${getProviderPresentation(provider).badge}`}>
            {formatProviderName(provider)}
        </span>
    );
}

function formatTurnIndex(index: number): string {
    return String(index + 1).padStart(2, '0');
}
