import { useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import type { CaptionDeskSnapshot } from '../../lib/captionDeskSession';

interface CaptionDeskPublishedHistoryProps {
  snapshot: CaptionDeskSnapshot;
}

export function CaptionDeskPublishedHistory({ snapshot }: CaptionDeskPublishedHistoryProps) {
  const historyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (historyRef.current && snapshot.recentlyPublished.length > 0) {
      historyRef.current.scrollTop = 0;
    }
  }, [snapshot.recentlyPublished.length]);

  const isEmpty = snapshot.waiting.length === 0 && snapshot.recentlyPublished.length === 0;

  return (
    <section
      className="app-panel caption-desk-history order-2 flex min-h-0 flex-col overflow-hidden bg-[var(--canvas-raised)] shadow-none lg:order-2 lg:h-full"
      aria-labelledby="published-captions-heading"
    >
      <div className="panel-header px-4 py-2.5">
        <h2 id="published-captions-heading" className="text-sm font-semibold">Published</h2>
        <p className="text-xs text-[var(--subtle)]">Release history</p>
      </div>
      <div ref={historyRef} className="flex-1 overflow-y-auto">
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
  );
}

function formatPublishedTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp);
}
