import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, Download, Radio, Users, Volume2, VolumeX, LogOut, Eraser } from 'lucide-react';
import { TranscriptSegment, ConnectionState, AudioSource } from '../types';
import { getLiveKitSessionPresentation } from '../lib/liveKitSession';
import { shouldStickToLatest } from '../lib/transcriptViewport';
import TranslationBlock from './TranslationBlock';
import { formatLanguageLabel, groupFinalTranscriptRows, isTranscriptTurnLive, normalizeLanguageTag, type InterimTranscript } from '../lib/transcriptMessages';
import { formatProviderName, getProviderPresentation, hasSourceLanguageLabel, providerFromAgentIdentity, transcriptStatusClasses } from '../lib/providers';
import { buildTranscriptFilename, downloadTranscriptText, formatTranscriptText } from '../lib/transcriptExport';

interface LiveKitPanelProps {
  transcripts: TranscriptSegment[];
  interimTranscripts: ReadonlyMap<string, InterimTranscript>;
  connectionState: ConnectionState;
  isAgentConnected: boolean;
  agentIdentity: string | null;
  audioSource: AudioSource;
  isAudioInputEnabled: boolean;
  isAudioInputStopped: boolean;
  participantCount: number;
  error: string | null;
  roomName: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleAudioInput: () => void;
  onClear: () => void;
}

const formatAgentProvider = (identity: string | null): string => {
  if (!identity) return '';
  return identity
    .split(',')
    .map(id => formatProviderName(providerFromAgentIdentity(id.trim())))
    .join(', ');
};

const LiveKitPanel: React.FC<LiveKitPanelProps> = ({
  transcripts,
  interimTranscripts,
  connectionState,
  isAgentConnected,
  agentIdentity,
  audioSource,
  isAudioInputEnabled,
  isAudioInputStopped,
  participantCount,
  error,
  roomName,
  onConnect,
  onDisconnect,
  onToggleAudioInput,
  onClear,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isFollowingLatest, setIsFollowingLatest] = useState(true);
  const [viewMode, setViewMode] = useState<'timeline' | 'paragraph'>('timeline');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [exportError, setExportError] = useState<string | null>(null);

  const scrollToLatest = useCallback(() => {
    const anchors = scrollRef.current?.querySelectorAll<HTMLElement>('[data-transcript-end]');
    anchors?.forEach(anchor => anchor.scrollIntoView({ block: 'end' }));
  }, []);

  const handleExportProvider = useCallback((provider: string, segments: TranscriptSegment[]) => {
    try {
      setExportError(null);
      const text = formatTranscriptText(segments);
      if (!text) return;
      downloadTranscriptText(text, buildTranscriptFilename(roomName, provider));
    } catch {
      setExportError(`Unable to export ${formatProviderName(provider)} transcript.`);
    }
  }, [roomName]);

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
        const provider = providerFromAgentIdentity(identity.trim());
        if (provider) ensureGroup(provider);
      });
    }
    if (groups.size === 0) ensureGroup('google');

    groups.forEach(group => {
      group.transcripts = groupFinalTranscriptRows(group.transcripts);
    });

    const order = ['google', 'gemini', 'azure', 'gpt-realtime-whisper'];
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
  const displayLineCount = providerGroups.reduce((count, [, group]) => count + group.transcripts.length, 0);
  const latestFinalText = transcripts.at(-1)?.text ?? '';

  const session = getLiveKitSessionPresentation(
    connectionState,
    isAudioInputEnabled,
    isAgentConnected,
    audioSource,
    isAudioInputStopped,
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
      <span className="sr-only" aria-live="polite" aria-atomic="true">{latestFinalText}</span>
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
                <button onClick={onConnect} disabled={!roomName.trim()} className="control-button control-button--primary" aria-label={roomName.trim() ? 'Connect audio' : 'Room ID Required'}>
                  {roomName.trim() ? 'Connect' : 'Room ID Required'}
                </button>
              </>
            )}
            {isConnecting && (
              <button disabled className="control-button control-button--primary" aria-label="Connecting audio input">
                <span className="status-dot status-dot--pending" aria-hidden="true" /> Connecting…
              </button>
            )}
            {isConnected && (
              <>
                <button
                  onClick={onToggleAudioInput}
                  disabled={isAudioInputStopped}
                  className="control-button control-button--quiet disabled:cursor-not-allowed disabled:opacity-55"
                  aria-label={isAudioInputStopped ? 'Tab audio stopped' : isAudioInputEnabled ? 'Mute audio input' : 'Resume audio input'}
                >
                  {isAudioInputEnabled ? <VolumeX size={14} aria-hidden="true" /> : <Volume2 size={14} aria-hidden="true" />}
                  {isAudioInputStopped ? 'Stopped' : isAudioInputEnabled ? 'Mute' : 'Resume'}
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

      {exportError && (
        <div className="flex items-center gap-2 border-b border-amber-300/25 bg-amber-300/5 px-4 py-2.5 text-sm text-amber-100" role="alert">
          <CircleAlert size={15} aria-hidden="true" />
          {exportError}
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
                    ? audioSource === 'chrome-tab'
                      ? 'Play audio in the shared tab. Your transcript will show here.'
                      : 'Start speaking. Your transcript will show here.'
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
                    {formatProviderName(provider)}
                  </button>
                ))}
              </div>
            )}
            <div className="flex min-h-0 flex-1 lg:divide-x lg:divide-slate-800/80">
            {providerGroups.map(([provider, group]) => {
              const providerTranscripts = group.transcripts;
              const providerInterims = group.interims;
              const hasProviderContent = providerTranscripts.length > 0 || providerInterims.length > 0;
              const exportText = formatTranscriptText(providerTranscripts);
              
              return (
                <section
                  key={provider}
                  className={`${visibleMobileProvider === provider ? 'flex' : 'hidden'} h-full min-w-0 flex-1 flex-col lg:flex`}
                  aria-label={`${provider} transcript`}
                >
                  <div className="px-4 py-2.5 bg-slate-900/40 border-b border-slate-800 flex items-center justify-between text-xs font-semibold text-slate-400 select-none shrink-0">
                    <span className="flex items-center gap-2 uppercase tracking-wider">
                      <span className={`w-1 h-3 rounded ${getProviderPresentation(provider).accent}`} aria-hidden="true" />
                      {formatProviderName(provider)}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums text-slate-400 font-medium">{providerTranscripts.length} lines</span>
                      <button
                        type="button"
                        disabled={!exportText}
                        onClick={() => handleExportProvider(provider, providerTranscripts)}
                        aria-label={`Export ${formatProviderName(provider)} transcript as text`}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Download size={13} aria-hidden="true" />
                        Export .txt
                      </button>
                    </span>
                  </div>
                  
                  <div 
                    className="flex-1 overflow-y-auto px-4 py-3 transcript-scroller"
                    onScroll={(event) => setIsFollowingLatest(shouldStickToLatest(event.currentTarget))}
                  >
                    {!hasProviderContent ? (
                      <div className="h-full flex flex-col items-center justify-center text-center p-6 select-none opacity-40 py-20">
                        <span className={`w-1.5 h-1.5 rounded-full animate-pulse mb-2 ${getProviderPresentation(provider).accent}`} />
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Awaiting Signal</p>
                      </div>
                    ) : viewMode === 'timeline' ? (
                      <div className="transcript-timeline">
                        {providerTranscripts.map((segment, idx) => {
                          const isTurnLive = isTranscriptTurnLive(segment);
                          return (
                            <div
                              key={segment.id}
                              className="transcript-turn transcript-turn--line group -mx-2 flex items-start rounded px-2 transition-colors duration-100 hover:bg-slate-900/25"
                            >
                              <span className="transcript-turn__index shrink-0 select-none tabular-nums text-slate-400">
                                <span className="sr-only">{isTurnLive ? 'Live turn ' : 'Turn '}</span>
                                <span aria-hidden="true">{String(idx + 1).padStart(2, '0')}</span>
                                {isTurnLive && <span className="transcript-live-dot transcript-turn__live-dot" aria-hidden="true" />}
                              </span>
                              <div className="transcript-bilingual min-w-0 flex-1">
                                <p
                                  className={`transcript-source-line text-slate-100 ${hasSourceLanguageLabel(segment.provider, segment.languageCode) ? 'transcript-source-line--labeled' : ''}`}
                                  lang={normalizeLanguageTag(segment.languageCode)}
                                  dir="auto"
                                >
                                  {hasSourceLanguageLabel(segment.provider, segment.languageCode) && (
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
                        {providerInterims.map((interim, draftIndex) => (
                          <div
                            key={interim.key}
                            className="transcript-turn transcript-turn--line group -mx-2 flex items-start rounded px-2 transition-colors duration-100 hover:bg-slate-900/25"
                          >
                            <span className="transcript-turn__index shrink-0 select-none tabular-nums text-slate-400">
                              <span className="sr-only">Live draft </span>
                              <span aria-hidden="true">{String(providerTranscripts.length + draftIndex + 1).padStart(2, '0')}</span>
                              <span className="transcript-live-dot transcript-turn__live-dot" aria-hidden="true" />
                            </span>
                            <div className="transcript-bilingual min-w-0 flex-1">
                              <p
                                className={`transcript-source-line min-w-0 text-slate-300 ${hasSourceLanguageLabel(interim.provider, interim.languageCode) ? 'transcript-source-line--labeled' : ''}`}
                                lang={normalizeLanguageTag(interim.languageCode)}
                                dir="auto"
                              >
                                {hasSourceLanguageLabel(interim.provider, interim.languageCode) && (
                                  <span className="source-language-label" title={formatLanguageLabel(interim.languageCode)} aria-hidden="true">
                                    <span className="language-label__text">{formatLanguageLabel(interim.languageCode)}</span>
                                  </span>
                                )}
                                <span className="transcript-source-line__text">{interim.text}</span>
                              </p>
                              <TranslationBlock translation={interim.translation} />
                            </div>
                            <span className={`transcript-status-badge shrink-0 rounded border uppercase ${transcriptStatusClasses.draftBadge}`}>Draft</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="transcript-paragraph-source min-w-0 break-words text-slate-100">
                        {providerTranscripts.map(segment => (
                          <React.Fragment key={segment.id}>
                            <span lang={normalizeLanguageTag(segment.languageCode)} dir="auto">{segment.text}</span>{' '}
                          </React.Fragment>
                        ))}
                        {providerInterims.map(interim => {
                          const presentation = getProviderPresentation(interim.provider);
                          return (
                            <React.Fragment key={interim.key}>
                              <span className="transcript-inline-draft">
                                <span className="transcript-inline-draft__dot" aria-hidden="true" />
                                Draft
                              </span>{' '}
                              <span className={`italic ${presentation.draftText}`} lang={normalizeLanguageTag(interim.languageCode)} dir="auto">{interim.text}</span>{' '}
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
        <span className="shrink-0 tabular-nums text-violet-300">{displayLineCount} Lines</span>
      </footer>
    </article>
  );
};

export default LiveKitPanel;
