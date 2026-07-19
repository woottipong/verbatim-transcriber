import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Radio, Users, Mic, MicOff, LogOut, Eraser } from 'lucide-react';
import { TranscriptSegment, InterimTranscript, ConnectionState } from '../types';
import { getLiveKitSessionPresentation } from '../lib/liveKitSession';
import { shouldStickToLatest } from '../lib/transcriptViewport';
import TranslationBlock from './TranslationBlock';
import { formatLanguageLabel, isTranscriptTurnLive, normalizeLanguageTag } from '../lib/transcriptMessages';

interface LiveKitPanelProps {
  transcripts: TranscriptSegment[];
  interimTranscripts: ReadonlyMap<string, InterimTranscript>;
  connectionState: ConnectionState;
  isAgentConnected: boolean;
  agentIdentity: string | null;
  isMicrophoneEnabled: boolean;
  participantCount: number;
  error: string | null;
  roomName: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleMicrophone: () => void;
  onClear: () => void;
}

const formatAgentProvider = (identity: string | null): string => {
  if (!identity) return '';
  return identity
    .split(',')
    .map(id => {
      const parts = id.split('-');
      if (parts.length > 1) {
        const provider = parts[1].toLowerCase();
        if (provider === 'google') return 'Google Cloud STT';
        if (provider === 'gemini') return 'Gemini Live';
        if (provider === 'azure') return 'Azure Speech';
        return parts[1];
      }
      return id;
    })
    .join(', ');
};

const providerAccents: Record<string, string> = {
  google: 'bg-sky-400',
  gemini: 'bg-violet-400',
  azure: 'bg-cyan-400',
};

interface DraftClass {
  bg: string;
  text: string;
}

const draftClasses: Record<string, DraftClass> = {
  google: { bg: 'bg-sky-500/5 border-sky-500/10', text: 'text-sky-400' },
  gemini: { bg: 'bg-violet-500/5 border-violet-500/10', text: 'text-violet-400' },
  azure: { bg: 'bg-cyan-500/5 border-cyan-500/10', text: 'text-cyan-400' },
};

const LiveKitPanel: React.FC<LiveKitPanelProps> = ({
  transcripts,
  interimTranscripts,
  connectionState,
  isAgentConnected,
  agentIdentity,
  isMicrophoneEnabled,
  participantCount,
  error,
  roomName,
  onConnect,
  onDisconnect,
  onToggleMicrophone,
  onClear,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isFollowingLatest, setIsFollowingLatest] = useState(true);
  const [viewMode, setViewMode] = useState<'timeline' | 'paragraph'>('timeline');
  const [selectedProvider, setSelectedProvider] = useState('');

  const scrollToLatest = useCallback(() => {
    const anchors = scrollRef.current?.querySelectorAll<HTMLElement>('[data-transcript-end]');
    anchors?.forEach(anchor => anchor.scrollIntoView({ block: 'end' }));
  }, []);

  useEffect(() => {
    if (!isFollowingLatest) return;

    const frame = window.requestAnimationFrame(scrollToLatest);
    return () => window.cancelAnimationFrame(frame);
  }, [interimTranscripts, isFollowingLatest, scrollToLatest, transcripts]);

  const isConnected = connectionState === ConnectionState.CONNECTED;
  const isConnecting = connectionState === ConnectionState.CONNECTING;
  const hasContent = transcripts.length > 0 || interimTranscripts.size > 0;

  const providerGroups = useMemo(() => {
    const groups = new Map<string, {
      transcripts: TranscriptSegment[];
      interims: InterimTranscript[];
    }>();
    const ensureGroup = (provider: string) => {
      let group = groups.get(provider);
      if (!group) {
        group = { transcripts: [], interims: [] };
        groups.set(provider, group);
      }
      return group;
    };

    transcripts.forEach(segment => {
      if (segment.provider) ensureGroup(segment.provider).transcripts.push(segment);
    });
    interimTranscripts.forEach(interim => {
      if (interim.provider) ensureGroup(interim.provider).interims.push(interim);
    });
    if (isAgentConnected && agentIdentity) {
      agentIdentity.split(',').forEach(identity => {
        const provider = identity.split('-')[1];
        if (provider) ensureGroup(provider);
      });
    }
    if (groups.size === 0) ensureGroup('google');

    const order = ['google', 'gemini', 'azure'];
    return Array.from(groups.entries()).sort(([left], [right]) => {
      const leftOrder = order.indexOf(left);
      const rightOrder = order.indexOf(right);
      if (leftOrder === -1) return rightOrder === -1 ? left.localeCompare(right) : 1;
      if (rightOrder === -1) return -1;
      return leftOrder - rightOrder;
    });
  }, [agentIdentity, interimTranscripts, isAgentConnected, transcripts]);
  const activeProviders = providerGroups.map(([provider]) => provider);
  const visibleMobileProvider = activeProviders.includes(selectedProvider)
    ? selectedProvider
    : activeProviders[0];

  const session = getLiveKitSessionPresentation(
    connectionState,
    isMicrophoneEnabled,
    isAgentConnected,
  );
  const sessionToneDot = session.tone === 'ready'
    ? 'status-dot--live'
    : session.tone === 'pending'
      ? 'status-dot--pending'
      : session.tone === 'error'
        ? 'status-dot--error'
        : '';

  return (
    <article className="livekit-panel app-panel flex min-h-[500px] h-[calc(100vh-12rem)] flex-col" aria-label="LiveKit transcription workspace">
      <header className="panel-header px-4 py-3 sm:px-5">
        <div className="session-toolbar">
          <div className="session-toolbar__identity">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-violet-500/15 text-violet-300">
              <Radio size={16} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-100">Audio Room Connection</h3>
              {isConnected ? (
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <Users size={13} aria-hidden="true" />
                    {participantCount} {participantCount === 1 ? 'user' : 'users'}
                  </span>
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-slate-400">Low-latency audio stream</p>
              )}
            </div>
          </div>

          <div className="session-readiness">
            <div className="min-w-0" role="status" aria-live="polite">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <span className={`status-dot ${sessionToneDot}`} aria-hidden="true" />
                {session.headline}
                <span className="sr-only">. {session.detail}</span>
              </p>
            </div>
            <dl className="session-health" aria-label="Session health">
              {session.health.map(item => (
                <div key={item.label} className={`session-health__item session-health__item--${item.state}`}>
                  <dt>{item.label}</dt>
                  <dd>
                    <span className="session-health__indicator" aria-hidden="true" />
                    {item.label === 'Transcriber' && isAgentConnected && agentIdentity
                      ? formatAgentProvider(agentIdentity)
                      : item.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="session-toolbar__actions">
            {!isConnected && !isConnecting && (
              <>
                <button onClick={onConnect} disabled={!roomName.trim()} className="control-button control-button--primary" aria-label={roomName.trim() ? 'Connect microphone' : 'Room ID Required'}>
                  {roomName.trim() ? 'Connect' : 'Room ID Required'}
                </button>
              </>
            )}
            {isConnecting && (
              <button disabled className="control-button control-button--primary" aria-label="Connecting microphone">
                <span className="status-dot status-dot--pending" aria-hidden="true" /> Connecting…
              </button>
            )}
            {isConnected && (
              <>
                <button onClick={onToggleMicrophone} className="control-button control-button--quiet" aria-label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}>
                  {isMicrophoneEnabled ? <MicOff size={14} aria-hidden="true" /> : <Mic size={14} aria-hidden="true" />}
                  {isMicrophoneEnabled ? 'Mute' : 'Unmute'}
                </button>
                <button onClick={onDisconnect} className="control-button control-button--danger" aria-label="Disconnect">
                  <LogOut size={14} aria-hidden="true" /> Disconnect
                </button>
              </>
            )}
            {isConnected && (
              <div className="flex items-center rounded-lg border border-slate-700 bg-slate-950/45 p-0.5 select-none shrink-0" role="group" aria-label="View mode">
                <button
                  type="button"
                  onClick={() => setViewMode('timeline')}
                  aria-pressed={viewMode === 'timeline'}
                  className={`h-11 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer ${viewMode === 'timeline' ? 'bg-violet-500 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  Lines
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('paragraph')}
                  aria-pressed={viewMode === 'paragraph'}
                  className={`h-11 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer ${viewMode === 'paragraph' ? 'bg-violet-500 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  Text
                </button>
              </div>
            )}
            <button onClick={onClear} className="control-button control-button--quiet !px-2.5 sm:!px-3" aria-label="Clear text" title="Clear text">
              <Eraser size={14} aria-hidden="true" />
              <span className="hidden sm:inline">Clear Text</span>
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="border-b border-red-400/30 bg-red-950/35 px-4 py-2.5 text-sm text-red-200" role="alert">
          {error}
        </div>
      )}

      {isConnected && !isAgentConnected && (
        <div className="border-b border-amber-300/25 bg-amber-300/5 px-4 py-3 sm:px-5">
          <p className="text-sm text-amber-100">Connected. Waiting for transcriber to start...</p>
          <p className="mt-1 text-xs text-slate-400">Ask an administrator to start the transcription service if it is waiting.</p>
        </div>
      )}

      <div className="relative min-h-[400px] flex-1" ref={scrollRef}>
        {!hasContent ? (
          <div className="absolute inset-0 overflow-y-auto px-4 py-2 sm:px-5">
            <div className="transcript-empty-state">
              <p className="text-base font-medium text-slate-300">
                {connectionState === ConnectionState.DISCONNECTED
                  ? 'Disconnected'
                  : session.canSpeak
                    ? 'Start speaking. Your transcript will show here.'
                    : session.headline}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {connectionState === ConnectionState.DISCONNECTED
                  ? 'Connect to the room to start sending your audio.'
                  : session.canSpeak
                    ? 'Draft text updates live and finalizes when you pause speaking.'
                    : session.detail}
              </p>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col bg-slate-950/20">
            {activeProviders.length > 1 && (
              <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-800 bg-slate-900/55 p-2 lg:hidden" role="group" aria-label="Transcription provider">
                {activeProviders.map(provider => (
                  <button
                    key={provider}
                    type="button"
                    onClick={() => setSelectedProvider(provider)}
                    aria-pressed={visibleMobileProvider === provider}
                    className={`min-h-11 shrink-0 rounded-md px-3 text-xs font-semibold transition-colors ${visibleMobileProvider === provider
                      ? 'bg-violet-500 text-white'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    {provider === 'google' ? 'Google Cloud STT' : provider === 'gemini' ? 'Gemini Live' : provider === 'azure' ? 'Azure Speech' : provider}
                  </button>
                ))}
              </div>
            )}
            <div className="flex min-h-0 flex-1 lg:divide-x lg:divide-slate-800/80">
            {providerGroups.map(([provider, group]) => {
              const providerTranscripts = group.transcripts;
              const providerInterims = group.interims;
              const hasProviderContent = providerTranscripts.length > 0 || providerInterims.length > 0;
              
              return (
                <section
                  key={provider}
                  className={`${visibleMobileProvider === provider ? 'flex' : 'hidden'} h-full min-w-0 flex-1 flex-col lg:flex`}
                  aria-label={`${provider} transcript`}
                >
                  <div className="px-4 py-2.5 bg-slate-900/40 border-b border-slate-800 flex items-center justify-between text-xs font-semibold text-slate-400 select-none shrink-0">
                    <span className="flex items-center gap-2 uppercase tracking-wider">
                      <span className={`w-1 h-3 rounded ${providerAccents[provider] ?? 'bg-slate-500'}`} aria-hidden="true" />
                      {provider === 'google' ? 'Google Cloud STT' : provider === 'gemini' ? 'Gemini Live' : provider === 'azure' ? 'Azure Speech' : provider}
                    </span>
                    <span className="tabular-nums text-slate-400 font-medium">{providerTranscripts.length} lines</span>
                  </div>
                  
                  <div 
                    className="flex-1 overflow-y-auto px-4 py-3 transcript-scroller"
                    onScroll={(event) => setIsFollowingLatest(shouldStickToLatest(event.currentTarget))}
                  >
                    {!hasProviderContent ? (
                      <div className="h-full flex flex-col items-center justify-center text-center p-6 select-none opacity-40 py-20">
                        <span className={`w-1.5 h-1.5 rounded-full animate-pulse mb-2 ${providerAccents[provider] ?? 'bg-slate-500'}`} />
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Awaiting Signal</p>
                      </div>
                    ) : viewMode === 'timeline' ? (
                      <div className="space-y-1">
                        {providerTranscripts.map((segment, idx) => {
                          const isTurnLive = isTranscriptTurnLive(segment);
                          return (
                            <div
                              key={segment.id}
                              className="transcript-turn group -mx-2 flex items-start gap-2 rounded px-2 py-2 transition-colors duration-100 hover:bg-slate-900/25"
                            >
                              <span className="transcript-turn__index w-5 shrink-0 select-none pt-1 text-[10px] tabular-nums text-slate-400">
                                <span className="sr-only">{isTurnLive ? 'Live turn ' : 'Turn '}</span>
                                <span aria-hidden="true">{String(idx + 1).padStart(2, '0')}</span>
                                {isTurnLive && <span className="transcript-live-dot transcript-turn__live-dot" aria-hidden="true" />}
                              </span>
                              <div className="transcript-bilingual min-w-0 flex-1">
                                <p
                                  className={`transcript-source-line break-words text-[1.05rem] font-medium leading-7 text-slate-100 ${segment.provider === 'gemini' && segment.languageCode ? 'transcript-source-line--labeled' : ''}`}
                                  lang={normalizeLanguageTag(segment.languageCode)}
                                  dir="auto"
                                >
                                  {segment.provider === 'gemini' && segment.languageCode && (
                                    <span className="source-language-label" title={formatLanguageLabel(segment.languageCode)} aria-hidden="true">
                                      <span className="language-label__text">{formatLanguageLabel(segment.languageCode)}</span>
                                    </span>
                                  )}
                                  <span className="transcript-source-line__text">{segment.text}</span>
                                </p>
                                <TranslationBlock translation={segment.translation} />
                              </div>
                            </div>
                          );
                        })}
                        {providerInterims.map(interim => {
                          const classes = draftClasses[interim.provider] ?? { bg: 'bg-violet-500/5 border-violet-500/10', text: 'text-violet-400' };
                          return (
                            <div
                              key={interim.key}
                              className={`py-1 flex items-baseline gap-2.5 rounded px-2.5 -mx-1 border shadow-sm ${classes.bg}`}
                              role="status"
                              aria-live="polite"
                              aria-atomic="true"
                            >
                              <span className={`text-sm select-none w-5 shrink-0 ${classes.text}`}>↳</span>
                              <p className="min-w-0 flex-1 text-[1.05rem] leading-7 text-slate-300 font-medium tracking-wide italic">{interim.text}</p>
                              <span className={`text-[9px] font-bold select-none uppercase tracking-[0.1em] ml-auto shrink-0 px-1 py-0.5 rounded border ${classes.text} border-current/20 bg-current/5`}>Draft</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="max-w-[75ch] break-words text-[1.05rem] font-medium leading-8 text-slate-100">
                        {providerTranscripts.map(segment => (
                          <React.Fragment key={segment.id}>
                            <span lang={normalizeLanguageTag(segment.languageCode)} dir="auto">
                              {segment.text}
                            </span>{' '}
                          </React.Fragment>
                        ))}
                        {providerInterims.map(interim => {
                          const classes = draftClasses[interim.provider] ?? { bg: 'bg-violet-500/5 border-violet-500/10', text: 'text-violet-400' };
                          return (
                            <React.Fragment key={interim.key}>
                              <span className={`italic ${classes.text}`}>{interim.text}…</span>{' '}
                            </React.Fragment>
                          );
                        })}
                      </p>
                    )}
                    <div data-transcript-end aria-hidden="true" />
                  </div>
                </section>
              );
            })}
            </div>
          </div>
        )}
      </div>
      {!isFollowingLatest && hasContent && (
        <button
          type="button"
          className="control-button control-button--quiet absolute bottom-3 right-4 bg-slate-900/95 shadow-lg z-10"
          onClick={() => {
            scrollToLatest();
            setIsFollowingLatest(true);
          }}
        >
          Jump to Latest
        </button>
      )}

      <footer className="flex items-center justify-between border-t border-slate-700/70 px-4 py-2.5 text-xs text-slate-400 sm:px-5">
        <span className="min-w-0 truncate pr-3">{session.headline} · {session.detail}</span>
        <span className="shrink-0 tabular-nums text-violet-300">{transcripts.length} Lines</span>
      </footer>
    </article>
  );
};

export default LiveKitPanel;
