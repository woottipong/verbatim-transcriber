import assert from 'node:assert/strict';
import test from 'node:test';
import {
    GEMINI_TRANSCRIPT_UPDATE_INTERVAL_MS,
    TranscriptUpdateBuffer,
} from './transcriptUpdates.ts';
import type { TranscriptMessage } from './transcriptMessages.ts';

interface Update {
    text: string;
    isFinal: boolean;
    key: string;
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
        update => update.key,
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

    buffer.push({ text: 'ทด', isFinal: false, key: 'one' });
    buffer.push({ text: 'ทดสอบ', isFinal: false, key: 'one' });
    buffer.push({ text: 'ทดสอบข้อความ', isFinal: false, key: 'one' });

    assert.deepEqual(delivered.map(update => update.text), ['ทด']);
    flushNext();
    assert.deepEqual(delivered.map(update => update.text), ['ทด', 'ทดสอบข้อความ']);
});

test('renders the latest interim before finalizing the same key', () => {
    const { buffer, delivered, flushNext } = createBuffer();

    buffer.push({ text: 'ประ', isFinal: false, key: 'one' });
    buffer.push({ text: 'ประโยค', isFinal: false, key: 'one' });
    buffer.push({ text: 'ประโยคสมบูรณ์', isFinal: true, key: 'one' });

    assert.deepEqual(delivered.map(update => update.text), ['ประ', 'ประโยค']);
    flushNext();
    assert.deepEqual(delivered.map(update => update.text), ['ประ', 'ประโยค', 'ประโยคสมบูรณ์']);
});

test('keeps independent interim updates for different keys', () => {
    const { buffer, delivered, flushNext } = createBuffer();

    buffer.push({ text: 'หนึ่ง', isFinal: false, key: 'one' });
    buffer.push({ text: 'สอง', isFinal: false, key: 'two' });
    buffer.push({ text: 'หนึ่งล่าสุด', isFinal: false, key: 'one' });
    flushNext();

    assert.deepEqual(delivered.map(update => update.text), ['หนึ่ง', 'สอง', 'หนึ่งล่าสุด']);
});

test('coalesces Gemini source and translation keys at 50 ms', () => {
    const scheduled = new Map<number, () => void>();
    const delivered: Update[] = [];
    const delays: number[] = [];
    let nextTimerId = 0;
    const buffer = new TranscriptUpdateBuffer<Update>(
        update => delivered.push(update),
        GEMINI_TRANSCRIPT_UPDATE_INTERVAL_MS,
        (callback, delayMs) => {
            delays.push(delayMs);
            const timerId = ++nextTimerId;
            scheduled.set(timerId, callback);
            return timerId;
        },
        timerId => scheduled.delete(timerId),
        update => update.isFinal,
        update => update.key,
        'immediate',
    );

    buffer.push({ text: 'source-1', isFinal: false, key: 'source' });
    buffer.push({ text: 'source-2', isFinal: false, key: 'source' });
    buffer.push({ text: 'translation-1', isFinal: false, key: 'translation' });
    buffer.push({ text: 'source-3', isFinal: false, key: 'source' });
    buffer.push({ text: 'translation-2', isFinal: false, key: 'translation' });

    assert.deepEqual(delays, [50]);

    const next = scheduled.entries().next().value as [number, () => void];
    scheduled.delete(next[0]);
    next[1]();
    assert.deepEqual(delivered.map(update => update.text), [
        'source-1',
        'source-3',
        'translation-2',
    ]);
});

test('flushes the latest pending Gemini update and final immediately', () => {
    const scheduled = new Map<number, () => void>();
    const delivered: Update[] = [];
    let nextTimerId = 0;
    const buffer = new TranscriptUpdateBuffer<Update>(
        update => delivered.push(update),
        GEMINI_TRANSCRIPT_UPDATE_INTERVAL_MS,
        callback => {
            const timerId = ++nextTimerId;
            scheduled.set(timerId, callback);
            return timerId;
        },
        timerId => scheduled.delete(timerId),
        update => update.isFinal,
        update => update.key,
        'immediate',
    );

    buffer.push({ text: 'source-1', isFinal: false, key: 'source' });
    buffer.push({ text: 'source-2', isFinal: false, key: 'source' });
    buffer.push({ text: 'source-final', isFinal: true, key: 'source' });

    assert.deepEqual(delivered.map(update => update.text), [
        'source-1',
        'source-2',
        'source-final',
    ]);
});

test('validates transcript packets and derives a provider key', async () => {
    const module = await import('./transcriptMessages.ts').catch(() => ({}));
    const parse = 'parseTranscriptMessage' in module ? module.parseTranscriptMessage : () => undefined;
    const keyOf = 'getTranscriptKey' in module ? module.getTranscriptKey : () => undefined;

    const valid = parse({
        type: 'transcript',
        text: ' ทดสอบ ',
        isFinal: false,
        provider: 'google',

    });

    assert.deepEqual(valid, {
        type: 'transcript',
        text: 'ทดสอบ',
        isFinal: false,
        role: 'source',
        provider: 'google',
    });
    assert.ok(valid);
    assert.equal(keyOf(valid as TranscriptMessage), 'google');
    assert.equal(parse({ type: 'status', text: 'connected', isFinal: false }), undefined);
    assert.equal(parse({ type: 'transcript', text: 123, isFinal: false }), undefined);
});

test('validates translation packets and separates their turn key', async () => {
    const module = await import('./transcriptMessages.ts');
    const translation = module.parseTranscriptMessage({
        type: 'transcript',
        text: ' ห้องฉุกเฉิน ',
        isFinal: false,
        provider: 'gemini',

        role: 'translation',
        languageCode: 'th',
        turnId: 'gemini-1',
    });

    assert.ok(translation);
    assert.equal(translation.role, 'translation');
    assert.equal(module.getTranscriptKey(translation), 'gemini:gemini-1:translation');
    assert.equal(module.parseTranscriptMessage({
        type: 'transcript', text: 'แปล', isFinal: false, role: 'translation', provider: 'gemini',
    }), undefined);
    assert.equal(module.parseTranscriptMessage({
        type: 'transcript', text: 'แปล', isFinal: false, role: 'translation', provider: 'gemini', turnId: '   ',
    }), undefined);
});

test('attaches translation to the latest source row in the same turn', async () => {
    const module = await import('./transcriptMessages.ts');
    const rows = [
        { id: '1', text: 'from', isFinal: true, timestamp: 1, provider: 'gemini', turnId: 'gemini-1', role: 'source' as const },
        { id: '2', text: 'emergency room', isFinal: true, timestamp: 2, provider: 'gemini', turnId: 'gemini-1', role: 'source' as const },
    ];
    const result = module.attachTranslation(rows, {
        type: 'transcript', text: 'ห้องฉุกเฉิน', isFinal: true, provider: 'gemini',
        role: 'translation', languageCode: 'th', turnId: 'gemini-1',
    });

    assert.equal(result.attached, true);
    assert.equal(result.transcripts.length, 2);
    assert.equal(result.transcripts[0].translation, undefined);
    assert.deepEqual(result.transcripts[1].translation, { text: 'ห้องฉุกเฉิน', languageCode: 'th', isFinal: true });
});

test('hides identical Thai translations', async () => {
    const module = await import('./transcriptMessages.ts');
    const rows = [{
        id: '1', text: 'ห้องฉุกเฉิน', isFinal: true, timestamp: 1, provider: 'gemini',
        turnId: 'gemini-1', role: 'source' as const, languageCode: 'th',
    }];
    const result = module.attachTranslation(rows, {
        type: 'transcript', text: 'ห้องฉุกเฉิน', isFinal: true, provider: 'gemini',
        role: 'translation', languageCode: 'th', turnId: 'gemini-1',
    });

    assert.equal(result.attached, true);
    assert.equal(result.transcripts[0].translation, undefined);
});

test('hides same-language translations when only one tag includes a region', async () => {
    const module = await import('./transcriptMessages.ts');
    const rows = [{
        id: '1', text: 'สวัสดี', isFinal: true, timestamp: 1, provider: 'gemini',
        turnId: 'gemini-1', role: 'source' as const, languageCode: 'th-TH',
    }];
    const result = module.attachTranslation(rows, {
        type: 'transcript', text: 'สวัสดีครับ', isFinal: true, provider: 'gemini',
        role: 'translation', languageCode: 'th', turnId: 'gemini-1',
    });

    assert.equal(result.attached, true);
    assert.equal(result.transcripts[0].translation, undefined);
});

test('shows English translation for a Thai source turn', async () => {
    const module = await import('./transcriptMessages.ts');
    const rows = [{
        id: '1', text: 'สวัสดีทุกคน', isFinal: true, timestamp: 1, provider: 'gemini',
        turnId: 'gemini-1', role: 'source' as const, languageCode: 'th',
    }];
    const result = module.attachTranslation(rows, {
        type: 'transcript', text: 'Hello everyone', isFinal: true, provider: 'gemini',
        role: 'translation', languageCode: 'en', turnId: 'gemini-1',
    });

    assert.equal(result.attached, true);
    assert.deepEqual(result.transcripts[0].translation, {
        text: 'Hello everyone', languageCode: 'en', isFinal: true,
    });
});

test('shows translations between different scripts of the same base language', async () => {
    const module = await import('./transcriptMessages.ts');
    const source = {
        id: '1', text: '简体中文', isFinal: true, timestamp: 1, provider: 'gemini',
        turnId: 'gemini-1', role: 'source' as const, languageCode: 'zh-Hans',
    };
    const result = module.attachTranslation([source], {
        type: 'transcript', text: '繁體中文', isFinal: true, role: 'translation',
        provider: 'gemini', languageCode: 'zh-Hant', turnId: 'gemini-1',
    });

    assert.deepEqual(result.transcripts[0].translation, {
        text: '繁體中文', languageCode: 'zh-Hant', isFinal: true,
    });
});

test('shows translations between different regions of the same base language', async () => {
    const module = await import('./transcriptMessages.ts');
    const source = {
        id: '1', text: 'olá', isFinal: true, timestamp: 1, provider: 'gemini',
        turnId: 'gemini-1', role: 'source' as const, languageCode: 'pt-BR',
    };
    const result = module.attachTranslation([source], {
        type: 'transcript', text: 'olá a todos', isFinal: true, role: 'translation',
        provider: 'gemini', languageCode: 'pt-PT', turnId: 'gemini-1',
    });

    assert.deepEqual(result.transcripts[0].translation, {
        text: 'olá a todos', languageCode: 'pt-PT', isFinal: true,
    });
});

test('does not invent a target language when translation metadata is missing', async () => {
    const module = await import('./transcriptMessages.ts');
    const rows = [{
        id: '1', text: 'สวัสดีทุกคน', isFinal: true, timestamp: 1, provider: 'gemini',
        turnId: 'gemini-1', role: 'source' as const, languageCode: 'th',
    }];
    const result = module.attachTranslation(rows, {
        type: 'transcript', text: 'Hello everyone', isFinal: true, provider: 'gemini',
        role: 'translation', turnId: 'gemini-1',
    });

    assert.deepEqual(result.transcripts[0].translation, {
        text: 'Hello everyone', languageCode: '', isFinal: true,
    });
});

test('moves a turn translation to the latest source row', async () => {
    const module = await import('./transcriptMessages.ts');
    const translation = { text: 'จากห้องฉุกเฉิน', languageCode: 'th', isFinal: false };
    const rows = [
        { id: '1', text: 'from', isFinal: true, timestamp: 1, provider: 'gemini', turnId: 'gemini-1', role: 'source' as const, translation },
        { id: '2', text: 'emergency room', isFinal: true, timestamp: 2, provider: 'gemini', turnId: 'gemini-1', role: 'source' as const },
    ];
    const result = module.attachTranslation(rows, {
        type: 'transcript', text: 'จากห้องฉุกเฉิน', isFinal: false, provider: 'gemini',
        role: 'translation', languageCode: 'th', turnId: 'gemini-1',
    });

    assert.equal(result.transcripts[0].translation, undefined);
    assert.deepEqual(result.transcripts[1].translation, translation);
});

test('bounds and expires pending translations', async () => {
    const module = await import('./transcriptMessages.ts');
    let pending = new Map();
    for (let index = 0; index < 65; index++) {
        const message = {
            type: 'transcript' as const, text: `แปล ${index}`, isFinal: false, provider: 'gemini',
            role: 'translation' as const, languageCode: 'th', turnId: `gemini-${index}`,
        };
        pending = module.storePendingTranslation(pending, message, 'agent-gemini', index);
    }
    assert.equal(pending.size, 64);
    assert.equal(pending.has('gemini:gemini-0'), false);

    const pruned = module.prunePendingTranslations(pending, 30_100);
    assert.equal(pruned.size, 0);
});

test('clears pending translations only for the disconnected agent', async () => {
    const module = await import('./transcriptMessages.ts');
    const pending = new Map([
        ['gemini:gemini-1', {
            message: {
                type: 'transcript' as const, text: 'แปลหนึ่ง', isFinal: false,
                role: 'translation' as const, provider: 'gemini', turnId: 'gemini-1',
            },
            sourceIdentity: 'agent-gemini-1',
            receivedAt: 1,
        }],
        ['gemini:gemini-2', {
            message: {
                type: 'transcript' as const, text: 'แปลสอง', isFinal: false,
                role: 'translation' as const, provider: 'gemini', turnId: 'gemini-2',
            },
            sourceIdentity: 'agent-gemini-2',
            receivedAt: 1,
        }],
    ]);

    const remaining = module.clearPendingTranslationsBySource(pending, 'agent-gemini-1');

    assert.deepEqual(Array.from(remaining.keys()), ['gemini:gemini-2']);
    assert.equal(remaining.get('gemini:gemini-2')?.sourceIdentity, 'agent-gemini-2');
});

test('updates and clears interim entries by key and source', async () => {
    const module = await import('./transcriptMessages.ts').catch(() => ({}));
    const upsert = 'upsertInterim' in module ? module.upsertInterim : () => new Map();
    const remove = 'removeInterim' in module ? module.removeInterim : () => new Map();
    const clearSource = 'clearInterimsBySource' in module ? module.clearInterimsBySource : () => new Map();

    let entries = new Map();
    entries = upsert(entries, {
        key: 'google', text: 'หนึ่ง', provider: 'google', sourceIdentity: 'agent-google',
    });
    entries = upsert(entries, {
        key: 'gemini:turn-1:source', text: 'สอง', provider: 'gemini',
        sourceIdentity: 'agent-gemini', turnId: 'turn-1',
    });
    entries = upsert(entries, {
        key: 'azure', text: 'สาม', provider: 'azure', sourceIdentity: 'agent-azure',
    });

    entries = remove(entries, 'google');
    assert.deepEqual(Array.from(entries.keys()), ['gemini:turn-1:source', 'azure']);

    entries = clearSource(entries, 'agent-gemini');
    assert.deepEqual(Array.from(entries.keys()), ['azure']);
});

test('creates one keyed Gemini draft and replaces its source revision', async () => {
    const module = await import('./transcriptMessages.ts');
    const exports = module as unknown as Record<string, unknown>;
    assert.equal(typeof exports.createInterimTranscript, 'function');
    const createInterim = exports.createInterimTranscript as (
        message: TranscriptMessage,
        sourceIdentity: string,
    ) => import('./transcriptMessages.ts').InterimTranscript;

    const first = createInterim({
        type: 'transcript', text: 'ประโยค', isFinal: false, role: 'source',
        provider: 'gemini', languageCode: 'th', turnId: 'gemini-1',
    }, 'agent-gemini');
    const revised = createInterim({
        type: 'transcript', text: 'ประโยคที่สมบูรณ์', isFinal: false, role: 'source',
        provider: 'gemini', languageCode: 'th', turnId: 'gemini-1',
    }, 'agent-gemini');

    let drafts = module.upsertInterim(new Map(), first);
    drafts = module.upsertInterim(drafts, revised);
    assert.equal(drafts.size, 1);
    assert.deepEqual(drafts.get(first.key), revised);
});

test('attaches Gemini translation to its matching draft and preserves it on source updates', async () => {
    const module = await import('./transcriptMessages.ts');
    const exports = module as unknown as Record<string, unknown>;
    assert.equal(typeof exports.createInterimTranscript, 'function');
    assert.equal(typeof exports.attachTranslationToInterims, 'function');
    const createInterim = exports.createInterimTranscript as (
        message: TranscriptMessage,
        sourceIdentity: string,
    ) => import('./transcriptMessages.ts').InterimTranscript;
    const attachDraftTranslation = exports.attachTranslationToInterims as (
        current: ReadonlyMap<string, import('./transcriptMessages.ts').InterimTranscript>,
        message: TranscriptMessage,
        sourceIdentity: string,
    ) => { interims: Map<string, import('./transcriptMessages.ts').InterimTranscript>; attached: boolean };

    const sourceMessage: TranscriptMessage = {
        type: 'transcript', text: 'สวัสดี', isFinal: false, role: 'source',
        provider: 'gemini', languageCode: 'th', turnId: 'gemini-1',
    };
    const draft = createInterim(sourceMessage, 'agent-gemini');
    const attached = attachDraftTranslation(new Map([[draft.key, draft]]), {
        type: 'transcript', text: 'Hello', isFinal: false, role: 'translation',
        provider: 'gemini', languageCode: 'en', turnId: 'gemini-1',
    }, 'agent-gemini');

    assert.equal(attached.attached, true);
    assert.deepEqual(attached.interims.get(draft.key)?.translation, {
        text: 'Hello', languageCode: 'en', isFinal: false,
    });

    const revised = createInterim({ ...sourceMessage, text: 'สวัสดีทุกคน' }, 'agent-gemini');
    const updated = module.upsertInterim(attached.interims, revised);
    assert.deepEqual(updated.get(draft.key)?.translation, {
        text: 'Hello', languageCode: 'en', isFinal: false,
    });
});

test('bounds active provider drafts', async () => {
    const module = await import('./transcriptMessages.ts');
    let drafts = new Map<string, import('./transcriptMessages.ts').InterimTranscript>();
    for (let index = 0; index < 70; index++) {
        drafts = module.upsertInterim(drafts, {
            key: `gemini:${index}:source`,
            text: `draft ${index}`,
            provider: 'gemini',

            sourceIdentity: 'agent-gemini',
            turnId: `${index}`,
        });
    }

    assert.equal(drafts.size, 64);
    assert.equal(drafts.has('gemini:0:source'), false);
    assert.equal(drafts.has('gemini:69:source'), true);
});

test('preserves draft row order when an existing key receives an update', async () => {
    const { upsertInterim } = await import('./transcriptMessages.ts');
    const first = {
        key: 'gemini:turn-1:source', text: 'first', provider: 'gemini',
        sourceIdentity: 'agent-gemini', turnId: 'turn-1',
    };
    const second = {
        key: 'gemini:turn-2:source', text: 'second', provider: 'gemini',
        sourceIdentity: 'agent-gemini', turnId: 'turn-2',
    };

    let drafts = upsertInterim(new Map(), first);
    drafts = upsertInterim(drafts, second);
    drafts = upsertInterim(drafts, { ...first, text: 'first updated' });

    assert.deepEqual(Array.from(drafts.keys()), [first.key, second.key]);
    assert.equal(drafts.get(first.key)?.text, 'first updated');
});

test('keeps Gemini interim chunks as separate transcript rows', async () => {
    const module = await import('./transcriptMessages.ts');
    const append = module.appendTranscriptIfNew;
    const isAppendOnly = module.isAppendOnlyInterimProvider;
    const first = { id: '1', text: 'ทดสอบ', isFinal: true, timestamp: 1, provider: 'gemini' };
    const second = { id: '2', text: 'เอาเด็กเท่านั้น', isFinal: true, timestamp: 2, provider: 'gemini' };

    assert.equal(isAppendOnly('gemini'), true);
    let rows = append([], first);
    rows = append(rows, second);
    assert.deepEqual(rows.map(row => row.text), ['ทดสอบ', 'เอาเด็กเท่านั้น']);
    const unchangedRows = append(rows, { ...second, id: '3' });
    assert.strictEqual(unchangedRows, rows);
});

test('updates one Gemini source row for cumulative chunks in the same turn', async () => {
    const module = await import('./transcriptMessages.ts');
    const first = {
        id: '1', text: 'useful. Very useful.', isFinal: true, timestamp: 1,
        provider: 'gemini', role: 'source' as const, turnId: 'gemini-1',
        translation: { text: 'มีประโยชน์มาก', languageCode: 'th', isFinal: false },
    };
    const second = {
        id: '2', text: 'useful. Very useful. Because off', isFinal: true, timestamp: 2,
        provider: 'gemini', role: 'source' as const, turnId: 'gemini-1',
    };

    let rows = module.appendTranscriptIfNew([], first);
    rows = module.appendTranscriptIfNew(rows, second);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, '1');
    assert.equal(rows[0].timestamp, 1);
    assert.equal(rows[0].text, second.text);
    assert.deepEqual(rows[0].translation, first.translation);
});

test('formats the translation language from the actual language code', async () => {
    const module = await import('./transcriptMessages.ts');

    assert.equal(module.formatLanguageLabel('th-TH'), 'th-TH');
    assert.equal(module.formatLanguageLabel('PT_br'), 'PT_br');
    assert.equal(module.formatLanguageLabel('zh-hans'), 'zh-hans');
    assert.equal(module.formatLanguageLabel('es'), 'es');
    assert.equal(module.formatLanguageLabel(''), '—');
});

test('marks a turn live while either its source or translation is unfinished', async () => {
    const module = await import('./transcriptMessages.ts');

    assert.equal(module.isTranscriptTurnLive({
        isFinal: true,
        translation: { text: 'Translating', languageCode: 'en', isFinal: false },
    }), true);
    assert.equal(module.isTranscriptTurnLive({
        isFinal: false,
        translation: { text: 'Translated', languageCode: 'en', isFinal: true },
    }), true);
    assert.equal(module.isTranscriptTurnLive({
        isFinal: false,
    }), true);
    assert.equal(module.isTranscriptTurnLive({
        isFinal: true,
        translation: { text: 'Translated', languageCode: 'en', isFinal: true },
    }), false);
});

test('preserves source finality when creating a committed display row', async () => {
    const module = await import('./transcriptMessages.ts');
    const message = {
        type: 'transcript' as const,
        text: 'still speaking',
        isFinal: false,
        role: 'source' as const,
        provider: 'gemini',
        turnId: 'gemini-1',
    };

    const segment = module.createCommittedTranscript('1', message, 'gemini');

    assert.equal(segment.isFinal, false);
});

test('keeps nearby finalized Thai chunks in separate display rows', async () => {
    const { groupFinalTranscriptRows } = await import('./transcriptMessages.ts');
    const grouped = groupFinalTranscriptRows([
        { id: '1', text: 'วันนี้เริ่มต้นบท', isFinal: true, timestamp: 1_000, provider: 'gemini', role: 'source' },
        { id: '2', text: 'เรียนเรื่องภาษาไทย', isFinal: true, timestamp: 2_200, provider: 'gemini', role: 'source' },
    ]);

    assert.deepEqual(grouped.map(row => row.text), [
        'วันนี้เริ่มต้นบท',
        'เรียนเรื่องภาษาไทย',
    ]);
});

test('keeps rows separate when their paired translations contain Thai text', async () => {
    const { groupFinalTranscriptRows } = await import('./transcriptMessages.ts');
    const grouped = groupFinalTranscriptRows([
        {
            id: '1', text: 'Hello', isFinal: true, timestamp: 1_000,
            provider: 'gemini', role: 'source', languageCode: 'en',
            translation: { text: 'สวัสดี', languageCode: 'th', isFinal: true },
        },
        {
            id: '2', text: 'everyone', isFinal: true, timestamp: 2_000,
            provider: 'gemini', role: 'source', languageCode: 'en',
            translation: { text: 'ทุกคน', languageCode: 'th', isFinal: true },
        },
    ]);

    assert.equal(grouped.length, 2);
});

test('keeps finalized rows separate across providers, punctuation, and long pauses', async () => {
    const { groupFinalTranscriptRows } = await import('./transcriptMessages.ts');
    const base = { isFinal: true, role: 'source' as const, languageCode: 'th' };
    const grouped = groupFinalTranscriptRows([
        { ...base, id: '1', text: 'ประโยคจบครับ', timestamp: 1_000, provider: 'gemini' },
        { ...base, id: '2', text: 'คนเดิมแต่พักนาน', timestamp: 4_000, provider: 'gemini' },
        { ...base, id: '3', text: 'คนละคน', timestamp: 4_500, provider: 'gemini' },
        { ...base, id: '4', text: 'คนละระบบ', timestamp: 4_700, provider: 'gpt-realtime-whisper' },
        { ...base, id: '5', text: 'จบด้วย punctuation.', timestamp: 5_000, provider: 'gpt-realtime-whisper' },
        { ...base, id: '6', text: 'ต้องขึ้นบรรทัดใหม่', timestamp: 5_300, provider: 'gpt-realtime-whisper' },
    ]);

    assert.deepEqual(grouped.map(row => row.text), [
        'ประโยคจบครับ',
        'คนเดิมแต่พักนาน',
        'คนละคน',
        'คนละระบบ',
        'จบด้วย punctuation.',
        'ต้องขึ้นบรรทัดใหม่',
    ]);
});

test('does not present a partial translation as covering a grouped source row', async () => {
    const { groupFinalTranscriptRows } = await import('./transcriptMessages.ts');
    const grouped = groupFinalTranscriptRows([
        {
            id: '1', text: 'hello', isFinal: true, timestamp: 1_000, provider: 'gemini', role: 'source',
            translation: { text: 'สวัสดี', languageCode: 'th', isFinal: true },
        },
        { id: '2', text: 'everyone', isFinal: true, timestamp: 2_000, provider: 'gemini', role: 'source' },
    ]);

    assert.equal(grouped.length, 2);
    assert.deepEqual(grouped[0].translation, { text: 'สวัสดี', languageCode: 'th', isFinal: true });
    assert.equal(grouped[1].translation, undefined);
});

test('normalizes API language codes for HTML lang attributes', async () => {
    const module = await import('./transcriptMessages.ts');

    assert.equal(module.normalizeLanguageTag('en_US'), 'en-US');
    assert.equal(module.normalizeLanguageTag('TH-th'), 'th-TH');
    assert.equal(module.normalizeLanguageTag('not a language'), undefined);
    assert.equal(module.normalizeLanguageTag(''), undefined);
});

test('sticks to latest only while the viewport is near the bottom', async () => {
    const module = await import('./transcriptViewport.ts').catch(() => ({}));
    const shouldStick = 'shouldStickToLatest' in module ? module.shouldStickToLatest : () => false;

    assert.equal(shouldStick({ scrollTop: 650, clientHeight: 300, scrollHeight: 1000 }), true);
    assert.equal(shouldStick({ scrollTop: 300, clientHeight: 300, scrollHeight: 1000 }), false);
});
