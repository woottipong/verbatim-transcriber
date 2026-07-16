import React, { useEffect, useRef, useState } from 'react';
import { Radio, Users, Mic, MicOff, LogOut, Eraser } from 'lucide-react';
import { TranscriptSegment, InterimTranscript, ConnectionState } from '../types';
import { getLiveKitSessionPresentation } from '../lib/liveKitSession';
import { shouldStickToLatest } from '../lib/transcriptViewport';

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

  useEffect(() => {
    if (isFollowingLatest) {
      const scrollContainers = scrollRef.current?.querySelectorAll('.overflow-y-auto');
      scrollContainers?.forEach(container => {
        container.scrollTop = container.scrollHeight;
      });
    }
  }, [interimTranscripts, isFollowingLatest, transcripts]);

  const isConnected = connectionState === ConnectionState.CONNECTED;
  const isConnecting = connectionState === ConnectionState.CONNECTING;
  const hasContent = transcripts.length > 0 || interimTranscripts.size > 0;

  const activeProviders = Array.from(new Set([
    ...transcripts.map(t => t.provider),
    ...Array.from(interimTranscripts.values()).map(i => i.provider)
  ])).filter(Boolean);

  if (isAgentConnected && agentIdentity) {
    agentIdentity.split(',').forEach(id => {
      const parts = id.split('-');
      if (parts.length > 1 && !activeProviders.includes(parts[1])) {
        activeProviders.push(parts[1]);
      }
    });
  }

  if (activeProviders.length === 0) {
    activeProviders.push('google');
  }

  const order = ['google', 'gemini', 'azure'];
  activeProviders.sort((a, b) => order.indexOf(a) - order.indexOf(b));

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
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <Users size={13} aria-hidden="true" />
                    {participantCount} {participantCount === 1 ? 'user' : 'users'}
                  </span>
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-slate-500">Low-latency audio stream</p>
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
                  onClick={() => setViewMode('timeline')}
                  className={`h-8 px-2.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${viewMode === 'timeline' ? 'bg-violet-500 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  Lines
                </button>
                <button
                  onClick={() => setViewMode('paragraph')}
                  className={`h-8 px-2.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${viewMode === 'paragraph' ? 'bg-violet-500 text-white' : 'text-slate-400 hover:text-slate-200'}`}
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
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {connectionState === ConnectionState.DISCONNECTED
                  ? 'Connect to the room to start sending your audio.'
                  : session.canSpeak
                    ? 'Draft text updates live and finalizes when you pause speaking.'
                    : session.detail}
              </p>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex divide-x divide-slate-800/80 bg-slate-950/20">
            {activeProviders.map(provider => {
              const providerTranscripts = transcripts.filter(t => t.provider === provider);
              const providerInterims = Array.from(interimTranscripts.values()).filter(i => i.provider === provider);
              const hasProviderContent = providerTranscripts.length > 0 || providerInterims.length > 0;
              
              return (
                <div key={provider} className="flex flex-col h-full min-w-0 flex-1">
                  <div className="px-4 py-2.5 bg-slate-900/40 border-b border-slate-800 flex items-center justify-between text-xs font-semibold text-slate-400 select-none shrink-0">
                    <span className="flex items-center gap-2 uppercase tracking-wider">
                      <span className={`w-1 h-3 rounded ${providerAccents[provider] ?? 'bg-slate-500'}`} aria-hidden="true" />
                      {provider === 'google' ? 'Google Cloud STT' : provider === 'gemini' ? 'Gemini Live' : provider === 'azure' ? 'Azure Speech' : provider}
                    </span>
                    <span className="tabular-nums text-slate-500 font-medium">{providerTranscripts.length} lines</span>
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
                        {providerTranscripts.map((segment, idx) => (
                          <div 
                            key={segment.id} 
                            className="py-1 px-2 -mx-2 flex items-baseline gap-2.5 rounded hover:bg-slate-900/25 transition-colors duration-100 group"
                          >
                            <span className="text-[10px] tabular-nums text-slate-500 group-hover:text-slate-400 select-none w-5 shrink-0 pt-0.5">
                              {String(idx + 1).padStart(2, '0')}
                            </span>
                            <p className="min-w-0 flex-1 text-[1.05rem] leading-7 text-slate-100 font-medium tracking-wide">
                              {segment.text}
                            </p>
                          </div>
                        ))}
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
                      <div className="text-[1.05rem] leading-8 text-slate-100 font-medium tracking-wide space-y-3">
                        <p>
                          {providerTranscripts.map((segment) => (
                            <span key={segment.id} className="hover:bg-slate-900/40 rounded px-0.5 transition-colors duration-100">
                              {segment.text}
                            </span>
                          ))}
                          {providerInterims.map(interim => {
                            const classes = draftClasses[interim.provider] ?? { bg: 'bg-violet-500/5 border-violet-500/10', text: 'text-violet-400' };
                            return (
                              <span key={interim.key} className={`italic ${classes.text}`}>
                                {interim.text}…
                              </span>
                            );
                          })}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {!isFollowingLatest && hasContent && (
        <button
          type="button"
          className="control-button control-button--quiet absolute bottom-3 right-4 bg-slate-900/95 shadow-lg z-10"
          onClick={() => {
            const scrollContainers = scrollRef.current?.querySelectorAll('.overflow-y-auto');
            scrollContainers?.forEach(container => {
              container.scrollTop = container.scrollHeight;
            });
            setIsFollowingLatest(true);
          }}
        >
          Jump to Latest
        </button>
      )}

      <footer className="flex items-center justify-between border-t border-slate-700/70 px-4 py-2.5 text-xs text-slate-500 sm:px-5">
        <span>Status: Connected · Low Latency Feed</span>
        <span className="tabular-nums text-violet-300">{transcripts.length} Lines</span>
      </footer>
    </article>
  );
};

export default LiveKitPanel;
