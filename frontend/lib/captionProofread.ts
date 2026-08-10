export const PROOFREAD_IDLE_MS = 1_200;
export const PROOFREAD_HARD_FLUSH_MS = 2_500;
export const PROOFREAD_MAX_GRAPHEMES = 320;
export const PROOFREAD_CONTEXT_GRAPHEMES = 160;

export interface ProofreadBatch {
  requestId: string;
  revision: number;
  baseText: string;
  start: number;
  end: number;
  targetText: string;
  contextText: string;
}

export function getAppendedSuffix(previousText: string, nextText: string): string | null {
  if (nextText.length <= previousText.length || !nextText.startsWith(previousText)) return null;
  return nextText.slice(previousText.length);
}

export function takeTrailingContext(text: string, maxGraphemes = PROOFREAD_CONTEXT_GRAPHEMES): string {
  const graphemes = splitGraphemes(text);
  return graphemes.slice(-maxGraphemes).join('');
}

export function createProofreadBatch(
  baseText: string,
  pendingStart: number,
  revision: number,
  requestId: string,
  previousPublishedText = '',
): ProofreadBatch | null {
  let start = Math.max(0, Math.min(pendingStart, baseText.length));
  while (start < baseText.length && isWhitespaceAt(baseText, start)) start += 1;
  const targetGraphemes = splitGraphemes(baseText.slice(start)).slice(0, PROOFREAD_MAX_GRAPHEMES);
  let end = start + targetGraphemes.join('').length;
  while (end > start && isWhitespaceAt(baseText, end - 1)) end -= 1;
  const targetText = baseText.slice(start, end);
  if (!targetText.trim()) return null;

  return {
    requestId,
    revision,
    baseText,
    start,
    end,
    targetText,
    contextText: takeTrailingContext(previousPublishedText + baseText.slice(0, start)),
  };
}

export function applyProofreadResult(
  currentText: string,
  batch: ProofreadBatch,
  suggestedText: string,
): string | null {
  if (!suggestedText || !currentText.startsWith(batch.baseText)) return null;
  if (currentText.slice(batch.start, batch.end) !== batch.targetText) return null;
  return currentText.slice(0, batch.start) + suggestedText + currentText.slice(batch.end);
}

export function shouldFlushProofread(
  pendingText: string,
  idleElapsedMs: number,
  hardElapsedMs: number,
  force = false,
): boolean {
  if (!pendingText) return false;
  if (force || hardElapsedMs >= PROOFREAD_HARD_FLUSH_MS) return true;
  return idleElapsedMs >= PROOFREAD_IDLE_MS || countGraphemes(pendingText) >= PROOFREAD_MAX_GRAPHEMES;
}

export function countProofreadGraphemes(text: string): number {
  return countGraphemes(text);
}

function countGraphemes(text: string): number {
  return splitGraphemes(text).length;
}

function splitGraphemes(text: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(text), part => part.segment);
  }

  const graphemes: string[] = [];
  for (const character of text) {
    if (/^\p{Mark}$/u.test(character) && graphemes.length > 0) {
      graphemes[graphemes.length - 1] += character;
    } else {
      graphemes.push(character);
    }
  }
  return graphemes;
}

function isWhitespaceAt(text: string, index: number): boolean {
  return /^\s$/u.test(text[index] || '');
}
