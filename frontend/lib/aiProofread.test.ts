import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadPersistedAiAutoEnabled,
  savePersistedAiAutoEnabled,
  requestAiProofread,
} from './aiProofread.ts';

function setupMockLocalStorage() {
  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
  (globalThis as unknown as { window: { localStorage: typeof mockStorage } }).window = {
    localStorage: mockStorage,
  };
}

test('loadPersistedAiAutoEnabled returns false by default when empty', () => {
  setupMockLocalStorage();
  const enabled = loadPersistedAiAutoEnabled();
  assert.equal(enabled, false);
});

test('savePersistedAiAutoEnabled persists boolean state', () => {
  setupMockLocalStorage();
  savePersistedAiAutoEnabled(false);
  assert.equal(loadPersistedAiAutoEnabled(), false);
  savePersistedAiAutoEnabled(true);
  assert.equal(loadPersistedAiAutoEnabled(), true);
});

test('requestAiProofread handles empty input gracefully', async () => {
  const result = await requestAiProofread('http://localhost:8080', {
    requestId: 'empty',
    revision: 0,
    targetText: '',
  });
  assert.equal(result.requestId, 'empty');
  assert.equal(result.suggestedText, '');
  assert.equal(result.changed, false);
});

test('requestAiProofread uses the configured backend and preserves text', async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = '';
  let calledInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledInit = init;
    return new Response(JSON.stringify({
      requestId: 'r1',
      revision: 2,
      suggestedText: 'แก้แล้ว',
      changed: true,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await requestAiProofread('https://backend.example/', {
      requestId: 'r1',
      revision: 2,
      targetText: 'ผิด  ',
      contextText: 'บริบท  ',
    });
    assert.equal(calledUrl, 'https://backend.example/api/caption-desk/ai-proofread');
    assert.equal((calledInit?.headers as Record<string, string>)['Content-Type'], 'application/json');
    assert.equal(JSON.parse(String(calledInit?.body)).targetText, 'ผิด  ');
    assert.equal(JSON.parse(String(calledInit?.body)).contextText, 'บริบท  ');
    assert.equal(result.suggestedText, 'แก้แล้ว');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('requestAiProofread rejects HTTP and response-schema failures', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'AI proofreading is not configured' }), { status: 503 });
  try {
    await assert.rejects(
      requestAiProofread('http://localhost:3000', { requestId: 'r', revision: 1, targetText: 'ข้อความ' }),
      /not configured/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
