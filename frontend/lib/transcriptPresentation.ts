import type { TranscriptSegment } from '../types';
import type { InterimTranscript } from './transcriptMessages.ts';
import { groupFinalTranscriptRows } from './transcriptMessages.ts';
import { formatTranscriptText } from './transcriptExport.ts';

export interface ProviderTranscriptPresentation {
    transcripts: TranscriptSegment[];
    interims: InterimTranscript[];
    exportText: string;
}

const PROVIDER_ORDER = ['google', 'gemini', 'azure', 'gpt-realtime-whisper'];

export function buildProviderTranscriptPresentations(
    transcripts: readonly TranscriptSegment[],
    interimTranscripts: ReadonlyMap<string, InterimTranscript>,
    additionalProviders: readonly string[] = [],
): Array<readonly [string, ProviderTranscriptPresentation]> {
    const providers = new Set(additionalProviders.filter(Boolean));
    const finalizedByProvider = new Map<string, TranscriptSegment[]>();
    const interimsByProvider = new Map<string, InterimTranscript[]>();
    transcripts.forEach(segment => {
        if (!segment.provider) return;
        providers.add(segment.provider);
        const entries = finalizedByProvider.get(segment.provider);
        if (entries) entries.push(segment);
        else finalizedByProvider.set(segment.provider, [segment]);
    });
    interimTranscripts.forEach(interim => {
        if (!interim.provider) return;
        providers.add(interim.provider);
        const entries = interimsByProvider.get(interim.provider);
        if (entries) entries.push(interim);
        else interimsByProvider.set(interim.provider, [interim]);
    });

    return Array.from(providers, provider => {
        const finalized = groupFinalTranscriptRows(finalizedByProvider.get(provider) ?? []);
        return [provider, {
            transcripts: finalized,
            interims: interimsByProvider.get(provider) ?? [],
            exportText: formatTranscriptText(finalized),
        }] as const;
    }).sort(([left], [right]) => compareProviders(left, right));
}

export function selectTranscriptPresentation(
    transcripts: readonly TranscriptSegment[],
    interimTranscripts: ReadonlyMap<string, InterimTranscript>,
    provider: string,
): Pick<ProviderTranscriptPresentation, 'transcripts' | 'interims'> {
    const matching = provider === 'all'
        ? transcripts
        : transcripts.filter(segment => segment.provider === provider);
    const interims = Array.from(interimTranscripts.values());
    return {
        transcripts: groupFinalTranscriptRows(matching),
        interims: provider === 'all'
            ? interims
            : interims.filter(interim => interim.provider === provider),
    };
}

export function collectTranscriptProviders(
    transcripts: readonly TranscriptSegment[],
    interimTranscripts: ReadonlyMap<string, InterimTranscript>,
    additionalProviders: readonly string[] = [],
): string[] {
    const providers = new Set(additionalProviders.filter(Boolean));
    transcripts.forEach(segment => {
        if (segment.provider) providers.add(segment.provider);
    });
    interimTranscripts.forEach(interim => providers.add(interim.provider));
    return Array.from(providers).sort(compareProviders);
}

function compareProviders(left: string, right: string): number {
    const leftOrder = PROVIDER_ORDER.indexOf(left);
    const rightOrder = PROVIDER_ORDER.indexOf(right);
    if (leftOrder === -1) return rightOrder === -1 ? left.localeCompare(right) : 1;
    if (rightOrder === -1) return -1;
    return leftOrder - rightOrder;
}
