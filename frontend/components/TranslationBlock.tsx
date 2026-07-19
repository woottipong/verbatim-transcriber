import type { TranscriptTranslation } from '../types';
import {
  formatLanguageLabel,
  normalizeLanguageTag,
} from '../lib/transcriptMessages';

interface TranslationBlockProps {
  translation?: TranscriptTranslation;
}

export default function TranslationBlock({ translation }: TranslationBlockProps) {
  if (!translation) return null;

  const languageLabel = formatLanguageLabel(translation.languageCode);
  const languageTag = normalizeLanguageTag(translation.languageCode);

  return (
    <div className="translation-block">
      <span className="translation-block__label" aria-hidden="true">
        {!translation.isFinal && <span className="transcript-live-dot" />}
        {languageLabel}
      </span>
      <p
        className="translation-block__text"
        lang={languageTag}
        dir="auto"
      >
        <span className="sr-only" lang="th">คำแปลภาษา {languageLabel}: </span>
        {translation.text}
      </p>
    </div>
  );
}
