import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Radio, RefreshCw } from 'lucide-react';
import {
  fetchAgentStatus,
  fetchDetailedRooms,
  type RoomDetails,
  type RunningAgent,
} from '../../lib/api';
import { buildCaptionDeskUrl } from '../../lib/appRoutes';
import { formatCaptionDeskError } from '../../lib/captionDeskPresentation';
import { formatProviderName, selectActiveRoomProviders, type AgentProvider } from '../../lib/providers';

interface CaptionDeskLauncherProps {
  backendUrl: string;
  initialRoomName: string;
}

export function CaptionDeskLauncher({
  backendUrl,
  initialRoomName,
}: CaptionDeskLauncherProps) {
  const fixedRoomName = initialRoomName.trim();
  const [agents, setAgents] = useState<RunningAgent[]>([]);
  const [rooms, setRooms] = useState<RoomDetails[]>([]);
  const [roomName, setRoomName] = useState(fixedRoomName);
  const [provider, setProvider] = useState<AgentProvider | ''>('');
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roomNames = useMemo(
    () => rooms.map(room => room.name).sort(),
    [rooms],
  );
  const providers = useMemo(
    () => selectActiveRoomProviders(agents, roomName),
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
      setError(formatCaptionDeskError(cause));
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

  const connect = () => {
    if (!roomName || !provider) return;
    setConnecting(true);
    const base = `${window.location.origin}${window.location.pathname}`;
    window.location.href = buildCaptionDeskUrl(base, roomName, provider);
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

          {error ? (
            <div className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-red-400/35 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
              <span>{error}</span>
              <button type="button" onClick={() => void refresh()} className="control-button control-button--inline shrink-0">
                <RefreshCw size={15} /> Retry
              </button>
            </div>
          ) : !loading && rooms.length === 0 ? (
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
              {!fixedRoomName ? (
                <label className="grid gap-2 text-sm font-medium" htmlFor="caption-desk-room">
                  Room
                  <select
                    id="caption-desk-room"
                    value={roomName}
                    onChange={event => setRoomName(event.target.value)}
                    disabled={loading}
                    className="h-11 rounded-lg border border-[var(--line)] bg-[var(--control-surface-bg)] px-3 text-[var(--ink)]"
                  >
                    {loading ? <option value="">Loading rooms…</option> : null}
                    {roomNames.map(room => <option key={room} value={room}>{room}</option>)}
                  </select>
                </label>
              ) : null}

              <label className="grid gap-2 text-sm font-medium" htmlFor="caption-desk-provider">
                Provider
                <select
                  id="caption-desk-provider"
                  value={provider}
                  onChange={event => setProvider(event.target.value as AgentProvider)}
                  disabled={loading || !roomName}
                  className="h-11 rounded-lg border border-[var(--line)] bg-[var(--control-surface-bg)] px-3 text-[var(--ink)]"
                >
                  {loading ? <option value="">Loading providers…</option> : null}
                  {!loading && providers.length === 0 ? <option value="">No active providers</option> : null}
                  {providers.map(item => <option key={item} value={item}>{formatProviderName(item)}</option>)}
                </select>
                {!loading && roomName && providers.length === 0 ? (
                  <span className="text-xs font-normal text-[var(--status-warning-text)]">Start a transcription provider for this room in Control Room.</span>
                ) : null}
              </label>

              <button
                type="button"
                onClick={connect}
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
