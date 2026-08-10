import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Settings, Sparkles, Zap } from 'lucide-react';
import ToastViewport from '../ToastViewport';
import type { CaptionDeskSnapshot } from '../../lib/captionDeskSession';
import { shouldPublishOnEnter } from '../../lib/captionDeskMessages';
import {
  countGraphemes,
  formatCaptionSegmentAge,
  formatCaptionDraftAnnouncement,
  formatFontSizeLabel,
  getCaptionBudgetWarning,
  getCaptionDraftStatusLabel,
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
import {
  insertTextAtCaret,
  loadPersistedQuickPhrases,
  savePersistedQuickPhrases,
  type QuickPhrase,
} from '../../lib/quickPhrases';
import { detectThaiTypos, replaceTypoInText, type TypoMatch } from '../../lib/thaiTypoDetector';
import { useCaptionProofread, type ProofreadAvailability } from '../../hooks/useCaptionProofread';
import { QuickPhraseModal } from './QuickPhraseModal';

interface CaptionDeskReviewEditorProps {
  backendUrl: string;
  proofreadAvailability: ProofreadAvailability;
  proofreadChecking: boolean;
  onRetryProofread: () => void;
  snapshot: CaptionDeskSnapshot;
  captionConnected: boolean;
  agentConnected: boolean;
  edit: (text: string) => void;
  publish: (splitIndex?: number) => Promise<boolean>;
}

const SHORTCUT_HINT_STORAGE_KEY = 'captionlive.caption-desk.shortcut-hint-seen';
const FONT_SIZE_STORAGE_KEY = 'captionlive.caption-desk.font-size';

export function CaptionDeskReviewEditor({
  backendUrl,
  proofreadAvailability,
  proofreadChecking,
  onRetryProofread,
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
  const [quickPhrases, setQuickPhrases] = useState<QuickPhrase[]>(() => loadPersistedQuickPhrases());
  const [showPhraseModal, setShowPhraseModal] = useState(false);

  const {
    autoEnabled,
    toggleAuto,
    isProcessing,
    notice,
    dismissNotice,
  } = useCaptionProofread({
    backendUrl,
    availability: proofreadAvailability,
    reviewText: snapshot.reviewText,
    sourceSegmentIds: snapshot.sourceSegmentIds,
    previousPublishedText: snapshot.recentlyPublished.at(-1)?.text,
    onApply: edit,
  });

  const graphemeCount = countGraphemes(snapshot.reviewText);
  const budgetWarning = getCaptionBudgetWarning(graphemeCount);
  const draftStatusLabel = getCaptionDraftStatusLabel(snapshot.isDraftActive);
  const typoMatches = useMemo(
    () => detectThaiTypos(snapshot.reviewText),
    [snapshot.reviewText],
  );

  const handleFixTypo = (match: TypoMatch) => {
    edit(replaceTypoInText(snapshot.reviewText, match));
  };

  const handleSavePhrases = (next: QuickPhrase[]) => {
    setQuickPhrases(next);
    savePersistedQuickPhrases(next);
  };

  const handleInsertPhrase = (phrase: QuickPhrase) => {
    const editor = editorRef.current;
    if (!editor) return;
    const nextText = insertTextAtCaret(editor, phrase.text);
    edit(nextText);
  };

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
          <h2 id="review-caption-heading" className="font-semibold">ตรวจทานแคปชัน</h2>
          <p id="caption-review-instructions" className="text-xs leading-5 text-[var(--muted)]">
            {getCaptionReviewInstructions(canEdit)}
          </p>
        </div>
        <div className="caption-desk-toolbar__tools flex items-center gap-3">
          <button
            type="button"
            onClick={toggleAuto}
            disabled={proofreadAvailability !== 'enabled'}
            aria-pressed={autoEnabled}
            title={proofreadAvailability === 'enabled'
              ? (autoEnabled ? 'ปิดการตรวจแก้คำอัตโนมัติ' : 'เปิดการตรวจแก้คำอัตโนมัติ')
              : 'AI ยังไม่พร้อมใช้งาน'}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              autoEnabled
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--ink)]'
            }`}
          >
            <Sparkles size={13} aria-hidden="true" />
            ตรวจแก้คำอัตโนมัติ: {autoEnabled ? 'เปิด' : 'ปิด'}
          </button>
          {proofreadAvailability === 'disabled' ? (
            <span className="text-xs text-[var(--muted)]" role="status">ยังไม่ได้ตั้งค่า AI · แก้ไขเองได้</span>
          ) : proofreadAvailability === 'unknown' ? (
            <div className="flex items-center gap-1.5 text-xs text-[var(--warning)]">
              <span role="status" aria-live="polite" aria-atomic="true">
                {proofreadChecking ? 'กำลังตรวจสอบ AI…' : 'AI ยังไม่พร้อมใช้งาน'}
              </span>
              {!proofreadChecking ? (
                <button
                  type="button"
                  onClick={onRetryProofread}
                  className="control-button control-button--inline text-xs"
                >
                  ลองตรวจสอบอีกครั้ง
                </button>
              ) : null}
            </div>
          ) : null}
          {isProcessing ? (
            <span className="text-xs text-[var(--muted)]" role="status" aria-live="polite" aria-atomic="true">
              กำลังตรวจแก้คำ…
            </span>
          ) : null}
          <div className="caption-desk-font-control flex items-center rounded-lg border border-[var(--line)] bg-[var(--control-surface-bg)] p-0.5 text-xs" aria-label="ปรับขนาดตัวอักษร">
            <button
              type="button"
              onClick={() => changeFontSize(getNextFontSize(fontSize, 'down'))}
              disabled={fontSize === 'sm'}
              aria-label="ลดขนาดตัวอักษร"
              title="ลดขนาดตัวอักษร (Alt + -)"
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
              aria-label="เพิ่มขนาดตัวอักษร"
              title="เพิ่มขนาดตัวอักษร (Alt + +)"
              className="h-6 px-2 font-medium transition-colors hover:bg-[var(--line-subtle)] disabled:opacity-30 rounded"
            >
              A+
            </button>
          </div>

          <div className="caption-desk-queue-status text-right text-xs text-[var(--muted)]">
            {hasSegmentIds ? (
              <>{snapshot.sourceSegmentIds.length} ช่วงข้อความ</>
            ) : null}
            {hasSegmentIds ? (
              <SegmentAge segmentKey={snapshot.sourceSegmentIds.join(':')} />
            ) : null}
            {snapshot.queuedCount > 0 ? (
              <span className="text-[var(--subtle)]"> · ถัดไป {snapshot.queuedCount}</span>
            ) : null}
            {snapshot.waiting.length > 0 ? (
              <span> · กำลังส่ง {snapshot.waiting.length}</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="caption-desk-quick-phrases flex flex-wrap items-center gap-1.5 border-b border-[var(--line)] bg-[var(--control-surface-bg)] px-4 py-2 text-xs sm:px-5">
        <span className="mr-1 flex items-center gap-1 font-semibold text-[var(--subtle)]">
          <Zap size={13} className="text-[var(--accent)]" aria-hidden="true" />
          <span>ศัพท์เฉพาะ:</span>
        </span>
        {quickPhrases.map(phrase => (
          <button
            key={phrase.id}
            type="button"
            onClick={() => handleInsertPhrase(phrase)}
            title={`กด ${phrase.key} หรือคลิกเพื่อแทรก "${phrase.text}"`}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 py-1 text-xs font-medium text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
          >
            <span className="rounded bg-[var(--accent-soft)] px-1 py-0.2 font-mono text-[10px] font-bold text-[var(--accent)]">
              {phrase.key}
            </span>
            <span className="caption-desk-quick-phrase__label min-w-0 truncate">{phrase.label}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowPhraseModal(true)}
          aria-label="ตั้งค่าศัพท์เฉพาะ"
          title="จัดการศัพท์เฉพาะ"
          className="caption-desk-quick-phrase-settings ml-auto inline-flex items-center gap-1 rounded p-1 text-xs text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
        >
          <Settings size={14} aria-hidden="true" />
          <span className="hidden sm:inline">ตั้งค่าศัพท์เฉพาะ</span>
        </button>
      </div>

      {typoMatches.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--line)] bg-[var(--control-surface-bg)] px-4 py-2 text-xs sm:px-5">
          <span className="flex items-center gap-1 font-semibold text-[var(--warning)]">
            <AlertTriangle size={13} aria-hidden="true" />
            สงสัยคำผิด:
          </span>
          {typoMatches.map(match => (
            <button
              key={match.id}
              type="button"
              onClick={() => handleFixTypo(match)}
              title={`เปลี่ยน "${match.wrong}" เป็น "${match.correct}"`}
              className="inline-flex min-h-11 min-w-11 items-center gap-1 rounded border border-[var(--warning)] px-2 py-1 text-[var(--draft-text)] hover:border-[var(--accent)]"
            >
              <span className="line-through">{match.wrong}</span>
              <span aria-hidden="true">→</span>
              <span className="font-semibold text-[var(--success)]">{match.correct}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="caption-review-editor-shell flex min-h-0 flex-1 flex-col">
        <div
          ref={editorRef}
          role="textbox"
          contentEditable={canEdit ? 'plaintext-only' : false}
          suppressContentEditableWarning
          aria-multiline="true"
          aria-disabled={!canEdit}
          aria-describedby={isDraftActive && snapshot.draftPreview.trim()
            ? 'caption-review-instructions caption-draft-description'
            : 'caption-review-instructions'}
          data-placeholder={
            captionConnected
              ? 'ข้อความแคปชันจะแสดงที่นี่…'
              : agentConnected
                ? 'กำลังรับข้อความแคปชัน…'
                : 'กำลังรอตัวถอดเสียง…'
          }
          style={getFontSizeStyles(fontSize)}
          onInput={event => edit(event.currentTarget.textContent || '')}
          onKeyDown={event => {
            const matchedPhrase = quickPhrases.find(p => p.key === event.key);
            if (matchedPhrase) {
              event.preventDefault();
              handleInsertPhrase(matchedPhrase);
              return;
            }
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
          aria-label="ข้อความแคปชันสำหรับตรวจทานและเผยแพร่"
          className="caption-review-editor transcript-paragraph-source min-h-0 w-full flex-1 overflow-y-auto bg-transparent px-4 py-3 text-[var(--ink)] aria-disabled:cursor-wait aria-disabled:text-[var(--muted)] sm:px-5 sm:py-4"
        />
        {isDraftActive && snapshot.draftPreview.trim() ? (
          <div
            id="caption-draft-description"
            className="caption-review-draft-preview"
            aria-label="ตัวอย่างข้อความสด แบบอ่านอย่างเดียว ยังเผยแพร่ไม่ได้"
          >
            <div className="caption-review-draft-preview__label">
              <Zap size={13} aria-hidden="true" />
              {draftStatusLabel}
            </div>
            <p className="caption-review-draft-preview__text">
              {snapshot.draftJoinWithoutSpace ? snapshot.draftPreview : ` ${snapshot.draftPreview}`}
            </p>
          </div>
        ) : null}
      </div>

      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {isDraftActive ? draftAnnouncement : ''}
      </span>

      {canEdit && showShortcutHint ? (
        <div className="caption-desk-shortcut-hint flex items-center justify-between gap-3 border-t border-[var(--line)] px-4 py-2 text-xs sm:px-5">
          <span><strong>เผยแพร่ด่วน:</strong> Enter เผยแพร่ถึงเคอร์เซอร์ · F1-F8 แทรกศัพท์เฉพาะ · Alt +/- ปรับขนาดตัวอักษร</span>
          <button type="button" className="control-button control-button--inline shrink-0" onClick={dismissShortcutHint}>
            เข้าใจแล้ว
          </button>
        </div>
      ) : null}

      <footer className="caption-desk-editor-footer flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-[var(--line)] bg-[var(--control-surface-bg)] px-4 py-2.5 sm:px-5">
        <div className="flex items-center gap-2 text-xs">
          <span className={budgetWarning.isOverTwoLines ? 'font-semibold text-[var(--warning)]' : 'text-[var(--muted)]'}>
            พร้อมเผยแพร่ {graphemeCount} ตัวอักษร
          </span>
        </div>
        {canEdit ? (
          <>
            <span className="hidden text-xs text-[var(--subtle)] sm:inline">Enter → เผยแพร่ถึงเคอร์เซอร์ · Shift+Enter → ขึ้นบรรทัดใหม่</span>
            <span className="text-xs text-[var(--subtle)] sm:hidden">Enter → เผยแพร่ · Shift+Enter → ขึ้นบรรทัดใหม่</span>
          </>
        ) : null}
      </footer>

      {showPhraseModal ? (
        <QuickPhraseModal
          phrases={quickPhrases}
          onSave={handleSavePhrases}
          onClose={() => setShowPhraseModal(false)}
        />
      ) : null}

      <ToastViewport locale="th" notices={notice ? [{ ...notice, onDismiss: dismissNotice }] : []} />
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
