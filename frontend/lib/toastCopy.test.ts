import assert from 'node:assert/strict';
import test from 'node:test';
import { getToastCopy } from './toastCopy.ts';

test('Caption Desk toast copy is Thai and names the notification action', () => {
  assert.deepEqual(getToastCopy('warning', 'th'), {
    title: 'ควรตรวจสอบ',
    dismissLabel: 'ปิดการแจ้งเตือน',
    regionLabel: 'การแจ้งเตือน',
  });
});
