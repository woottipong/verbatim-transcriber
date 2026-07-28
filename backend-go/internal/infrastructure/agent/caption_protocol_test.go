package agent

import (
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestParseCaptionSubscribeCommand(t *testing.T) {
	command, err := parseCaptionCommand([]byte(`{
		"type":"caption.subscribe",
		"requestId":"subscribe-1",
		"provider":"google"
	}`))
	if err != nil {
		t.Fatalf("parseCaptionCommand() error = %v", err)
	}
	if command.Type != captionSubscribeType || command.Provider != "google" {
		t.Fatalf("command = %#v", command)
	}
}

func TestParseCaptionPublishCommand(t *testing.T) {
	command, err := parseCaptionCommand([]byte(`{
		"type":"caption.publish",
		"requestId":"publish-1",
		"provider":"google",
		"sourceSegmentIds":["google-1","google-2"],
		"text":" ผู้ป่วยมีอาการเจ็บหน้าอก "
	}`))
	if err != nil {
		t.Fatalf("parseCaptionCommand() error = %v", err)
	}
	if got, want := command.Text, " ผู้ป่วยมีอาการเจ็บหน้าอก "; got != want {
		t.Fatalf("Text = %q, want %q", got, want)
	}
	if got, want := len(command.SourceSegmentIDs), 2; got != want {
		t.Fatalf("source IDs = %d, want %d", got, want)
	}
}

func TestParseCaptionPublishCommandWithRemainder(t *testing.T) {
	command, err := parseCaptionCommand([]byte(`{
		"type":"caption.publish",
		"requestId":"publish-1",
		"provider":"google",
		"sourceSegmentIds":["google-1","google-2"],
		"text":"ประโยคแรก",
		"remainingText":" ประโยคถัดไป "
	}`))
	if err != nil {
		t.Fatalf("parseCaptionCommand() error = %v", err)
	}
	if command.RemainingText != " ประโยคถัดไป " {
		t.Fatalf("RemainingText = %q", command.RemainingText)
	}
	if len(command.SourceSegmentIDs) != 2 {
		t.Fatalf("SourceSegmentIDs = %#v", command.SourceSegmentIDs)
	}
}

func TestParseCaptionReviewModeCommand(t *testing.T) {
	command, err := parseCaptionCommand([]byte(`{
		"type":"caption.review-mode",
		"requestId":"mode-1",
		"provider":"gemini",
		"useInterim":true
	}`))
	if err != nil {
		t.Fatalf("parseCaptionCommand() error = %v", err)
	}
	if command.UseInterim == nil || !*command.UseInterim {
		t.Fatalf("UseInterim = %#v", command.UseInterim)
	}
}

func TestParseCaptionCommandRejectsInvalidPayloads(t *testing.T) {
	tooManyIDs := make([]string, 501)
	for index := range tooManyIDs {
		tooManyIDs[index] = fmt.Sprintf(`"google-%d"`, index)
	}

	tests := []struct {
		name    string
		payload string
	}{
		{name: "malformed JSON", payload: `{`},
		{name: "trailing JSON", payload: `{"type":"caption.subscribe","requestId":"r","provider":"google"} {}`},
		{name: "unknown field", payload: `{"type":"caption.subscribe","requestId":"r","provider":"google","extra":true}`},
		{name: "unsupported type", payload: `{"type":"caption.delete","requestId":"r","provider":"google"}`},
		{name: "empty request ID", payload: `{"type":"caption.subscribe","requestId":" ","provider":"google"}`},
		{name: "unsupported provider", payload: `{"type":"caption.subscribe","requestId":"r","provider":"other"}`},
		{name: "review mode without value", payload: `{"type":"caption.review-mode","requestId":"r","provider":"google"}`},
		{name: "publish without source IDs", payload: `{"type":"caption.publish","requestId":"r","provider":"google","text":"ข้อความ"}`},
		{name: "publish with empty source ID", payload: `{"type":"caption.publish","requestId":"r","provider":"google","sourceSegmentIds":[" "],"text":"ข้อความ"}`},
		{name: "publish with duplicate source ID", payload: `{"type":"caption.publish","requestId":"r","provider":"google","sourceSegmentIds":["google-1","google-1"],"text":"ข้อความ"}`},
		{name: "publish with empty text", payload: `{"type":"caption.publish","requestId":"r","provider":"google","sourceSegmentIds":["google-1"],"text":" "}`},
		{name: "oversized text", payload: `{"type":"caption.publish","requestId":"r","provider":"google","sourceSegmentIds":["google-1"],"text":"` + strings.Repeat("a", maxCaptionCommandTextBytes+1) + `"}`},
		{name: "too many source IDs", payload: `{"type":"caption.publish","requestId":"r","provider":"google","sourceSegmentIds":[` + strings.Join(tooManyIDs, ",") + `],"text":"ข้อความ"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := parseCaptionCommand([]byte(tt.payload)); !errors.Is(err, errInvalidCaptionCommand) {
				t.Fatalf("parseCaptionCommand() error = %v, want errInvalidCaptionCommand", err)
			}
		})
	}
}

func TestCaptionTopicsRemainDistinct(t *testing.T) {
	topics := map[string]struct{}{
		CaptionOperatorTopic: {},
		CaptionCommandTopic:  {},
		CaptionPublicTopic:   {},
	}
	if len(topics) != 3 {
		t.Fatalf("caption topics are not distinct: %#v", topics)
	}
}
