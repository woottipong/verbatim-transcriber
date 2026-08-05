import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { useCaptionDesk } from '../hooks/useCaptionDesk';
import {
  buildCaptionDeskUrl,
  buildCaptionDeskSessionKey,
  type CaptionPolicy,
} from '../lib/appRoutes';
import { hasCaptionDeskWork } from '../lib/captionDeskPresentation';
import { isAgentProvider, type AgentProvider } from '../lib/providers';
import { ConnectionState } from '../types';
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
  const errorMessage = snapshot.error || error;
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

  const changeDesk = () => {
    if (
      hasWork &&
      !window.confirm('Discard the caption currently in this desk and change room or provider?')
    ) return;
    window.location.href = changeDeskUrl;
  };

  return (
    <div className="app-shell flex h-dvh flex-col overflow-hidden bg-[var(--canvas)] text-[var(--ink)]">
      <a href="#main-content" className="app-skip-link">
        Skip to content
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
        {errorMessage || connectionState === ConnectionState.DISCONNECTED ? (
          <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-red-400/35 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
            <span>{errorMessage || 'Caption Desk disconnected. Your current edits are preserved.'}</span>
            {canReconnect ? (
              <button type="button" onClick={reconnect} className="control-button control-button--inline shrink-0">
                <RefreshCw size={15} /> {connected ? 'Try again' : 'Reconnect'}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="caption-desk-workspace grid flex-none gap-4 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] xl:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]">
          <CaptionDeskReviewEditor
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
            Caption published.
          </span>
        ) : null}
      </main>
    </div>
  );
}
