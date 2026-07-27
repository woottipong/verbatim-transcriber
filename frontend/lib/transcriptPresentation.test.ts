import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildProviderTranscriptPresentations,
    collectTranscriptProviders,
    selectTranscriptPresentation,
} from './transcriptPresentation.ts';
import type { TranscriptSegment } from '../types.ts';
import type { InterimTranscript } from './transcriptMessages.ts';

const transcripts: TranscriptSegment[] = [
    { id: '1', text: 'Google final', isFinal: true, timestamp: 1, provider: 'google', speaker: 'one', role: 'source' },
    { id: '2', text: 'Azure final', isFinal: true, timestamp: 2, provider: 'azure', speaker: 'one', role: 'source' },
];
const interims = new Map<string, InterimTranscript>([
    ['gemini:one', {
        key: 'gemini:one',
        text: 'Gemini draft',
        provider: 'gemini',
        speaker: 'one',
        sourceIdentity: 'agent-gemini',
    }],
]);

test('builds provider presentations in product order with export text', () => {
    const groups = buildProviderTranscriptPresentations(
        transcripts,
        interims,
        ['gpt-realtime-whisper'],
    );

    assert.deepEqual(groups.map(([provider]) => provider), [
        'google',
        'gemini',
        'azure',
        'gpt-realtime-whisper',
    ]);
    assert.equal(groups[0][1].exportText, 'Google final');
    assert.equal(groups[1][1].interims[0].text, 'Gemini draft');
});

test('selects one provider or the combined transcript presentation', () => {
    const azure = selectTranscriptPresentation(transcripts, interims, 'azure');
    assert.deepEqual(azure.transcripts.map(segment => segment.text), ['Azure final']);
    assert.equal(azure.interims.length, 0);

    const all = selectTranscriptPresentation(transcripts, interims, 'all');
    assert.equal(all.transcripts.length, 2);
    assert.equal(all.interims.length, 1);
});

test('collects providers from agents, committed rows, and drafts without duplicates', () => {
    assert.deepEqual(
        collectTranscriptProviders(transcripts, interims, ['google']),
        ['google', 'gemini', 'azure'],
    );
});
