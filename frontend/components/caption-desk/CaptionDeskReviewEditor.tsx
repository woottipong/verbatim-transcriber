import { useEffect, useRef, useState } from 'react';
import type { CaptionDeskSnapshot } from '../../lib/captionDeskSession';
import { shouldPublishOnEnter } from '../../lib/captionDeskMessages';
import {
  formatCaptionSegmentAge,
  getCaptionEditorTextUpdate,
  getCaptionReviewInstructions,
} from '../../lib/captionDeskPresentation';
import {
  getContentEditableCaretOffset,
  replaceContentEditableTextPreservingCaret,
} from '../../lib/caretUtils';

interface CaptionDeskReviewEditorProps {
  snapshot: CaptionDeskSnapshot;
  captionConnected: boolean;
  agentConnected: boolean;
  edit: (text: string) => void;
  publish: (splitIndex?: number) => Promise<void>;
}

const SHORTCUT_HINT_STORAGE_KEY = 'captionlive.caption-desk.shortcut-hint-seen';

export function CaptionDeskReviewEditor({
  snapshot,
  captionConnected,
  agentConnected,
  edit,
  publish,
}: CaptionDeskReviewEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const hasSegmentIds = snapshot.sourceSegmentIds.length > 0;
  const canEdit = captionConnected || hasSegmentIds || snapshot.reviewText.length > 0;
  const [showShortcutHint, setShowShortcutHint] = useState(() => !hasSeenShortcutHint());

  const dismissShortcutHint = () => {
    try {
      window.localStorage.setItem(SHORTCUT_HINT_STORAGE_KEY, '1');
    } catch {
      // The hint still dismisses for this session when storage is unavailable.
    }
    setShowShortcutHint(false);
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const update = getCaptionEditorTextUpdate(
      editor.textContent || '',
      snapshot.reviewText,
    );
    if (update.kind === 'append') {
      editor.append(document.createTextNode(update.text));
    } else if (update.kind === 'replace') {
      replaceContentEditableTextPreservingCaret(editor, update.text);
    }
  }, [snapshot.reviewText]);

  const release = (splitAtCaret = false) => {
    const splitIndex = splitAtCaret ? getContentEditableCaretOffset(editorRef.current) : undefined;
    void publish(splitIndex).finally(() => requestAnimationFrame(() => editorRef.current?.focus()));
  };

  const isDraftActive = snapshot.isDraftActive;

  return (
    <section className="app-panel caption-desk-review order-1 flex min-h-64 flex-col lg:order-1 lg:h-full lg:min-h-0" aria-labelledby="review-caption-heading">
      <div className="panel-header caption-desk-toolbar px-4 py-2.5 sm:px-5">
        <div className="min-w-0">
          <h2 id="review-caption-heading" className="font-semibold">Review caption</h2>
          <p id="caption-review-instructions" className="text-xs leading-5 text-[var(--muted)]">
            {getCaptionReviewInstructions(canEdit)}
          </p>
        </div>
        <div className="caption-desk-toolbar__tools">
          <div className="caption-desk-queue-status text-right text-xs text-[var(--muted)]">
            {hasSegmentIds ? (
              <>{snapshot.sourceSegmentIds.length} segment{snapshot.sourceSegmentIds.length === 1 ? '' : 's'}</>
            ) : null}
            {hasSegmentIds ? (
              <SegmentAge segmentKey={snapshot.sourceSegmentIds.join(':')} />
            ) : null}
            {snapshot.queuedCount > 0 ? (
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
        contentEditable={canEdit ? 'plaintext-only' : false}
        suppressContentEditableWarning
        aria-multiline="true"
        aria-disabled={!canEdit}
        aria-describedby="caption-review-instructions"
        data-placeholder={
          captionConnected
            ? 'Caption text will collect here…'
            : agentConnected
              ? 'Connecting to the caption feed…'
              : 'Waiting for the transcriber…'
        }
        data-draft={snapshot.draftPreview}
        onInput={event => edit(event.currentTarget.textContent || '')}
        onKeyDown={event => {
          if (!shouldPublishOnEnter(event.nativeEvent)) return;
          event.preventDefault();
          if (showShortcutHint) dismissShortcutHint();
          release(true);
        }}
        aria-label="Caption text to review and publish"
        className="caption-review-editor transcript-paragraph-source w-full flex-1 overflow-y-auto bg-transparent px-4 py-3 text-[var(--ink)] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] aria-disabled:cursor-wait aria-disabled:text-[var(--muted)] sm:px-5 sm:py-4"
      />

      <span className="sr-only" aria-live="polite">
        {isDraftActive ? 'Draft active, waiting for final' : ''}
      </span>

      {canEdit && showShortcutHint ? (
        <div className="caption-desk-shortcut-hint flex items-center justify-between gap-3 border-t border-[var(--line)] px-4 py-2 text-xs sm:px-5">
          <span><strong>Quick publish:</strong> Enter publishes to the cursor. Shift+Enter adds a new line.</span>
          <button type="button" className="control-button control-button--inline shrink-0" onClick={dismissShortcutHint}>
            Got it
          </button>
        </div>
      ) : null}

      <footer className="caption-desk-editor-footer flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-[var(--line)] bg-[var(--control-surface-bg)] px-4 py-2.5 sm:px-5">
        <span className="text-sm text-[var(--muted)]">{snapshot.reviewText.length} characters</span>
        {canEdit ? (
          <>
            <span className="hidden text-xs text-[var(--subtle)] sm:inline">Enter → publish to cursor · Shift+Enter → new line</span>
            <span className="text-xs text-[var(--subtle)] sm:hidden">Enter → publish · Shift+Enter → new line</span>
          </>
        ) : (
          <span className="text-xs text-[var(--subtle)]">Waiting for captions…</span>
        )}
      </footer>
    </section>
  );
}

function hasSeenShortcutHint(): boolean {
  try {
    return window.localStorage.getItem(SHORTCUT_HINT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
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

  return <span> · {formatCaptionSegmentAge(age)}</span>;
}
