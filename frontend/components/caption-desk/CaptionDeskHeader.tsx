import { buildCaptionDeskUrl } from '../../lib/appRoutes';
import { formatProviderName, type AgentProvider } from '../../lib/providers';

interface CaptionDeskHeaderProps {
  roomName: string;
  provider: AgentProvider;
  connected: boolean;
  captionConnected: boolean;
  agentConnected: boolean;
}

export function CaptionDeskHeader({
  roomName,
  provider,
  connected,
  captionConnected,
  agentConnected,
}: CaptionDeskHeaderProps) {
  return (
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
              label={
                captionConnected
                  ? 'Receiving captions'
                  : agentConnected
                    ? 'Connecting captions'
                    : 'Transcriber unavailable'
              }
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
  );
}

function Status({ connected, label }: { connected: boolean; label: string }) {
  return (
    <span className={`admin-status ${connected ? 'admin-status--success' : 'admin-status--warning'}`}>
      <span className={`status-dot ${connected ? 'status-dot--live' : 'status-dot--pending'}`} aria-hidden="true" />
      {label}
    </span>
  );
}
