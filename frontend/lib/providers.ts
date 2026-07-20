export type AgentProvider = 'google' | 'gemini' | 'azure' | 'gpt-realtime-whisper';

export const providerLabels: Record<AgentProvider, string> = {
    google: 'Google Cloud STT',
    gemini: 'Gemini Live',
    azure: 'Azure Speech',
    'gpt-realtime-whisper': 'GPT Realtime Whisper',
};

export function formatProviderName(provider: string): string {
    return providerLabels[provider as AgentProvider] || provider;
}

export function hasSourceLanguageLabel(provider: string | undefined, languageCode: string | undefined): boolean {
    return Boolean(languageCode && (provider === 'gemini' || provider === 'gpt-realtime-whisper'));
}

export function providerFromAgentIdentity(identity: string): string {
    if (identity === 'asr-agent') return 'unknown';
    if (!identity.startsWith('agent-')) return 'unknown';
    const remainder = identity.slice('agent-'.length);
    const knownProviders = ['google', 'gemini', 'azure', 'gpt-realtime-whisper'];
    const known = knownProviders.find(provider => remainder === provider || remainder.startsWith(`${provider}-`));
    return known || remainder || 'unknown';
}

export const providerAccents: Record<string, string> = {
    google: 'bg-sky-400',
    gemini: 'bg-violet-400',
    azure: 'bg-cyan-400',
    'gpt-realtime-whisper': 'bg-emerald-400',
};

export const providerDraftClasses: Record<string, { bg: string; text: string }> = {
    google: { bg: 'bg-sky-500/5 border-sky-500/10', text: 'text-sky-400' },
    gemini: { bg: 'bg-violet-500/5 border-violet-500/10', text: 'text-violet-400' },
    azure: { bg: 'bg-cyan-500/5 border-cyan-500/10', text: 'text-cyan-400' },
    'gpt-realtime-whisper': { bg: 'bg-emerald-500/5 border-emerald-500/10', text: 'text-emerald-400' },
};
