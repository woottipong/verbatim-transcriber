import {
  type CaptionDeskStatusTone,
  getCaptionDeskOperationalStatus,
  getCaptionPolicyCopy,
} from '../../lib/captionDeskPresentation';
import { formatProviderName, type AgentProvider } from '../../lib/providers';
import type { ConnectionState } from '../../types';
import type { CaptionPolicy } from '../../lib/appRoutes';

interface CaptionDeskHeaderProps {
  roomName: string;
  provider: AgentProvider;
  captionPolicy: CaptionPolicy;
  connectionState: ConnectionState;
  captionConnected: boolean;
  agentConnected: boolean;
  subscriptionBlockCode: string | null;
  onChangeDesk: () => void;
}

export function CaptionDeskHeader({
  roomName,
  provider,
  captionPolicy,
  connectionState,
  captionConnected,
  agentConnected,
  subscriptionBlockCode,
  onChangeDesk,
}: CaptionDeskHeaderProps) {
  const operationalStatus = getCaptionDeskOperationalStatus(
    connectionState,
    captionConnected,
    agentConnected,
    subscriptionBlockCode,
  );
  const policyCopy = getCaptionPolicyCopy(captionPolicy);

  return (
    <header className="app-header">
      <div className="app-header__content caption-desk-navbar mx-auto w-full px-4 py-3 sm:px-6 lg:px-8">
        <div className="caption-desk-navbar__brand flex min-w-0 items-center gap-3">
          <img src="/captionlive-mark.svg" alt="" className="h-10 w-10 shrink-0 rounded-lg" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="flex min-w-0 items-center gap-2 truncate text-lg font-semibold tracking-tight sm:text-xl">
              <span className="hidden shrink-0 text-[var(--accent)] sm:inline">CaptionLive</span>
              <span className="hidden h-4 w-px shrink-0 bg-[var(--line)] sm:inline" aria-hidden="true" />
              <span className="truncate">Caption Desk</span>
            </h1>
            <p className="caption-desk-navbar__meta mt-0.5 flex min-w-0 items-center gap-1.5 text-sm">
              <span className="text-[var(--muted)]">ห้อง</span>
              <strong className="truncate font-semibold text-[var(--ink)]">{roomName}</strong>
              <span className="text-[var(--subtle)]" aria-hidden="true">·</span>
              <strong className="truncate font-semibold text-[var(--ink)]">{formatProviderName(provider)}</strong>
              <span className="caption-desk-navbar__policy flex items-center gap-1.5 text-[var(--muted)]">
                <span className="text-[var(--subtle)]" aria-hidden="true">·</span>
                {policyCopy.shortLabel}
              </span>
            </p>
          </div>
        </div>
        <div className="caption-desk-navbar__controls flex items-center justify-end gap-2">
          <div
            className="caption-desk-navbar__status flex min-w-0 items-center gap-1.5"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="sr-only">สถานะ: </span>
            <Status tone={operationalStatus.tone} label={operationalStatus.label} />
          </div>
          <button
            type="button"
            onClick={onChangeDesk}
            className="control-button control-button--inline"
          >
            เปลี่ยนผู้ให้บริการ
          </button>
        </div>
      </div>
    </header>
  );
}

function Status({ tone, label }: { tone: CaptionDeskStatusTone; label: string }) {
  return (
    <span className={`admin-status admin-status--${tone}`}>
      <span className={`status-dot status-dot--${tone}`} aria-hidden="true" />
      {label}
    </span>
  );
}
