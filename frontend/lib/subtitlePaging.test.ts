import assert from 'node:assert/strict';
import test from 'node:test';
import {
    alignSubtitlePagePairs,
    calculateSubtitleIdleTimeoutMs,
    calculateSubtitlePageDurationMs,
    countSubtitleLineCharacters,
    fitsNbtcCaptionLine,
    calculateQueuedSubtitlePageDurationMs,
    countSubtitleCharacters,
    resolveSubtitlePageIndex,
    splitSubtitleTextByFit,
    splitSubtitleTextIntoLines,
    splitSubtitleTextIntoRollingWindows,
} from './subtitlePaging.ts';

test('counts Thai grapheme clusters for the NBTC 35-character line limit', () => {
    assert.equal(countSubtitleLineCharacters('น้ำ'), 1);
    assert.equal(countSubtitleLineCharacters('ก ข'), 3);
    assert.equal(countSubtitleLineCharacters('a'.repeat(35)), 35);
    assert.equal(fitsNbtcCaptionLine('a'.repeat(35)), true);
    assert.equal(fitsNbtcCaptionLine('a'.repeat(36)), false);
});

test('splits long captions without exceeding the NBTC line limit or losing text', () => {
    const text = 'ประเทศไทยกำลังพัฒนาระบบคำบรรยายสดเพื่อให้ประชาชนเข้าถึงข้อมูลได้อย่างเท่าเทียมและต่อเนื่อง';
    const lines = splitSubtitleTextIntoLines(text, fitsNbtcCaptionLine, 'th');

    assert.equal(lines.every(line => countSubtitleLineCharacters(line.text) <= 35), true);
    assert.equal(lines.map(line => line.text + line.separatorAfter).join(''), text);
});


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

test('rolls subtitle text forward one line at a time without dropping the previous line', () => {
    const windows = splitSubtitleTextIntoRollingWindows(
        'first line second line third line fourth line',
        candidate => candidate.length <= 11,
    );

    assert.deepEqual(windows, [
        'first line',
        'first line second line',
        'second line third line',
        'third line fourth line',
    ]);
});

test('rolls Thai text without inventing spaces between Thai fragments', () => {
    const text = 'ข้อความบรรทัดแรกข้อความบรรทัดสองข้อความบรรทัดสาม';
    const windows = splitSubtitleTextIntoRollingWindows(
        text,
        candidate => countSubtitleCharacters(candidate) <= 12,
        'th',
    );

    assert.ok(windows.length >= 3);
    assert.equal(windows.some(window => /[ก-๙] [ก-๙]/u.test(window)), false);
});

test('exposes line fragments without losing their original separators', () => {
    const fragments = splitSubtitleTextIntoLines(
        'first line second line third line',
        candidate => candidate.length <= 11,
    );

    assert.deepEqual(fragments, [
        { text: 'first line', separatorAfter: ' ' },
        { text: 'second line', separatorAfter: ' ' },
        { text: 'third line', separatorAfter: '' },
    ]);
});

test('preserves every whitespace character in verbatim subtitle mode', () => {
    const text = '  บรรทัดแรก\nบรรทัด  ถัดไป  ';
    const fragments = splitSubtitleTextIntoLines(
        text,
        candidate => candidate.length <= 12,
        'th',
        true,
    );

    assert.equal(
        fragments.map(fragment => fragment.text + fragment.separatorAfter).join(''),
        text,
    );
});

test('keeps explicit newlines in verbatim rolling windows', () => {
    const windows = splitSubtitleTextIntoRollingWindows(
        'หนึ่ง\n  สอง',
        candidate => candidate.length <= 20,
        'th',
        true,
    );

    assert.equal(windows.at(-1), 'หนึ่ง\n  สอง');
});

test('preserves every Thai grapheme across caption pages', () => {
    const text = 'ผู้ชมกำลังอ่านข้อความที่แสดงอย่างต่อเนื่อง';
    const fragments = splitSubtitleTextIntoLines(
        text,
        candidate => countSubtitleCharacters(candidate) <= 9,
        'th',
    );

    assert.equal(fragments.map(fragment => fragment.text + fragment.separatorAfter).join(''), text);
    assert.equal(fragments.every(fragment => countSubtitleCharacters(fragment.text) <= 9), true);
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

test('advances long pages promptly while queued captions are waiting', () => {
    assert.equal(calculateQueuedSubtitlePageDurationMs('a'.repeat(200), '', true), 1_800);
    assert.equal(calculateQueuedSubtitlePageDurationMs('a'.repeat(200), '', false), 6_800);
    assert.equal(calculateQueuedSubtitlePageDurationMs('short', '', true), 900);
});

test('keeps idle text visible long enough to finish the current page', () => {
    assert.equal(calculateSubtitleIdleTimeoutMs(2_000), 5_000);
    assert.equal(calculateSubtitleIdleTimeoutMs(6_800), 7_000);
});

test('starts long drafts at the beginning and advances without jumping to the tail', () => {
    assert.equal(resolveSubtitlePageIndex({ previousIndex: 0, pageCount: 3, isDraft: true, isSameCue: false }), 1);
    assert.equal(resolveSubtitlePageIndex({ previousIndex: 0, pageCount: 3, isDraft: true, isSameCue: true }), 1);
    assert.equal(resolveSubtitlePageIndex({ previousIndex: 1, pageCount: 3, isDraft: true, isSameCue: true }), 1);
    assert.equal(resolveSubtitlePageIndex({ previousIndex: 2, pageCount: 3, isDraft: false, isSameCue: true }), 2);
    assert.equal(resolveSubtitlePageIndex({ previousIndex: 1, pageCount: 2, isDraft: false, isSameCue: true }), 1);
    assert.equal(resolveSubtitlePageIndex({ previousIndex: 2, pageCount: 3, isDraft: false, isSameCue: false }), 1);
});

test('fills the lower line immediately before timing later roll-up pages', () => {
    assert.equal(resolveSubtitlePageIndex({ previousIndex: 0, pageCount: 1, isDraft: true, isSameCue: false }), 0);
    assert.equal(resolveSubtitlePageIndex({ previousIndex: 0, pageCount: 2, isDraft: true, isSameCue: true }), 1);
    assert.equal(resolveSubtitlePageIndex({ previousIndex: 1, pageCount: 4, isDraft: true, isSameCue: true }), 1);
});

test('follows Caption Desk live text as each new line becomes available', () => {
    assert.equal(resolveSubtitlePageIndex({
        previousIndex: 1,
        pageCount: 4,
        isDraft: false,
        isSameCue: true,
        followLiveEdge: true,
    }), 3);
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
