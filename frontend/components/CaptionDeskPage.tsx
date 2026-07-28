import { RefreshCw } from 'lucide-react';
import { useCaptionDesk } from '../hooks/useCaptionDesk';
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
}

export default function CaptionDeskPage({ backendUrl, roomName, providerName }: CaptionDeskPageProps) {
  const provider = providerName as AgentProvider;
  const validProvider = isAgentProvider(provider);

  if (!roomName || !validProvider) {
    return <CaptionDeskLauncher backendUrl={backendUrl} initialRoomName={roomName} />;
  }

  const hashParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const initialInterim = hashParams.get('source') === 'interim';

  return (
    <ConnectedCaptionDesk
      backendUrl={backendUrl}
      roomName={roomName}
      provider={provider}
      initialInterim={initialInterim}
    />
  );
}

function ConnectedCaptionDesk({
  backendUrl,
  roomName,
  provider,
  initialInterim = false,
}: {
  backendUrl: string;
  roomName: string;
  provider: AgentProvider;
  initialInterim?: boolean;
}) {
  const {
    snapshot,
    connectionState,
    error,
    agentConnected,
    captionConnected,
    edit,
    publish,
    reconnect,
  } = useCaptionDesk(backendUrl, roomName, provider);

  const connected = connectionState === ConnectionState.CONNECTED;
  const errorMessage = snapshot.error || error;

  return (
    <div className="app-shell flex h-dvh flex-col overflow-hidden bg-[var(--canvas)] text-[var(--ink)]">
      <a href="#main-content" className="app-skip-link">
        Skip to content
      </a>

      <CaptionDeskHeader
        roomName={roomName}
        provider={provider}
        connected={connected}
        captionConnected={captionConnected}
        agentConnected={agentConnected}
      />

      <main id="main-content" className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6 sm:py-5">
        {errorMessage || connectionState === ConnectionState.DISCONNECTED ? (
          <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-red-400/35 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
            <span>{errorMessage || 'Caption Desk disconnected. Your current edits are preserved.'}</span>
            {connectionState !== ConnectionState.CONNECTED ? (
              <button type="button" onClick={reconnect} className="control-button control-button--inline shrink-0">
                <RefreshCw size={15} /> Reconnect
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="caption-desk-workspace grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,19rem)]">
          <CaptionDeskPublishedHistory snapshot={snapshot} />

          <CaptionDeskReviewEditor
            snapshot={snapshot}
            useInterimInReview={initialInterim}
            captionConnected={captionConnected}
            agentConnected={agentConnected}
            edit={edit}
            publish={publish}
          />
        </div>

        <span className="sr-only" aria-live="polite">
          {snapshot.error || (snapshot.recentlyPublished.at(-1) ? 'Caption published' : '')}
        </span>
      </main>
    </div>
  );
}
