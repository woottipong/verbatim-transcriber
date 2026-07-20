import test from 'node:test';
import assert from 'node:assert/strict';
import { formatProviderName, hasSourceLanguageLabel, providerFromAgentIdentity } from './providers.ts';

test('preserves the full hyphenated OpenAI provider identity', () => {
    assert.equal(providerFromAgentIdentity('agent-gpt-realtime-whisper'), 'gpt-realtime-whisper');
});

test('keeps legacy provider identities with suffixes compatible', () => {
    assert.equal(providerFromAgentIdentity('agent-google-123'), 'google');
});

test('maps OpenAI provider to its display label', () => {
    assert.equal(formatProviderName('gpt-realtime-whisper'), 'GPT Realtime Whisper');
});

test('only bilingual providers show source language labels', () => {
    assert.equal(hasSourceLanguageLabel('gpt-realtime-whisper', 'th'), true);
    assert.equal(hasSourceLanguageLabel('gemini', 'th'), true);
    assert.equal(hasSourceLanguageLabel('google', 'th-TH'), false);
});
