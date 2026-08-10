import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useCaptionDesk } from '../hooks/useCaptionDesk';
import {
  buildCaptionDeskUrl,
  buildCaptionDeskSessionKey,
  type CaptionPolicy,
} from '../lib/appRoutes';
import {
  getCaptionDeskChangeConfirmation,
  getCaptionProofreadAvailability,
  formatCaptionDeskError,
  hasCaptionDeskWork,
} from '../lib/captionDeskPresentation';
import { checkAvailableProviders } from '../lib/api';
import { isAgentProvider, type AgentProvider } from '../lib/providers';
import { ConnectionState } from '../types';
import type { ProofreadAvailability } from '../hooks/useCaptionProofread';
import { CaptionDeskHeader } from './caption-desk/CaptionDeskHeader';
import { CaptionDeskLauncher } from './caption-desk/CaptionDeskLauncher';
import { CaptionDeskPublishedHistory } from './caption-desk/CaptionDeskPublishedHistory';
import { CaptionDeskReviewEditor } from './caption-desk/CaptionDeskReviewEditor';

interface CaptionDeskPageProps {
  backendUrl: string;
  roomName: string;
  providerName: string;
  captionPolicy: CaptionPolicy;
}

export default function CaptionDeskPage({ backendUrl, roomName, providerName, captionPolicy }: CaptionDeskPageProps) {
  const provider = providerName as AgentProvider;
  const validProvider = isAgentProvider(provider);

  if (!roomName || !validProvider) {
    return <CaptionDeskLauncher backendUrl={backendUrl} initialRoomName={roomName} />;
  }

  return (
    <ConnectedCaptionDesk
      key={buildCaptionDeskSessionKey(roomName, provider, captionPolicy)}
      backendUrl={backendUrl}
      roomName={roomName}
      provider={provider}
      captionPolicy={captionPolicy}
    />
  );
}

function ConnectedCaptionDesk({
  backendUrl,
  roomName,
  provider,
  captionPolicy,
}: {
  key?: string;
  backendUrl: string;
  roomName: string;
  provider: AgentProvider;
  captionPolicy: CaptionPolicy;
}) {
  const {
    snapshot,
    connectionState,
    error,
    agentConnected,
    captionConnected,
    subscriptionBlockCode,
    edit,
    publish,
    reconnect,
  } = useCaptionDesk(backendUrl, roomName, provider, captionPolicy);

  const connected = connectionState === ConnectionState.CONNECTED;
  const [proofreadAvailability, setProofreadAvailability] = useState<ProofreadAvailability>('unknown');
  const [proofreadChecking, setProofreadChecking] = useState(true);
  const errorMessage = snapshot.error || error;
  const displayErrorMessage = errorMessage ? formatCaptionDeskError(errorMessage) : null;
  const canReconnect = Boolean(error) || connectionState === ConnectionState.DISCONNECTED;
  const hasWork = hasCaptionDeskWork({
    reviewText: snapshot.reviewText,
    waitingCount: snapshot.waiting.length,
  });
  const changeDeskUrl = buildCaptionDeskUrl(
    `${window.location.origin}${window.location.pathname}`,
    roomName,
    '',
  );
  useEffect(() => {
    if (!hasWork) return undefined;
    const preventAccidentalExit = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', preventAccidentalExit);
    return () => window.removeEventListener('beforeunload', preventAccidentalExit);
  }, [hasWork]);

  useEffect(() => {
    let disposed = false;
    setProofreadChecking(true);
    void checkAvailableProviders(backendUrl).then(providers => {
      if (disposed) return;
      setProofreadAvailability(getCaptionProofreadAvailability(providers));
      setProofreadChecking(false);
    });
    return () => { disposed = true; };
  }, [backendUrl]);

  const retryProofreadAvailability = useCallback(async () => {
    setProofreadChecking(true);
    const providers = await checkAvailableProviders(backendUrl);
    setProofreadAvailability(getCaptionProofreadAvailability(providers));
    setProofreadChecking(false);
  }, [backendUrl]);

  const changeDesk = () => {
    if (
      hasWork &&
      !window.confirm(getCaptionDeskChangeConfirmation())
    ) return;
    window.location.href = changeDeskUrl;
  };

  return (
    <div className="app-shell flex h-dvh flex-col overflow-hidden bg-[var(--canvas)] text-[var(--ink)]">
      <a href="#main-content" className="app-skip-link">
        ข้ามไปยังเนื้อหา
      </a>

      <CaptionDeskHeader
        roomName={roomName}
        provider={provider}
        captionPolicy={captionPolicy}
        connectionState={connectionState}
        captionConnected={captionConnected}
        agentConnected={agentConnected}
        subscriptionBlockCode={subscriptionBlockCode}
        onChangeDesk={changeDesk}
      />

      <main id="main-content" className="caption-desk-main mx-auto flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:overflow-hidden">
        {displayErrorMessage || connectionState === ConnectionState.DISCONNECTED ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[var(--danger)] bg-[var(--status-danger-bg)] px-4 py-3 text-sm text-[var(--status-danger-text)]" role="alert">
            <span className="min-w-0 flex-1 break-words">{displayErrorMessage || 'Caption Desk ขาดการเชื่อมต่อ แต่ข้อความที่แก้ไขไว้ยังอยู่'}</span>
            {canReconnect ? (
              <button type="button" onClick={reconnect} className="control-button control-button--inline w-full shrink-0 sm:w-auto">
                <RefreshCw size={15} /> {connected ? 'ลองอีกครั้ง' : 'เชื่อมต่อใหม่'}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="caption-desk-workspace grid flex-none gap-4 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] xl:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]">
          <CaptionDeskReviewEditor
            backendUrl={backendUrl}
            proofreadAvailability={proofreadAvailability}
            proofreadChecking={proofreadChecking}
            onRetryProofread={() => void retryProofreadAvailability()}
            snapshot={snapshot}
            captionConnected={captionConnected}
            agentConnected={agentConnected}
            edit={edit}
            publish={publish}
          />

          <CaptionDeskPublishedHistory snapshot={snapshot} />
        </div>

        {snapshot.recentlyPublished.at(-1) ? (
          <span
            key={snapshot.recentlyPublished.at(-1)?.publicationId}
            className="sr-only"
            aria-live="polite"
          >
            เผยแพร่แคปชันแล้ว
          </span>
        ) : null}
      </main>
    </div>
  );
}
