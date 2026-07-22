import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldAutoConnectViewer } from './viewerLaunch.ts';

test('viewer auto-connect requires a room, flag, and disconnected state', () => {
  assert.equal(shouldAutoConnectViewer({ autoConnect: true, roomName: 'room', attempted: false, connected: false }), true);
  assert.equal(shouldAutoConnectViewer({ autoConnect: false, roomName: 'room', attempted: false, connected: false }), false);
  assert.equal(shouldAutoConnectViewer({ autoConnect: true, roomName: '', attempted: false, connected: false }), false);
  assert.equal(shouldAutoConnectViewer({ autoConnect: true, roomName: 'room', attempted: true, connected: false }), false);
  assert.equal(shouldAutoConnectViewer({ autoConnect: true, roomName: 'room', attempted: false, connected: true }), false);
});
