import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildProviderTranscriptPresentations,
    collectTranscriptProviders,
    selectCurrentSubtitle,
    selectTranscriptPresentation,
} from './transcriptPresentation.ts';
import type { TranscriptSegment } from '../types.ts';
import type { InterimTranscript } from './transcriptMessages.ts';

const transcripts: TranscriptSegment[] = [
    { id: '1', text: 'Google final', isFinal: true, timestamp: 1, provider: 'google', role: 'source' },
    { id: '2', text: 'Azure final', isFinal: true, timestamp: 2, provider: 'azure', role: 'source' },
];
const interims = new Map<string, InterimTranscript>([
    ['gemini:one', {
        key: 'gemini:one',
        text: 'Gemini draft',
        provider: 'gemini',

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

test('selects one provider and never combines providers', () => {
    const azure = selectTranscriptPresentation(transcripts, interims, 'azure');
    assert.deepEqual(azure.transcripts.map(segment => segment.text), ['Azure final']);
    assert.equal(azure.interims.length, 0);

    const all = selectTranscriptPresentation(transcripts, interims, 'all');
    assert.equal(all.transcripts.length, 0);
    assert.equal(all.interims.length, 0);

    const none = selectTranscriptPresentation(transcripts, interims, '');
    assert.equal(none.transcripts.length, 0);
    assert.equal(none.interims.length, 0);
});

test('keeps one subtitle block on the latest draft or final', () => {
    const google = selectTranscriptPresentation(transcripts, interims, 'google');
    const draft = selectCurrentSubtitle(google.transcripts, [
        { key: 'google:latest', text: 'Google draft', provider: 'google', sourceIdentity: 'agent-google' },
    ]);
    assert.deepEqual(draft.transcripts, []);
    assert.deepEqual(draft.interims.map(interim => interim.text), ['Google draft']);

    const final = selectCurrentSubtitle(google.transcripts, []);
    assert.deepEqual(final.transcripts.map(segment => segment.text), ['Google final']);
    assert.deepEqual(final.interims, []);
});

test('collects providers from agents, committed rows, and drafts without duplicates', () => {
    assert.deepEqual(
        collectTranscriptProviders(transcripts, interims, ['google']),
        ['google', 'gemini', 'azure'],
    );
});
