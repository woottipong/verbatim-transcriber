import assert from 'node:assert/strict';
import test from 'node:test';
import {
    alignSubtitlePagePairs,
    calculateSubtitleIdleTimeoutMs,
    calculateSubtitlePageDurationMs,
    countSubtitleCharacters,
    resolveSubtitlePageIndex,
    splitSubtitleTextByFit,
} from './subtitlePaging.ts';

test('counts Thai combining marks as part of one visible character', () => {
    assert.equal(countSubtitleCharacters('ก้า'), 2);
    assert.equal(countSubtitleCharacters('สวัสดี'), 4);
});

test('splits Thai text without losing or duplicating graphemes', () => {
    const text = 'ทุกอย่างที่เชื่อมต่อกันจะถูกแสดงเป็นข้อมูลสดของบริษัทเรา';
    const pages = splitSubtitleTextByFit(text, candidate => countSubtitleCharacters(candidate) <= 18, 'th');

    assert.ok(pages.length > 1);
    assert.ok(pages.every(page => countSubtitleCharacters(page) <= 18));
    assert.equal(pages.join(''), text);
});

test('breaks Thai at word boundaries before falling back to graphemes', () => {
    const text = 'ประเทศไทยมีข้อมูลสดสำหรับผู้ชม';
    const pages = splitSubtitleTextByFit(text, candidate => countSubtitleCharacters(candidate) <= 12, 'th');

    const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
    const boundaries = new Set(Array.from(segmenter.segment(text), part => part.index + part.segment.length));
    let consumed = 0;
    pages.slice(0, -1).forEach(page => {
        consumed += page.length;
        assert.equal(boundaries.has(consumed), true, `expected a Thai word boundary after ${page}`);
    });
    assert.ok(pages.every(page => countSubtitleCharacters(page) <= 12));
    assert.equal(pages.join(''), text);
});

test('prefers natural English word boundaries while preserving all text', () => {
    const text = 'Everything that is interconnected will use live company data.';
    const pages = splitSubtitleTextByFit(text, candidate => candidate.length <= 24);

    assert.ok(pages.every(page => page.length <= 24));
    assert.equal(pages.join(' '), text);
});

test('uses reading speed with professional minimum and maximum page durations', () => {
    assert.equal(calculateSubtitlePageDurationMs('สั้น'), 2_000);
    assert.equal(calculateSubtitlePageDurationMs('a'.repeat(34)), 2_000);
    assert.equal(calculateSubtitlePageDurationMs('a'.repeat(68)), 4_000);
    assert.equal(calculateSubtitlePageDurationMs('a'.repeat(200)), 6_800);
});

test('uses the slower of source and translation reading times', () => {
    assert.equal(calculateSubtitlePageDurationMs('สั้น', 'a'.repeat(51)), 3_000);
});

test('keeps idle text visible long enough to finish the current page', () => {
    assert.equal(calculateSubtitleIdleTimeoutMs(2_000), 5_000);
    assert.equal(calculateSubtitleIdleTimeoutMs(6_800), 7_000);
});

test('keeps draft and finalized revisions on the current cue instead of replaying page one', () => {
    assert.equal(resolveSubtitlePageIndex({ previousIndex: 0, pageCount: 3, isDraft: true, isSameCue: true }), 2);
    assert.equal(resolveSubtitlePageIndex({ previousIndex: 2, pageCount: 3, isDraft: false, isSameCue: true }), 2);
    assert.equal(resolveSubtitlePageIndex({ previousIndex: 1, pageCount: 2, isDraft: false, isSameCue: true }), 1);
    assert.equal(resolveSubtitlePageIndex({ previousIndex: 2, pageCount: 3, isDraft: false, isSameCue: false }), 0);
});

test('keeps bilingual cue pages synchronized without emptying the shorter side', () => {
    assert.deepEqual(
        alignSubtitlePagePairs(['ต้นฉบับช่วงแรก', 'ต้นฉบับช่วงท้าย'], ['first', 'middle', 'last']),
        [
            { sourceText: 'ต้นฉบับช่วงแรก', translationText: 'first' },
            { sourceText: 'ต้นฉบับช่วงท้าย', translationText: 'middle' },
            { sourceText: 'ต้นฉบับช่วงท้าย', translationText: 'last' },
        ],
    );
    assert.deepEqual(
        alignSubtitlePagePairs(['ข้อความเดียว'], ['translation one', 'translation two']),
        [
            { sourceText: 'ข้อความเดียว', translationText: 'translation one' },
            { sourceText: 'ข้อความเดียว', translationText: 'translation two' },
        ],
    );
});
