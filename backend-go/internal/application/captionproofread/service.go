// Package captionproofread owns the application policy around Caption Desk proofreading.
package captionproofread

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"thai-transcriber-backend/internal/domain"
)

const maxContextTextBytes = 2_000

var (
	ErrDisabled         = errors.New("caption proofreading is disabled")
	ErrInvalidTarget    = errors.New("proofread target is empty")
	ErrTargetTooLarge   = errors.New("proofread target is too large")
	ErrSuggestionEmpty  = errors.New("proofread suggestion is empty")
	ErrSuggestionTooBig = errors.New("proofread suggestion is too large")
	ErrSuggestionUnsafe = errors.New("proofread suggestion changes too much content")
)

type Service struct {
	provider domain.Proofreader
}

func New(provider domain.Proofreader) *Service {
	return &Service{provider: provider}
}

func (s *Service) Enabled() bool {
	return s != nil && s.provider != nil
}

func (s *Service) Proofread(ctx context.Context, request domain.ProofreadRequest) (domain.ProofreadResult, error) {
	if !s.Enabled() {
		return domain.ProofreadResult{}, ErrDisabled
	}
	if strings.TrimSpace(request.TargetText) == "" {
		return domain.ProofreadResult{}, ErrInvalidTarget
	}
	if len([]byte(request.TargetText)) > domain.MaxCaptionTextBytes {
		return domain.ProofreadResult{}, ErrTargetTooLarge
	}

	request.ContextText = truncateUTF8(request.ContextText, maxContextTextBytes)
	startedAt := time.Now()
	result, err := s.provider.Proofread(ctx, request)
	if err != nil {
		errorClass := "provider"
		if errors.Is(err, context.DeadlineExceeded) {
			errorClass = "timeout"
		} else if errors.Is(err, context.Canceled) {
			errorClass = "canceled"
		}
		logProofreadFailure(request.RequestID, startedAt, errorClass)
		return domain.ProofreadResult{}, err
	}
	if strings.TrimSpace(result.SuggestedText) == "" {
		logProofreadFailure(request.RequestID, startedAt, "empty_suggestion")
		return unchangedResult(request, result.Usage), nil
	}
	if len([]byte(result.SuggestedText)) > domain.MaxCaptionTextBytes {
		logProofreadFailure(request.RequestID, startedAt, "oversized_suggestion")
		return unchangedResult(request, result.Usage), nil
	}
	if !suggestionPreservesContent(request.TargetText, result.SuggestedText) {
		logProofreadFailure(request.RequestID, startedAt, "unsafe_suggestion")
		return unchangedResult(request, result.Usage), nil
	}
	result.RequestID = request.RequestID
	result.Revision = request.Revision
	result.Changed = result.SuggestedText != request.TargetText
	log.Printf(
		"[CaptionProofread] request_id=%q duration_ms=%d prompt_tokens=%d output_tokens=%d total_tokens=%d changed=%t",
		request.RequestID,
		time.Since(startedAt).Milliseconds(),
		result.Usage.PromptTokens,
		result.Usage.OutputTokens,
		result.Usage.TotalTokens,
		result.Changed,
	)
	return result, nil
}

func unchangedResult(request domain.ProofreadRequest, usage domain.ProofreadUsage) domain.ProofreadResult {
	return domain.ProofreadResult{
		RequestID:     request.RequestID,
		Revision:      request.Revision,
		SuggestedText: request.TargetText,
		Changed:       false,
		Usage:         usage,
	}
}

func logProofreadFailure(requestID string, startedAt time.Time, errorClass string) {
	log.Printf(
		"[CaptionProofread] request_id=%q duration_ms=%d error_class=%s",
		requestID,
		time.Since(startedAt).Milliseconds(),
		errorClass,
	)
}

func truncateUTF8(text string, limit int) string {
	data := []byte(text)
	if len(data) <= limit {
		return text
	}
	data = data[:limit]
	for len(data) > 0 && !utf8.Valid(data) {
		data = data[:len(data)-1]
	}
	return string(data)
}

func suggestionPreservesContent(target, suggestion string) bool {
	if target == suggestion {
		return true
	}
	targetRunes := contentRunes(target)
	suggestionRunes := contentRunes(suggestion)
	if len(targetRunes) == 0 || len(suggestionRunes)*100 < len(targetRunes)*80 {
		return false
	}
	if !sameNumberRuns(target, suggestion) {
		return false
	}
	if len(targetRunes) < 4 {
		return true
	}

	targetPairs := runePairCounts(targetRunes)
	suggestionPairs := runePairCounts(suggestionRunes)
	commonPairs := 0
	for pair, targetCount := range targetPairs {
		if suggestionCount := suggestionPairs[pair]; suggestionCount < targetCount {
			commonPairs += suggestionCount
		} else {
			commonPairs += targetCount
		}
	}
	totalPairs := len(targetRunes) + len(suggestionRunes) - 2
	return commonPairs*2*100 >= totalPairs*45
}

func sameNumberRuns(left, right string) bool {
	leftRuns := numberRuns(left)
	rightRuns := numberRuns(right)
	if len(leftRuns) != len(rightRuns) {
		return false
	}
	for index := range leftRuns {
		if leftRuns[index] != rightRuns[index] {
			return false
		}
	}
	return true
}

func numberRuns(text string) []string {
	var runs []string
	var current []rune
	for _, r := range text {
		if unicode.IsDigit(r) {
			current = append(current, r)
			continue
		}
		if len(current) > 0 {
			runs = append(runs, string(current))
			current = current[:0]
		}
	}
	if len(current) > 0 {
		runs = append(runs, string(current))
	}
	return runs
}

func contentRunes(text string) []rune {
	runes := make([]rune, 0, utf8.RuneCountInString(text))
	for _, r := range text {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsMark(r) {
			runes = append(runes, r)
		}
	}
	return runes
}

func runePairCounts(runes []rune) map[[2]rune]int {
	pairs := make(map[[2]rune]int, len(runes)-1)
	for index := 1; index < len(runes); index++ {
		pairs[[2]rune{runes[index-1], runes[index]}]++
	}
	return pairs
}
