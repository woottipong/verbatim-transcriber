import assert from 'node:assert/strict';
import test from 'node:test';
import { TranscriptUpdateBuffer } from './transcriptUpdates.ts';

test('buffers rapid transcript updates so each interim snapshot is delivered', () => {
    const scheduled: Array<() => void> = [];
    const delivered: string[] = [];
    const buffer = new TranscriptUpdateBuffer<{ text: string }>(
        update => delivered.push(update.text),
        50,
        callback => {
            scheduled.push(callback);
            return scheduled.length;
        },
        () => undefined
    );

    buffer.push({ text: 'ทด' });
    buffer.push({ text: 'ทดสอบ' });
    buffer.push({ text: 'ทดสอบข้อความ' });

    assert.deepEqual(delivered, ['ทด']);
    scheduled.shift()?.();
    assert.deepEqual(delivered, ['ทด', 'ทดสอบ']);
    scheduled.shift()?.();
    assert.deepEqual(delivered, ['ทด', 'ทดสอบ', 'ทดสอบข้อความ']);
});
