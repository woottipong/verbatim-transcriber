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

// NormalizeThaiSpacing is retained for callers using the original API name.
func NormalizeThaiSpacing(text string) string {
	return NormalizeTranscriptSpacing(text)
}
