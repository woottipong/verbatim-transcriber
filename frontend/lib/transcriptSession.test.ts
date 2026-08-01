import assert from 'node:assert/strict';
import test from 'node:test';
import { TranscriptSession } from './transcriptSession.ts';

function payload(message: Record<string, unknown>): Uint8Array {
    return new TextEncoder().encode(JSON.stringify({ type: 'transcript', role: 'source', ...message }));
}

function createSession(idPrefix = 'test') {
    const scheduled = new Map<number, () => void>();
    const delays: number[] = [];
    let timerId = 0;
    const session = new TranscriptSession({
        idPrefix,
        schedule: (callback, delayMs) => {
            delays.push(delayMs);
            scheduled.set(++timerId, callback);
            return timerId;
        },
        cancel: id => scheduled.delete(id),
    });
    const flushNext = () => {
        const next = scheduled.entries().next().value as [number, () => void] | undefined;
        if (!next) return;
        scheduled.delete(next[0]);
        next[1]();
    };
    return { session, flushNext, delays };
}

test('coalesces Google interim revisions at 80 ms through the shared session', () => {
    const { session, flushNext, delays } = createSession();
    let notifications = 0;
    session.subscribe(() => notifications++);

    session.ingest(payload({
        text: 'ผู้ป่วย', isFinal: false, provider: 'google', segmentId: 'google-1',
    }), 'agent-google');
    session.ingest(payload({
        text: 'ผู้ป่วยมีอาการ', isFinal: false, provider: 'google', segmentId: 'google-1',
    }), 'agent-google');
    session.ingest(payload({
        text: 'ผู้ป่วยมีอาการเจ็บหน้าอก', isFinal: false, provider: 'google', segmentId: 'google-1',
    }), 'agent-google');

    assert.equal(notifications, 1);
    assert.deepEqual(delays, [80]);
    assert.equal(session.getSnapshot().interimTranscripts.values().next().value?.text, 'ผู้ป่วย');
    flushNext();
    assert.equal(notifications, 2);
    assert.equal(session.getSnapshot().interimTranscripts.values().next().value?.text, 'ผู้ป่วยมีอาการเจ็บหน้าอก');
});

test('ignores a delayed lossy interim after a reliable final', () => {
    const { session, flushNext } = createSession();

    session.ingest(payload({
        text: 'ผู้ป่วย', isFinal: false, provider: 'google', sequence: 1,
    }), 'agent-google');
    session.ingest(payload({
        text: 'ผู้ป่วยมีอาการเจ็บหน้าอก', isFinal: true, provider: 'google', sequence: 3,
    }), 'agent-google');
    session.ingest(payload({
        text: 'ผู้ป่วยมีอาการ', isFinal: false, provider: 'google', sequence: 2,
    }), 'agent-google');
    flushNext();

    const snapshot = session.getSnapshot();
    assert.deepEqual(snapshot.transcripts.map(segment => segment.text), ['ผู้ป่วยมีอาการเจ็บหน้าอก']);
    assert.equal(snapshot.interimTranscripts.size, 0);
});

test('keeps approved publications out of the raw transcript', () => {
    const { session } = createSession();
    const approved = payload({
        text: 'ตรวจแล้ว', isFinal: true, provider: 'google', publicationId: 'publication-1',
    });
    session.ingest(approved, 'agent-google');
    session.ingest(approved, 'agent-google');
    session.ingest(payload({ text: 'สดเดิม', isFinal: true, provider: 'google' }), 'agent-google');
    assert.deepEqual(session.getSnapshot().transcripts.map(item => item.text), ['สดเดิม']);
});

test('accepts every approved public caption as display-ready text regardless of isFinal', () => {
    const { session } = createSession('desk');

    session.ingest(payload({
        text: 'ข้อความที่ตรวจแล้ว', isFinal: false, provider: 'google',
        publicationId: 'publication-1', timestamp: 1_000,
    }), 'agent-google', { publicCaptionMode: true });

    assert.deepEqual(session.getSnapshot().transcripts, [{
        id: 'desk-1',
        text: 'ข้อความที่ตรวจแล้ว',
        isFinal: true,
        timestamp: 1_000,
        provider: 'caption-desk',
        role: 'source',
        segmentId: 'publication-1',
    }]);
});

test('accepts an approved public caption when isFinal is omitted', () => {
    const { session } = createSession('desk');

    session.ingest(payload({
        text: 'เผยแพร่แล้ว', provider: 'azure',
        publicationId: 'publication-2', timestamp: 2_000,
    }), 'agent-azure', { publicCaptionMode: true });

    assert.deepEqual(session.getSnapshot().transcripts.map(item => item.text), ['เผยแพร่แล้ว']);
});

test('deduplicates approved public captions by publicationId', () => {
    const { session } = createSession('desk');
    const approved = payload({
        text: 'แสดงครั้งเดียว', isFinal: false, provider: 'gemini',
        publicationId: 'publication-1', timestamp: 1_000,
    });

    session.ingest(approved, 'agent-gemini', { publicCaptionMode: true });
    session.ingest(approved, 'agent-gemini', { publicCaptionMode: true });

    assert.deepEqual(session.getSnapshot().transcripts.map(item => item.text), ['แสดงครั้งเดียว']);
});

test('rejects ordinary provider packets from the public caption session', () => {
    const { session } = createSession('desk');

    session.ingest(payload({
        text: 'ข้อความดิบ', isFinal: true, provider: 'google', timestamp: 1_000,
    }), 'agent-google', { publicCaptionMode: true });

    assert.equal(session.getSnapshot().transcripts.length, 0);
});

test('ignores a delayed Gemini translation draft after its final translation', () => {
    const { session } = createSession();

    session.ingest(payload({
        text: 'ผู้ป่วยมีอาการเจ็บหน้าอก', isFinal: true, provider: 'gemini',
        role: 'source', turnId: 'turn-1', languageCode: 'th', sequence: 1,
    }), 'agent-gemini');
    session.ingest(payload({
        text: 'Patient has chest pain', isFinal: true, provider: 'gemini',
        role: 'translation', turnId: 'turn-1', languageCode: 'en', sequence: 3,
    }), 'agent-gemini');
    session.ingest(payload({
        text: 'Patient has pain', isFinal: false, provider: 'gemini',
        role: 'translation', turnId: 'turn-1', languageCode: 'en', sequence: 2,
    }), 'agent-gemini');

    assert.deepEqual(session.getSnapshot().transcripts[0].translation, {
        text: 'Patient has chest pain',
        languageCode: 'en',
        isFinal: true,
    });
});

test('bounds packet-order watermarks for long-running Gemini sessions', () => {
    const { session } = createSession();

    for (let index = 1; index <= 300; index++) {
        session.ingest(payload({
            text: `turn ${index}`,
            isFinal: true,
            provider: 'gemini',
            turnId: `turn-${index}`,
            sequence: index,
        }), 'agent-gemini');
    }

    const ordering = (session as unknown as {
        latestPacketByKey: Map<string, unknown>;
    }).latestPacketByKey;
    assert.equal(ordering.size, 256);
    assert.equal(ordering.has('gemini:turn-1:source'), false);
    assert.equal(ordering.has('gemini:turn-300:source'), true);
});

test('pairs a Gemini translation received before its source and commits one row', () => {
    const { session } = createSession('view');
    session.ingest(payload({
        text: 'Patient has chest pain', isFinal: true, role: 'translation',
        provider: 'gemini', turnId: 'turn-1', languageCode: 'en',
    }), 'agent-gemini');
    session.ingest(payload({
        text: 'ผู้ป่วยมีอาการเจ็บหน้าอก', isFinal: true,
        provider: 'gemini', turnId: 'turn-1', languageCode: 'th',
    }), 'agent-gemini');

    const snapshot = session.getSnapshot();
    assert.equal(snapshot.transcripts.length, 1);
    assert.equal(snapshot.transcripts[0].id, 'view-1');
    assert.equal(snapshot.transcripts[0].translation?.text, 'Patient has chest pain');
    assert.equal(snapshot.interimTranscripts.size, 0);
});

test('uses the caller provider adapter and reports explicit provider observations', () => {
    const { session } = createSession();
    const observed: Array<[string, string]> = [];
    session.ingest(
        payload({ text: 'ทดสอบ', isFinal: false }),
        'agent-azure',
        {
            resolveProvider: () => 'azure',
            onProviderObserved: (source, provider) => observed.push([source, provider]),
        },
    );
    assert.equal(session.getSnapshot().interimTranscripts.values().next().value?.provider, 'azure');
    assert.deepEqual(observed, []);

    session.ingest(
        payload({ text: 'ทดสอบอีกครั้ง', isFinal: false, provider: 'azure' }),
        'agent-azure',
        { onProviderObserved: (source, provider) => observed.push([source, provider]) },
    );
    assert.deepEqual(observed, [['agent-azure', 'azure']]);
});

test('removes only transient state for a disconnected source and can clear the full session', () => {
    const { session, flushNext } = createSession();
    session.ingest(payload({ text: 'หนึ่ง', isFinal: false, provider: 'google' }), 'agent-google');
    session.ingest(payload({ text: 'สอง', isFinal: false, provider: 'azure' }), 'agent-azure');
    flushNext();
    assert.equal(session.getSnapshot().interimTranscripts.size, 2);

    session.removeSource('agent-google');
    assert.deepEqual(
        Array.from(session.getSnapshot().interimTranscripts.values()).map(item => item.provider),
        ['azure'],
    );

    session.reset(true);
    assert.equal(session.getSnapshot().transcripts.length, 0);
    assert.equal(session.getSnapshot().interimTranscripts.size, 0);
});
