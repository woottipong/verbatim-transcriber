package captionproofread

import (
	"bytes"
	"context"
	"errors"
	"log"
	"strings"
	"testing"
	"unicode/utf8"

	"thai-transcriber-backend/internal/domain"
)

type fakeProofreader struct {
	called  bool
	request domain.ProofreadRequest
	result  domain.ProofreadResult
	err     error
}

func (f *fakeProofreader) Proofread(_ context.Context, request domain.ProofreadRequest) (domain.ProofreadResult, error) {
	f.called = true
	f.request = request
	if f.err != nil {
		return domain.ProofreadResult{}, f.err
	}
	return f.result, nil
}

func TestServiceDisabledWithoutProvider(t *testing.T) {
	service := New(nil)
	if service.Enabled() {
		t.Fatal("Enabled() = true without provider")
	}
	_, err := service.Proofread(context.Background(), domain.ProofreadRequest{TargetText: "ข้อความ"})
	if !errors.Is(err, ErrDisabled) {
		t.Fatalf("error = %v, want ErrDisabled", err)
	}
}

func TestServiceRejectsOversizedTargetBeforeProvider(t *testing.T) {
	provider := &fakeProofreader{}
	service := New(provider)
	_, err := service.Proofread(context.Background(), domain.ProofreadRequest{
		TargetText: strings.Repeat("ก", domain.MaxCaptionTextBytes),
	})
	if !errors.Is(err, ErrTargetTooLarge) {
		t.Fatalf("error = %v, want ErrTargetTooLarge", err)
	}
	if provider.called {
		t.Fatal("provider was called for oversized target")
	}
}

func TestServiceTruncatesContextWithoutBreakingUTF8(t *testing.T) {
	provider := &fakeProofreader{result: domain.ProofreadResult{SuggestedText: "เดิม"}}
	service := New(provider)
	contextText := strings.Repeat("ก", maxContextTextBytes)
	result, err := service.Proofread(context.Background(), domain.ProofreadRequest{
		RequestID:   "r1",
		Revision:    4,
		TargetText:  "เดิม",
		ContextText: contextText,
	})
	if err != nil {
		t.Fatalf("Proofread() error = %v", err)
	}
	if len([]byte(provider.request.ContextText)) > maxContextTextBytes {
		t.Fatalf("context bytes = %d, want <= %d", len([]byte(provider.request.ContextText)), maxContextTextBytes)
	}
	if !utf8.ValidString(provider.request.ContextText) {
		t.Fatalf("context is not valid UTF-8: %q", provider.request.ContextText[len(provider.request.ContextText)-4:])
	}
	if !strings.HasPrefix(provider.request.ContextText, "ก") {
		t.Fatal("context was not preserved")
	}
	if result.Changed {
		t.Fatal("Changed = true for identical suggestion")
	}
}

func TestServiceFallsBackWhenSuggestionDropsCaptionContent(t *testing.T) {
	target := "ประชุมวันที่ 15 สิงหาคม เวลา 10.30 นาฬิกา"
	service := New(&fakeProofreader{result: domain.ProofreadResult{
		SuggestedText: "ประชุมเวลา 10.30 นาฬิกา",
	}})

	result, err := service.Proofread(context.Background(), domain.ProofreadRequest{TargetText: target})
	if err != nil || result.SuggestedText != target || result.Changed {
		t.Fatalf("result = %#v, error = %v, want unchanged original", result, err)
	}
}

func TestServiceFallsBackToOriginalWhenSuggestionChangesRepeatedSpeech(t *testing.T) {
	target := "ครับครับผมคิดว่าคือมันน่าจะน่าจะใช้งานได้แล้วนะ"
	service := New(&fakeProofreader{result: domain.ProofreadResult{
		SuggestedText: "ครับ ผมคิดว่าน่าจะใช้งานได้แล้วนะ",
	}})

	result, err := service.Proofread(context.Background(), domain.ProofreadRequest{
		RequestID:  "repeated-speech",
		Revision:   7,
		TargetText: target,
	})
	if err != nil {
		t.Fatalf("Proofread() error = %v", err)
	}
	if result.SuggestedText != target || result.Changed {
		t.Fatalf("result = %#v, want unchanged original", result)
	}
	if result.RequestID != "repeated-speech" || result.Revision != 7 {
		t.Fatalf("result identity = %#v", result)
	}
}

func TestServiceFallsBackWhenSuggestionRewritesCaptionAtSimilarLength(t *testing.T) {
	target := "วันนี้ประชุมทีมเพื่อสรุปแผนงานประจำเดือน"
	service := New(&fakeProofreader{result: domain.ProofreadResult{
		SuggestedText: "พรุ่งนี้ยกเลิกกิจกรรมและเดินทางกลับบ้านทันที",
	}})

	result, err := service.Proofread(context.Background(), domain.ProofreadRequest{TargetText: target})
	if err != nil || result.SuggestedText != target || result.Changed {
		t.Fatalf("result = %#v, error = %v, want unchanged original", result, err)
	}
}

func TestServiceFallsBackWhenSuggestionChangesNumbers(t *testing.T) {
	target := "ประชุมวันที่ 15 สิงหาคม เวลา 10.30 นาฬิกา"
	service := New(&fakeProofreader{result: domain.ProofreadResult{
		SuggestedText: "ประชุมวันที่ 16 สิงหาคม เวลา 10.30 นาฬิกา",
	}})

	result, err := service.Proofread(context.Background(), domain.ProofreadRequest{TargetText: target})
	if err != nil || result.SuggestedText != target || result.Changed {
		t.Fatalf("result = %#v, error = %v, want unchanged original", result, err)
	}
}

func TestServiceAcceptsLocalProofreadingCorrection(t *testing.T) {
	target := "ทางบริษัทอนุญาติให้เข้าร่วมประชุมเวลา 10.30 น."
	service := New(&fakeProofreader{result: domain.ProofreadResult{
		SuggestedText: "ทางบริษัทอนุญาตให้เข้าร่วมประชุม เวลา 10.30 น.",
	}})

	result, err := service.Proofread(context.Background(), domain.ProofreadRequest{TargetText: target})
	if err != nil {
		t.Fatalf("Proofread() error = %v", err)
	}
	if !result.Changed {
		t.Fatal("Changed = false for a safe correction")
	}
}

func TestServiceLogsSafeUsageWithoutCaptionText(t *testing.T) {
	var output bytes.Buffer
	previousWriter := log.Writer()
	previousFlags := log.Flags()
	log.SetOutput(&output)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(previousWriter)
		log.SetFlags(previousFlags)
	})

	service := New(&fakeProofreader{result: domain.ProofreadResult{
		SuggestedText: "ข้อความที่แก้แล้ว",
		Usage: domain.ProofreadUsage{
			PromptTokens: 12,
			OutputTokens: 4,
			TotalTokens:  16,
		},
	}})
	_, err := service.Proofread(context.Background(), domain.ProofreadRequest{
		RequestID:  "request-7",
		TargetText: "ข้อความที่ผิด",
	})
	if err != nil {
		t.Fatalf("Proofread() error = %v", err)
	}

	got := output.String()
	for _, want := range []string{"request_id=\"request-7\"", "prompt_tokens=12", "output_tokens=4", "total_tokens=16", "duration_ms="} {
		if !strings.Contains(got, want) {
			t.Fatalf("log = %q, want %q", got, want)
		}
	}
	for _, forbidden := range []string{"ข้อความที่ผิด", "ข้อความที่แก้แล้ว"} {
		if strings.Contains(got, forbidden) {
			t.Fatalf("log leaked caption text: %q", got)
		}
	}
}

func TestServiceLogsProviderErrorClassWithoutRawError(t *testing.T) {
	var output bytes.Buffer
	previousWriter := log.Writer()
	previousFlags := log.Flags()
	log.SetOutput(&output)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(previousWriter)
		log.SetFlags(previousFlags)
	})

	service := New(&fakeProofreader{err: errors.New("upstream contained sensitive detail")})
	_, err := service.Proofread(context.Background(), domain.ProofreadRequest{
		RequestID:  "request-error",
		TargetText: "ข้อความลับ",
	})
	if err == nil {
		t.Fatal("Proofread() error = nil")
	}
	got := output.String()
	if !strings.Contains(got, "error_class=provider") || !strings.Contains(got, "request_id=\"request-error\"") {
		t.Fatalf("log = %q", got)
	}
	for _, forbidden := range []string{"ข้อความลับ", "sensitive detail"} {
		if strings.Contains(got, forbidden) {
			t.Fatalf("log leaked sensitive detail: %q", got)
		}
	}
}

func TestServiceClassifiesProviderTimeout(t *testing.T) {
	var output bytes.Buffer
	previousWriter := log.Writer()
	log.SetOutput(&output)
	t.Cleanup(func() { log.SetOutput(previousWriter) })

	service := New(&fakeProofreader{err: context.DeadlineExceeded})
	_, err := service.Proofread(context.Background(), domain.ProofreadRequest{
		RequestID: "request-timeout", TargetText: "ข้อความ",
	})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("error = %v, want context deadline exceeded", err)
	}
	if !strings.Contains(output.String(), "error_class=timeout") {
		t.Fatalf("log = %q", output.String())
	}
}

func TestServiceLogsUnsafeSuggestionClassWithoutCaptionText(t *testing.T) {
	var output bytes.Buffer
	previousWriter := log.Writer()
	previousFlags := log.Flags()
	log.SetOutput(&output)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(previousWriter)
		log.SetFlags(previousFlags)
	})

	target := "ประชุมวันที่ 15 สิงหาคม เวลา 10.30 นาฬิกา"
	service := New(&fakeProofreader{result: domain.ProofreadResult{
		SuggestedText: "ยกเลิกกิจกรรมทั้งหมดและเดินทางกลับบ้าน",
	}})
	result, err := service.Proofread(context.Background(), domain.ProofreadRequest{
		RequestID:  "request-unsafe",
		TargetText: target,
	})
	if err != nil || result.SuggestedText != target || result.Changed {
		t.Fatalf("result = %#v, error = %v, want unchanged original", result, err)
	}
	got := output.String()
	if !strings.Contains(got, "error_class=unsafe_suggestion") {
		t.Fatalf("log = %q", got)
	}
	if strings.Contains(got, target) || strings.Contains(got, "ยกเลิกกิจกรรม") {
		t.Fatalf("log leaked caption text: %q", got)
	}
}

func TestServiceFallsBackForEmptyAndOversizedSuggestions(t *testing.T) {
	tests := []struct {
		name   string
		result string
	}{
		{name: "empty", result: ""},
		{name: "whitespace", result: "  \n"},
		{name: "oversized", result: strings.Repeat("ก", domain.MaxCaptionTextBytes)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			service := New(&fakeProofreader{result: domain.ProofreadResult{SuggestedText: tt.result}})
			result, err := service.Proofread(context.Background(), domain.ProofreadRequest{TargetText: "เดิม"})
			if err != nil || result.SuggestedText != "เดิม" || result.Changed {
				t.Fatalf("result = %#v, error = %v, want unchanged original", result, err)
			}
		})
	}
}
