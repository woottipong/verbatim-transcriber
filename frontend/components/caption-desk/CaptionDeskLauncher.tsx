import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Radio, RefreshCw } from 'lucide-react';
import {
  fetchAgentStatus,
  fetchDetailedRooms,
  type RoomDetails,
  type RunningAgent,
} from '../../lib/api';
import { buildCaptionDeskUrl, type CaptionPolicy } from '../../lib/appRoutes';
import { formatCaptionDeskError, getCaptionPolicyCopy } from '../../lib/captionDeskPresentation';
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
  const [captionPolicy, setCaptionPolicy] = useState<CaptionPolicy>('early-final');
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
  const earlyFinalCopy = getCaptionPolicyCopy('early-final');
  const providerFinalCopy = getCaptionPolicyCopy('provider-final');

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
    window.location.href = buildCaptionDeskUrl(base, roomName, provider, captionPolicy);
  };

  return (
    <div className="app-shell min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <a href="#main-content" className="app-skip-link">
        ข้ามไปยังเนื้อหา
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
              <p className="mt-0.5 text-xs text-[var(--muted)]">ตรวจทานและเผยแพร่แคปชันที่ผ่านการกลั่นกรอง</p>
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
              <h2 id="caption-desk-connect-heading" className="text-lg font-semibold">เชื่อมต่อ Caption Desk</h2>
              {fixedRoomName ? (
                <p className="mt-1 text-sm text-[var(--muted)]">
                  ห้อง <strong className="font-semibold text-[var(--ink)]">{fixedRoomName}</strong>
                  <span aria-hidden="true"> · </span>
                  เลือกผู้ให้บริการถอดเสียงที่กำลังทำงาน
                </p>
              ) : (
                <p className="mt-1 text-sm text-[var(--muted)]">เลือกห้องและผู้ให้บริการถอดเสียงที่กำลังทำงาน</p>
              )}
            </div>
          </div>

          {error ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--danger)] bg-[var(--status-danger-bg)] px-4 py-3 text-sm text-[var(--status-danger-text)]" role="alert">
              <span className="min-w-0 flex-1 break-words">{error}</span>
              <button type="button" onClick={() => void refresh()} className="control-button control-button--inline w-full shrink-0 sm:w-auto">
                <RefreshCw size={15} /> ลองอีกครั้ง
              </button>
            </div>
          ) : !loading && rooms.length === 0 ? (
            <div className="mt-5 rounded-lg bg-[var(--control-surface-bg)] px-4 py-4">
              <p className="text-sm font-medium">ยังไม่มีห้อง</p>
              <p className="mt-1 text-sm text-[var(--muted)]">เริ่มจากสร้างห้องใน Control Room แล้วกลับมาที่นี่</p>
              <div className="mt-4 flex items-center gap-2">
                <a href="#admin" className="control-button control-button--quiet">เปิด Control Room</a>
                <button type="button" onClick={() => void refresh()} className="control-button control-button--inline">
                  <RefreshCw size={15} /> รีเฟรช
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-6 grid gap-4">
              {!fixedRoomName ? (
                <label className="grid gap-2 text-sm font-medium" htmlFor="caption-desk-room">
                  ห้อง
                  <select
                    id="caption-desk-room"
                    value={roomName}
                    onChange={event => setRoomName(event.target.value)}
                    disabled={loading}
                    className="h-11 rounded-lg border border-[var(--line)] bg-[var(--control-surface-bg)] px-3 text-[var(--ink)]"
                  >
                    {loading ? <option value="">กำลังโหลดห้อง…</option> : null}
                    {roomNames.map(room => <option key={room} value={room}>{room}</option>)}
                  </select>
                </label>
              ) : null}

              <label className="grid gap-2 text-sm font-medium" htmlFor="caption-desk-provider">
                ผู้ให้บริการ
                <select
                  id="caption-desk-provider"
                  value={provider}
                  onChange={event => setProvider(event.target.value as AgentProvider)}
                  disabled={loading || !roomName}
                  className="h-11 rounded-lg border border-[var(--line)] bg-[var(--control-surface-bg)] px-3 text-[var(--ink)]"
                >
                  {loading ? <option value="">กำลังโหลดผู้ให้บริการ…</option> : null}
                  {!loading && providers.length === 0 ? <option value="">ไม่มีผู้ให้บริการที่กำลังทำงาน</option> : null}
                  {providers.map(item => <option key={item} value={item}>{formatProviderName(item)}</option>)}
                </select>
                {!loading && roomName && providers.length === 0 ? (
                  <span className="text-xs font-normal text-[var(--status-warning-text)]">เริ่มผู้ให้บริการถอดเสียงของห้องนี้ใน Control Room</span>
                ) : null}
              </label>

              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">เลือกโหมดการรับข้อความ</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--line)] bg-[var(--control-surface-bg)] p-3 has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)]">
                    <input
                      type="radio"
                      name="caption-policy"
                      value="early-final"
                      checked={captionPolicy === 'early-final'}
                      onChange={() => setCaptionPolicy('early-final')}
                      className="mt-1 accent-[var(--accent)]"
                    />
                    <span>
                      <span className="block text-sm font-semibold">{earlyFinalCopy.title}</span>
                      <span className="mt-0.5 block text-xs font-normal leading-5 text-[var(--muted)]">
                        {earlyFinalCopy.description}
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--line)] bg-[var(--control-surface-bg)] p-3 has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)]">
                    <input
                      type="radio"
                      name="caption-policy"
                      value="provider-final"
                      checked={captionPolicy === 'provider-final'}
                      onChange={() => setCaptionPolicy('provider-final')}
                      className="mt-1 accent-[var(--accent)]"
                    />
                    <span>
                      <span className="block text-sm font-semibold">{providerFinalCopy.title}</span>
                      <span className="mt-0.5 block text-xs font-normal leading-5 text-[var(--muted)]">
                        {providerFinalCopy.description}
                      </span>
                    </span>
                  </label>
                </div>
              </fieldset>

              <button
                type="button"
                onClick={connect}
                disabled={loading || connecting || !roomName || !provider}
                className="control-button control-button--primary mt-1 h-11 justify-center"
              >
                {connecting ? <RefreshCw className="animate-spin" size={16} /> : <ArrowRight size={16} />}
                {connecting ? 'กำลังเชื่อมต่อ…' : 'เชื่อมต่อ'}
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
