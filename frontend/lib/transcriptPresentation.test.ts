import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildProviderTranscriptPresentations,
    collectTranscriptProviders,
    selectCurrentSubtitle,
    selectTranscriptPresentation,
    snapshotCurrentSubtitle,
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

test('keeps the previous final continuous with a new interim inside five seconds', () => {
    const currentInterim = {
        key: 'google:current',
        text: 'ข้อความใหม่',
        provider: 'google',
        sourceIdentity: 'agent-google',
        timestamp: 4_000,
    } as InterimTranscript;

    const current = selectCurrentSubtitle([{
        id: 'previous', text: 'ข้อความก่อนหน้า', isFinal: true,
        timestamp: 1_000, provider: 'google', role: 'source',
    }], [currentInterim]);

    assert.deepEqual(current.transcripts, []);
    assert.deepEqual(current.interims.map(interim => interim.text), ['ข้อความก่อนหน้า ข้อความใหม่']);
});

test('rolls consecutive finals forward instead of blanking the completed interim', () => {
    const current = selectCurrentSubtitle([
        { id: 'previous', text: 'บรรทัดก่อน', isFinal: true, timestamp: 1_000, provider: 'google', role: 'source' },
        { id: 'current', text: 'บรรทัดใหม่', isFinal: true, timestamp: 4_000, provider: 'google', role: 'source' },
    ], []);

    assert.deepEqual(current.transcripts.map(segment => segment.text), ['บรรทัดก่อน บรรทัดใหม่']);
    assert.deepEqual(current.interims, []);
});

test('starts a fresh subtitle cue after five seconds without continuation', () => {
    const current = selectCurrentSubtitle([
        { id: 'stale', text: 'ข้อความเก่า', isFinal: true, timestamp: 1_000, provider: 'google', role: 'source' },
        { id: 'current', text: 'ข้อความใหม่', isFinal: true, timestamp: 6_001, provider: 'google', role: 'source' },
    ], []);

    assert.deepEqual(current.transcripts.map(segment => segment.text), ['ข้อความใหม่']);
});

test('freezes the current subtitle cue independently from later live revisions', () => {
    const live = selectCurrentSubtitle([], [{
        key: 'google:live',
        text: 'Current draft',
        provider: 'google',
        sourceIdentity: 'agent-google',
        translation: { text: 'คำแปลปัจจุบัน', languageCode: 'th', isFinal: false },
    }]);
    const frozen = snapshotCurrentSubtitle(live);

    live.interims[0].text = 'Later revision';
    if (live.interims[0].translation) live.interims[0].translation.text = 'คำแปลใหม่';

    assert.equal(frozen.interims[0].text, 'Current draft');
    assert.equal(frozen.interims[0].translation?.text, 'คำแปลปัจจุบัน');
});

test('collects providers from agents, committed rows, and drafts without duplicates', () => {
    assert.deepEqual(
        collectTranscriptProviders(transcripts, interims, ['google']),
        ['google', 'gemini', 'azure'],
    );
});
