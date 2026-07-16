package domain

import (
	"strings"
	"unicode"
)

// NormalizeThaiSpacing removes tokenization spaces inside Thai text while
// preserving separators around Latin text, numbers, and punctuation.
func NormalizeThaiSpacing(text string) string {
	runes := []rune(strings.TrimSpace(text))
	if len(runes) == 0 {
		return ""
	}

	var normalized strings.Builder
	for i := 0; i < len(runes); {
		if !unicode.IsSpace(runes[i]) {
			normalized.WriteRune(runes[i])
			i++
			continue
		}

		spaceStart := i
		for i < len(runes) && unicode.IsSpace(runes[i]) {
			i++
		}

		if i == len(runes) {
			break
		}
		previous := runes[spaceStart-1]
		next := runes[i]
		if unicode.In(previous, unicode.Thai) && unicode.In(next, unicode.Thai) {
			continue
		}
		normalized.WriteByte(' ')
	}

	return normalized.String()
}
