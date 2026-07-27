import { Fragment, memo } from 'react';
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

interface TranscriptRowsProps {
    transcripts: readonly TranscriptSegment[];
    interims: readonly InterimTranscript[];
    variant: 'numbered' | 'detailed';
}

export const TranscriptRows = memo(function TranscriptRows({
    transcripts,
    interims,
    variant,
}: TranscriptRowsProps) {
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
                <span className="sr-only">Live interim transcript from {interim.speaker}: </span>
                <TranscriptSource segment={interim} className="break-words text-[1rem] leading-7 text-slate-300" />
                <TranslationBlock translation={interim.translation} />
            </div>
        </div>
    );
});

function TranscriptSource({
    segment,
    className,
}: {
    segment: Pick<TranscriptSegment, 'provider' | 'text' | 'languageCode'>;
    className: string;
}) {
    const showLanguage = hasSourceLanguageLabel(segment.provider, segment.languageCode);
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
            <span className="transcript-source-line__text">{segment.text}</span>
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
