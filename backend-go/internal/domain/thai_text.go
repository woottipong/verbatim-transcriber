package domain

import (
	"strings"
	"unicode"
)

// isThai returns true if the rune is in the Thai Unicode range (U+0E00 to U+0E7F).
func isThai(r rune) bool {
	return r >= 0x0E00 && r <= 0x0E7F
}

// isLatinOrDigit returns true if the rune is a standard English letter, a digit,
// or falls in the primary Latin supplemented and extended blocks.
func isLatinOrDigit(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') ||
		(r >= 0x00C0 && r <= 0x024F)
}

// NormalizeTranscriptSpacing collapses repeated whitespace while preserving explicit
// Thai text boundaries. It also inserts spaces at boundaries between Thai
// characters and Latin letters/digits to improve readability.
func NormalizeTranscriptSpacing(text string) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return ""
	}

	runes := []rune(text)
	var normalized strings.Builder
	// Grow buffer slightly larger than input string length to avoid allocations
	normalized.Grow(len(text) + 8)

	var lastNonSpace rune = 0
	var spaceWritten bool = false

	for i := 0; i < len(runes); {
		r := runes[i]
		if unicode.IsSpace(r) {
			for i < len(runes) && unicode.IsSpace(runes[i]) {
				i++
			}
			if i == len(runes) {
				break
			}

			if lastNonSpace != 0 {
				normalized.WriteByte(' ')
				spaceWritten = true
			}
			continue
		}

		// Non-space rune: check for language boundary before writing if no space was just written
		if lastNonSpace != 0 && !spaceWritten {
			if (isThai(lastNonSpace) && isLatinOrDigit(r)) || (isLatinOrDigit(lastNonSpace) && isThai(r)) {
				normalized.WriteByte(' ')
			}
		}

		normalized.WriteRune(r)
		lastNonSpace = r
		spaceWritten = false
		i++
	}

	return normalized.String()
}

// NormalizeProviderTranscriptSpacing applies provider-specific cleanup after
// the shared whitespace normalization. Google Thai transcripts may contain
// spaces between every recognized word; those Thai-to-Thai spaces are not
// useful in standard Thai display text.
func NormalizeProviderTranscriptSpacing(provider, languageCode, text string) string {
	normalized := NormalizeTranscriptSpacing(text)
	if !strings.EqualFold(strings.TrimSpace(provider), "google") || !isThaiLanguage(languageCode) {
		return normalized
	}
	return removeSpacesBetweenThai(normalized)
}

func isThaiLanguage(languageCode string) bool {
	language := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(languageCode), "_", "-"))
	return language == "th" || strings.HasPrefix(language, "th-")
}

func removeSpacesBetweenThai(text string) string {
	runes := []rune(text)
	var normalized strings.Builder
	normalized.Grow(len(text))

	for index, current := range runes {
		if current != ' ' {
			normalized.WriteRune(current)
			continue
		}

		var previous, next rune
		if index > 0 {
			previous = runes[index-1]
		}
		if index+1 < len(runes) {
			next = runes[index+1]
		}
		if isThai(previous) && isThai(next) {
			continue
		}
		normalized.WriteRune(current)
	}

	return normalized.String()
}

// NormalizeThaiSpacing is retained for callers using the original API name.
func NormalizeThaiSpacing(text string) string {
	return NormalizeTranscriptSpacing(text)
}
