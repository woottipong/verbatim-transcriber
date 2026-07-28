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

test('interim review mode makes a draft editable and publishable before final', () => {
  const session = new CaptionDeskSession();
  session.setInterimReviewEnabled(true);
  session.ingestOperatorPacket(packet({
    type: 'caption.draft', provider: 'google',
    source: { segmentId: 'g-1', text: 'กำลังถอด', provider: 'google', isFinal: false, sequence: 1 },
  }));
  session.ingestOperatorPacket(packet({
    type: 'caption.draft', provider: 'google',
    source: { segmentId: 'g-1', text: 'กำลังถอดข้อความ', provider: 'google', isFinal: false, sequence: 2 },
  }));

  assert.equal(session.getSnapshot().reviewText, 'กำลังถอดข้อความ');
  assert.deepEqual(session.getSnapshot().sourceSegmentIds, ['g-1']);
  const command = session.release('google');
  assert.equal(command?.text, 'กำลังถอดข้อความ');
  assert.deepEqual(command?.sourceSegmentIds, ['g-1']);
});

test('human edits freeze the active interim until it is published', () => {
  const session = new CaptionDeskSession();
  session.setInterimReviewEnabled(true);
  session.ingestOperatorPacket(packet({
    type: 'caption.draft', provider: 'google',
    source: { segmentId: 'g-1', text: 'ข้อความแรก', provider: 'google', isFinal: false, sequence: 1 },
  }));
  session.edit('ข้อความที่แก้แล้ว');
  session.ingestOperatorPacket(packet({
    type: 'caption.draft', provider: 'google',
    source: { segmentId: 'g-1', text: 'ข้อความแรกที่ยาวขึ้น', provider: 'google', isFinal: false, sequence: 2 },
  }));

  assert.equal(session.getSnapshot().reviewText, 'ข้อความที่แก้แล้ว');
  assert.equal(session.getSnapshot().rawText, 'ข้อความแรกที่ยาวขึ้น');
});

test('matching final promotes an interim review without overwriting human edits', () => {
  const session = new CaptionDeskSession();
  session.setInterimReviewEnabled(true);
  session.ingestOperatorPacket(packet({
    type: 'caption.draft', provider: 'google',
    source: { segmentId: 'g-1', text: 'ข้อความแรก', provider: 'google', isFinal: false, sequence: 1 },
  }));
  session.edit('ข้อความที่แก้แล้ว');
  session.ingestOperatorPacket(pending('g-1', 'ข้อความ final'));

  assert.equal(session.getSnapshot().reviewText, 'ข้อความที่แก้แล้ว');
  assert.equal(session.getSnapshot().rawText, 'ข้อความ final');
  assert.deepEqual(session.getSnapshot().sourceSegmentIds, ['g-1']);
});

test('interim review mode accumulates finals and replaces only the active draft revision', () => {
  const session = new CaptionDeskSession();
  session.setInterimReviewEnabled(true);
  session.ingestOperatorPacket(pending('g-1', 'final เก่า'));
  session.ingestOperatorPacket(packet({
    type: 'caption.draft', provider: 'google',
    source: { segmentId: 'g-2', text: 'ข้อความสด', provider: 'google', isFinal: false, sequence: 2 },
  }));
  session.ingestOperatorPacket(packet({
    type: 'caption.draft', provider: 'google',
    source: { segmentId: 'g-2', text: 'ข้อความสดใหม่', provider: 'google', isFinal: false, sequence: 3 },
  }));

  assert.equal(session.getSnapshot().reviewText, 'final เก่า ข้อความสดใหม่');
  assert.deepEqual(session.getSnapshot().sourceSegmentIds, ['g-1', 'g-2']);
  assert.equal(session.getSnapshot().queuedCount, 0);

  const command = session.release('google', 'final เก่า'.length);
  assert.equal(command?.text, 'final เก่า');
  assert.equal(command?.remainingText, ' ข้อความสดใหม่');
  assert.deepEqual(command?.sourceSegmentIds, ['g-1', 'g-2']);
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
