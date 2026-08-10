import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_QUICK_PHRASES,
  MAX_QUICK_PHRASE_GRAPHEMES,
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

test('persisted quick phrases are bounded before they reach the editor', () => {
  setupMockLocalStorage();
  const overlongText = 'ก'.repeat(MAX_QUICK_PHRASE_GRAPHEMES + 12);
  (globalThis as unknown as { window: { localStorage: { setItem: (key: string, value: string) => void } } }).window.localStorage.setItem(
    QUICK_PHRASE_STORAGE_KEY,
    JSON.stringify([{ id: 'qp-long', key: 'F1', label: overlongText, text: overlongText }]),
  );

  const loaded = loadPersistedQuickPhrases();
  assert.equal(Array.from(loaded[0]?.text ?? '').length, MAX_QUICK_PHRASE_GRAPHEMES);
  assert.equal(Array.from(loaded[0]?.label ?? '').length, MAX_QUICK_PHRASE_GRAPHEMES);
});
