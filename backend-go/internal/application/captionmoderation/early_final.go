package captionmoderation

import (
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode"
)

type CaptionPolicy string

const (
	CaptionPolicyEarlyFinal    CaptionPolicy = "early-final"
	CaptionPolicyProviderFinal CaptionPolicy = "provider-final"
)

type EarlyFinalConfig struct {
	MinimumObservations int
	MinimumSpan         time.Duration
	MinimumChunkRunes   int
	MaximumChunkRunes   int
	SafetyTailRunes     int
	MaxObservations     int
}

type EarlyFinalOutput struct {
	Pending    []SourceSegment
	Draft      *SourceSegment
	ClearDraft *SourceSegment
}

type earlyFinalObservation struct {
	at time.Time
}

type EarlyFinalCutter struct {
	mu sync.Mutex

	config               EarlyFinalConfig
	segmentID            string
	provider             string
	lastSequence         uint64
	emittedRunes         int
	emittedText          string
	latestSegment        SourceSegment
	cutNumber            int
	observations         []earlyFinalObservation
	lastText             []rune
	stableSince          []time.Time
	stableCounts         []int
	nextJoinWithoutSpace bool
}

func DefaultEarlyFinalConfig() EarlyFinalConfig {
	return EarlyFinalConfig{
		MinimumObservations: 2,
		MinimumSpan:         250 * time.Millisecond,
		MinimumChunkRunes:   12,
		MaximumChunkRunes:   45,
		SafetyTailRunes:     16,
		MaxObservations:     8,
	}
}

func NewEarlyFinalCutter(config EarlyFinalConfig) *EarlyFinalCutter {
	defaults := DefaultEarlyFinalConfig()
	if config.MinimumObservations <= 0 {
		config.MinimumObservations = defaults.MinimumObservations
	}
	if config.MinimumSpan <= 0 {
		config.MinimumSpan = defaults.MinimumSpan
	}
	if config.MinimumChunkRunes <= 0 {
		config.MinimumChunkRunes = defaults.MinimumChunkRunes
	}
	if config.MaximumChunkRunes < config.MinimumChunkRunes {
		config.MaximumChunkRunes = defaults.MaximumChunkRunes
	}
	if config.SafetyTailRunes <= 0 {
		config.SafetyTailRunes = defaults.SafetyTailRunes
	}
	if config.MaxObservations <= 0 {
		config.MaxObservations = defaults.MaxObservations
	}
	return &EarlyFinalCutter{config: config}
}

func ParseCaptionPolicy(value string) (CaptionPolicy, bool) {
	switch CaptionPolicy(strings.ToLower(strings.TrimSpace(value))) {
	case CaptionPolicyEarlyFinal:
		return CaptionPolicyEarlyFinal, true
	case CaptionPolicyProviderFinal:
		return CaptionPolicyProviderFinal, true
	default:
		return "", false
	}
}

func (c *EarlyFinalCutter) Observe(segment SourceSegment, at time.Time) EarlyFinalOutput {
	c.mu.Lock()
	defer c.mu.Unlock()

	segment = normalizeSourceSegment(segment)
	if segment.ID == "" || segment.Provider == "" || segment.Text == "" {
		return EarlyFinalOutput{}
	}
	if c.segmentID != segment.ID || c.provider != segment.Provider {
		c.resetLocked()
		c.segmentID = segment.ID
		c.provider = segment.Provider
	} else if !segment.IsFinal && segment.Sequence <= c.lastSequence {
		return EarlyFinalOutput{}
	}
	c.lastSequence = segment.Sequence

	if segment.IsFinal {
		return c.flushFinalLocked(segment)
	}

	current := []rune(segment.Text)
	c.latestSegment = segment
	c.updateStabilityLocked(current, at)
	c.observations = append(c.observations, earlyFinalObservation{at: at})
	if overflow := len(c.observations) - c.config.MaxObservations; overflow > 0 {
		c.observations = append([]earlyFinalObservation(nil), c.observations[overflow:]...)
	}
	return c.buildOutputLocked(segment, current, at)
}

// Reevaluate checks the most recent interim again after time has passed. It
// never records a synthetic provider observation or advances the sequence.
func (c *EarlyFinalCutter) Reevaluate(at time.Time) EarlyFinalOutput {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.latestSegment.ID == "" || len(c.lastText) == 0 || len(c.observations) == 0 {
		return EarlyFinalOutput{}
	}
	return c.buildOutputLocked(c.latestSegment, append([]rune(nil), c.lastText...), at)
}

// ReevaluateAfter returns the remaining time before the current stable prefix
// can be promoted. A revision does not restart time already accrued by that
// prefix.
func (c *EarlyFinalCutter) ReevaluateAfter(at time.Time) time.Duration {
	c.mu.Lock()
	defer c.mu.Unlock()
	candidate := min(
		len(c.lastText)-c.config.SafetyTailRunes,
		c.emittedRunes+c.config.MaximumChunkRunes,
	)
	for candidate > c.emittedRunes {
		index := candidate - 1
		if index < len(c.stableCounts) && c.stableCounts[index] >= c.config.MinimumObservations {
			break
		}
		candidate--
	}
	if candidate-c.emittedRunes >= c.config.MinimumChunkRunes {
		remaining := c.config.MinimumSpan - at.Sub(c.stableSince[candidate-1])
		if remaining < 0 {
			return 0
		}
		return remaining
	}
	return c.config.MinimumSpan
}

func (c *EarlyFinalCutter) buildOutputLocked(segment SourceSegment, current []rune, at time.Time) EarlyFinalOutput {
	output := EarlyFinalOutput{}
	if cut := c.stableCutLocked(current, at); cut > c.emittedRunes {
		chunk := strings.TrimSpace(string(current[c.emittedRunes:cut]))
		if len([]rune(chunk)) >= c.config.MinimumChunkRunes {
			c.cutNumber++
			output.Pending = []SourceSegment{{
				ID:               fmt.Sprintf("%s:early:%d", segment.ID, c.cutNumber),
				Provider:         segment.Provider,
				Text:             chunk,
				IsFinal:          true,
				Sequence:         segment.Sequence,
				LanguageCode:     segment.LanguageCode,
				JoinWithoutSpace: c.nextJoinWithoutSpace,
			}}
			c.emittedRunes = cut
			c.emittedText = string(current[:cut])
			c.nextJoinWithoutSpace = true
			c.observations = []earlyFinalObservation{{at: at}}
			c.resetTailStabilityLocked(cut, at)
		}
	}

	tail := suffixAfterEmission(segment.Text, c.emittedText)
	if tail != "" {
		draft := segment
		draft.Text = tail
		draft.JoinWithoutSpace = c.nextJoinWithoutSpace
		output.Draft = &draft
	}
	return output
}

func (c *EarlyFinalCutter) stableCutLocked(current []rune, at time.Time) int {
	if c.emittedText != "" && !strings.HasPrefix(string(current), c.emittedText) {
		return 0
	}
	candidate := len(current) - c.config.SafetyTailRunes
	for candidate > c.emittedRunes {
		index := candidate - 1
		if index < len(c.stableCounts) &&
			c.stableCounts[index] >= c.config.MinimumObservations &&
			at.Sub(c.stableSince[index]) >= c.config.MinimumSpan {
			break
		}
		candidate--
	}
	if candidate <= c.emittedRunes {
		return 0
	}
	candidate = min(candidate, c.emittedRunes+c.config.MaximumChunkRunes)
	return boundedTextCut(
		current,
		c.emittedRunes,
		candidate,
		c.config.MinimumChunkRunes,
	)
}

func (c *EarlyFinalCutter) resetTailStabilityLocked(cut int, at time.Time) {
	for index := cut; index < len(c.stableCounts); index++ {
		c.stableSince[index] = at
		c.stableCounts[index] = 1
	}
}

func (c *EarlyFinalCutter) updateStabilityLocked(current []rune, at time.Time) {
	common := commonPrefixRunes(c.lastText, current)
	since := make([]time.Time, len(current))
	counts := make([]int, len(current))
	for index := range current {
		if index < common && index < len(c.stableSince) && index < len(c.stableCounts) {
			since[index] = c.stableSince[index]
			counts[index] = c.stableCounts[index] + 1
			continue
		}
		since[index] = at
		counts[index] = 1
	}
	c.lastText = append(c.lastText[:0], current...)
	c.stableSince = since
	c.stableCounts = counts
}

func (c *EarlyFinalCutter) flushFinalLocked(segment SourceSegment) EarlyFinalOutput {
	remainder := suffixAfterEmission(segment.Text, c.emittedText)
	pending := c.splitFinalLocked(segment, remainder)
	c.resetLocked()
	if remainder == "" {
		return EarlyFinalOutput{ClearDraft: &segment}
	}
	return EarlyFinalOutput{Pending: pending}
}

func (c *EarlyFinalCutter) splitFinalLocked(
	segment SourceSegment,
	remainder string,
) []SourceSegment {
	text := []rune(strings.TrimSpace(remainder))
	if len(text) == 0 {
		return nil
	}

	pending := make([]SourceSegment, 0, (len(text)+c.config.MaximumChunkRunes-1)/c.config.MaximumChunkRunes)
	start := 0
	joinWithoutSpace := c.nextJoinWithoutSpace
	for start < len(text) {
		end := min(start+c.config.MaximumChunkRunes, len(text))
		if end < len(text) {
			if len(text)-end < c.config.MinimumChunkRunes {
				end = len(text) - c.config.MinimumChunkRunes
			}
			end = boundedTextCut(text, start, end, c.config.MinimumChunkRunes)
		}
		chunk := segment
		chunk.Text = strings.TrimSpace(string(text[start:end]))
		chunk.JoinWithoutSpace = joinWithoutSpace
		if end < len(text) {
			c.cutNumber++
			chunk.ID = fmt.Sprintf("%s:early:%d", segment.ID, c.cutNumber)
		}
		pending = append(pending, chunk)
		joinWithoutSpace = true
		start = end
	}
	return pending
}

func suffixAfterEmission(value, emitted string) string {
	value = strings.TrimSpace(value)
	emitted = strings.TrimSpace(emitted)
	if emitted == "" {
		return value
	}
	if strings.HasPrefix(value, emitted) {
		return strings.TrimSpace(strings.TrimPrefix(value, emitted))
	}
	if index := strings.LastIndex(value, emitted); index >= 0 {
		return strings.TrimSpace(value[index+len(emitted):])
	}

	emittedRunes := []rune(emitted)
	const minimumAnchorRunes = 8
	for start := 1; len(emittedRunes)-start >= minimumAnchorRunes; start++ {
		anchor := string(emittedRunes[start:])
		if index := strings.LastIndex(value, anchor); index >= 0 {
			return strings.TrimSpace(value[index+len(anchor):])
		}
	}

	// There is no safe boundary between the already-promoted text and the
	// provider final. Preserve the provider final verbatim for human review
	// instead of dropping an arbitrary positional prefix.
	return value
}

func (c *EarlyFinalCutter) Reset() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.resetLocked()
}

func (c *EarlyFinalCutter) resetLocked() {
	c.segmentID = ""
	c.provider = ""
	c.lastSequence = 0
	c.emittedRunes = 0
	c.emittedText = ""
	c.latestSegment = SourceSegment{}
	c.cutNumber = 0
	c.observations = nil
	c.lastText = nil
	c.stableSince = nil
	c.stableCounts = nil
	c.nextJoinWithoutSpace = false
}

func (c *EarlyFinalCutter) observationCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.observations)
}

func commonPrefixRunes(left, right []rune) int {
	limit := min(len(left), len(right))
	for index := 0; index < limit; index++ {
		if left[index] != right[index] {
			return index
		}
	}
	return limit
}

func boundedTextCut(text []rune, start, limit, minimum int) int {
	if limit <= start {
		return start
	}

	minimumCut := min(start+minimum, limit)
	preferredCut := max(minimumCut, start+(limit-start)/2)
	boundaryRanges := [][2]int{
		{preferredCut, limit},
		{minimumCut, preferredCut - 1},
	}
	for _, boundaryRange := range boundaryRanges {
		if boundaryRange[1] < boundaryRange[0] {
			continue
		}
		if cut := latestBoundaryAfter(
			text,
			boundaryRange[0],
			boundaryRange[1],
			isSentenceTerminator,
		); cut > 0 {
			return combiningMarkSafeCut(text, start, cut)
		}
		if cut := latestBoundaryAfter(
			text,
			boundaryRange[0],
			boundaryRange[1],
			isClauseSeparator,
		); cut > 0 {
			return combiningMarkSafeCut(text, start, cut)
		}
		if cut := latestWhitespaceBoundary(text, boundaryRange[0], boundaryRange[1]); cut > 0 {
			return combiningMarkSafeCut(text, start, cut)
		}
	}
	return combiningMarkSafeCut(text, start, limit)
}

func combiningMarkSafeCut(text []rune, start, cut int) int {
	cut = min(cut, len(text))
	for cut > start && cut < len(text) && (unicode.Is(unicode.Mn, text[cut]) ||
		unicode.Is(unicode.Mc, text[cut]) ||
		unicode.Is(unicode.Me, text[cut])) {
		cut--
	}
	return cut
}

func latestBoundaryAfter(text []rune, from, through int, matches func(rune) bool) int {
	through = min(through, len(text))
	for index := through; index >= from; index-- {
		if index > 0 && matches(text[index-1]) {
			return index
		}
	}
	return 0
}

func latestWhitespaceBoundary(text []rune, from, through int) int {
	through = min(through, len(text))
	for index := through; index >= from; index-- {
		if index < len(text) && unicode.IsSpace(text[index]) {
			return index
		}
		if index > 0 && unicode.IsSpace(text[index-1]) {
			return index
		}
	}
	return 0
}

func isSentenceTerminator(value rune) bool {
	switch value {
	case '.', '!', '?', '…', '。', '！', '？', '๚', '๛':
		return true
	default:
		return false
	}
}

func isClauseSeparator(value rune) bool {
	switch value {
	case ',', ';', ':', '、', '，', '；', '：', '—', '–':
		return true
	default:
		return false
	}
}
