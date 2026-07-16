import React, { useEffect, useRef, useState } from 'react';
import { Eraser, LogOut, Mic, MicOff, Play, Radio, Users } from 'lucide-react';
import { ConnectionState, TranscriptSegment } from '../types';
import { InterimTranscript } from '../lib/transcriptMessages';
import { shouldStickToLatest } from '../lib/transcriptViewport';
import { getLiveKitSessionPresentation } from '../lib/liveKitSession';

interface LiveKitPanelProps {
  transcripts: TranscriptSegment[];
  interimTranscripts: ReadonlyMap<string, InterimTranscript>;
  connectionState: ConnectionState;
  isAgentConnected: boolean;
  isMicrophoneEnabled: boolean;
  participantCount: number;
  error: string | null;
  roomName: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleMicrophone: () => void;
  onClear: () => void;
}

const providerClasses: Record<string, string> = {
  google: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
  gemini: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
  azure: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200',
};

const LiveKitPanel: React.FC<LiveKitPanelProps> = ({
  transcripts,
  interimTranscripts,
  connectionState,
  isAgentConnected,
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

  useEffect(() => {
    if (scrollRef.current && isFollowingLatest) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [interimTranscripts, isFollowingLatest, transcripts]);

  const isConnected = connectionState === ConnectionState.CONNECTED;
  const isConnecting = connectionState === ConnectionState.CONNECTING;
  const hasContent = transcripts.length > 0 || interimTranscripts.size > 0;
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
    <article className="livekit-panel app-panel flex min-h-[340px] flex-col" aria-label="LiveKit transcription workspace">
      <header className="panel-header px-4 py-3 sm:px-5">
        <div className="session-toolbar">
          <div className="session-toolbar__identity">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-violet-500/15 text-violet-300">
              <Radio size={16} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-100">LiveKit / WebRTC</h3>
              {isConnected ? (
                <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                  <Users size={13} aria-hidden="true" />
                  {participantCount} {participantCount === 1 ? 'participant' : 'participants'}
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-slate-500">Low-latency audio session</p>
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
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="session-toolbar__actions">
            {!isConnected && !isConnecting && (
              <>
                <button onClick={onConnect} disabled={!roomName.trim()} className="control-button control-button--primary" aria-label={roomName.trim() ? 'Join room and enable microphone' : 'A room link is required'}>
                  <Play size={14} fill="currentColor" aria-hidden="true" /> {roomName.trim() ? 'Join & enable mic' : 'Room link required'}
                </button>
              </>
            )}
            {isConnecting && (
              <button disabled className="control-button control-button--primary" aria-label="Joining room and starting microphone">
                <span className="status-dot status-dot--pending" aria-hidden="true" /> Joining &amp; starting mic…
              </button>
            )}
            {isConnected && (
              <>
                <button onClick={onToggleMicrophone} className="control-button control-button--quiet" aria-label={isMicrophoneEnabled ? 'Mute microphone' : 'Turn on microphone'}>
                  {isMicrophoneEnabled ? <MicOff size={14} aria-hidden="true" /> : <Mic size={14} aria-hidden="true" />}
                  {isMicrophoneEnabled ? 'Mute' : 'Turn on mic'}
                </button>
                <button onClick={onDisconnect} className="control-button control-button--danger" aria-label="Leave LiveKit room">
                  <LogOut size={14} aria-hidden="true" /> Leave room
                </button>
              </>
            )}
            <button onClick={onClear} className="control-button control-button--quiet !px-2.5 sm:!px-3" aria-label="Clear transcript" title="Clear transcript">
              <Eraser size={14} aria-hidden="true" />
              <span className="hidden sm:inline">Clear</span>
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
          <p className="text-sm text-amber-100">Room connected. Waiting for the transcription agent.</p>
          <p className="mt-1 text-xs text-slate-400">An administrator can start the agent from the room workspace.</p>
        </div>
      )}

      <div className="relative min-h-[200px] flex-1">
      <div
        ref={scrollRef}
        className="transcript-scroller absolute inset-0 overflow-y-auto px-4 py-2 sm:px-5"
        onScroll={(event) => setIsFollowingLatest(shouldStickToLatest(event.currentTarget))}
      >
        {!hasContent ? (
          <div className="transcript-empty-state">
            <p className="text-base font-medium text-slate-300">
              {connectionState === ConnectionState.DISCONNECTED
                ? 'No transcript yet'
                : session.canSpeak
                  ? 'Speak normally. Your transcript will appear here.'
                  : session.headline}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {connectionState === ConnectionState.DISCONNECTED
                ? 'Join the room to enable your microphone and start transcribing.'
                : session.canSpeak
                  ? 'Interim text updates live, then settles into a final segment.'
                  : session.detail}
            </p>
          </div>
        ) : (
          <div>
            {transcripts.map((segment, index) => (
              <div key={segment.id} className="transcript-row grid grid-cols-[2.25rem_minmax(0,1fr)] items-baseline gap-3 py-2.5">
                <span className="pt-0.5 text-xs tabular-nums text-slate-500">{String(index + 1).padStart(2, '0')}</span>
                <div className="flex min-w-0 items-baseline gap-2.5">
                  {segment.provider && (
                    <span className={`inline-flex shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${providerClasses[segment.provider] ?? 'border-violet-400/30 bg-violet-400/10 text-violet-200'}`}>
                      {segment.provider.toUpperCase()}
                    </span>
                  )}
                  <p className="min-w-0 text-[1.05rem] leading-7 text-slate-100">{segment.text}</p>
                </div>
              </div>
            ))}
            {Array.from<InterimTranscript>(interimTranscripts.values()).map(interim => (
              <div
                key={interim.key}
                className="transcript-row transcript-row--interim grid grid-cols-[2.25rem_minmax(0,1fr)] items-baseline gap-3 py-2.5"
                role="status"
                aria-live="polite"
                aria-atomic="true"
                aria-label={`Live interim transcript from ${interim.speaker}`}
              >
                <span className="transcript-row__marker pt-0.5 text-sm text-violet-300" aria-hidden="true">↳</span>
                <div className="transcript-row__content flex min-w-0 items-baseline gap-2.5">
                  <span className={`inline-flex shrink-0 items-center gap-1.5 rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${providerClasses[interim.provider] ?? 'border-violet-400/30 bg-violet-400/10 text-violet-200'}`}>
                    <span className="transcript-live-dot" aria-hidden="true" />
                    {interim.provider.toUpperCase()} · LIVE DRAFT
                  </span>
                  <span className="transcript-row__hint text-[10px] font-medium uppercase tracking-[0.12em] text-violet-300/70">กำลังถอดเสียง</span>
                  <p className="transcript-row__text min-w-0 text-[1.05rem] leading-7 text-slate-300">{interim.text}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {!isFollowingLatest && hasContent && (
        <button
          type="button"
          className="control-button control-button--quiet absolute bottom-3 right-4 bg-slate-900/95 shadow-lg"
          onClick={() => {
            if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            setIsFollowingLatest(true);
          }}
        >
          Jump to latest
        </button>
      )}
      </div>

      <footer className="flex items-center justify-between border-t border-slate-700/70 px-4 py-2.5 text-xs text-slate-500 sm:px-5">
        <span>WebRTC · target latency 200–500 ms</span>
        <span className="tabular-nums text-violet-300">{transcripts.length} segments</span>
      </footer>
    </article>
  );
};

export default LiveKitPanel;
