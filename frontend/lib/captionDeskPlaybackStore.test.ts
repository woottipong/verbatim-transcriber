import assert from 'node:assert/strict';
import test from 'node:test';
import { createCaptionDeskPlaybackStore } from './captionDeskPlaybackStore.ts';

const immediateClock = {
    requestFrame: (_callback: (now: number) => void) => 1,
    cancelFrame: (_frameId: number) => undefined,
    now: () => 0,
    prefersReducedMotion: () => true,
};

function createAdvancingClock() {
    let now = 0;
    let nextFrameId = 0;
    const frames = new Map<number, (time: number) => void>();
    return {
        clock: {
            requestFrame(callback: (time: number) => void) {
                nextFrameId += 1;
                frames.set(nextFrameId, callback);
                return nextFrameId;
            },
            cancelFrame(frameId: number) {
                frames.delete(frameId);
            },
            now: () => now,
            prefersReducedMotion: () => false,
        },
        advance(milliseconds: number) {
            const end = now + milliseconds;
            while (now < end) {
                now = Math.min(end, now + 40);
                const pending = [...frames.values()];
                frames.clear();
                pending.forEach(callback => callback(now));
            }
        },
        step(milliseconds: number) {
            now += milliseconds;
            const pending = [...frames.values()];
            frames.clear();
            pending.forEach(callback => callback(now));
        },
    };
}

test('keeps queued captions when the source is temporarily inactive', () => {
    const store = createCaptionDeskPlaybackStore(immediateClock);
    store.setActive(true);
    store.enqueue({ id: 'p1', text: 'หนึ่ง' });
    store.setActive(false);
    store.enqueue({ id: 'p2', text: 'สอง' });

    assert.equal(store.getSnapshot(), 'หนึ่ง');
    assert.equal(store.hasPendingText(), true);

    store.setActive(true);
    assert.equal(store.getSnapshot(), 'หนึ่งสอง');
    assert.equal(store.hasPendingText(), false);
});

test('keeps a completed final cue visible until new text arrives', () => {
    const store = createCaptionDeskPlaybackStore(immediateClock);
    store.setActive(true);
    store.enqueue({ id: 'p1', text: 'หนึ่ง' });
    assert.equal(store.completeCue(), false);

    assert.equal(store.getSnapshot(), 'หนึ่ง');

    store.enqueue({ id: 'p2', text: 'สอง' });
    assert.equal(store.getSnapshot(), 'หนึ่งสอง');
});

test('continues a later publication in the active cue while capacity remains', () => {
    const store = createCaptionDeskPlaybackStore(immediateClock);
    store.setActive(true);
    store.enqueue({ id: 'p1', text: 'บรรทัดแรก' });
    assert.equal(store.completeCue(), false);

    store.enqueue({ id: 'p2', text: 'บรรทัดถัดไป' });

    assert.equal(store.getSnapshot(), 'บรรทัดแรกบรรทัดถัดไป');
    assert.equal(store.hasPendingText(), false);
});

test('advances to queued text without publishing an empty frame', () => {
    const store = createCaptionDeskPlaybackStore(immediateClock);
    const snapshots: string[] = [];
    store.subscribe(() => snapshots.push(store.getSnapshot()));
    store.setActive(true);
    store.enqueue({ id: 'burst', text: 'ก'.repeat(4_120) });
    snapshots.length = 0;

    assert.equal(store.completeCue(), true);

    assert.equal(snapshots.includes(''), false);
    assert.equal(store.getSnapshot(), 'ก'.repeat(70));
});

test('reports every bounded cue advance until the queue is exhausted', () => {
    const store = createCaptionDeskPlaybackStore(immediateClock);
    store.setActive(true);
    store.enqueue({ id: 'burst', text: 'ก'.repeat(4_120) });

    let advances = 0;
    while (store.completeCue()) advances += 1;

    assert.equal(advances, 58);
    assert.equal(store.getSnapshot(), 'ก'.repeat(60));
    assert.equal(store.completeCue(), false);
});

test('clear removes both visible and queued captions', () => {
    const store = createCaptionDeskPlaybackStore(immediateClock);
    store.enqueue({ id: 'p1', text: 'หนึ่ง' });
    store.clear();
    store.setActive(true);

    assert.equal(store.getSnapshot(), '');
    assert.equal(store.hasContent(), false);
});

test('releases a long burst as bounded cues without losing text', () => {
    const store = createCaptionDeskPlaybackStore(immediateClock);
    const source = 'ก'.repeat(8_220);
    const displayed: string[] = [];
    store.setActive(true);
    store.enqueue({ id: 'burst', text: source });

    while (store.hasPendingText()) {
        displayed.push(store.getSnapshot());
        assert.ok(Array.from(store.getSnapshot()).length <= 280);
        store.completeCue();
    }
    displayed.push(store.getSnapshot());

    assert.equal(displayed.join(''), source);
});

test('continues releasing a long publication without waiting for cue completion', () => {
    const { clock, advance } = createAdvancingClock();
    const store = createCaptionDeskPlaybackStore(clock);
    const source = Array.from({ length: 420 }, (_, index) => String.fromCodePoint(0x4e00 + index)).join('');
    store.setPlaybackRate(20 / 17);
    store.setActive(true);
    store.enqueue({ id: 'long-publication', text: source });

    advance(21_500);

    assert.equal(store.hasPendingText(), false);
    assert.ok(store.getSnapshot().length <= 280);
    assert.ok(source.endsWith(store.getSnapshot()));
});

test('preserves elapsed reveal progress when a delayed frame crosses the rolling boundary', () => {
    const { clock, step } = createAdvancingClock();
    const store = createCaptionDeskPlaybackStore(clock);
    store.setPlaybackRate(20 / 17);
    store.setActive(true);
    store.enqueue({ id: 'delayed-frame', text: 'ก'.repeat(500) });

    for (let index = 0; index < 279; index += 1) step(50);
    assert.equal(Array.from(store.getSnapshot()).length, 279);

    step(500);

    assert.equal(Array.from(store.getSnapshot()).length, 79);
});

test('shows every reduced-motion publication in discrete readable windows', () => {
    const store = createCaptionDeskPlaybackStore(immediateClock);
    const source = Array.from({ length: 420 }, (_, index) => String.fromCodePoint(0x4e00 + index)).join('');
    const displayed: string[] = [];
    store.setActive(true);
    store.enqueue({ id: 'reduced-motion', text: source });

    while (store.hasPendingText()) {
        displayed.push(store.getSnapshot());
        assert.ok(Array.from(store.getSnapshot()).length <= 70);
        store.completeCue();
    }
    displayed.push(store.getSnapshot());

    assert.equal(displayed.join(''), source);
});

test('keeps later reduced-motion publications within the active two-line window', () => {
    const store = createCaptionDeskPlaybackStore(immediateClock);
    store.setActive(true);
    store.enqueue({ id: 'first', text: 'ก'.repeat(50) });
    store.enqueue({ id: 'second', text: 'ข'.repeat(40) });

    assert.equal(store.getSnapshot(), `${'ก'.repeat(50)}${'ข'.repeat(20)}`);
    assert.equal(store.getPendingGraphemeCount(), 20);
});

test('reports the queued cue count and an exact pending preview', () => {
    const { clock } = createAdvancingClock();
    const store = createCaptionDeskPlaybackStore(clock);
    store.enqueue({ id: 'burst', text: `ก${'ข'.repeat(4_100)}\nค` });

    assert.equal(store.getPendingGraphemeCount(), 4_103);
    assert.equal(store.getPendingCueCount(), 20);
    assert.equal(store.getPendingPreview(), `ก${'ข'.repeat(47)}`);
});

test('counts pending text that fits the initial active capacity as one cue', () => {
    const { clock } = createAdvancingClock();
    const store = createCaptionDeskPlaybackStore(clock);
    store.enqueue({ id: 'one-cue', text: 'ก'.repeat(220) });

    assert.equal(store.getPendingCueCount(), 1);
});
