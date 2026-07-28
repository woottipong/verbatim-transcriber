import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Radio, RefreshCw } from 'lucide-react';
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
  if (!roomName || !validProvider) {
    return <CaptionDeskLauncher backendUrl={backendUrl} initialRoomName={roomName} />;
  }
  const hashParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const initialInterim = hashParams.get('source') === 'interim';
  return <ConnectedCaptionDesk backendUrl={backendUrl} roomName={roomName} provider={provider} initialInterim={initialInterim} />;
}

function ConnectedCaptionDesk({ backendUrl, roomName, provider, initialInterim = false }: {
  backendUrl: string;
  roomName: string;
  provider: AgentProvider;
  initialInterim?: boolean;
}) {
  const {
    snapshot, connectionState, error, agentConnected, captionConnected, edit,
    setInterimReviewEnabled, publish, reconnect,
  } =
    useCaptionDesk(backendUrl, roomName, provider);
  const editorRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const [useInterimInReview, setUseInterimInReview] = useState(initialInterim);
  const connected = connectionState === ConnectionState.CONNECTED;
  const reviewSourceLocked =
    snapshot.sourceSegmentIds.length > 0 ||
    snapshot.queuedCount > 0 ||
    snapshot.waiting.length > 0;

  useEffect(() => editorRef.current?.focus(), []);
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.textContent !== snapshot.reviewText) {
      editor.textContent = snapshot.reviewText;
    }
  }, [snapshot.reviewText]);
  useEffect(() => {
    if (historyRef.current && snapshot.recentlyPublished.length > 0) {
      historyRef.current.scrollTop = 0;
    }
  }, [snapshot.recentlyPublished.length]);

  const release = (splitAtCaret = false) => {
    const splitIndex = splitAtCaret ? getContentEditableCaretOffset(editorRef.current) : undefined;
    void publish(splitIndex).finally(() => requestAnimationFrame(() => editorRef.current?.focus()));
  };
  const toggleInterimReview = async (next: boolean) => {
    if (next === useInterimInReview) return;
    const previous = useInterimInReview;
    setUseInterimInReview(next);
    const changed = await setInterimReviewEnabled(next);
    if (!changed) setUseInterimInReview(previous);
    requestAnimationFrame(() => editorRef.current?.focus());
  };

  return (
    <div className="app-shell flex h-dvh flex-col overflow-hidden bg-[var(--canvas)] text-[var(--ink)]">
      <a href="#main-content" className="app-skip-link">
        Skip to content
      </a>
      <header className="app-header">
        <div className="app-header__content caption-desk-navbar mx-auto w-full max-w-7xl px-4 py-3 sm:px-6">
          <div className="caption-desk-navbar__brand flex min-w-0 items-center gap-3">
            <img src="/captionlive-mark.svg" alt="" className="h-10 w-10 shrink-0 rounded-lg" aria-hidden="true" />
            <div className="min-w-0">
              <h1 className="flex min-w-0 items-center gap-2 truncate text-lg font-semibold tracking-tight sm:text-xl">
                <span className="shrink-0 text-[var(--accent)]">CaptionLive</span>
                <span className="h-4 w-px shrink-0 bg-[var(--line)]" aria-hidden="true" />
                <span className="truncate">Caption Desk</span>
              </h1>
              <p className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-sm">
                <span className="text-[var(--muted)]">Room</span>
                <strong className="truncate font-semibold text-[var(--ink)]">{roomName}</strong>
                <span className="text-[var(--subtle)]" aria-hidden="true">·</span>
                <strong className="truncate font-semibold text-[var(--ink)]">{formatProviderName(provider)}</strong>
              </p>
            </div>
          </div>
          <div className="caption-desk-navbar__controls flex items-center justify-end gap-2">
            <div className="flex items-center gap-1.5" aria-label="Caption Desk status">
              <Status connected={connected} label={connected ? 'Room connected' : 'Room connecting'} />
              <Status
                connected={captionConnected}
                label={captionConnected
                  ? 'Receiving captions'
                  : agentConnected
                    ? 'Connecting captions'
                    : 'Transcriber unavailable'}
              />
            </div>
            <a
              href={buildCaptionDeskUrl(
                `${window.location.origin}${window.location.pathname}`,
                roomName,
                '',
              )}
              className="control-button control-button--inline"
            >
              Change
            </a>
          </div>
        </div>
      </header>

      <main id="main-content" className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6 sm:py-5">
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
        <div className="caption-desk-workspace grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,19rem)]">
          <section className="app-panel caption-desk-history order-2 flex min-h-0 flex-col overflow-hidden bg-[var(--canvas-raised)] shadow-none lg:order-2 lg:h-full" aria-labelledby="published-captions-heading">
            <div className="panel-header px-4 py-2.5">
              <h2 id="published-captions-heading" className="text-sm font-semibold">Published</h2>
              <p className="text-xs text-[var(--subtle)]">Release history</p>
            </div>
            <div ref={historyRef} className="flex-1 overflow-y-auto">
              {snapshot.waiting.length === 0 && snapshot.recentlyPublished.length === 0 ? (
                <p className="px-4 py-5 text-sm leading-6 text-[var(--subtle)]">Captions you publish will appear here.</p>
              ) : (
                <ol className="divide-y divide-[var(--line)]">
                  {[...snapshot.waiting].reverse().map(item => (
                    <li key={item.requestId} className="px-4 py-3">
                      <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-[var(--status-warning-text)]">
                        <RefreshCw className="animate-spin" size={13} aria-hidden="true" /> Sending…
                      </div>
                      <p className="break-words whitespace-pre-wrap text-sm leading-6 text-[var(--ink)] [overflow-wrap:anywhere]">{item.text}</p>
                    </li>
                  ))}
                  {[...snapshot.recentlyPublished].slice(-10).reverse().map(item => (
                    <li key={item.publicationId} className="px-4 py-3">
                      <time className="mb-1 block text-xs text-[var(--subtle)]" dateTime={new Date(item.publishedAt).toISOString()}>
                        {formatPublishedTime(item.publishedAt)}
                      </time>
                      <p className="break-words whitespace-pre-wrap text-sm leading-6 text-[var(--ink)] [overflow-wrap:anywhere]">{item.text}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>

          <section className="app-panel order-1 flex min-h-[20rem] flex-col lg:order-1 lg:h-full lg:min-h-0" aria-labelledby="review-caption-heading">
            <div className="panel-header caption-desk-toolbar px-4 py-2.5 sm:px-5">
              <div className="min-w-0">
                <h2 id="review-caption-heading" className="font-semibold">Review caption</h2>
                <p className="truncate text-xs text-[var(--muted)]">Place the cursor at a break, then press Enter to publish up to it.</p>
              </div>
              <div className="caption-desk-toolbar__tools">
                <span className="caption-desk-source-badge" aria-label={`Review source: ${useInterimInReview ? 'Interim' : 'Final'}`}>
                  {useInterimInReview ? 'Interim' : 'Final'}
                </span>
                <div className="caption-desk-queue-status text-right text-xs text-[var(--muted)]">
                  {snapshot.sourceSegmentIds.length > 0 && (
                    <>{snapshot.sourceSegmentIds.length} segment{snapshot.sourceSegmentIds.length === 1 ? '' : 's'}</>
                  )}
                  {snapshot.sourceSegmentIds.length > 0 && (
                    <SegmentAge segmentKey={snapshot.sourceSegmentIds.join(':')} />
                  )}
                  {!useInterimInReview && snapshot.queuedCount > 0 && <span className="text-[var(--subtle)]"> · Next {snapshot.queuedCount}</span>}
                  {snapshot.waiting.length > 0 && <span> · Sending {snapshot.waiting.length}</span>}
                </div>
              </div>
            </div>
            <div
              ref={editorRef}
              role="textbox"
              contentEditable="plaintext-only"
              suppressContentEditableWarning
              aria-multiline="true"
              data-placeholder={captionConnected
                ? 'Final transcript text will collect here…'
                : agentConnected
                  ? 'Connecting to the caption feed…'
                  : 'Waiting for the transcriber…'}
              data-draft={!useInterimInReview ? snapshot.draftPreview : ''}
              onInput={event => edit(event.currentTarget.textContent || '')}
              onKeyDown={event => {
                if (!shouldPublishOnEnter(event.nativeEvent)) return;
                event.preventDefault();
                release(true);
              }}
              aria-label="Caption text to review and publish"
              className="caption-review-editor transcript-paragraph-source w-full flex-1 overflow-y-auto bg-transparent px-4 py-3 text-[var(--ink)] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] sm:px-5 sm:py-4"
            />
            <span className="sr-only" aria-live="polite">
              {!useInterimInReview && snapshot.isDraftActive
                ? 'Draft active, waiting for final'
                : ''}
            </span>
            <footer className="caption-desk-editor-footer flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-[var(--line)] bg-[var(--control-surface-bg)] px-4 py-2.5 sm:px-5">
              <span className="text-sm text-[var(--muted)]">{snapshot.reviewText.length} characters</span>
              <span className="text-xs text-[var(--subtle)] hidden sm:inline">Enter → publish to cursor · Shift+Enter → new line</span>
              <span className="text-xs text-[var(--subtle)] sm:hidden">Enter → publish · Shift+Enter → new line</span>
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

function getContentEditableCaretOffset(editor: HTMLDivElement | null): number | undefined {
  if (!editor) return undefined;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return undefined;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(editor);
  prefix.setEnd(range.startContainer, range.startOffset);
  return prefix.toString().length;
}

function Status({ connected, label }: { connected: boolean; label: string }) {
  return (
    <span className={`admin-status ${connected ? 'admin-status--success' : 'admin-status--warning'}`}>
      <span className={`status-dot ${connected ? 'status-dot--live' : 'status-dot--pending'}`} aria-hidden="true" />
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

function CaptionDeskLauncher({
  backendUrl,
  initialRoomName,
}: {
  backendUrl: string;
  initialRoomName: string;
}) {
  const fixedRoomName = initialRoomName.trim();
  const [agents, setAgents] = useState<RunningAgent[]>([]);
  const [rooms, setRooms] = useState<RoomDetails[]>([]);
  const [roomName, setRoomName] = useState(fixedRoomName);
  const [provider, setProvider] = useState<AgentProvider | ''>('');
  const [reviewSource, setReviewSource] = useState<'final' | 'interim'>('final');
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
    if (loading) return;
    if (fixedRoomName) {
      if (roomName !== fixedRoomName) setRoomName(fixedRoomName);
      return;
    }
    if (!roomNames.includes(roomName)) setRoomName(roomNames[0] || '');
  }, [fixedRoomName, loading, roomName, roomNames]);
  useEffect(() => {
    if (!provider || !providers.includes(provider)) setProvider(providers[0] || '');
  }, [provider, providers]);

  const connect = async () => {
    if (!roomName || !provider) return;
    setConnecting(true);
    const base = `${window.location.origin}${window.location.pathname}`;
    const url = new URL(base);
    const params = new URLSearchParams();
    if (roomName.trim()) params.set('room', roomName.trim());
    params.set('provider', provider.trim().toLowerCase());
    if (reviewSource === 'interim') params.set('source', 'interim');
    url.hash = `caption-desk?${params.toString()}`;
    window.location.href = url.toString();
  };

  return (
    <div className="app-shell min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <a href="#main-content" className="app-skip-link">
        Skip to content
      </a>
      <header className="app-header">
        <div className="app-header__content mx-auto flex w-full max-w-7xl items-center px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/captionlive-mark.svg" alt="" className="h-10 w-10 shrink-0 rounded-lg" aria-hidden="true" />
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight sm:text-xl">
                <span className="text-[var(--accent)]">CaptionLive</span>
                <span className="h-4 w-px bg-[var(--line)]" aria-hidden="true" />
                <span>Caption Desk</span>
              </h1>
              <p className="mt-0.5 text-xs text-[var(--muted)]">Review and publish moderated captions.</p>
            </div>
          </div>
        </div>
      </header>
      <main id="main-content" className="mx-auto flex w-full max-w-2xl flex-col px-4 py-8 sm:px-6 sm:py-10">
        <section className="app-panel p-5 sm:p-6" aria-labelledby="caption-desk-connect-heading">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
              <Radio size={19} aria-hidden="true" />
            </span>
            <div>
              <h2 id="caption-desk-connect-heading" className="text-lg font-semibold">Connect to a caption desk</h2>
              {fixedRoomName ? (
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Room <strong className="font-semibold text-[var(--ink)]">{fixedRoomName}</strong>
                  <span aria-hidden="true"> · </span>
                  Choose an active transcription provider.
                </p>
              ) : (
                <p className="mt-1 text-sm text-[var(--muted)]">Choose a room and one of its active transcription providers.</p>
              )}
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
              <p className="text-sm font-medium">No rooms yet.</p>
              <p className="mt-1 text-sm text-[var(--muted)]">Start by creating one in Control Room, then come back here.</p>
              <div className="mt-4 flex items-center gap-2">
                <a href="#admin" className="control-button control-button--quiet">Open Control Room</a>
                <button type="button" onClick={() => void refresh()} className="control-button control-button--inline">
                  <RefreshCw size={15} /> Refresh
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-6 grid gap-4">
              {!fixedRoomName && (
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
              )}
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
                  <span className="text-xs font-normal text-[var(--status-warning-text)]">Start a transcription provider for this room in Control Room.</span>
                )}
              </label>
              <div className="grid gap-2.5">
                <span className="text-sm font-medium text-[var(--ink)]" id="review-source-launcher-label">
                  Review Source Mode
                </span>
                <div
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                  role="radiogroup"
                  aria-labelledby="review-source-launcher-label"
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={reviewSource === 'final'}
                    onClick={() => setReviewSource('final')}
                    className={`flex flex-col text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                      reviewSource === 'final'
                        ? 'border-[var(--accent)] bg-[var(--surface-raised)] ring-1 ring-[var(--accent)]'
                        : 'border-[var(--line)] bg-[var(--control-surface-bg)] hover:border-[var(--line-strong)]'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold text-sm text-[var(--ink)]">
                      <span>Final Text</span>
                      <span className={`h-2.5 w-2.5 rounded-full transition-colors ${reviewSource === 'final' ? 'bg-[var(--accent)]' : 'border border-[var(--line)]'}`} />
                    </div>
                    <p className="mt-1.5 text-xs text-[var(--muted)] leading-relaxed">
                      Waits for confirmed final text. Stable with zero text flickering.
                    </p>
                  </button>

                  <button
                    type="button"
                    role="radio"
                    aria-checked={reviewSource === 'interim'}
                    onClick={() => setReviewSource('interim')}
                    className={`flex flex-col text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                      reviewSource === 'interim'
                        ? 'border-[var(--accent)] bg-[var(--surface-raised)] ring-1 ring-[var(--accent)]'
                        : 'border-[var(--line)] bg-[var(--control-surface-bg)] hover:border-[var(--line-strong)]'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold text-sm text-[var(--ink)]">
                      <span>Live Draft (Interim)</span>
                      <span className={`h-2.5 w-2.5 rounded-full transition-colors ${reviewSource === 'interim' ? 'bg-[var(--accent)]' : 'border border-[var(--line)]'}`} />
                    </div>
                    <p className="mt-1.5 text-xs text-[var(--muted)] leading-relaxed">
                      Streams real-time words into the editor immediately as spoken.
                    </p>
                  </button>
                </div>
              </div>
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
