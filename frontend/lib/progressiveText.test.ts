import assert from 'node:assert/strict';
import test from 'node:test';
import * as progressiveText from './progressiveText.ts';
import {
    completeVisibleCaption,
    createCaptionPlaybackState,
    enqueueCaptionPublications,
    getVisibleCaptionText,
    progressiveRevealRate,
    reconcileProgressiveTarget,
    revealCaptionGraphemes,
    splitTextGraphemes,
    splitTextGraphemesFallback,
    synchronizeTranslationTarget,
} from './progressiveText.ts';

test('starts a replacement cue without publishing an empty frame', () => {
    assert.equal(reconcileProgressiveTarget('ข้อความเดิม', 'ประโยคใหม่', true), 'ป');
});

test('keeps visible progress when an interim becomes a corrected final', () => {
    const interim = 'วันนี้เราจะมาพูดถึงการทำคำบรรยายสดให้ผู้ชมอ่านได้ต่อเนื่อง';
    const visible = 'วันนี้เราจะมาพูดถึงการทำคำบรรยายสด';
    const final = 'วันนี้เราจะพูดถึงการทำคำบรรยายสดให้ผู้ชมอ่านอย่างต่อเนื่อง';

    assert.equal(
        reconcileProgressiveTarget(visible, final, true, interim),
        splitTextGraphemes(final).slice(0, splitTextGraphemes(visible).length).join(''),
    );
});

test('continues from the retained final when the rolling cue drops its oldest text', () => {
    const previousTarget = 'ประโยคก่อนหน้า ข้อความที่อ่านจบแล้ว';
    const visible = 'ประโยคก่อนหน้า ข้อความที่อ่านจบแล้ว';
    const nextTarget = 'ข้อความที่อ่านจบแล้ว ข้อความใหม่กำลังเข้ามา';

    assert.equal(
        reconcileProgressiveTarget(visible, nextTarget, true, previousTarget),
        'ข้อความที่อ่านจบแล้ว',
    );
});

test('requests a roll only when a new cue retains the previous tail', () => {
    const shouldRoll = (progressiveText as typeof progressiveText & {
        shouldRollProgressiveTarget?: (previous: string, next: string) => boolean;
    }).shouldRollProgressiveTarget;

    assert.equal(shouldRoll?.('ประโยคก่อนหน้า ข้อความที่อ่านจบแล้ว', 'ข้อความที่อ่านจบแล้ว ข้อความใหม่') ?? false, true);
    assert.equal(shouldRoll?.('ข้อความกำลังมา', 'ข้อความกำลังมาต่อ') ?? false, false);
    assert.equal(shouldRoll?.('ข้อความเดิม', 'ประโยคใหม่') ?? false, false);
});

test('caps live translation progress at the visible source progress', () => {
    assert.equal(synchronizeTranslationTarget('12345', '1234567890', 'abcdefghij'), 'abcde');
    assert.equal(synchronizeTranslationTarget('1234567890', '1234567890', 'abcdefghij'), 'abcdefghij');
});

test('keeps Thai combining marks attached during progressive reveal', () => {
    const text = 'น้ำเสียง';
    assert.equal(splitTextGraphemes(text).join(''), text);
    assert.equal(splitTextGraphemes('น้ำ')[0], 'น้ำ');
    assert.equal(splitTextGraphemesFallback('น้ำ')[0], 'น้ำ');
});

test('queues every publication in order and preserves whitespace exactly', () => {
    let state = createCaptionPlaybackState();
    state = enqueueCaptionPublications(state, [
        { id: 'p1', text: '  หนึ่ง\n' },
        { id: 'p2', text: '  สอง  ' },
        { id: 'p1', text: 'ซ้ำ' },
    ]);

    state = revealCaptionGraphemes(state, 10_000);
    assert.equal(getVisibleCaptionText(state), '  หนึ่ง\n  สอง  ');
});

test('reveals queued text incrementally and releases consumed graphemes', () => {
    let state = enqueueCaptionPublications(createCaptionPlaybackState(), [
        { id: 'p1', text: 'abcd' },
        { id: 'p2', text: 'efgh' },
    ]);
    state = revealCaptionGraphemes(state, 3);
    assert.equal(getVisibleCaptionText(state), 'abc');
    assert.equal(state.pendingGraphemeCount, 5);
    state = revealCaptionGraphemes(state, 5);
    assert.equal(getVisibleCaptionText(state), 'abcdefgh');
    assert.equal(state.pendingGraphemeCount, 0);
});

test('uses the selected Thai reading speed without accelerating queued text past the SDH limit', () => {
    assert.equal(progressiveRevealRate(20), 17);
    assert.equal(progressiveRevealRate(121), 17);
    assert.equal(progressiveRevealRate(20, 10 / 17), 10);
    assert.equal(progressiveRevealRate(20, 0.25), 10);
    assert.equal(progressiveRevealRate(121, 1.18), 20);
});

test('bounds the active cue without dropping queued text', () => {
    let state = enqueueCaptionPublications(createCaptionPlaybackState(), [
        { id: 'p1', text: 'abcdefgh' },
    ]);

    state = revealCaptionGraphemes(state, 100, 4);
    assert.equal(getVisibleCaptionText(state), 'abcd');
    assert.equal(state.pendingGraphemeCount, 4);

    state = completeVisibleCaption(state);
    state = revealCaptionGraphemes(state, 100, 4);
    assert.equal(getVisibleCaptionText(state), 'efgh');
    assert.equal(state.pendingGraphemeCount, 0);
});

test('keeps publication order across multiple bounded cues', () => {
    let state = enqueueCaptionPublications(createCaptionPlaybackState(), [
        { id: 'p1', text: 'หนึ่ง' },
        { id: 'p2', text: 'สอง' },
        { id: 'p3', text: 'สาม' },
    ]);
    const displayed: string[] = [];

    while (state.pendingGraphemeCount > 0) {
        state = revealCaptionGraphemes(state, 100, 5);
        displayed.push(getVisibleCaptionText(state));
        state = completeVisibleCaption(state);
    }

    assert.equal(displayed.join(''), 'หนึ่งสองสาม');
});
