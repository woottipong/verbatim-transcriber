import type { TranscriptSegment } from '../types';

type TranscriptTextSegment = Pick<TranscriptSegment, 'text'>;

function toFilenameSlug(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

export function formatTranscriptText(
  segments: readonly TranscriptTextSegment[],
): string {
  return segments
    .map(segment => segment.text.trim())
    .filter(Boolean)
    .join('\n');
}

export function buildTranscriptFilename(
  roomName: string,
  provider: string,
  date = new Date(),
): string {
  const datePart = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');

  return `${toFilenameSlug(roomName, 'room')}-${toFilenameSlug(provider, 'provider')}-transcript-${datePart}.txt`;
}

export function downloadTranscriptText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  try {
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}
