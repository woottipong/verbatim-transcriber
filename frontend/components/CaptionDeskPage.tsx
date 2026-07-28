import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Radio, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useCaptionDesk } from '../hooks/useCaptionDesk';
import {
  fetchAgentStatus,
  fetchDetailedRooms,
  type RoomDetails,
  type RunningAgent,
} from '../lib/api';
import { buildCaptionDeskUrl } from '../lib/appRoutes';
import { shouldPublishOnEnter } from '../lib/captionDeskMessages';
import { formatProviderName, type AgentProvider } from '../lib/providers';
import { ConnectionState } from '../types';

interface CaptionDeskPageProps {
  backendUrl: string;
  roomName: string;
  providerName: string;
}

export default function CaptionDeskPage({ backendUrl, roomName, providerName }: CaptionDeskPageProps) {
  const provider = providerName as AgentProvider;
  const validProvider = isAgentProvider(provider);
  if (!roomName || !validProvider) return <CaptionDeskLauncher backendUrl={backendUrl} />;
  return <ConnectedCaptionDesk backendUrl={backendUrl} roomName={roomName} provider={provider} />;
}

function ConnectedCaptionDesk({ backendUrl, roomName, provider }: {
  backendUrl: string;
  roomName: string;
  provider: AgentProvider;
}) {
  const {
    snapshot, connectionState, error, agentConnected, edit,
    setInterimEnabled, setInterimReviewEnabled, publish, reconnect,
  } =
    useCaptionDesk(backendUrl, roomName, provider);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showInterim, setShowInterim] = useState(true);
  const [useInterimInReview, setUseInterimInReview] = useState(false);
  const connected = connectionState === ConnectionState.CONNECTED;
  const reviewSourceLocked =
    snapshot.sourceSegmentIds.length > 0 ||
    snapshot.queuedCount > 0 ||
    snapshot.waiting.length > 0;

  useEffect(() => textareaRef.current?.focus(), []);

  const release = (splitAtCaret = false) => {
    const splitIndex = splitAtCaret ? textareaRef.current?.selectionStart : undefined;
    void publish(splitIndex).finally(() => requestAnimationFrame(() => textareaRef.current?.focus()));
  };
  const toggleInterim = () => {
    const next = !showInterim;
    setShowInterim(next);
    setInterimEnabled(next);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };
  const toggleInterimReview = async (next: boolean) => {
    if (next === useInterimInReview) return;
    const previous = useInterimInReview;
    setUseInterimInReview(next);
    const changed = await setInterimReviewEnabled(next);
    if (!changed) setUseInterimInReview(previous);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  return (
    <div className="app-shell flex min-h-screen flex-col bg-[var(--canvas)] text-[var(--ink)]">
      <header className="app-header">
        <div className="app-header__content mx-auto flex w-full max-w-[1480px] items-center justify-between gap-6 px-5 sm:px-8">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="text-xl font-bold text-teal-200">CaptionLive</span>
              <span className="h-6 w-px bg-[var(--line)]" aria-hidden="true" />
              <h1 className="truncate text-lg font-semibold">Caption Desk</h1>
            </div>
            <p className="mt-1 truncate text-sm text-[var(--muted)]">
              {roomName} · {formatProviderName(provider)}
            </p>
          </div>
          <div className="flex items-center gap-5 text-sm">
            <div className="flex items-center gap-4">
              <Status connected={connected} label={connected ? 'Connected' : 'Connecting'} />
              <Status connected={agentConnected} label={agentConnected ? 'Agent connected' : 'Agent unavailable'} />
            </div>
            <a href="#caption-desk" className="control-button control-button--inline !min-h-9">
              Change
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1480px] flex-1 flex-col px-5 py-6 sm:px-8">
        {(error || snapshot.error || connectionState === ConnectionState.DISCONNECTED) && (
          <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-red-400/35 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
            <span>{snapshot.error || error || 'Caption Desk disconnected. Your current edits are preserved.'}</span>
            {connectionState !== ConnectionState.CONNECTED && (
              <button type="button" onClick={reconnect} className="control-button control-button--inline shrink-0">
                <RefreshCw size={15} /> Reconnect
              </button>
            )}
          </div>
        )}
        <div className="grid min-h-[62vh] flex-1 gap-4 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
          <section className="app-panel order-2 flex min-h-[280px] flex-col overflow-hidden bg-[var(--canvas-raised)] shadow-none lg:order-1" aria-labelledby="published-captions-heading">
            <div className="panel-header px-4 py-2.5">
              <h2 id="published-captions-heading" className="text-sm font-semibold">Published</h2>
              <p className="text-xs text-[var(--subtle)]">Release history</p>
            </div>
            <div className="flex-1 overflow-y-auto">
              {snapshot.waiting.length === 0 && snapshot.recentlyPublished.length === 0 ? (
                <p className="px-4 py-5 text-sm leading-6 text-[var(--subtle)]">Published captions will appear here after you press Enter.</p>
              ) : (
                <ol className="divide-y divide-[var(--line)]">
                  {[...snapshot.waiting].reverse().map(item => (
                    <li key={item.requestId} className="px-4 py-3">
                      <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-amber-300">
                        <RefreshCw className="animate-spin" size={13} aria-hidden="true" /> Sending…
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--ink)]">{item.text}</p>
                    </li>
                  ))}
                  {[...snapshot.recentlyPublished].reverse().map(item => (
                    <li key={item.publicationId} className="px-4 py-3">
                      <time className="mb-1 block text-xs text-[var(--subtle)]" dateTime={new Date(item.publishedAt).toISOString()}>
                        {formatPublishedTime(item.publishedAt)}
                      </time>
                      <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--ink)]">{item.text}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>

          <section className="app-panel order-1 flex min-h-[62vh] flex-col lg:order-2" aria-labelledby="review-caption-heading">
            <div className="panel-header flex flex-col items-stretch gap-3 px-5 py-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h2 id="review-caption-heading" className="font-semibold">Review caption</h2>
                <p className="text-xs text-[var(--muted)]">Place the cursor at a break, then press Enter to publish up to it.</p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 xl:justify-end">
                <fieldset className="flex items-center gap-2">
                  <legend className="sr-only">Review source</legend>
                  <span id="review-source-label" className="text-xs text-[var(--muted)]">Review source</span>
                  <div className="flex rounded-lg border border-[var(--line)] bg-[var(--canvas)] p-0.5">
                    <button
                      type="button"
                      onClick={() => void toggleInterimReview(false)}
                      disabled={reviewSourceLocked && useInterimInReview}
                      aria-describedby="review-source-label review-source-help"
                      aria-pressed={!useInterimInReview}
                      className={`min-h-11 rounded-md px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                        !useInterimInReview ? 'bg-[var(--surface-raised)] text-[var(--ink)]' : 'text-[var(--muted)]'
                      }`}
                    >
                      Final
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleInterimReview(true)}
                      disabled={reviewSourceLocked && !useInterimInReview}
                      aria-describedby="review-source-label review-source-help"
                      aria-pressed={useInterimInReview}
                      className={`min-h-11 rounded-md px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                        useInterimInReview ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--muted)]'
                      }`}
                    >
                      Interim
                    </button>
                  </div>
                </fieldset>
                <div className="text-right text-xs text-[var(--muted)]">
                  {snapshot.sourceSegmentIds.length} segment{snapshot.sourceSegmentIds.length === 1 ? '' : 's'}
                  {snapshot.sourceSegmentIds.length > 0 && (
                    <SegmentAge segmentKey={snapshot.sourceSegmentIds.join(':')} />
                  )}
                  {!useInterimInReview && snapshot.queuedCount > 0 && <span className="text-[var(--subtle)]"> · Next {snapshot.queuedCount}</span>}
                  {snapshot.waiting.length > 0 && <span> · Sending {snapshot.waiting.length}</span>}
                </div>
              </div>
              <p id="review-source-help" className={`text-xs text-[var(--subtle)] ${reviewSourceLocked ? '' : 'sr-only'}`}>
                {reviewSourceLocked
                  ? 'Publish pending captions before changing the review source.'
                  : 'Choose whether finalized or live draft text enters the review editor.'}
              </p>
            </div>
            <textarea
              ref={textareaRef}
              value={snapshot.reviewText}
              onChange={event => edit(event.target.value)}
              onKeyDown={event => {
                if (!shouldPublishOnEnter(event.nativeEvent)) return;
                event.preventDefault();
                release(true);
              }}
              placeholder={agentConnected ? 'Final transcript text will collect here…' : 'Waiting for the transcriber…'}
              aria-label="Caption text to review and publish"
              className="min-h-[340px] w-full flex-1 resize-none border-0 bg-transparent px-6 py-6 text-2xl leading-relaxed text-[var(--ink)] outline-none placeholder:text-[var(--subtle)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] sm:text-3xl"
            />
            <div className={`border-t border-[var(--line)] bg-[var(--control-surface-bg)] px-6 ${showInterim ? 'min-h-20 py-3' : 'min-h-12 py-1.5'}`}>
              <div className={`flex items-center justify-between gap-4 ${showInterim ? 'mb-1' : ''}`}>
                <div className="flex items-center gap-2 text-xs font-medium text-[var(--accent)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                  Live draft
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={toggleInterim}
                    aria-expanded={showInterim}
                    className="control-button control-button--inline !min-h-11 px-3 text-xs"
                  >
                    {showInterim ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              {showInterim && (
                <p className="max-h-14 overflow-hidden text-lg leading-7 text-[var(--muted)]">
                  {snapshot.incomingDraft || <span className="text-[var(--subtle)]">Waiting for speech…</span>}
                </p>
              )}
            </div>
            <footer className="flex items-center justify-between border-t border-[var(--line)] bg-[var(--control-surface-bg)] px-5 py-3">
              <span className="text-sm text-[var(--muted)]">{snapshot.reviewText.length} characters</span>
              <span className="text-xs text-[var(--subtle)]">Enter publishes to cursor · Shift+Enter new line</span>
            </footer>
          </section>
        </div>
        <span className="sr-only" aria-live="polite">
          {snapshot.error || (snapshot.recentlyPublished.at(-1) ? 'Caption published' : '')}
        </span>
      </main>
    </div>
  );
}

function SegmentAge({ segmentKey }: { segmentKey: string }) {
  const [age, setAge] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    setAge(0);
    const timer = window.setInterval(() => {
      setAge(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [segmentKey]);

  return <span> · {age}s behind</span>;
}

function Status({ connected, label }: { connected: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${connected ? 'text-emerald-300' : 'text-amber-300'}`}>
      {connected ? <Wifi size={16} /> : <WifiOff size={16} />}
      {label}
    </span>
  );
}

function formatPublishedTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp);
}

function CaptionDeskLauncher({ backendUrl }: { backendUrl: string }) {
  const [agents, setAgents] = useState<RunningAgent[]>([]);
  const [rooms, setRooms] = useState<RoomDetails[]>([]);
  const [roomName, setRoomName] = useState('');
  const [provider, setProvider] = useState<AgentProvider | ''>('');
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roomNames = useMemo(
    () => rooms.map(room => room.name).sort(),
    [rooms],
  );
  const providers = useMemo(
    () => Array.from(new Set(
      agents
        .filter(agent => agent.running && agent.room === roomName && isAgentProvider(agent.provider))
        .map(agent => agent.provider as AgentProvider),
    )),
    [agents, roomName],
  );

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [roomList, status] = await Promise.all([
        fetchDetailedRooms(backendUrl),
        fetchAgentStatus(backendUrl),
      ]);
      setRooms(roomList);
      setAgents(status.agents);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load Caption Desk options.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [backendUrl]);
  useEffect(() => {
    if (!roomNames.includes(roomName)) setRoomName(roomNames[0] || '');
  }, [roomName, roomNames]);
  useEffect(() => {
    if (!provider || !providers.includes(provider)) setProvider(providers[0] || '');
  }, [provider, providers]);

  const connect = async () => {
    if (!roomName || !provider) return;
    setConnecting(true);
    window.location.href = buildCaptionDeskUrl(
      `${window.location.origin}${window.location.pathname}`,
      roomName,
      provider,
    );
  };

  return (
    <div className="app-shell min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <header className="app-header">
        <div className="app-header__content mx-auto flex w-full max-w-[1480px] items-center px-5 sm:px-8">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-xl font-bold text-teal-200">CaptionLive</span>
              <span className="h-6 w-px bg-[var(--line)]" aria-hidden="true" />
              <h1 className="text-lg font-semibold">Caption Desk</h1>
            </div>
            <p className="mt-1 text-sm text-[var(--muted)]">Review and publish moderated captions.</p>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-col px-5 py-12 sm:px-8">
        <section className="app-panel p-5 sm:p-6" aria-labelledby="caption-desk-connect-heading">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-400/10 text-teal-200">
              <Radio size={19} aria-hidden="true" />
            </span>
            <div>
              <h2 id="caption-desk-connect-heading" className="text-lg font-semibold">Connect to a caption desk</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">Choose a room and one of its active transcription providers.</p>
            </div>
          </div>

          {error && (
            <div className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-red-400/35 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
              <span>{error}</span>
              <button type="button" onClick={() => void refresh()} className="control-button control-button--inline shrink-0">
                <RefreshCw size={15} /> Retry
              </button>
            </div>
          )}

          {!error && !loading && rooms.length === 0 ? (
            <div className="mt-5 rounded-lg bg-[var(--control-surface-bg)] px-4 py-4">
              <p className="text-sm font-medium">No rooms are available.</p>
              <p className="mt-1 text-sm text-[var(--muted)]">Create a room in Control Room, then refresh this page.</p>
              <div className="mt-4 flex items-center gap-2">
                <a href="#" className="control-button control-button--quiet">Open Control Room</a>
                <button type="button" onClick={() => void refresh()} className="control-button control-button--inline">
                  <RefreshCw size={15} /> Refresh
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-6 grid gap-4">
              <label className="grid gap-2 text-sm font-medium" htmlFor="caption-desk-room">
                Room
                <select
                  id="caption-desk-room"
                  value={roomName}
                  onChange={event => setRoomName(event.target.value)}
                  disabled={loading}
                  className="h-11 rounded-lg border border-[var(--line)] bg-[var(--control-surface-bg)] px-3 text-[var(--ink)]"
                >
                  {loading && <option value="">Loading rooms…</option>}
                  {roomNames.map(room => <option key={room} value={room}>{room}</option>)}
                </select>
              </label>
              <label className="grid gap-2 text-sm font-medium" htmlFor="caption-desk-provider">
                Provider
                <select
                  id="caption-desk-provider"
                  value={provider}
                  onChange={event => setProvider(event.target.value as AgentProvider)}
                  disabled={loading || !roomName}
                  className="h-11 rounded-lg border border-[var(--line)] bg-[var(--control-surface-bg)] px-3 text-[var(--ink)]"
                >
                  {loading && <option value="">Loading providers…</option>}
                  {!loading && providers.length === 0 && <option value="">No active providers</option>}
                  {providers.map(item => <option key={item} value={item}>{formatProviderName(item)}</option>)}
                </select>
                {!loading && roomName && providers.length === 0 && (
                  <span className="text-xs font-normal text-amber-200">Start a transcription provider for this room in Control Room.</span>
                )}
              </label>
              <button
                type="button"
                onClick={() => void connect()}
                disabled={loading || connecting || !roomName || !provider}
                className="control-button control-button--primary mt-1 h-11 justify-center"
              >
                {connecting ? <RefreshCw className="animate-spin" size={16} /> : <ArrowRight size={16} />}
                {connecting ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function isAgentProvider(value: string): value is AgentProvider {
  return ['google', 'gemini', 'azure', 'gpt-realtime-whisper'].includes(value);
}
