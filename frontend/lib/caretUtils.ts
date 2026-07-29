/**
 * Helper utility to calculate the character offset of the text cursor (caret)
 * inside a contentEditable element.
 */
export function getContentEditableCaretOffset(editor: HTMLDivElement | null): number | undefined {
  if (!editor) return undefined;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return undefined;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(editor);
  prefix.setEnd(range.startContainer, range.startOffset);
  return prefix.toString().length;
}

export function clampCaretOffset(offset: number, textLength: number): number {
  return Math.min(Math.max(0, offset), Math.max(0, textLength));
}

export function replaceContentEditableTextPreservingCaret(
  editor: HTMLDivElement,
  text: string,
): void {
  const caretOffset = getContentEditableCaretOffset(editor);
  editor.textContent = text;
  if (caretOffset === undefined) return;

  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  const textNode = editor.firstChild;
  if (textNode) {
    range.setStart(textNode, clampCaretOffset(caretOffset, text.length));
  } else {
    range.setStart(editor, 0);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}
