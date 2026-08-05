import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_QUICK_PHRASES,
  loadPersistedQuickPhrases,
  savePersistedQuickPhrases,
  QUICK_PHRASE_STORAGE_KEY,
} from './quickPhrases.ts';

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

test('loadPersistedQuickPhrases returns defaults when storage is empty', () => {
  setupMockLocalStorage();
  assert.deepEqual(loadPersistedQuickPhrases(), DEFAULT_QUICK_PHRASES);
});

test('savePersistedQuickPhrases persists custom quick phrases', () => {
  setupMockLocalStorage();
  const custom = [
    { id: 'qp-custom', key: 'F1', label: 'นายกฯ', text: 'นายกรัฐมนตรี' },
  ];
  savePersistedQuickPhrases(custom);
  assert.deepEqual(loadPersistedQuickPhrases(), custom);
});
