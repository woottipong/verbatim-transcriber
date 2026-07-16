import React, { useEffect, useRef } from 'react';
import { Play, Square, Trash2 } from 'lucide-react';
import { ConnectionState, TranscriptSegment } from '../types';
import { shouldStickToLatest } from '../lib/transcriptViewport';

interface TranscriptPanelProps {
  transcripts: TranscriptSegment[];
  interimTranscript: string;
  onClear: () => void;
  connectionState: ConnectionState;
  onStart: () => void;
  onStop: () => void;
  microphoneActive: boolean;
}

const TranscriptPanel: React.FC<TranscriptPanelProps> = ({
  transcripts,
  interimTranscript,
  onClear,
  connectionState,
  onStart,
  onStop,
  microphoneActive,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isFollowingLatest, setIsFollowingLatest] = React.useState(true);

  useEffect(() => {
    if (scrollRef.current && isFollowingLatest) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [interimTranscript, isFollowingLatest, transcripts]);

  const isConnected = connectionState === ConnectionState.CONNECTED;
  const isConnecting = connectionState === ConnectionState.CONNECTING;
  const isActive = isConnected || isConnecting;
  const hasContent = transcripts.length > 0 || Boolean(interimTranscript);
  const status = connectionState === ConnectionState.ERROR
    ? { label: 'Error', dot: 'status-dot--error' }
    : isConnecting
      ? { label: 'Connecting', dot: 'status-dot--pending' }
      : isConnected
        ? { label: 'Listening', dot: 'status-dot--live' }
        : { label: 'Idle', dot: '' };

  return (
    <article className="app-panel flex min-h-[320px] flex-col" aria-label="Provider transcript">
      <header className="panel-header flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <span className={`status-dot ${status.dot}`} aria-hidden="true" />
          <span className="font-medium">{status.label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {isActive ? (
            <button onClick={onStop} className="control-button control-button--danger" aria-label="Stop this provider">
              <Square size={13} fill="currentColor" aria-hidden="true" /> Stop
            </button>
          ) : (
            <button
              onClick={onStart}
              disabled={!microphoneActive}
              className="control-button control-button--primary"
              aria-label="Start this provider"
              title={!microphoneActive ? 'Start microphone first' : 'Start transcription'}
            >
              <Play size={13} fill="currentColor" aria-hidden="true" /> Start
            </button>
          )}
          <button onClick={onClear} className="control-button control-button--quiet !px-2.5" aria-label="Clear transcripts">
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="relative min-h-[238px] flex-1">
      <div
        ref={scrollRef}
        className="transcript-scroller absolute inset-0 overflow-y-auto px-4 py-2"
        onScroll={(event) => setIsFollowingLatest(shouldStickToLatest(event.currentTarget))}
      >
        {!hasContent ? (
          <div className="flex h-full min-h-[214px] items-center">
            <p className="max-w-xs text-sm leading-6 text-slate-500">Start this provider to review its Thai transcript alongside the live stream.</p>
          </div>
        ) : (
          <div>
            {transcripts.map((segment, index) => (
              <div key={segment.id} className="transcript-row grid grid-cols-[2rem_1fr] gap-2 py-3">
                <span className="pt-0.5 text-xs tabular-nums text-slate-500">{String(index + 1).padStart(2, '0')}</span>
                <p className="text-base leading-7 text-slate-100">{segment.text}</p>
              </div>
            ))}
            {interimTranscript && (
              <div className="transcript-row transcript-row--interim grid grid-cols-[2rem_minmax(0,1fr)] items-baseline gap-2 py-3" role="status" aria-label="Live interim transcript" aria-live="polite" aria-atomic="true">
                <span className="pt-0.5 text-xs tabular-nums text-slate-500">
                  {String(transcripts.length + 1).padStart(2, '0')}
                </span>
                <div className="transcript-row__content flex min-w-0 items-baseline gap-2.5">
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-violet-400/30 bg-violet-400/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-violet-200">
                    <span className="transcript-live-dot" aria-hidden="true" /> LIVE
                  </span>
                  <p className="transcript-row__text min-w-0 text-base leading-7 text-slate-300">{interimTranscript}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {!isFollowingLatest && hasContent && (
        <button
          type="button"
          className="control-button control-button--quiet absolute bottom-3 right-3 bg-slate-900/95 shadow-lg"
          onClick={() => {
            if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            setIsFollowingLatest(true);
          }}
        >
          Jump to latest
        </button>
      )}
      </div>
    </article>
  );
};

export default TranscriptPanel;
