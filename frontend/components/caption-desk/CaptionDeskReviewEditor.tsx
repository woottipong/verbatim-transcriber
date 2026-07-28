import { useEffect, useRef, useState } from 'react';
import type { CaptionDeskSnapshot } from '../../lib/captionDeskSession';
import { shouldPublishOnEnter } from '../../lib/captionDeskMessages';
import { getContentEditableCaretOffset } from '../../lib/caretUtils';

interface CaptionDeskReviewEditorProps {
  snapshot: CaptionDeskSnapshot;
  useInterimInReview: boolean;
  captionConnected: boolean;
  agentConnected: boolean;
  edit: (text: string) => void;
  publish: (splitIndex?: number) => Promise<void>;
}

export function CaptionDeskReviewEditor({
  snapshot,
  useInterimInReview,
  captionConnected,
  agentConnected,
  edit,
  publish,
}: CaptionDeskReviewEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => editorRef.current?.focus(), []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.textContent !== snapshot.reviewText) {
      editor.textContent = snapshot.reviewText;
    }
  }, [snapshot.reviewText]);

  const release = (splitAtCaret = false) => {
    const splitIndex = splitAtCaret ? getContentEditableCaretOffset(editorRef.current) : undefined;
    void publish(splitIndex).finally(() => requestAnimationFrame(() => editorRef.current?.focus()));
  };

  const hasSegmentIds = snapshot.sourceSegmentIds.length > 0;
  const isDraftActive = !useInterimInReview && snapshot.isDraftActive;

  return (
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
            {hasSegmentIds ? (
              <>{snapshot.sourceSegmentIds.length} segment{snapshot.sourceSegmentIds.length === 1 ? '' : 's'}</>
            ) : null}
            {hasSegmentIds ? (
              <SegmentAge segmentKey={snapshot.sourceSegmentIds.join(':')} />
            ) : null}
            {!useInterimInReview && snapshot.queuedCount > 0 ? (
              <span className="text-[var(--subtle)]"> · Next {snapshot.queuedCount}</span>
            ) : null}
            {snapshot.waiting.length > 0 ? (
              <span> · Sending {snapshot.waiting.length}</span>
            ) : null}
          </div>
        </div>
      </div>

      <div
        ref={editorRef}
        role="textbox"
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        aria-multiline="true"
        data-placeholder={
          captionConnected
            ? 'Final transcript text will collect here…'
            : agentConnected
              ? 'Connecting to the caption feed…'
              : 'Waiting for the transcriber…'
        }
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
        {isDraftActive ? 'Draft active, waiting for final' : ''}
      </span>

      <footer className="caption-desk-editor-footer flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-[var(--line)] bg-[var(--control-surface-bg)] px-4 py-2.5 sm:px-5">
        <span className="text-sm text-[var(--muted)]">{snapshot.reviewText.length} characters</span>
        <span className="text-xs text-[var(--subtle)] hidden sm:inline">Enter → publish to cursor · Shift+Enter → new line</span>
        <span className="text-xs text-[var(--subtle)] sm:hidden">Enter → publish · Shift+Enter → new line</span>
      </footer>
    </section>
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
