import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { CaptionDeskSnapshot } from '../../lib/captionDeskSession';

interface CaptionDeskPublishedHistoryProps {
  snapshot: CaptionDeskSnapshot;
}

export function CaptionDeskPublishedHistory({ snapshot }: CaptionDeskPublishedHistoryProps) {
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const isEmpty = snapshot.waiting.length === 0 && snapshot.recentlyPublished.length === 0;
  const latest = snapshot.waiting.at(-1) ?? snapshot.recentlyPublished.at(-1);

  return (
    <>
      <section className="app-panel caption-desk-history-compact order-2 overflow-hidden bg-[var(--canvas-raised)] shadow-none lg:hidden" aria-label="Published captions">
        <button
          type="button"
          aria-expanded={mobileExpanded}
          onClick={() => setMobileExpanded(expanded => !expanded)}
          className="w-full min-h-12 cursor-pointer px-4 py-2.5 text-left"
        >
          <span className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">
              {snapshot.waiting.length > 0 ? 'Sending' : 'Last published'}
            </span>
            <span className="min-w-0 truncate text-xs text-[var(--muted)]">
              {latest?.text || 'No captions published yet'}
            </span>
          </span>
        </button>
        {mobileExpanded ? <HistoryContent snapshot={snapshot} isEmpty={isEmpty} /> : null}
      </section>

      <section
        className={`app-panel caption-desk-history order-2 hidden min-h-0 flex-col overflow-hidden bg-[var(--canvas-raised)] shadow-none lg:flex lg:order-2 lg:h-full ${
          isEmpty ? 'caption-desk-history--empty' : ''
        }`}
        aria-labelledby="published-captions-heading"
      >
        <div className="panel-header px-4 py-2.5">
          <h2 id="published-captions-heading" className="text-sm font-semibold">Published</h2>
          <p className="text-xs text-[var(--subtle)]">Release history</p>
        </div>
        <HistoryContent snapshot={snapshot} isEmpty={isEmpty} />
      </section>
    </>
  );
}

function HistoryContent({
  snapshot,
  isEmpty,
}: CaptionDeskPublishedHistoryProps & { isEmpty: boolean }) {
  return (
    <div className="max-h-64 flex-1 overflow-y-auto lg:max-h-none">
      {isEmpty ? (
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
          {[...snapshot.recentlyPublished].reverse().map(item => (
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
  );
}

function formatPublishedTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp);
}
