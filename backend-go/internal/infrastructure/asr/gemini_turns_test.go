package asr

import (
	"strings"
	"testing"
)

func TestGeminiTranscriptAccumulatorPreservesIncrementalAndCumulativeTails(t *testing.T) {
	var accumulator geminiTranscriptAccumulator
	if tail, _ := accumulator.observe("one"); tail != "one" {
		t.Fatalf("tail = %q, want one", tail)
	}
	if tail, _ := accumulator.observe("two"); tail != "one two" {
		t.Fatalf("tail = %q, want one two", tail)
	}

	cutoff := accumulator.historyCutoff()
	accumulator.commit(cutoff)
	if tail, _ := accumulator.observe("one two three"); tail != "three" {
		t.Fatalf("cumulative tail = %q, want three", tail)
	}
	if tail, _ := accumulator.observe("four"); tail != "three four" {
		t.Fatalf("incremental tail = %q, want three four", tail)
	}
}

func TestGeminiTranscriptAccumulatorFreezesPendingCutoff(t *testing.T) {
	var accumulator geminiTranscriptAccumulator
	accumulator.observe("first sentence.")
	cutoff := accumulator.historyCutoff()
	accumulator.observe("second sentence")

	oldTail, ok := accumulator.tailAt(cutoff)
	if !ok || oldTail != "first sentence." {
		t.Fatalf("old tail = %q, prefixOK = %t", oldTail, ok)
	}
	accumulator.commit(cutoff)
	newTail, ok := accumulator.tail()
	if !ok || newTail != "second sentence" {
		t.Fatalf("new tail = %q, prefixOK = %t", newTail, ok)
	}
}

func TestGeminiTranscriptAccumulatorHandlesUnicodeCutoffs(t *testing.T) {
	var accumulator geminiTranscriptAccumulator
	first := strings.Repeat("ก", 600)
	accumulator.observe(first)
	cutoff := accumulator.historyCutoff()
	accumulator.observe("ถัดไป")
	accumulator.commit(cutoff)

	if tail, ok := accumulator.tail(); !ok || tail != "ถัดไป" {
		t.Fatalf("tail = %q, prefixOK = %t", tail, ok)
	}
}

func TestGeminiTranscriptAccumulatorReportsPrefixInvariantFailure(t *testing.T) {
	accumulator := geminiTranscriptAccumulator{
		history:       "current history",
		emittedPrefix: "unrelated prefix",
	}

	if tail, ok := accumulator.tail(); ok || tail != "current history" {
		t.Fatalf("tail = %q, prefixOK = %t, want full history and false", tail, ok)
	}
	accumulator.commit("current")
	if accumulator.emittedPrefix != "unrelated prefix" {
		t.Fatalf("invalid commit changed emitted prefix to %q", accumulator.emittedPrefix)
	}
}
