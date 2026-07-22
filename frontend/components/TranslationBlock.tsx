import { memo } from 'react';
import type { TranscriptTranslation } from '../types';
import {
  formatLanguageLabel,
  normalizeLanguageTag,
} from '../lib/transcriptMessages';

interface TranslationBlockProps {
  translation?: TranscriptTranslation;
}

function TranslationBlock({ translation }: TranslationBlockProps) {
  if (!translation) return null;

  const languageLabel = formatLanguageLabel(translation.languageCode);
  const languageTag = normalizeLanguageTag(translation.languageCode);

  return (
    <div className="translation-block">
      <span className="translation-block__label" title={languageLabel} aria-hidden="true">
        <span className="language-label__text">{languageLabel}</span>
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

export default memo(TranslationBlock);
