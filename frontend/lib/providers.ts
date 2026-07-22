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

export interface ProviderPresentation {
    accent: string;
    badge: string;
    draftText: string;
}

const fallbackProviderPresentation: ProviderPresentation = {
    accent: 'bg-slate-500',
    badge: 'text-slate-300 bg-slate-500/15 border-slate-400/30',
    draftText: 'text-slate-300',
};

const providerPresentations: Record<AgentProvider, ProviderPresentation> = {
    google: {
        accent: 'bg-sky-400',
        badge: 'text-sky-300 bg-sky-500/15 border-sky-400/30',
        draftText: 'text-sky-300',
    },
    gemini: {
        accent: 'bg-violet-400',
        badge: 'text-violet-300 bg-violet-500/15 border-violet-400/30',
        draftText: 'text-violet-300',
    },
    azure: {
        accent: 'bg-cyan-400',
        badge: 'text-cyan-300 bg-cyan-500/15 border-cyan-400/30',
        draftText: 'text-cyan-300',
    },
    'gpt-realtime-whisper': {
        accent: 'bg-emerald-400',
        badge: 'text-emerald-300 bg-emerald-500/15 border-emerald-400/30',
        draftText: 'text-emerald-300',
    },
};

export function getProviderPresentation(provider: string): ProviderPresentation {
    return providerPresentations[provider as AgentProvider] ?? fallbackProviderPresentation;
}
