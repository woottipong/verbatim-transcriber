import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Play, Radio, Square, Trash2, Users } from 'lucide-react';
import { ConnectionState, TranscriptSegment } from '../types';

interface LiveKitPanelProps {
  transcripts: TranscriptSegment[];
  interimTranscript: string;
  connectionState: ConnectionState;
  isAgentConnected: boolean;
  agentName: string | null;
  participantCount: number;
  error: string | null;
  roomName: string;
  onRoomNameChange: (name: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onClear: () => void;
  roomPlaceholder?: string;
}

const providerClasses: Record<string, string> = {
  google: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
  azure: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200',
};

const LiveKitPanel: React.FC<LiveKitPanelProps> = ({
  transcripts,
  interimTranscript,
  connectionState,
  isAgentConnected,
  agentName,
  participantCount,
  error,
  roomName,
  onRoomNameChange,
  onConnect,
  onDisconnect,
  onClear,
  roomPlaceholder = 'Room name',
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [interimTranscript, transcripts]);

  const isConnected = connectionState === ConnectionState.CONNECTED;
  const isConnecting = connectionState === ConnectionState.CONNECTING;
  const isActive = isConnected || isConnecting;
  const hasContent = transcripts.length > 0 || Boolean(interimTranscript);
  const status = connectionState === ConnectionState.ERROR
    ? { label: 'Connection error', dot: 'status-dot--error' }
    : isConnecting
      ? { label: 'Connecting', dot: 'status-dot--pending' }
      : isConnected && isAgentConnected
        ? { label: agentName ? `Agent: ${agentName}` : 'Agent ready', dot: 'status-dot--live' }
        : isConnected
          ? { label: 'Waiting for agent', dot: 'status-dot--pending' }
          : { label: 'Disconnected', dot: '' };
  const agentCommand = `curl -X POST localhost:3000/livekit/agent/start -H "Content-Type: application/json" -d '{"roomName":"${roomName}","provider":"google"}'`;

  const copyAgentCommand = async () => {
    try {
      await navigator.clipboard.writeText(agentCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <article className="app-panel flex min-h-[390px] flex-col" aria-label="LiveKit transcription workspace">
      <header className="panel-header flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-violet-500/15 text-violet-300">
            <Radio size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="text-sm font-semibold text-slate-100">LiveKit / WebRTC</h3>
              <span className="flex items-center gap-2 text-xs text-slate-400">
                <span className={`status-dot ${status.dot}`} aria-hidden="true" />
                {status.label}
              </span>
            </div>
            {isConnected && (
              <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                <span className="font-mono text-slate-400">{roomName}</span>
                <span aria-hidden="true">·</span>
                <Users size={13} aria-hidden="true" />
                {participantCount} participant{participantCount === 1 ? '' : 's'}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isActive && (
            <label className="sr-only" htmlFor="livekit-room">LiveKit room name</label>
          )}
          {!isActive && (
            <input
              id="livekit-room"
              type="text"
              value={roomName}
              onChange={(event) => onRoomNameChange(event.target.value)}
              placeholder={roomPlaceholder}
              className="h-9 w-full rounded-lg border border-slate-600 bg-slate-950/40 px-3 text-sm text-slate-100 placeholder:text-slate-500 sm:w-44"
            />
          )}
          {isActive ? (
            <button onClick={onDisconnect} className="control-button control-button--danger" aria-label="Disconnect from LiveKit">
              <Square size={14} fill="currentColor" aria-hidden="true" /> Disconnect
            </button>
          ) : (
            <button onClick={onConnect} disabled={!roomName.trim()} className="control-button control-button--primary" aria-label="Connect to LiveKit">
              <Play size={14} fill="currentColor" aria-hidden="true" /> Connect
            </button>
          )}
          <button onClick={onClear} className="control-button control-button--quiet" aria-label="Clear LiveKit transcripts">
            <Trash2 size={14} aria-hidden="true" /> <span className="hidden sm:inline">Clear</span>
          </button>
        </div>
      </header>

      {error && (
        <div className="border-b border-red-400/30 bg-red-950/35 px-4 py-2.5 text-sm text-red-200" role="alert">
          {error}
        </div>
      )}

      {isConnected && !isAgentConnected && (
        <div className="border-b border-amber-300/25 bg-amber-300/5 px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-amber-100">Waiting for the ASR agent. Start it for this room to begin recognition.</p>
            <button onClick={copyAgentCommand} className="control-button control-button--quiet shrink-0 text-amber-100" aria-label="Copy agent start command">
              {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy command'}
            </button>
          </div>
          <code className="mt-2 block overflow-x-auto rounded-md border border-amber-200/15 bg-slate-950/35 px-3 py-2 text-xs text-slate-300">{agentCommand}</code>
        </div>
      )}

      <div ref={scrollRef} className="transcript-scroller min-h-[250px] flex-1 overflow-y-auto px-4 py-2 sm:px-5">
        {!hasContent ? (
          <div className="flex h-full min-h-[230px] max-w-sm flex-col justify-center">
            <p className="text-base font-medium text-slate-300">
              {!isConnected ? 'Connect a room to begin monitoring.' : isAgentConnected ? 'Listening for Thai speech.' : 'The stream is ready; waiting for the ASR agent.'}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-500">Final segments stay here for comparison. New interim text appears separately so it never disrupts your reading flow.</p>
          </div>
        ) : (
          <div>
            {transcripts.map((segment, index) => (
              <div key={segment.id} className="transcript-row grid grid-cols-[2.25rem_1fr] gap-3 py-3.5">
                <span className="pt-0.5 text-xs tabular-nums text-slate-500">{String(index + 1).padStart(2, '0')}</span>
                <div className="min-w-0">
                  {segment.provider && (
                    <span className={`mb-1.5 inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${providerClasses[segment.provider] ?? 'border-violet-400/30 bg-violet-400/10 text-violet-200'}`}>
                      {segment.provider.toUpperCase()}
                    </span>
                  )}
                  <p className="text-[1.05rem] leading-8 text-slate-100">{segment.text}</p>
                </div>
              </div>
            ))}
            {interimTranscript && (
              <div className="my-2 rounded-lg border border-violet-400/35 bg-violet-500/10 px-3.5 py-3" aria-label="Live interim transcript" aria-live="polite">
                <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-violet-200">
                  <span className="status-dot status-dot--pending" aria-hidden="true" /> Live preview
                </div>
                <p className="text-[1.05rem] leading-8 text-violet-50">{interimTranscript}</p>
              </div>
            )}
          </div>
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
