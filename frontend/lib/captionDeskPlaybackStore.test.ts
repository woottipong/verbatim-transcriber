import assert from 'node:assert/strict';
import test from 'node:test';
import { createCaptionDeskPlaybackStore } from './captionDeskPlaybackStore.ts';

const immediateClock = {
    requestFrame: (_callback: (now: number) => void) => 1,
    cancelFrame: (_frameId: number) => undefined,
    now: () => 0,
    prefersReducedMotion: () => true,
};

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
    assert.equal(store.getSnapshot(), 'ก'.repeat(280));
});

test('reports every bounded cue advance until the queue is exhausted', () => {
    const store = createCaptionDeskPlaybackStore(immediateClock);
    store.setActive(true);
    store.enqueue({ id: 'burst', text: 'ก'.repeat(4_120) });

    let advances = 0;
    while (store.completeCue()) advances += 1;

    assert.equal(advances, 14);
    assert.equal(store.getSnapshot(), 'ก'.repeat(200));
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

test('reports the queued cue count and an exact pending preview', () => {
    const store = createCaptionDeskPlaybackStore(immediateClock);
    store.setActive(true);
    store.enqueue({ id: 'burst', text: `ก${'ข'.repeat(4_100)}\nค` });

    assert.equal(store.getPendingGraphemeCount(), 3_823);
    assert.equal(store.getPendingCueCount(), 14);
    assert.equal(store.getPendingPreview(), 'ข'.repeat(48));
});
