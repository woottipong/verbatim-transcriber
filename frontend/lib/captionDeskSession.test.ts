import assert from 'node:assert/strict';
import test from 'node:test';
import { CaptionDeskSession, MAX_WAITING_CAPTIONS } from './captionDeskSession.ts';

const packet = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const pending = (id: string, text: string) => packet({
  type: 'caption.pending', provider: 'google',
  source: { segmentId: id, text, provider: 'google', isFinal: true, sequence: 1 },
});

test('finals accumulate in one editable review buffer', () => {
  const session = new CaptionDeskSession();
  session.ingestOperatorPacket(pending('g-1', 'หนึ่ง'));
  session.ingestOperatorPacket(pending('g-2', 'สอง'));
  assert.equal(session.getSnapshot().reviewText, 'หนึ่ง สอง');
  assert.equal(session.getSnapshot().rawText, 'หนึ่ง สอง');
  assert.equal(session.getSnapshot().queuedCount, 0);
  session.edit('แก้หนึ่ง แก้สอง');

  const command = session.release('google');
  assert.equal(command?.text, 'แก้หนึ่ง แก้สอง');
  assert.deepEqual(command?.sourceSegmentIds, ['g-1', 'g-2']);
  assert.equal(session.getSnapshot().reviewText, '');
  assert.deepEqual(session.getSnapshot().sourceSegmentIds, []);
  assert.equal(session.getSnapshot().queuedCount, 0);
  assert.equal(session.getSnapshot().waiting.length, 1);
});

test('release at the caret publishes only the prefix and keeps the remainder', () => {
  const session = new CaptionDeskSession();
  session.ingestOperatorPacket(pending('g-1', 'ประโยคแรก ประโยคถัดไป'));

  const command = session.release('google', 'ประโยคแรก'.length);
  assert.equal(command?.text, 'ประโยคแรก');
  assert.equal(command?.remainingText, ' ประโยคถัดไป');
  assert.deepEqual(command?.sourceSegmentIds, ['g-1']);
  assert.equal(session.getSnapshot().reviewText, ' ประโยคถัดไป');
  assert.deepEqual(session.getSnapshot().sourceSegmentIds, ['g-1']);

  session.acknowledge({
    type: 'caption.published',
    requestId: command!.requestId,
    provider: 'google',
    publicationId: 'p-1',
    sourceSegmentIds: ['g-1'],
    text: 'ประโยคแรก',
    publishedAt: 1,
  });
  const remainder = session.release('google');
  assert.equal(remainder?.text, ' ประโยคถัดไป');
  assert.equal(remainder?.remainingText, undefined);
  assert.deepEqual(remainder?.sourceSegmentIds, ['g-1']);
});

test('release preserves operator whitespace and line breaks on both sides of the caret', () => {
  const session = new CaptionDeskSession();
  session.ingestOperatorPacket(pending('g-1', 'ข้อความต้นทาง'));
  session.edit('  บรรทัดแรก \n  บรรทัดถัดไป  ');

  const splitAt = '  บรรทัดแรก \n'.length;
  const command = session.release('google', splitAt);

  assert.equal(command?.text, '  บรรทัดแรก \n');
  assert.equal(command?.remainingText, '  บรรทัดถัดไป  ');
  assert.equal(session.getSnapshot().reviewText, '  บรรทัดถัดไป  ');
});

test('release at the beginning does not publish the whole caption', () => {
  const session = new CaptionDeskSession();
  session.ingestOperatorPacket(pending('g-1', 'ห้ามส่งทั้งหมด'));

  assert.equal(session.release('google', 0), null);
  assert.equal(session.getSnapshot().reviewText, 'ห้ามส่งทั้งหมด');
  assert.equal(session.getSnapshot().waiting.length, 0);
  assert.match(session.getSnapshot().error || '', /Move the cursor/);
});

test('the same source cannot publish again before its acknowledgement', () => {
  const session = new CaptionDeskSession();
  session.ingestOperatorPacket(pending('g-1', 'ประโยคแรก ประโยคถัดไป'));
  session.release('google', 'ประโยคแรก'.length);

  assert.equal(session.release('google'), null);
  assert.equal(session.getSnapshot().waiting.length, 1);
  assert.match(session.getSnapshot().error || '', /finish sending/);
});

test('reconnect snapshot keeps the remainder of a partial publication active', () => {
  const session = new CaptionDeskSession();
  session.ingestOperatorPacket(pending('g-1', 'ประโยคแรก ประโยคถัดไป'));
  session.release('google', 'ประโยคแรก'.length);

  session.ingestOperatorPacket(packet({
    type: 'caption.snapshot', requestId: 's-1', provider: 'google',
    pending: [
      { segmentId: 'g-1', text: 'ประโยคถัดไป', provider: 'google', isFinal: true, sequence: 1 },
      { segmentId: 'g-2', text: 'ข้อความใหม่', provider: 'google', isFinal: true, sequence: 2 },
    ],
  }));

  assert.equal(session.getSnapshot().reviewText, ' ประโยคถัดไป ข้อความใหม่');
  assert.deepEqual(session.getSnapshot().sourceSegmentIds, ['g-1', 'g-2']);
  assert.equal(session.getSnapshot().queuedCount, 0);
  assert.equal(session.getSnapshot().error, null);
});

test('rejection restores both sides of a split caption', () => {
  const session = new CaptionDeskSession();
  session.ingestOperatorPacket(pending('g-1', 'ประโยคแรก ประโยคถัดไป'));
  const command = session.release('google', 'ประโยคแรก'.length)!;

  session.reject({
    type: 'caption.rejected', requestId: command.requestId, provider: 'google',
    code: 'publish_failed', message: 'ลองใหม่',
  });

  assert.equal(session.getSnapshot().reviewText, 'ประโยคแรก ประโยคถัดไป');
  assert.deepEqual(session.getSnapshot().sourceSegmentIds, ['g-1']);
});

test('rapid releases use distinct IDs and acknowledgements remove only their request', () => {
  const session = new CaptionDeskSession();
  session.ingestOperatorPacket(pending('g-1', 'หนึ่ง'));
  const first = session.release('google')!;
  session.ingestOperatorPacket(pending('g-2', 'สอง'));
  const second = session.release('google')!;
  assert.notEqual(first.requestId, second.requestId);
  assert.deepEqual(session.waitingCommands('google').map(item => item.requestId), [first.requestId, second.requestId]);
  session.ingestOperatorPacket(packet({
    type: 'caption.published', requestId: first.requestId, provider: 'google',
    publicationId: 'p-1', sourceSegmentIds: ['g-1'], text: 'หนึ่ง', publishedAt: 1,
  }));
  assert.deepEqual(session.getSnapshot().waiting.map(item => item.requestId), [second.requestId]);
  assert.deepEqual(session.getSnapshot().recentlyPublished, [
    { publicationId: 'p-1', text: 'หนึ่ง', publishedAt: 1 },
  ]);
});

test('recently published history is automatically bounded to 10 items', () => {
  const session = new CaptionDeskSession();
  for (let i = 1; i <= 15; i += 1) {
    session.ingestOperatorPacket(packet({
      type: 'caption.published',
      requestId: `req-${i}`,
      provider: 'google',
      publicationId: `pub-${i}`,
      sourceSegmentIds: [`seg-${i}`],
      text: `ข้อความ ${i}`,
      publishedAt: i,
    }));
  }
  const published = session.getSnapshot().recentlyPublished;
  assert.equal(published.length, 10);
  assert.equal(published[0].publicationId, 'pub-6');
  assert.equal(published[9].publicationId, 'pub-15');
});

test('rejection restores failed text before newer edits', () => {
  const session = new CaptionDeskSession();
  session.ingestOperatorPacket(pending('g-1', 'หนึ่ง'));
  const command = session.release('google')!;
  session.ingestOperatorPacket(pending('g-2', 'สอง'));
  session.edit('แก้สอง');
  session.ingestOperatorPacket(packet({
    type: 'caption.rejected', requestId: command.requestId, provider: 'google',
    code: 'publish_failed', message: 'ลองใหม่',
  }));
  assert.equal(session.getSnapshot().reviewText, 'หนึ่ง');
  assert.equal(session.getSnapshot().queuedCount, 1);
  assert.equal(session.getSnapshot().error, 'ลองใหม่');
  const retry = session.release('google');
  assert.equal(retry?.text, 'หนึ่ง');
  assert.equal(session.getSnapshot().reviewText, 'แก้สอง');
});

test('final review mode keeps the current draft separate from editable finals', () => {
  const session = new CaptionDeskSession();
  session.ingestOperatorPacket(pending('g-0', 'ข้อความก่อนหน้า'));
  session.ingestOperatorPacket(packet({
    type: 'caption.draft', provider: 'google',
    source: { segmentId: 'draft', text: 'กำลัง', provider: 'google', isFinal: false, sequence: 1 },
  }));
  session.ingestOperatorPacket(packet({
    type: 'caption.draft', provider: 'google',
    source: { segmentId: 'draft', text: 'กำลังพูด', provider: 'google', isFinal: false, sequence: 2 },
  }));
  assert.equal(session.getSnapshot().reviewText, 'ข้อความก่อนหน้า');
  assert.equal(session.getSnapshot().draftPreview, 'กำลังพูด');
  assert.equal(session.getSnapshot().isDraftActive, true);
  session.edit('ข้อความก่อนหน้าที่แก้แล้ว');
  const command = session.release('google');
  assert.equal(command?.text, 'ข้อความก่อนหน้าที่แก้แล้ว');
  assert.deepEqual(command?.sourceSegmentIds, ['g-0']);
  assert.equal(session.getSnapshot().draftPreview, 'กำลังพูด');

  session.ingestOperatorPacket(pending('draft', 'ข้อความ final'));
  assert.equal(session.getSnapshot().reviewText, 'ข้อความ final');
  assert.equal(session.getSnapshot().draftPreview, '');
  assert.equal(session.getSnapshot().isDraftActive, false);
  session.edit('ข้อความที่แก้แล้ว');
  assert.equal(session.getSnapshot().reviewText, 'ข้อความที่แก้แล้ว');
});

test('final review mode accepts a finalized packet without a preceding draft', () => {
  const session = new CaptionDeskSession();
  session.ingestOperatorPacket(pending('g-1', 'ข้อความ final'));
  assert.equal(session.getSnapshot().reviewText, 'ข้อความ final');
  assert.equal(session.getSnapshot().isDraftActive, false);
});

test('Draft packets update preview but never enter the editable review buffer', () => {
  const session = new CaptionDeskSession();
  session.ingestOperatorPacket(packet({
    type: 'caption.draft', provider: 'google',
    source: { segmentId: 'g-1', text: 'กำลังถอด', provider: 'google', isFinal: false, sequence: 1 },
  }));
  session.ingestOperatorPacket(packet({
    type: 'caption.draft', provider: 'google',
    source: { segmentId: 'g-1', text: 'กำลังถอดข้อความ', provider: 'google', isFinal: false, sequence: 2 },
  }));

  assert.equal(session.getSnapshot().draftPreview, 'กำลังถอดข้อความ');
  assert.equal(session.getSnapshot().reviewText, '');
  assert.deepEqual(session.getSnapshot().sourceSegmentIds, []);
  assert.equal(session.release('google'), null);
});

test('snapshot Draft stays out of the editor', () => {
  const session = new CaptionDeskSession();
  session.ingestOperatorPacket(packet({
    type: 'caption.snapshot',
    requestId: 'subscribe-1',
    provider: 'gemini',
    pending: [],
    draft: {
      segmentId: 'gemini-1',
      text: 'ข้อความที่กำลังพูด',
      provider: 'gemini',
      isFinal: false,
      sequence: 3,
    },
  }));

  assert.equal(session.getSnapshot().reviewText, '');
  assert.equal(session.getSnapshot().rawText, '');
  assert.deepEqual(session.getSnapshot().sourceSegmentIds, []);
  assert.equal(session.getSnapshot().draftPreview, 'ข้อความที่กำลังพูด');
});

test('a newer Draft segment replaces preview and a delayed older Draft cannot restore it', () => {
  const session = new CaptionDeskSession();
  session.ingestOperatorPacket(packet({
    type: 'caption.draft', provider: 'google',
    source: { segmentId: 'g-1', text: 'ช่วงแรก', provider: 'google', isFinal: false, sequence: 1 },
  }));
  session.ingestOperatorPacket(packet({
    type: 'caption.draft', provider: 'google',
    source: { segmentId: 'g-2', text: 'ช่วงใหม่', provider: 'google', isFinal: false, sequence: 3 },
  }));
  session.ingestOperatorPacket(packet({
    type: 'caption.draft', provider: 'google',
    source: { segmentId: 'g-1', text: 'ช่วงแรกที่มาช้า', provider: 'google', isFinal: false, sequence: 2 },
  }));
  session.ingestOperatorPacket(packet({
    type: 'caption.draft', provider: 'google',
    source: { segmentId: 'g-2', text: 'ช่วงใหม่ revision เก่า', provider: 'google', isFinal: false, sequence: 2 },
  }));

  assert.equal(session.getSnapshot().draftPreview, 'ช่วงใหม่');
  assert.equal(session.getSnapshot().reviewText, '');
});

test('a matching Final clears its Draft preview and enters review once', () => {
  const session = new CaptionDeskSession();
  session.ingestOperatorPacket(packet({
    type: 'caption.draft', provider: 'google',
    source: { segmentId: 'g-1', text: 'กำลังพูด', provider: 'google', isFinal: false, sequence: 1 },
  }));
  session.ingestOperatorPacket(pending('g-1', 'กำลังพูดต่อจนจบ'));
  session.ingestOperatorPacket(pending('g-1', 'กำลังพูดต่อจนจบ'));

  assert.equal(session.getSnapshot().reviewText, 'กำลังพูดต่อจนจบ');
  assert.equal(session.getSnapshot().rawText, 'กำลังพูดต่อจนจบ');
  assert.deepEqual(session.getSnapshot().sourceSegmentIds, ['g-1']);
  assert.equal(session.getSnapshot().draftPreview, '');
  assert.equal(session.getSnapshot().isDraftActive, false);
});

test('a Draft clear removes a retracted tail without adding caption text', () => {
  const session = new CaptionDeskSession();
  session.ingestOperatorPacket(packet({
    type: 'caption.draft', provider: 'google',
    source: { segmentId: 'g-1', text: 'stable phrase mutable tail', provider: 'google', isFinal: false, sequence: 10 },
  }));
  session.ingestOperatorPacket(packet({
    type: 'caption.pending', provider: 'google',
    source: { segmentId: 'g-1:early:1', text: 'stable phrase', provider: 'google', isFinal: true, sequence: 11 },
  }));
  session.ingestOperatorPacket(packet({
    type: 'caption.draft-cleared', provider: 'google',
    source: { segmentId: 'g-1', text: 'stable phrase', provider: 'google', isFinal: true, sequence: 12 },
  }));

  assert.equal(session.getSnapshot().reviewText, 'stable phrase');
  assert.equal(session.getSnapshot().draftPreview, '');
  assert.equal(session.getSnapshot().isDraftActive, false);
  assert.deepEqual(session.getSnapshot().sourceSegmentIds, ['g-1:early:1']);
});

test('a promoted prefix and its newer Draft tail remain correct in either packet order', () => {
  for (const order of ['pending-first', 'draft-first'] as const) {
    const session = new CaptionDeskSession();
    session.ingestOperatorPacket(packet({
      type: 'caption.draft', provider: 'google',
      source: { segmentId: 'g-1', text: 'stable phrase mutable tail', provider: 'google', isFinal: false, sequence: 10 },
    }));
    const promoted = {
      type: 'caption.pending' as const,
      provider: 'google',
      source: { segmentId: 'g-1:early:1', text: 'stable phrase', provider: 'google', isFinal: true, sequence: 11 },
    };
    const tail = {
      type: 'caption.draft' as const,
      provider: 'google',
      source: {
        segmentId: 'g-1',
        text: 'mutable tail',
        provider: 'google',
        isFinal: false,
        sequence: 12,
        joinWithoutSpace: true,
      },
    };
    for (const message of order === 'pending-first' ? [promoted, tail] : [tail, promoted]) {
      session.ingestOperatorPacket(packet(message));
    }

    assert.equal(session.getSnapshot().reviewText, 'stable phrase', order);
    assert.equal(session.getSnapshot().draftPreview, 'mutable tail', order);
    assert.equal(session.getSnapshot().draftJoinWithoutSpace, true, order);
    assert.equal(session.getSnapshot().isDraftActive, true, order);
  }
});

test('bounded Thai continuation chunks do not invent spaces', () => {
  const session = new CaptionDeskSession();
  session.ingestOperatorPacket(packet({
    type: 'caption.pending', provider: 'google',
    source: { segmentId: 'th-1:early:1', text: 'ภาษาไทยก้อนแรก', provider: 'google', isFinal: true, sequence: 1 },
  }));
  session.ingestOperatorPacket(packet({
    type: 'caption.pending', provider: 'google',
    source: {
      segmentId: 'th-1:early:2',
      text: 'ต่อเนื่องก้อนสอง',
      provider: 'google',
      isFinal: true,
      sequence: 2,
      joinWithoutSpace: true,
    },
  }));

  assert.equal(session.getSnapshot().reviewText, 'ภาษาไทยก้อนแรกต่อเนื่องก้อนสอง');
  assert.equal(session.getSnapshot().rawText, 'ภาษาไทยก้อนแรกต่อเนื่องก้อนสอง');
});

test('interleaved Draft segment IDs cannot suppress their later Finals', () => {
  const session = new CaptionDeskSession();
  session.ingestOperatorPacket(packet({
    type: 'caption.draft', provider: 'google',
    source: { segmentId: 'g-1', text: 'ร่างหนึ่ง', provider: 'google', isFinal: false, sequence: 1 },
  }));
  session.ingestOperatorPacket(packet({
    type: 'caption.draft', provider: 'google',
    source: { segmentId: 'g-2', text: 'ร่างสอง', provider: 'google', isFinal: false, sequence: 2 },
  }));
  session.ingestOperatorPacket(packet({
    type: 'caption.pending', provider: 'google',
    source: { segmentId: 'g-1', text: 'final หนึ่ง', provider: 'google', isFinal: true, sequence: 3 },
  }));

  assert.equal(session.getSnapshot().reviewText, 'final หนึ่ง');
  assert.equal(session.getSnapshot().draftPreview, 'ร่างสอง');

  session.ingestOperatorPacket(packet({
    type: 'caption.pending', provider: 'google',
    source: { segmentId: 'g-2', text: 'final สอง', provider: 'google', isFinal: true, sequence: 4 },
  }));
  assert.equal(session.getSnapshot().reviewText, 'final หนึ่ง final สอง');
  assert.equal(session.getSnapshot().draftPreview, '');
});

test('a stale snapshot cannot restore a Draft after its newer Final', () => {
  const session = new CaptionDeskSession();
  session.ingestOperatorPacket(packet({
    type: 'caption.draft', provider: 'google',
    source: { segmentId: 'g-1', text: 'ร่างเก่า', provider: 'google', isFinal: false, sequence: 1 },
  }));
  session.ingestOperatorPacket(packet({
    type: 'caption.pending', provider: 'google',
    source: { segmentId: 'g-1', text: 'ข้อความ final', provider: 'google', isFinal: true, sequence: 2 },
  }));
  session.ingestOperatorPacket(packet({
    type: 'caption.snapshot', requestId: 'stale', provider: 'google', pending: [],
    draft: { segmentId: 'g-1', text: 'ร่างเก่า', provider: 'google', isFinal: false, sequence: 1 },
  }));

  assert.equal(session.getSnapshot().reviewText, 'ข้อความ final');
  assert.equal(session.getSnapshot().draftPreview, '');
  assert.equal(session.getSnapshot().isDraftActive, false);
});

test('a delayed Draft packet cannot reactivate a segment after its newer Final', () => {
  const session = new CaptionDeskSession();
  session.ingestOperatorPacket(packet({
    type: 'caption.draft', provider: 'google',
    source: { segmentId: 'g-1', text: 'ร่างเก่า', provider: 'google', isFinal: false, sequence: 10 },
  }));
  session.ingestOperatorPacket(packet({
    type: 'caption.pending', provider: 'google',
    source: { segmentId: 'g-1', text: 'ข้อความ final', provider: 'google', isFinal: true, sequence: 11 },
  }));
  session.ingestOperatorPacket(packet({
    type: 'caption.draft', provider: 'google',
    source: { segmentId: 'g-1', text: 'ร่างเก่าที่มาช้า', provider: 'google', isFinal: false, sequence: 10 },
  }));

  assert.equal(session.getSnapshot().reviewText, 'ข้อความ final');
  assert.equal(session.getSnapshot().draftPreview, '');
  assert.equal(session.getSnapshot().isDraftActive, false);
});

test('a new source epoch accepts a replacement agent snapshot with reset sequences', () => {
  const session = new CaptionDeskSession();
  session.ingestOperatorPacket(packet({
    type: 'caption.pending', provider: 'google',
    source: { segmentId: 'old-1', text: 'ข้อความจาก agent เก่า', provider: 'google', isFinal: true, sequence: 90 },
  }));

  session.beginSourceEpoch();
  session.ingestOperatorPacket(packet({
    type: 'caption.snapshot', requestId: 'new-agent', provider: 'google', pending: [],
    draft: { segmentId: 'new-1', text: 'ข้อความจาก agent ใหม่', provider: 'google', isFinal: false, sequence: 1 },
  }));

  assert.equal(session.getSnapshot().reviewText, '');
  assert.deepEqual(session.getSnapshot().sourceSegmentIds, []);
  assert.equal(session.getSnapshot().draftPreview, 'ข้อความจาก agent ใหม่');
  assert.equal(session.getSnapshot().isDraftActive, true);
});

test('partial publication keeps only the backend-owned remainder source for the next release', () => {
  const session = new CaptionDeskSession();
  session.ingestOperatorPacket(pending('g-1', 'หนึ่ง'));
  session.ingestOperatorPacket(pending('g-2', 'สอง'));

  const first = session.release('google', 'หนึ่ง'.length);
  assert.equal(first?.text, 'หนึ่ง');
  assert.equal(first?.remainingText, ' สอง');
  assert.deepEqual(first?.sourceSegmentIds, ['g-1', 'g-2']);
  assert.equal(session.getSnapshot().reviewText, ' สอง');
  assert.deepEqual(session.getSnapshot().sourceSegmentIds, ['g-2']);

  session.ingestOperatorPacket(packet({
    type: 'caption.published',
    requestId: first?.requestId,
    provider: 'google',
    publicationId: 'p-1',
    sourceSegmentIds: ['g-1', 'g-2'],
    text: 'หนึ่ง',
    publishedAt: 1,
  }));
  const second = session.release('google');
  assert.equal(second?.text, ' สอง');
  assert.deepEqual(second?.sourceSegmentIds, ['g-2']);
});

test('reconnect snapshot preserves human edits and appends new finals', () => {
  const session = new CaptionDeskSession();
  session.ingestOperatorPacket(pending('g-1', 'หนึ่ง'));
  session.edit('แก้ไขหนึ่ง');
  session.ingestOperatorPacket(packet({
    type: 'caption.snapshot', requestId: 's-1', provider: 'google',
    pending: [
      { segmentId: 'g-1', text: 'หนึ่ง', provider: 'google', isFinal: true, sequence: 1 },
      { segmentId: 'g-2', text: 'สอง', provider: 'google', isFinal: true, sequence: 2 },
    ],
  }));
  assert.equal(session.getSnapshot().reviewText, 'แก้ไขหนึ่ง สอง');
  const command = session.release('google');
  assert.equal(command?.text, 'แก้ไขหนึ่ง สอง');
  assert.deepEqual(command?.sourceSegmentIds, ['g-1', 'g-2']);
  assert.equal(session.getSnapshot().reviewText, '');
  assert.equal(session.getSnapshot().queuedCount, 0);
});

test('waiting backpressure never evicts an unsettled request', () => {
  const session = new CaptionDeskSession();
  for (let index = 0; index < MAX_WAITING_CAPTIONS; index++) {
    session.ingestOperatorPacket(pending(`g-${index}`, `${index}`));
    assert.ok(session.release('google'));
  }
  session.ingestOperatorPacket(pending('g-overflow', 'overflow'));
  assert.equal(session.release('google'), null);
  assert.equal(session.getSnapshot().waiting.length, MAX_WAITING_CAPTIONS);
  assert.match(session.getSnapshot().error || '', /Waiting for 64/);
});
