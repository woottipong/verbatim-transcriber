import React, { useCallback, useMemo, useState } from 'react';
import { Download, Radio, Users, Volume2, VolumeX, LogOut, Eraser } from 'lucide-react';
import { TranscriptSegment, ConnectionState, AudioSource } from '../types';
import { getLiveKitSessionPresentation } from '../lib/liveKitSession';
import type { InterimTranscript } from '../lib/transcriptMessages';
import { formatProviderName, getProviderPresentation, providerFromAgentIdentity } from '../lib/providers';
import { buildTranscriptFilename, downloadTranscriptText } from '../lib/transcriptExport';
import ToastViewport from './ToastViewport';
import { TranscriptParagraph, TranscriptRows } from './TranscriptPresentation';
import { useTranscriptViewport } from '../hooks/useTranscriptViewport';
import { buildProviderTranscriptPresentations } from '../lib/transcriptPresentation';

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
  const [viewMode, setViewMode] = useState<'timeline' | 'paragraph'>('timeline');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExportProvider = useCallback((provider: string, text: string) => {
    try {
      setExportError(null);
      if (!text) return;
      downloadTranscriptText(text, buildTranscriptFilename(roomName, provider));
    } catch {
      setExportError(`Unable to export ${formatProviderName(provider)} transcript.`);
    }
  }, [roomName]);

  const {
    containerRef: scrollRef,
    isFollowingLatest,
    handleScroll,
    jumpToLatest,
  } = useTranscriptViewport({
    committed: transcripts,
    interim: interimTranscripts,
    descendantScrollers: true,
  });

  const isConnected = connectionState === ConnectionState.CONNECTED;
  const isConnecting = connectionState === ConnectionState.CONNECTING;
  const hasContent = transcripts.length > 0 || interimTranscripts.size > 0;

  const providerGroups = useMemo(() => {
    const providers: string[] = [];
    if (isAgentConnected && agentIdentity) {
      agentIdentity.split(',').forEach(identity => {
        const provider = providerFromAgentIdentity(identity.trim());
        if (provider) providers.push(provider);
      });
    }
    const presentations = buildProviderTranscriptPresentations(
      transcripts,
      interimTranscripts,
      providers,
    );
    return presentations.length > 0
      ? presentations
      : buildProviderTranscriptPresentations(transcripts, interimTranscripts, ['google']);
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
      {(error || exportError) && (
        <ToastViewport notices={[
          error && { id: `livekit-error-${error}`, tone: 'error', title: 'Connection error', message: error },
          exportError && { id: `export-error-${exportError}`, tone: 'error', title: 'Export failed', message: exportError, onDismiss: () => setExportError(null) },
        ]} />
      )}
      <span className="sr-only" aria-live="polite" aria-atomic="true">{latestFinalText}</span>
      <header className="panel-header px-4 py-3 sm:px-5">
        <div className="session-toolbar">
          <div className="session-toolbar__identity">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-teal-500/10 text-teal-300">
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
                  className={`view-toggle-button ${viewMode === 'timeline' ? 'view-toggle-button--active' : ''}`}
                >
                  Lines
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('paragraph')}
                  aria-pressed={viewMode === 'paragraph'}
                  className={`view-toggle-button ${viewMode === 'paragraph' ? 'view-toggle-button--active' : ''}`}
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
                      ? 'bg-teal-700 text-white'
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
              const exportText = group.exportText;
              
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
                        onClick={() => handleExportProvider(provider, exportText)}
                        aria-label={`Export ${formatProviderName(provider)} transcript as text`}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Download size={13} aria-hidden="true" />
                        Export .txt
                      </button>
                    </span>
                  </div>
                  
                  <div 
                    className="flex-1 overflow-y-auto px-4 py-3 transcript-scroller"
                    data-transcript-scroller
                    onScroll={(event) => handleScroll(event.currentTarget)}
                  >
                    {!hasProviderContent ? (
                      <div className="h-full flex flex-col items-center justify-center text-center p-6 select-none opacity-40 py-20">
                        <span className={`w-1.5 h-1.5 rounded-full animate-pulse mb-2 ${getProviderPresentation(provider).accent}`} />
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Awaiting Signal</p>
                      </div>
                    ) : viewMode === 'timeline' ? (
                      <div className="transcript-timeline">
                        <TranscriptRows transcripts={providerTranscripts} interims={providerInterims} variant="numbered" />
                      </div>
                    ) : (
                      <TranscriptParagraph transcripts={providerTranscripts} interims={providerInterims} />
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
          onClick={jumpToLatest}
        >
          Jump to Latest
        </button>
      )}

      <footer className="flex items-center justify-between border-t border-slate-700/70 px-4 py-2.5 text-xs text-slate-400 sm:px-5">
        <span className="min-w-0 truncate pr-3">{session.headline} · {session.detail}</span>
        <span className="shrink-0 tabular-nums text-teal-300">{displayLineCount} Lines</span>
      </footer>
    </article>
  );
};

export default LiveKitPanel;
