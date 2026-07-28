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
