import { useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import {
  DEFAULT_QUICK_PHRASES,
  type QuickPhrase,
} from '../../lib/quickPhrases';

interface QuickPhraseModalProps {
  phrases: QuickPhrase[];
  onSave: (phrases: QuickPhrase[]) => void;
  onClose: () => void;
}

const FIXED_KEYS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8'];

type PhraseFormMap = { [key: string]: string };

function buildInitialMap(source: QuickPhrase[]): PhraseFormMap {
  const map: PhraseFormMap = {};
  for (const key of FIXED_KEYS) {
    const match = source.find(p => p.key === key);
    map[key] = match ? match.text : '';
  }
  return map;
}

export function QuickPhraseModal({ phrases, onSave, onClose }: QuickPhraseModalProps) {
  const [formState, setFormState] = useState<PhraseFormMap>(() => buildInitialMap(phrases));

  const handleChange = (key: string, value: string) => {
    setFormState(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>, startKey: string) => {
    const raw = e.clipboardData.getData('text');
    if (!raw) return;

    // Split by newlines or commas
    const lines = raw
      .split(/[\r\n,]+/)
      .map(s => s.trim())
      .filter(Boolean);

    // Intercept if multi-item paste
    if (lines.length > 1) {
      e.preventDefault();
      const startIndex = FIXED_KEYS.indexOf(startKey);
      setFormState(prev => {
        const next = { ...prev };
        lines.forEach((line, index) => {
          const targetIndex = startIndex + index;
          if (targetIndex < FIXED_KEYS.length) {
            next[FIXED_KEYS[targetIndex]] = line;
          }
        });
        return next;
      });
    }
  };

  const handleClearRow = (key: string) => {
    setFormState(prev => ({
      ...prev,
      [key]: '',
    }));
  };

  const restoreDefaults = () => {
    setFormState(buildInitialMap(DEFAULT_QUICK_PHRASES));
  };

  const handleSave = () => {
    const nextPhrases: QuickPhrase[] = FIXED_KEYS
      .filter(key => (formState[key] || '').trim().length > 0)
      .map(key => {
        const text = formState[key].trim();
        return {
          id: `qp-${key.toLowerCase()}`,
          key,
          text,
          label: text,
        };
      });
    onSave(nextPhrases);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-phrase-modal-title"
    >
      <div className="app-panel flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden bg-[var(--surface)] text-[var(--ink)] shadow-2xl">
        <header className="panel-header flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
          <div>
            <h2 id="quick-phrase-modal-title" className="text-base font-semibold">
              ตั้งค่าศัพท์เฉพาะ (Quick Terms)
            </h2>
            <p className="text-xs text-[var(--muted)]">
              ก๊อปปี้ข้อความหลายบรรทัดมาวาง (Ctrl+V) ที่ช่องเพื่อจัดเรียงเข้า F1 - F8 ได้ทันที
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="control-button control-button--inline shrink-0 p-1.5"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          <div className="space-y-2">
            {FIXED_KEYS.map(key => {
              const textValue = formState[key] || '';
              const hasValue = textValue.trim().length > 0;
              return (
                <div
                  key={key}
                  className={`flex items-center gap-3 rounded-lg border p-2 transition-colors ${hasValue
                      ? 'border-[var(--line-strong)] bg-[var(--control-surface-bg)]'
                      : 'border-[var(--line)] bg-[var(--surface)] opacity-75 focus-within:opacity-100'
                    }`}
                >
                  <span className="inline-flex h-8 w-11 shrink-0 items-center justify-center rounded bg-[var(--accent-soft)] font-mono text-xs font-bold text-[var(--accent)]">
                    {key}
                  </span>

                  <input
                    type="text"
                    value={textValue}
                    onChange={e => handleChange(key, e.target.value)}
                    onPaste={e => handlePaste(e, key)}
                    placeholder={`คำศัพท์สำหรับ ${key} (วางหลายบรรทัดได้)…`}
                    className="h-8 flex-1 rounded border border-[var(--line)] bg-[var(--surface)] px-3 text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                  />

                  {hasValue ? (
                    <button
                      type="button"
                      onClick={() => handleClearRow(key)}
                      title={`ล้างคำสำหรับ ${key}`}
                      className="shrink-0 p-1 text-[var(--subtle)] hover:text-red-400 transition-colors"
                    >
                      <X size={15} />
                    </button>
                  ) : (
                    <div className="w-5" />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-[var(--line)] bg-[var(--control-surface-bg)] px-5 py-3">
          <button
            type="button"
            onClick={restoreDefaults}
            className="control-button control-button--inline text-xs"
          >
            <RotateCcw size={14} /> คืนค่าเริ่มต้น
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="control-button control-button--quiet text-xs"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="control-button control-button--primary text-xs"
            >
              บันทึกการตั้งค่า
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
