package captionmoderation

import (
	"strings"
	"testing"
	"time"
	"unicode"
	"unicode/utf8"
)

func TestEarlyFinalPromotesStablePrefixAndKeepsSafetyTail(t *testing.T) {
	cutter := NewEarlyFinalCutter(EarlyFinalConfig{
		MinimumObservations: 3,
		MinimumSpan:         300 * time.Millisecond,
		MinimumChunkRunes:   10,
		SafetyTailRunes:     12,
		MaxObservations:     8,
	})
	start := time.Unix(1_000, 0)

	first := cutter.Observe(earlyDraft("g-1", "hello stable phrase mutable tail"), start)
	second := cutter.Observe(earlyDraft("g-1", "hello stable phrase mutable tail grows"), start.Add(150*time.Millisecond))
	third := cutter.Observe(earlyDraft("g-1", "hello stable phrase mutable tail grows again"), start.Add(300*time.Millisecond))

	if len(first.Pending) != 0 || len(second.Pending) != 0 {
		t.Fatalf("promoted before observation threshold: first=%#v second=%#v", first, second)
	}
	if len(third.Pending) != 1 {
		t.Fatalf("pending = %#v, want one promoted chunk", third.Pending)
	}
	if third.Pending[0].Text != "hello stable phrase mutable tail" {
		t.Fatalf("promoted text = %q", third.Pending[0].Text)
	}
	if third.Pending[0].ID != "g-1:early:1" || !third.Pending[0].IsFinal {
		t.Fatalf("promoted segment = %#v", third.Pending[0])
	}
	if third.Draft == nil || third.Draft.Text != "grows again" || third.Draft.ID != "g-1" {
		t.Fatalf("Draft tail = %#v", third.Draft)
	}
}

func TestEarlyFinalReevaluatesLatestDraftAfterIdle(t *testing.T) {
	cutter := NewEarlyFinalCutter(EarlyFinalConfig{
		MinimumObservations: 2,
		MinimumSpan:         250 * time.Millisecond,
		MinimumChunkRunes:   12,
		MaximumChunkRunes:   45,
		SafetyTailRunes:     16,
		MaxObservations:     8,
	})
	start := time.Unix(9_000, 0)
	cutter.Observe(earlyDraftWithSequence(
		"th-idle",
		"ข้อความส่วนต้นที่นิ่งแล้วและส่วนท้ายที่ยังเปลี่ยนได้",
		1,
	), start)
	second := cutter.Observe(earlyDraftWithSequence(
		"th-idle",
		"ข้อความส่วนต้นที่นิ่งแล้วและส่วนท้ายที่ยังเปลี่ยนได้อีก",
		2,
	), start.Add(100*time.Millisecond))
	if len(second.Pending) != 0 {
		t.Fatalf("promoted too early: %#v", second.Pending)
	}

	output := cutter.Reevaluate(start.Add(250 * time.Millisecond))
	if len(output.Pending) != 1 || output.Draft == nil {
		t.Fatalf("idle output = %#v", output)
	}
	if got := output.Pending[0].Text + output.Draft.Text; got != "ข้อความส่วนต้นที่นิ่งแล้วและส่วนท้ายที่ยังเปลี่ยนได้อีก" {
		t.Fatalf("idle reconstruction = %q", got)
	}
}

func TestEarlyFinalReevaluationDoesNotPromoteSameRevisionTwice(t *testing.T) {
	cutter := NewEarlyFinalCutter(EarlyFinalConfig{
		MinimumObservations: 2,
		MinimumSpan:         250 * time.Millisecond,
		MinimumChunkRunes:   12,
		MaximumChunkRunes:   45,
		SafetyTailRunes:     16,
		MaxObservations:     8,
	})
	start := time.Unix(9_500, 0)
	text := "ข้อความส่วนต้นที่นิ่งแล้วและส่วนท้ายที่ยังเปลี่ยนได้อีก"
	cutter.Observe(earlyDraftWithSequence("th-repeat", text, 1), start)
	cutter.Observe(earlyDraftWithSequence("th-repeat", text+"ครับ", 2), start.Add(100*time.Millisecond))

	first := cutter.Reevaluate(start.Add(250 * time.Millisecond))
	second := cutter.Reevaluate(start.Add(500 * time.Millisecond))
	if len(first.Pending) != 1 || len(second.Pending) != 0 {
		t.Fatalf("repeated idle output = first=%#v second=%#v", first, second)
	}
}

func TestDefaultEarlyFinalConfigUsesFasterConservativeBounds(t *testing.T) {
	config := DefaultEarlyFinalConfig()
	if config.MinimumObservations != 2 || config.MinimumSpan != 250*time.Millisecond {
		t.Fatalf("stability defaults = %#v", config)
	}
	if config.MinimumChunkRunes != 12 || config.MaximumChunkRunes != 45 || config.SafetyTailRunes != 16 {
		t.Fatalf("chunk defaults = %#v", config)
	}
}

func TestEarlyFinalWaitsForMinimumSpanAndChunkLength(t *testing.T) {
	cutter := NewEarlyFinalCutter(DefaultEarlyFinalConfig())
	start := time.Unix(2_000, 0)

	for index, elapsed := range []time.Duration{0, 100 * time.Millisecond, 250 * time.Millisecond} {
		output := cutter.Observe(earlyDraft("g-1", "short text that continues"), start.Add(elapsed))
		if len(output.Pending) != 0 {
			t.Fatalf("observation %d promoted before 300ms: %#v", index, output.Pending)
		}
	}

	cutter.Reset()
	for index, elapsed := range []time.Duration{0, 150 * time.Millisecond, 300 * time.Millisecond} {
		output := cutter.Observe(earlyDraft("g-2", "tiny mutable-tail"), start.Add(elapsed))
		if len(output.Pending) != 0 {
			t.Fatalf("observation %d promoted a short chunk: %#v", index, output.Pending)
		}
	}
}

func TestEarlyFinalResetReleasesLatestSegment(t *testing.T) {
	cutter := NewEarlyFinalCutter(DefaultEarlyFinalConfig())
	cutter.Observe(earlyDraftWithSequence(
		"g-reset",
		strings.Repeat("ข้อความ Interim ที่ไม่ควรถูกเก็บไว้", 100),
		1,
	), time.Unix(2_500, 0))

	cutter.Reset()

	if cutter.latestSegment != (SourceSegment{}) {
		t.Fatalf("latest segment retained after reset: %#v", cutter.latestSegment)
	}
}

func TestEarlyFinalCutsThaiAtRuneBoundary(t *testing.T) {
	cutter := NewEarlyFinalCutter(EarlyFinalConfig{
		MinimumObservations: 3,
		MinimumSpan:         300 * time.Millisecond,
		MinimumChunkRunes:   10,
		SafetyTailRunes:     12,
		MaxObservations:     8,
	})
	start := time.Unix(3_000, 0)
	texts := []string{
		"วันนี้เราจะพูดเรื่องการลงทุนระยะยาวต่อไปครับ",
		"วันนี้เราจะพูดเรื่องการลงทุนระยะยาวต่อไปครับอีกนิด",
		"วันนี้เราจะพูดเรื่องการลงทุนระยะยาวต่อไปครับอีกนิดหนึ่ง",
	}
	var output EarlyFinalOutput
	for index, text := range texts {
		output = cutter.Observe(earlyDraft("th-1", text), start.Add(time.Duration(index)*150*time.Millisecond))
	}

	if len(output.Pending) != 1 || !utf8.ValidString(output.Pending[0].Text) {
		t.Fatalf("Thai promotion = %#v", output.Pending)
	}
	if output.Draft == nil || !utf8.ValidString(output.Draft.Text) {
		t.Fatalf("Thai Draft = %#v", output.Draft)
	}
	if utf8.RuneCountInString(output.Draft.Text) < 12 {
		t.Fatalf("Draft tail runes = %d, want at least 12", utf8.RuneCountInString(output.Draft.Text))
	}
}

func TestEarlyFinalRejectsStaleSequenceAndResetsForNewSegment(t *testing.T) {
	cutter := NewEarlyFinalCutter(DefaultEarlyFinalConfig())
	start := time.Unix(4_000, 0)
	cutter.Observe(earlyDraftWithSequence("g-1", "newest Draft text", 5), start)

	stale := cutter.Observe(earlyDraftWithSequence("g-1", "stale Draft", 4), start.Add(time.Second))
	if stale.Draft != nil || len(stale.Pending) != 0 {
		t.Fatalf("stale output = %#v, want empty", stale)
	}

	next := cutter.Observe(earlyDraftWithSequence("g-2", "next segment Draft", 1), start.Add(2*time.Second))
	if next.Draft == nil || next.Draft.ID != "g-2" || next.Draft.Text != "next segment Draft" {
		t.Fatalf("new segment output = %#v", next)
	}
}

func TestEarlyFinalProviderFinalFlushesOnlyUnpromotedSuffix(t *testing.T) {
	cutter := NewEarlyFinalCutter(EarlyFinalConfig{
		MinimumObservations: 3,
		MinimumSpan:         300 * time.Millisecond,
		MinimumChunkRunes:   10,
		SafetyTailRunes:     12,
		MaxObservations:     8,
	})
	start := time.Unix(5_000, 0)
	texts := []string{
		"hello stable phrase mutable tail",
		"hello stable phrase mutable tail grows",
		"hello stable phrase mutable tail grows again",
	}
	for index, text := range texts {
		cutter.Observe(earlyDraft("g-1", text), start.Add(time.Duration(index)*150*time.Millisecond))
	}

	final := earlyDraftWithSequence("g-1", "hello stable phrase mutable tail grows again final", 10)
	final.IsFinal = true
	output := cutter.Observe(final, start.Add(time.Second))
	if len(output.Pending) != 1 {
		t.Fatalf("final pending = %#v", output.Pending)
	}
	if output.Pending[0].ID != "g-1" || output.Pending[0].Text != "grows again final" {
		t.Fatalf("final remainder = %#v", output.Pending[0])
	}
	if strings.Contains(output.Pending[0].Text, "hello stable phrase") {
		t.Fatalf("final duplicated promoted prefix: %q", output.Pending[0].Text)
	}
	if output.Draft != nil {
		t.Fatalf("Draft remained after final: %#v", output.Draft)
	}
}

func TestEarlyFinalProviderFinalClearsDraftWhenTailWasRetracted(t *testing.T) {
	cutter := NewEarlyFinalCutter(EarlyFinalConfig{
		MinimumObservations: 3,
		MinimumSpan:         300 * time.Millisecond,
		MinimumChunkRunes:   10,
		SafetyTailRunes:     12,
		MaxObservations:     8,
	})
	start := time.Unix(5_500, 0)
	for index, text := range []string{
		"hello stable phrase mutable tail",
		"hello stable phrase mutable tail grows",
		"hello stable phrase mutable tail grows again",
	} {
		cutter.Observe(earlyDraft("g-1", text), start.Add(time.Duration(index)*150*time.Millisecond))
	}

	final := earlyDraftWithSequence("g-1", "hello stable phrase mutable tail", 100)
	final.IsFinal = true
	output := cutter.Observe(final, start.Add(time.Second))

	if len(output.Pending) != 0 {
		t.Fatalf("retracted tail was published: %#v", output.Pending)
	}
	if output.ClearDraft == nil || output.ClearDraft.ID != "g-1" {
		t.Fatalf("Draft clear = %#v", output.ClearDraft)
	}
}

func TestEarlyFinalAlignsDivergentFinalWithoutPositionalTruncation(t *testing.T) {
	cutter := NewEarlyFinalCutter(EarlyFinalConfig{
		MinimumObservations: 3,
		MinimumSpan:         300 * time.Millisecond,
		MinimumChunkRunes:   10,
		SafetyTailRunes:     12,
		MaxObservations:     8,
	})
	start := time.Unix(5_750, 0)
	for index, text := range []string{
		"hello stable phrase mutable tail",
		"hello stable phrase mutable tail grows",
		"hello stable phrase mutable tail grows again",
	} {
		cutter.Observe(earlyDraft("g-1", text), start.Add(time.Duration(index)*150*time.Millisecond))
	}

	final := earlyDraftWithSequence(
		"g-1",
		"well hello stable phrase mutable tail corrected ending",
		100,
	)
	final.IsFinal = true
	output := cutter.Observe(final, start.Add(time.Second))

	if len(output.Pending) != 1 || output.Pending[0].Text != "corrected ending" {
		t.Fatalf("aligned final suffix = %#v", output.Pending)
	}
	if output.ClearDraft != nil {
		t.Fatalf("unexpected Draft clear = %#v", output.ClearDraft)
	}
}

func TestEarlyFinalAlignsDivergentInterimAndStopsFurtherPromotion(t *testing.T) {
	cutter := NewEarlyFinalCutter(EarlyFinalConfig{
		MinimumObservations: 3,
		MinimumSpan:         300 * time.Millisecond,
		MinimumChunkRunes:   10,
		SafetyTailRunes:     12,
		MaxObservations:     8,
	})
	start := time.Unix(5_875, 0)
	for index, text := range []string{
		"hello stable phrase mutable tail",
		"hello stable phrase mutable tail grows",
		"hello stable phrase mutable tail grows again",
	} {
		cutter.Observe(earlyDraft("g-1", text), start.Add(time.Duration(index)*150*time.Millisecond))
	}

	output := cutter.Observe(
		earlyDraftWithSequence(
			"g-1",
			"well hello stable phrase mutable tail corrected ending",
			100,
		),
		start.Add(time.Second),
	)
	if len(output.Pending) != 0 {
		t.Fatalf("promoted after prefix divergence: %#v", output.Pending)
	}
	if output.Draft == nil || output.Draft.Text != "corrected ending" {
		t.Fatalf("aligned divergent Draft = %#v", output.Draft)
	}
}

func TestEarlyFinalUsesLongestPromotedSuffixAsFinalAlignmentAnchor(t *testing.T) {
	if got := suffixAfterEmission(
		"hello corrected phrase mutable tail corrected ending",
		"hello stable phrase mutable tail",
	); got != "corrected ending" {
		t.Fatalf("aligned suffix = %q", got)
	}
	if got := suffixAfterEmission(
		"completely rewritten provider final",
		"unrelated promoted phrase",
	); got != "completely rewritten provider final" {
		t.Fatalf("unaligned final = %q", got)
	}
}

func TestEarlyFinalBoundsObservationHistory(t *testing.T) {
	cutter := NewEarlyFinalCutter(EarlyFinalConfig{
		MinimumObservations: 20,
		MinimumSpan:         time.Hour,
		MinimumChunkRunes:   10,
		SafetyTailRunes:     12,
		MaxObservations:     4,
	})
	start := time.Unix(6_000, 0)
	for index := 1; index <= 20; index++ {
		cutter.Observe(
			earlyDraftWithSequence("g-1", "bounded history text "+strings.Repeat("x", index), uint64(index)),
			start.Add(time.Duration(index)*time.Second),
		)
	}
	if got := cutter.observationCount(); got != 4 {
		t.Fatalf("observation count = %d, want 4", got)
	}
}

func TestEarlyFinalPromotesAfterMinimumSpanAtHighRevisionFrequency(t *testing.T) {
	cutter := NewEarlyFinalCutter(DefaultEarlyFinalConfig())
	start := time.Unix(6_500, 0)
	text := "stable phrase stays unchanged mutable tail"
	var output EarlyFinalOutput
	var promoted bool
	for index := 0; index <= 15; index++ {
		output = cutter.Observe(
			earlyDraftWithSequence("g-fast", text, uint64(index+1)),
			start.Add(time.Duration(index)*20*time.Millisecond),
		)
		promoted = promoted || len(output.Pending) == 1
	}

	if !promoted {
		t.Fatalf("high-frequency stable text was not promoted: %#v", output)
	}
}

func TestEarlyFinalBoundsOnePromotedChunkForLongStableThaiText(t *testing.T) {
	cutter := NewEarlyFinalCutter(DefaultEarlyFinalConfig())
	start := time.Unix(7_000, 0)
	text := strings.Repeat("ก", 200) + strings.Repeat("ข", 12)
	var output EarlyFinalOutput
	for index := 0; index < 3; index++ {
		output = cutter.Observe(
			earlyDraftWithSequence("th-long", text, uint64(index+1)),
			start.Add(time.Duration(index)*150*time.Millisecond),
		)
	}

	if len(output.Pending) != 1 {
		t.Fatalf("promoted chunks = %#v, want one bounded chunk", output.Pending)
	}
	if got := utf8.RuneCountInString(output.Pending[0].Text); got > 45 {
		t.Fatalf("promoted chunk length = %d runes, want at most 45", got)
	}
	if output.Draft == nil || !output.Draft.JoinWithoutSpace {
		t.Fatalf("Thai continuation Draft = %#v", output.Draft)
	}
	if got := output.Pending[0].Text + output.Draft.Text; got != text {
		t.Fatalf("bounded promotion changed Thai text: got %q want %q", got, text)
	}
}

func TestEarlyFinalDoesNotSplitThaiGraphemeAtFallbackBoundary(t *testing.T) {
	cutter := NewEarlyFinalCutter(DefaultEarlyFinalConfig())
	start := time.Unix(7_250, 0)
	text := strings.Repeat("ก้", 40) + strings.Repeat("ข", 16)
	var output EarlyFinalOutput
	for index := 0; index < 3; index++ {
		output = cutter.Observe(
			earlyDraftWithSequence("th-grapheme", text, uint64(index+1)),
			start.Add(time.Duration(index)*150*time.Millisecond),
		)
	}

	if len(output.Pending) != 1 || output.Draft == nil {
		t.Fatalf("split output = %#v, want one pending chunk and Draft", output)
	}
	draftRunes := []rune(output.Draft.Text)
	if len(draftRunes) == 0 || unicode.Is(unicode.Mn, draftRunes[0]) {
		t.Fatalf("Draft starts inside Thai grapheme: pending=%q Draft=%q", output.Pending[0].Text, output.Draft.Text)
	}
	if got := output.Pending[0].Text + output.Draft.Text; got != text {
		t.Fatalf("grapheme-safe split changed text: got %q want %q", got, text)
	}
}

func TestEarlyFinalSplitsLongProviderFinalWithoutChangingThaiText(t *testing.T) {
	cutter := NewEarlyFinalCutter(DefaultEarlyFinalConfig())
	text := strings.Repeat("ก", 170)
	final := earlyDraftWithSequence("th-final", text, 1)
	final.IsFinal = true

	output := cutter.Observe(final, time.Unix(7_500, 0))
	if len(output.Pending) != 4 {
		t.Fatalf("final chunks = %d, want 4", len(output.Pending))
	}
	var reconstructed strings.Builder
	for index, chunk := range output.Pending {
		if got := utf8.RuneCountInString(chunk.Text); got > 45 {
			t.Fatalf("chunk %d length = %d runes, want at most 45", index, got)
		}
		if index > 0 && !chunk.JoinWithoutSpace {
			reconstructed.WriteByte(' ')
		}
		reconstructed.WriteString(chunk.Text)
	}
	if reconstructed.String() != text {
		t.Fatalf("reconstructed final changed: got %q want %q", reconstructed.String(), text)
	}
	if output.Pending[len(output.Pending)-1].ID != "th-final" {
		t.Fatalf("last final ID = %q, want raw provider ID", output.Pending[len(output.Pending)-1].ID)
	}
}

func TestEarlyFinalPrefersExistingSentenceBreakWithoutInventingPunctuation(t *testing.T) {
	cutter := NewEarlyFinalCutter(DefaultEarlyFinalConfig())
	text := strings.Repeat("ก", 40) + "ครับ. " +
		strings.Repeat("ข", 12) + " " +
		strings.Repeat("ค", 30)
	final := earlyDraftWithSequence("th-natural-break", text, 1)
	final.IsFinal = true

	output := cutter.Observe(final, time.Unix(8_000, 0))
	if len(output.Pending) < 2 {
		t.Fatalf("final chunks = %#v, want a natural split", output.Pending)
	}
	if !strings.HasSuffix(output.Pending[0].Text, ".") {
		t.Fatalf("first chunk = %q, want existing sentence punctuation kept at the break", output.Pending[0].Text)
	}

	var reconstructed strings.Builder
	for index, chunk := range output.Pending {
		if index > 0 && !chunk.JoinWithoutSpace {
			reconstructed.WriteByte(' ')
		}
		reconstructed.WriteString(chunk.Text)
	}
	want := strings.Replace(text, ". ", ".", 1)
	if reconstructed.String() != want {
		t.Fatalf("split reconstruction = %q, want joined continuation %q", reconstructed.String(), want)
	}
	if strings.Count(reconstructed.String(), ".") != strings.Count(text, ".") {
		t.Fatalf("split changed provider punctuation: got %q want punctuation from %q", reconstructed.String(), text)
	}
}

func TestEarlyFinalDraftJoinsItsGeneratedSplitWithoutAnInsertedSpace(t *testing.T) {
	cutter := NewEarlyFinalCutter(DefaultEarlyFinalConfig())
	start := time.Unix(8_500, 0)
	text := strings.Repeat("ก", 40) + "ครับ. " + strings.Repeat("ข", 24)
	var output EarlyFinalOutput
	for index := 0; index < 3; index++ {
		output = cutter.Observe(
			earlyDraftWithSequence("th-generated-split", text, uint64(index+1)),
			start.Add(time.Duration(index)*150*time.Millisecond),
		)
	}

	if len(output.Pending) != 1 || output.Draft == nil {
		t.Fatalf("split output = %#v, want one pending chunk and its Draft continuation", output)
	}
	if !output.Draft.JoinWithoutSpace {
		t.Fatalf("Draft continuation = %#v, generated split must not insert a space", output.Draft)
	}
	if strings.Contains(output.Pending[0].Text+output.Draft.Text, ". ") {
		t.Fatalf(
			"generated split inserted a visible gap: pending=%q Draft=%q",
			output.Pending[0].Text,
			output.Draft.Text,
		)
	}
}

func earlyDraft(id, text string) SourceSegment {
	return earlyDraftWithSequence(id, text, uint64(utf8.RuneCountInString(text)))
}

func earlyDraftWithSequence(id, text string, sequence uint64) SourceSegment {
	return SourceSegment{
		ID: id, Provider: "google", Text: text, Sequence: sequence,
	}
}
