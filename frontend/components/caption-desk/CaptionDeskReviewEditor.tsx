import { useEffect, useRef, useState } from 'react';
import type { CaptionDeskSnapshot } from '../../lib/captionDeskSession';
import { shouldPublishOnEnter } from '../../lib/captionDeskMessages';
import {
  countGraphemes,
  formatCaptionSegmentAge,
  formatCaptionDraftAnnouncement,
  formatFontSizeLabel,
  getCaptionBudgetWarning,
  getCaptionEditorTextUpdate,
  getCaptionReviewInstructions,
  getFontSizeStyles,
  getNextFontSize,
  type CaptionDeskFontSize,
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
const FONT_SIZE_STORAGE_KEY = 'captionlive.caption-desk.font-size';

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
  const [draftAnnouncement, setDraftAnnouncement] = useState('');
  const [fontSize, setFontSize] = useState<CaptionDeskFontSize>(() => loadPersistedFontSize());

  const graphemeCount = countGraphemes(snapshot.reviewText);
  const budgetWarning = getCaptionBudgetWarning(graphemeCount);

  const changeFontSize = (next: CaptionDeskFontSize) => {
    setFontSize(next);
    try {
      window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, next);
    } catch {
      // Fall back for disabled local storage
    }
  };

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

  useEffect(() => {
    if (!snapshot.isDraftActive || !snapshot.draftPreview.trim()) {
      setDraftAnnouncement('');
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setDraftAnnouncement(formatCaptionDraftAnnouncement(snapshot.draftPreview));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [snapshot.draftPreview, snapshot.isDraftActive]);

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
        <div className="caption-desk-toolbar__tools flex items-center gap-3">
          <div className="caption-desk-font-control flex items-center rounded-lg border border-[var(--line)] bg-[var(--control-surface-bg)] p-0.5 text-xs" aria-label="Font size control">
            <button
              type="button"
              onClick={() => changeFontSize(getNextFontSize(fontSize, 'down'))}
              disabled={fontSize === 'sm'}
              aria-label="Decrease editor font size"
              title="Decrease font size (Alt + -)"
              className="h-6 px-2 font-medium transition-colors hover:bg-[var(--line-subtle)] disabled:opacity-30 rounded"
            >
              A-
            </button>
            <span className="min-w-[36px] text-center font-mono text-[11px] font-semibold text-[var(--muted)]">
              {formatFontSizeLabel(fontSize)}
            </span>
            <button
              type="button"
              onClick={() => changeFontSize(getNextFontSize(fontSize, 'up'))}
              disabled={fontSize === 'xl'}
              aria-label="Increase editor font size"
              title="Increase font size (Alt + +)"
              className="h-6 px-2 font-medium transition-colors hover:bg-[var(--line-subtle)] disabled:opacity-30 rounded"
            >
              A+
            </button>
          </div>

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
        data-draft-join={snapshot.draftJoinWithoutSpace ? 'true' : 'false'}
        style={getFontSizeStyles(fontSize)}
        onInput={event => edit(event.currentTarget.textContent || '')}
        onKeyDown={event => {
          if (event.altKey && (event.key === '-' || event.key === '_')) {
            event.preventDefault();
            changeFontSize(getNextFontSize(fontSize, 'down'));
            return;
          }
          if (event.altKey && (event.key === '=' || event.key === '+')) {
            event.preventDefault();
            changeFontSize(getNextFontSize(fontSize, 'up'));
            return;
          }
          if (!shouldPublishOnEnter(event.nativeEvent)) return;
          event.preventDefault();
          if (showShortcutHint) dismissShortcutHint();
          release(true);
        }}
        aria-label="Caption text to review and publish"
        className="caption-review-editor transcript-paragraph-source w-full flex-1 overflow-y-auto bg-transparent px-4 py-3 text-[var(--ink)] outline-none focus:outline-none focus-visible:ring-0 aria-disabled:cursor-wait aria-disabled:text-[var(--muted)] sm:px-5 sm:py-4"
      />

      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {isDraftActive ? draftAnnouncement : ''}
      </span>

      {canEdit && showShortcutHint ? (
        <div className="caption-desk-shortcut-hint flex items-center justify-between gap-3 border-t border-[var(--line)] px-4 py-2 text-xs sm:px-5">
          <span><strong>Quick publish:</strong> Enter publishes to the cursor. Shift+Enter adds a new line. Alt +/- adjusts font.</span>
          <button type="button" className="control-button control-button--inline shrink-0" onClick={dismissShortcutHint}>
            Got it
          </button>
        </div>
      ) : null}

      <footer className="caption-desk-editor-footer flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-[var(--line)] bg-[var(--control-surface-bg)] px-4 py-2.5 sm:px-5">
        <div className="flex items-center gap-2 text-xs">
          <span className={budgetWarning.isOverTwoLines ? 'font-semibold text-amber-400' : 'text-[var(--muted)]'}>
            {graphemeCount} chars
          </span>
          <span className="text-[var(--subtle)]">·</span>
          <span className={budgetWarning.isOverTwoLines ? 'font-semibold text-amber-400' : 'text-[var(--subtle)]'}>
            {budgetWarning.label}
          </span>
        </div>
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

function loadPersistedFontSize(): CaptionDeskFontSize {
  try {
    const value = window.localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    if (value === 'sm' || value === 'md' || value === 'lg' || value === 'xl') {
      return value;
    }
  } catch {
    // Default fallback
  }
  return 'md';
}

