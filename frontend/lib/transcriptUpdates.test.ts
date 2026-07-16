import assert from 'node:assert/strict';
import test from 'node:test';
import { TranscriptUpdateBuffer } from './transcriptUpdates.ts';
import type { TranscriptMessage } from './transcriptMessages.ts';

interface Update {
    text: string;
    isFinal: boolean;
    speaker: string;
}

function createBuffer() {
    const scheduled = new Map<number, () => void>();
    const delivered: Update[] = [];
    let nextTimerId = 0;
    const buffer = new TranscriptUpdateBuffer<Update>(
        update => delivered.push(update),
        50,
        callback => {
            const timerId = ++nextTimerId;
            scheduled.set(timerId, callback);
            return timerId;
        },
        timerId => scheduled.delete(timerId),
        update => update.isFinal,
        update => update.speaker,
    );

    const flushNext = () => {
        const next = scheduled.entries().next().value as [number, () => void] | undefined;
        if (!next) return;
        scheduled.delete(next[0]);
        next[1]();
    };

    return { buffer, delivered, flushNext };
}

test('coalesces rapid interim snapshots to the latest text', () => {
    const { buffer, delivered, flushNext } = createBuffer();

    buffer.push({ text: 'ทด', isFinal: false, speaker: 'one' });
    buffer.push({ text: 'ทดสอบ', isFinal: false, speaker: 'one' });
    buffer.push({ text: 'ทดสอบข้อความ', isFinal: false, speaker: 'one' });

    assert.deepEqual(delivered.map(update => update.text), ['ทด']);
    flushNext();
    assert.deepEqual(delivered.map(update => update.text), ['ทด', 'ทดสอบข้อความ']);
});

test('renders the latest interim before finalizing the same speaker', () => {
    const { buffer, delivered, flushNext } = createBuffer();

    buffer.push({ text: 'ประ', isFinal: false, speaker: 'one' });
    buffer.push({ text: 'ประโยค', isFinal: false, speaker: 'one' });
    buffer.push({ text: 'ประโยคสมบูรณ์', isFinal: true, speaker: 'one' });

    assert.deepEqual(delivered.map(update => update.text), ['ประ', 'ประโยค']);
    flushNext();
    assert.deepEqual(delivered.map(update => update.text), ['ประ', 'ประโยค', 'ประโยคสมบูรณ์']);
});

test('keeps independent interim updates for different speakers', () => {
    const { buffer, delivered, flushNext } = createBuffer();

    buffer.push({ text: 'หนึ่ง', isFinal: false, speaker: 'one' });
    buffer.push({ text: 'สอง', isFinal: false, speaker: 'two' });
    buffer.push({ text: 'หนึ่งล่าสุด', isFinal: false, speaker: 'one' });
    flushNext();

    assert.deepEqual(delivered.map(update => update.text), ['หนึ่ง', 'สอง', 'หนึ่งล่าสุด']);
});

test('validates transcript packets and derives a provider-speaker key', async () => {
    const module = await import('./transcriptMessages.ts').catch(() => ({}));
    const parse = 'parseTranscriptMessage' in module ? module.parseTranscriptMessage : () => undefined;
    const keyOf = 'getTranscriptKey' in module ? module.getTranscriptKey : () => undefined;

    const valid = parse({
        type: 'transcript',
        text: ' ทดสอบ ',
        isFinal: false,
        provider: 'google',
        speaker: 'user-1',
    });

    assert.deepEqual(valid, {
        type: 'transcript',
        text: 'ทดสอบ',
        isFinal: false,
        provider: 'google',
        speaker: 'user-1',
    });
    assert.ok(valid);
    assert.equal(keyOf(valid as TranscriptMessage, 'agent-google'), 'google:user-1');
    assert.equal(parse({ type: 'status', text: 'connected', isFinal: false }), undefined);
    assert.equal(parse({ type: 'transcript', text: 123, isFinal: false }), undefined);
});

test('updates and clears interim entries by speaker and source', async () => {
    const module = await import('./transcriptMessages.ts').catch(() => ({}));
    const upsert = 'upsertInterim' in module ? module.upsertInterim : () => new Map();
    const remove = 'removeInterim' in module ? module.removeInterim : () => new Map();
    const clearSource = 'clearInterimsBySource' in module ? module.clearInterimsBySource : () => new Map();

    let entries = new Map();
    entries = upsert(entries, {
        key: 'google:user-1', text: 'หนึ่ง', provider: 'google', speaker: 'user-1', sourceIdentity: 'agent-google',
    });
    entries = upsert(entries, {
        key: 'google:user-2', text: 'สอง', provider: 'google', speaker: 'user-2', sourceIdentity: 'agent-google',
    });
    entries = upsert(entries, {
        key: 'azure:user-3', text: 'สาม', provider: 'azure', speaker: 'user-3', sourceIdentity: 'agent-azure',
    });

    entries = remove(entries, 'google:user-1');
    assert.deepEqual(Array.from(entries.keys()), ['google:user-2', 'azure:user-3']);

    entries = clearSource(entries, 'agent-google');
    assert.deepEqual(Array.from(entries.keys()), ['azure:user-3']);
});

test('sticks to latest only while the viewport is near the bottom', async () => {
    const module = await import('./transcriptViewport.ts').catch(() => ({}));
    const shouldStick = 'shouldStickToLatest' in module ? module.shouldStickToLatest : () => false;

    assert.equal(shouldStick({ scrollTop: 650, clientHeight: 300, scrollHeight: 1000 }), true);
    assert.equal(shouldStick({ scrollTop: 300, clientHeight: 300, scrollHeight: 1000 }), false);
});
