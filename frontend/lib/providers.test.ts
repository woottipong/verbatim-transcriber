import test from 'node:test';
import assert from 'node:assert/strict';
import { formatProviderName, getProviderPresentation, hasSourceLanguageLabel, providerFromAgentIdentity, selectActiveRoomProviders } from './providers.ts';

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
        accent: 'bg-amber-400',
        badge: 'text-amber-300 bg-amber-500/10 border-amber-400/30',
        draftText: 'text-amber-300',
    });
    assert.deepEqual(getProviderPresentation('unknown'), {
        accent: 'bg-slate-500',
        badge: 'text-slate-300 bg-slate-500/15 border-slate-400/30',
        draftText: 'text-slate-300',
    });
});

test('selectActiveRoomProviders filters active running providers for target room', () => {
    const agents = [
        { running: true, room: 'room-a', provider: 'google' },
        { running: true, room: 'room-a', provider: 'gemini' },
        { running: false, room: 'room-a', provider: 'azure' },
        { running: true, room: 'room-b', provider: 'gpt-realtime-whisper' },
        { running: true, room: 'room-a', provider: 'google' }, // duplicate
    ];
    assert.deepEqual(selectActiveRoomProviders(agents, 'room-a'), ['google', 'gemini']);
    assert.deepEqual(selectActiveRoomProviders(agents, 'room-b'), ['gpt-realtime-whisper']);
    assert.deepEqual(selectActiveRoomProviders(agents, 'room-c'), []);
    assert.deepEqual(selectActiveRoomProviders(agents, ''), []);
});
