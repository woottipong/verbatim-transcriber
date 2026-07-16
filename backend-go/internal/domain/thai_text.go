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

// NormalizeThaiSpacing removes tokenization spaces inside Thai text while
// preserving separators around Latin text, numbers, and punctuation. It also
// dynamically inserts spaces at the boundaries between Thai characters and
// Latin letters/digits to improve readability.
func NormalizeThaiSpacing(text string) string {
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

			nextRune := runes[i]
			if lastNonSpace != 0 {
				if isThai(lastNonSpace) && isThai(nextRune) {
					// Skip tokenization spaces between consecutive Thai characters
					spaceWritten = false
				} else {
					normalized.WriteByte(' ')
					spaceWritten = true
				}
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
