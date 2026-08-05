export interface QuickPhrase {
  id: string;
  key: string;
  label: string;
  text: string;
}

export const QUICK_PHRASE_STORAGE_KEY = 'captionlive.caption-desk.quick-phrases';

export const DEFAULT_QUICK_PHRASES: QuickPhrase[] = [
  { id: 'qp-1', key: 'F1', label: 'ท่านประธาน', text: 'ท่านประธาน' },
  { id: 'qp-2', key: 'F2', label: 'กรรมาธิการ', text: 'กรรมาธิการ' },
  { id: 'qp-3', key: 'F3', label: 'ร่าง พ.ร.บ.', text: 'ร่างพระราชบัญญัติ' },
  { id: 'qp-4', key: 'F4', label: 'ระเบียบวาระ', text: 'ระเบียบวาระ' },
  { id: 'qp-5', key: 'F5', label: 'ส.ส.', text: 'สมาชิกสภาผู้แทนราษฎร' },
  { id: 'qp-6', key: 'F6', label: 'กระทรวง', text: 'กระทรวง' },
  { id: 'qp-7', key: 'F7', label: 'อภิปราย', text: 'อภิปราย' },
  { id: 'qp-8', key: 'F8', label: 'ที่ประชุม', text: 'ที่ประชุม' },
];

export function loadPersistedQuickPhrases(): QuickPhrase[] {
  try {
    const storage = typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
    if (!storage) return DEFAULT_QUICK_PHRASES;
    const raw = storage.getItem(QUICK_PHRASE_STORAGE_KEY);
    if (!raw) return DEFAULT_QUICK_PHRASES;
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) {
      const validItems = parsed
        .filter(
          (item): item is QuickPhrase =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as QuickPhrase).id === 'string' &&
            typeof (item as QuickPhrase).key === 'string' &&
            typeof (item as QuickPhrase).text === 'string',
        )
        .map(item => ({
          id: item.id,
          key: item.key,
          label: item.label || item.text,
          text: item.text,
        }));

      // Deduplicate by key (keep first occurrence)
      const seenKeys = new Set<string>();
      const uniquePhrases: QuickPhrase[] = [];
      for (const item of validItems) {
        if (!seenKeys.has(item.key)) {
          seenKeys.add(item.key);
          uniquePhrases.push(item);
        }
      }
      return uniquePhrases.length > 0 ? uniquePhrases : DEFAULT_QUICK_PHRASES;
    }
  } catch {
    // Fall back to default
  }
  return DEFAULT_QUICK_PHRASES;
}

export function savePersistedQuickPhrases(phrases: QuickPhrase[]): void {
  try {
    const storage = typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
    if (storage) {
      storage.setItem(QUICK_PHRASE_STORAGE_KEY, JSON.stringify(phrases));
    }
  } catch {
    // Session fallback if storage is disabled
  }
}

export function insertTextAtCaret(editor: HTMLElement, textToInsert: string): string {
  editor.focus();
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    const next = (editor.textContent || '') + textToInsert;
    editor.textContent = next;
    return next;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();

  const textNode = document.createTextNode(textToInsert);
  range.insertNode(textNode);

  // Move caret immediately after the inserted text
  range.setStartAfter(textNode);
  range.setEndAfter(textNode);
  selection.removeAllRanges();
  selection.addRange(range);

  return editor.textContent || '';
}
