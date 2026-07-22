import test from 'node:test';
import assert from 'node:assert/strict';
import { formatProviderName, getProviderPresentation, hasSourceLanguageLabel, providerFromAgentIdentity } from './providers.ts';

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

test('provides one shared visual presentation for every provider surface', () => {
    assert.deepEqual(getProviderPresentation('gemini'), {
        accent: 'bg-violet-400',
        badge: 'text-violet-300 bg-violet-500/15 border-violet-400/30',
        draftText: 'text-violet-300',
    });
    assert.deepEqual(getProviderPresentation('unknown'), {
        accent: 'bg-slate-500',
        badge: 'text-slate-300 bg-slate-500/15 border-slate-400/30',
        draftText: 'text-slate-300',
    });
});
