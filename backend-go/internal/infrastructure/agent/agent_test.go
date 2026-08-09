package agent

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"thai-transcriber-backend/config"
	"thai-transcriber-backend/internal/application/captionmoderation"
	"thai-transcriber-backend/internal/domain"
)

type lifecycleProvider struct {
	startErr  error
	err       error
	stopCalls int
	results   chan domain.TranscriptResult
}

type publishedData struct {
	payload      []byte
	topic        string
	reliable     bool
	destinations []string
}

type collectingTranscriptSink struct {
	messages []TranscriptMessage
}

func (s *collectingTranscriptSink) Publish(_ string, message TranscriptMessage) {
	s.messages = append(s.messages, message)
}

// recordingCaptionSink captures what the agent hands to the external caption
// feed, so tests can assert one operator publish produces exactly one delivery.
type recordingCaptionSink struct {
	mu        sync.Mutex
	published []string
}

func (s *recordingCaptionSink) PublishCaption(_, text string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.published = append(s.published, text)
}

func (s *recordingCaptionSink) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.published)
}

func TestProviderTranscriptAlwaysUsesRawLane(t *testing.T) {
	sink := &collectingTranscriptSink{}
	var packets []publishedData
	agent := &Agent{
		moderator:         captionmoderation.New("google", time.Now),
		preferredProvider: "google",
		transcriptSink:    sink,
		dataPublisher: func(payload []byte, topic string, reliable bool, destinations []string) error {
			packets = append(packets, publishedData{
				payload: append([]byte(nil), payload...), topic: topic, reliable: reliable,
				destinations: append([]string(nil), destinations...),
			})
			return nil
		},
	}

	agent.handleTranscriptMessage(TranscriptMessage{
		Type: "transcript", Text: "ข้อความสด", IsFinal: true, Provider: "google",
		Role: domain.TranscriptRoleSource,
	})

	if len(packets) != 1 || packets[0].topic != "" || !packets[0].reliable || len(packets[0].destinations) != 0 {
		t.Fatalf("live packets = %#v", packets)
	}
	if len(sink.messages) != 1 || sink.messages[0].Text != "ข้อความสด" {
		t.Fatalf("raw sink messages = %#v", sink.messages)
	}
}

func TestActiveProviderTargetsDraftToOperatorAndKeepsRawLive(t *testing.T) {
	var packets []publishedData
	agent := newCaptionTestAgent("google", &packets)
	agent.captionOperatorID = "caption-operator-1"

	agent.handleTranscriptMessage(TranscriptMessage{
		Type: "transcript", Text: "ผู้ป่วย", Provider: "google",
		Role: domain.TranscriptRoleSource, SegmentID: "google-1",
	})

	if len(packets) != 2 {
		t.Fatalf("packets = %#v, want raw transcript and operator Draft", packets)
	}
	if packets[0].topic != "" || packets[1].topic != CaptionOperatorTopic || packets[1].reliable {
		t.Fatalf("packets = %#v", packets)
	}
	if got, want := packets[1].destinations, []string{"caption-operator-1"}; !equalStringSlices(got, want) {
		t.Fatalf("destinations = %v, want %v", got, want)
	}
}

func TestEarlyFinalPolicyPromotesStablePrefixOnlyInModerationLane(t *testing.T) {
	var packets []publishedData
	agent := newCaptionTestAgent("google", &packets)
	agent.captionOperatorID = "caption-operator-1"
	agent.captionReviewStarted = true
	agent.captionPolicy = captionmoderation.CaptionPolicyEarlyFinal
	agent.captionDraftInterval = time.Nanosecond
	agent.earlyFinalCutter = captionmoderation.NewEarlyFinalCutter(captionmoderation.EarlyFinalConfig{
		MinimumObservations: 3,
		MinimumSpan:         time.Nanosecond,
		MinimumChunkRunes:   10,
		SafetyTailRunes:     12,
		MaxObservations:     8,
	})

	texts := []string{
		"hello stable phrase mutable tail",
		"hello stable phrase mutable tail grows",
		"hello stable phrase mutable tail grows again",
	}
	for _, text := range texts {
		agent.handleTranscriptMessage(TranscriptMessage{
			Type: "transcript", Text: text, Provider: "google",
			Role: domain.TranscriptRoleSource, SegmentID: "google-1",
		})
	}

	var rawTexts []string
	var operatorEnvelopes []captionOperatorEnvelope
	for _, packet := range packets {
		if packet.topic == "" {
			var raw dataChannelTranscript
			if err := json.Unmarshal(packet.payload, &raw); err != nil {
				t.Fatal(err)
			}
			rawTexts = append(rawTexts, raw.Text)
			continue
		}
		if packet.topic == CaptionOperatorTopic {
			var envelope captionOperatorEnvelope
			if err := json.Unmarshal(packet.payload, &envelope); err != nil {
				t.Fatal(err)
			}
			operatorEnvelopes = append(operatorEnvelopes, envelope)
		}
	}
	if len(rawTexts) != 3 || rawTexts[2] != texts[2] {
		t.Fatalf("raw transcript changed = %#v", rawTexts)
	}
	var promoted *captionSourceEnvelope
	var tail *captionSourceEnvelope
	for _, envelope := range operatorEnvelopes {
		if envelope.Type == captionPendingType {
			promoted = envelope.Source
		}
		if envelope.Type == captionDraftType && envelope.Source != nil &&
			envelope.Source.Text == "grows again" {
			tail = envelope.Source
		}
	}
	if promoted == nil || promoted.Text != texts[0] ||
		promoted.SegmentID != "google-1:early:1" {
		t.Fatalf("early-final promotion = %#v", promoted)
	}
	if tail == nil || tail.Sequence <= promoted.Sequence || !tail.JoinWithoutSpace {
		t.Fatalf("tail continuation = %#v, want a newer joined continuation after %#v", tail, promoted)
	}
	snapshot := agent.moderator.Snapshot()
	if len(snapshot.Pending) != 1 || snapshot.Draft == nil ||
		snapshot.Draft.Text != "grows again" {
		t.Fatalf("moderation snapshot = %#v", snapshot)
	}
}

func TestEarlyFinalPromotesAfterIdleWithoutThirdRevision(t *testing.T) {
	operatorPackets := make(chan captionOperatorEnvelope, 8)
	rawPackets := make(chan struct{}, 8)
	agent := &Agent{
		preferredProvider:    "google",
		isRunning:            true,
		moderator:            captionmoderation.New("google", time.Now),
		captionOperatorID:    "caption-operator-1",
		captionReviewStarted: true,
		captionPolicy:        captionmoderation.CaptionPolicyEarlyFinal,
		earlyFinalCutter: captionmoderation.NewEarlyFinalCutter(captionmoderation.EarlyFinalConfig{
			MinimumObservations: 2,
			MinimumSpan:         200 * time.Millisecond,
			MinimumChunkRunes:   10,
			MaximumChunkRunes:   45,
			SafetyTailRunes:     12,
			MaxObservations:     8,
		}),
		dataPublisher: func(payload []byte, topic string, _ bool, _ []string) error {
			if topic == "" {
				rawPackets <- struct{}{}
				return nil
			}
			var envelope captionOperatorEnvelope
			if err := json.Unmarshal(payload, &envelope); err != nil {
				return err
			}
			operatorPackets <- envelope
			return nil
		},
	}

	agent.handleTranscriptMessage(TranscriptMessage{
		Type: "transcript", Text: "hello stable phrase mutable tail", Provider: "google",
		Role: domain.TranscriptRoleSource, SegmentID: "google-1",
	})
	time.Sleep(150 * time.Millisecond)
	agent.handleTranscriptMessage(TranscriptMessage{
		Type: "transcript", Text: "hello stable phrase mutable tail grows", Provider: "google",
		Role: domain.TranscriptRoleSource, SegmentID: "google-1",
	})

	deadline := time.After(120 * time.Millisecond)
	var promoted, tail *captionSourceEnvelope
	for {
		select {
		case envelope := <-operatorPackets:
			if envelope.Type == captionPendingType {
				promoted = envelope.Source
			}
			if envelope.Type == captionDraftType && envelope.Source != nil && envelope.Source.JoinWithoutSpace {
				tail = envelope.Source
			}
			if promoted != nil && tail != nil {
				if tail.Sequence <= promoted.Sequence {
					t.Fatalf("idle Draft sequence = %d, want newer than promoted sequence %d", tail.Sequence, promoted.Sequence)
				}
				if got := len(rawPackets); got != 2 {
					t.Fatalf("raw packet count = %d, want 2", got)
				}
				return
			}
		case <-deadline:
			t.Fatal("timed out waiting for idle early-final promotion")
		}
	}
}

func TestEarlyFinalProviderFinalStopsIdleRecheck(t *testing.T) {
	operatorPackets := make(chan captionOperatorEnvelope, 16)
	agent := &Agent{
		preferredProvider:    "google",
		isRunning:            true,
		moderator:            captionmoderation.New("google", time.Now),
		captionOperatorID:    "caption-operator-1",
		captionReviewStarted: true,
		captionPolicy:        captionmoderation.CaptionPolicyEarlyFinal,
		earlyFinalCutter: captionmoderation.NewEarlyFinalCutter(captionmoderation.EarlyFinalConfig{
			MinimumObservations: 2,
			MinimumSpan:         40 * time.Millisecond,
			MinimumChunkRunes:   10,
			MaximumChunkRunes:   45,
			SafetyTailRunes:     12,
			MaxObservations:     8,
		}),
		dataPublisher: func(payload []byte, topic string, _ bool, _ []string) error {
			if topic != CaptionOperatorTopic {
				return nil
			}
			var envelope captionOperatorEnvelope
			if err := json.Unmarshal(payload, &envelope); err != nil {
				return err
			}
			operatorPackets <- envelope
			return nil
		},
	}

	for _, text := range []string{
		"hello stable phrase mutable tail",
		"hello stable phrase mutable tail grows",
	} {
		agent.handleTranscriptMessage(TranscriptMessage{
			Type: "transcript", Text: text, Provider: "google",
			Role: domain.TranscriptRoleSource, SegmentID: "google-1",
		})
	}
	agent.handleTranscriptMessage(TranscriptMessage{
		Type: "transcript", Text: "hello stable phrase mutable tail grows final",
		IsFinal: true, Provider: "google", Role: domain.TranscriptRoleSource,
		SegmentID: "google-1",
	})

	time.Sleep(100 * time.Millisecond)
	var pendingCount int
	for {
		select {
		case envelope := <-operatorPackets:
			if envelope.Type == captionPendingType {
				pendingCount++
			}
		default:
			if pendingCount != 1 {
				t.Fatalf("pending packets = %d, want one provider final", pendingCount)
			}
			return
		}
	}
}

func TestEarlyFinalAgentStopCancelsIdleRecheck(t *testing.T) {
	operatorPackets := make(chan captionOperatorEnvelope, 16)
	agent := &Agent{
		preferredProvider:    "google",
		isRunning:            true,
		moderator:            captionmoderation.New("google", time.Now),
		captionOperatorID:    "caption-operator-1",
		captionReviewStarted: true,
		captionPolicy:        captionmoderation.CaptionPolicyEarlyFinal,
		earlyFinalCutter: captionmoderation.NewEarlyFinalCutter(captionmoderation.EarlyFinalConfig{
			MinimumObservations: 2,
			MinimumSpan:         40 * time.Millisecond,
			MinimumChunkRunes:   10,
			MaximumChunkRunes:   45,
			SafetyTailRunes:     12,
			MaxObservations:     8,
		}),
		dataPublisher: func(payload []byte, topic string, _ bool, _ []string) error {
			if topic != CaptionOperatorTopic {
				return nil
			}
			var envelope captionOperatorEnvelope
			if err := json.Unmarshal(payload, &envelope); err != nil {
				return err
			}
			operatorPackets <- envelope
			return nil
		},
	}

	for _, text := range []string{
		"hello stable phrase mutable tail",
		"hello stable phrase mutable tail grows",
	} {
		agent.handleTranscriptMessage(TranscriptMessage{
			Type: "transcript", Text: text, Provider: "google",
			Role: domain.TranscriptRoleSource, SegmentID: "google-1",
		})
	}
	agent.Stop()
	time.Sleep(100 * time.Millisecond)

	for {
		select {
		case envelope := <-operatorPackets:
			if envelope.Type == captionPendingType {
				t.Fatalf("idle promotion arrived after agent stop: %#v", envelope)
			}
		default:
			return
		}
	}
}

func TestEarlyFinalPolicyClearsRetractedDraftTail(t *testing.T) {
	var packets []publishedData
	agent := newCaptionTestAgent("google", &packets)
	agent.captionOperatorID = "caption-operator-1"
	agent.captionReviewStarted = true
	agent.captionPolicy = captionmoderation.CaptionPolicyEarlyFinal
	agent.captionDraftInterval = time.Nanosecond
	agent.earlyFinalCutter = captionmoderation.NewEarlyFinalCutter(captionmoderation.EarlyFinalConfig{
		MinimumObservations: 3,
		MinimumSpan:         time.Nanosecond,
		MinimumChunkRunes:   10,
		SafetyTailRunes:     12,
		MaxObservations:     8,
	})
	for _, text := range []string{
		"hello stable phrase mutable tail",
		"hello stable phrase mutable tail grows",
		"hello stable phrase mutable tail grows again",
	} {
		agent.handleTranscriptMessage(TranscriptMessage{
			Type: "transcript", Text: text, Provider: "google",
			Role: domain.TranscriptRoleSource, SegmentID: "google-1",
		})
	}
	packets = nil

	agent.handleTranscriptMessage(TranscriptMessage{
		Type: "transcript", Text: "hello stable phrase mutable tail",
		IsFinal: true, Provider: "google",
		Role: domain.TranscriptRoleSource, SegmentID: "google-1",
	})

	var cleared *captionOperatorEnvelope
	for _, packet := range packets {
		if packet.topic != CaptionOperatorTopic {
			continue
		}
		var envelope captionOperatorEnvelope
		if err := json.Unmarshal(packet.payload, &envelope); err != nil {
			t.Fatal(err)
		}
		if envelope.Type == captionDraftClearedType {
			cleared = &envelope
		}
	}
	if cleared == nil || cleared.Source == nil || cleared.Source.SegmentID != "google-1" {
		t.Fatalf("Draft clear packet = %#v", cleared)
	}
	snapshot := agent.moderator.Snapshot()
	if snapshot.Draft != nil || len(snapshot.Pending) != 1 {
		t.Fatalf("moderation snapshot after clear = %#v", snapshot)
	}
}

func TestCaptionDraftDeliveryCoalescesRevisionsAndSendsFinalImmediately(t *testing.T) {
	operatorPackets := make(chan captionOperatorEnvelope, 8)
	agent := &Agent{
		preferredProvider:    "google",
		moderator:            captionmoderation.New("google", time.Now),
		captionOperatorID:    "caption-operator-1",
		captionReviewStarted: true,
		dataPublisher: func(payload []byte, topic string, _ bool, _ []string) error {
			if topic != CaptionOperatorTopic {
				return nil
			}
			var envelope captionOperatorEnvelope
			if err := json.Unmarshal(payload, &envelope); err != nil {
				t.Fatalf("decode operator packet: %v", err)
			}
			operatorPackets <- envelope
			return nil
		},
	}

	agent.handleTranscriptMessage(TranscriptMessage{
		Type: "transcript", Text: "หนึ่ง", Provider: "google",
		Role: domain.TranscriptRoleSource, SegmentID: "google-1",
	})
	if got := receiveCaptionOperatorEnvelope(t, operatorPackets); got.Source == nil || got.Source.Text != "หนึ่ง" {
		t.Fatalf("first Draft = %#v", got)
	}

	agent.handleTranscriptMessage(TranscriptMessage{
		Type: "transcript", Text: "หนึ่ง สอง", Provider: "google",
		Role: domain.TranscriptRoleSource, SegmentID: "google-1",
	})
	agent.handleTranscriptMessage(TranscriptMessage{
		Type: "transcript", Text: "หนึ่ง สอง สาม", Provider: "google",
		Role: domain.TranscriptRoleSource, SegmentID: "google-1",
	})
	select {
	case unexpected := <-operatorPackets:
		t.Fatalf("rapid Draft was not coalesced: %#v", unexpected)
	case <-time.After(10 * time.Millisecond):
	}
	if got := receiveCaptionOperatorEnvelope(t, operatorPackets); got.Source == nil || got.Source.Text != "หนึ่ง สอง สาม" {
		t.Fatalf("coalesced Draft = %#v", got)
	}

	agent.handleTranscriptMessage(TranscriptMessage{
		Type: "transcript", Text: "หนึ่ง สอง สาม สี่", Provider: "google",
		Role: domain.TranscriptRoleSource, SegmentID: "google-1",
	})
	agent.handleTranscriptMessage(TranscriptMessage{
		Type: "transcript", Text: "ข้อความ final", IsFinal: true, Provider: "google",
		Role: domain.TranscriptRoleSource, SegmentID: "google-1",
	})
	if got := receiveCaptionOperatorEnvelope(t, operatorPackets); got.Type != captionPendingType ||
		got.Source == nil || got.Source.Text != "ข้อความ final" {
		t.Fatalf("immediate final = %#v", got)
	}
	select {
	case unexpected := <-operatorPackets:
		t.Fatalf("pending Draft was delivered after final: %#v", unexpected)
	case <-time.After(75 * time.Millisecond):
	}
}

func receiveCaptionOperatorEnvelope(
	t *testing.T,
	packets <-chan captionOperatorEnvelope,
) captionOperatorEnvelope {
	t.Helper()
	select {
	case packet := <-packets:
		return packet
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for caption operator packet")
		return captionOperatorEnvelope{}
	}
}

func TestCaptionFallbackKeepsDraftAndFinalOnSameSegment(t *testing.T) {
	agent := New(&config.Config{}, "azure")
	draftID := agent.moderationSegmentID(TranscriptMessage{
		Provider: "azure", Text: "กำลังถอด",
	}, 10)
	revisedID := agent.moderationSegmentID(TranscriptMessage{
		Provider: "azure", Text: "กำลังถอดข้อความ",
	}, 11)
	finalID := agent.moderationSegmentID(TranscriptMessage{
		Provider: "azure", Text: "ถอดเสร็จ", IsFinal: true,
	}, 12)
	nextDraftID := agent.moderationSegmentID(TranscriptMessage{
		Provider: "azure", Text: "ข้อความใหม่",
	}, 13)

	if draftID != revisedID || finalID != draftID {
		t.Fatalf("segment IDs = draft %q, revised %q, final %q", draftID, revisedID, finalID)
	}
	if nextDraftID == draftID {
		t.Fatalf("next draft reused completed segment ID %q", nextDraftID)
	}
}

func TestActiveProviderSendsRawFinalAndQueuesOperatorPending(t *testing.T) {
	var packets []publishedData
	agent := newCaptionTestAgent("google", &packets)
	agent.captionOperatorID = "caption-operator-1"

	agent.handleTranscriptMessage(TranscriptMessage{
		Type: "transcript", Text: "ผู้ป่วยมีอาการ", IsFinal: true, Provider: "google",
		Role: domain.TranscriptRoleSource, SegmentID: "google-1",
	})

	if len(packets) != 2 || packets[0].topic != "" ||
		packets[1].topic != CaptionOperatorTopic || !packets[1].reliable {
		t.Fatalf("packets = %#v, want raw final and reliable operator pending", packets)
	}
	if snapshot := agent.moderator.Snapshot(); len(snapshot.Pending) != 1 {
		t.Fatalf("moderator snapshot = %#v", snapshot)
	}
}

func TestCaptionPublishBroadcastsExactlyOnceAndAcknowledgesOperator(t *testing.T) {
	var packets []publishedData
	agent := newCaptionTestAgent("google", &packets)
	agent.captionOperatorID = "caption-operator-1"
	agent.handleTranscriptMessage(TranscriptMessage{
		Type: "transcript", Text: "ผู้ป่วยมีอาการ", IsFinal: true, Provider: "google",
		Role: domain.TranscriptRoleSource, SegmentID: "google-1",
	})
	packets = nil

	command := captionCommandEnvelope{
		Type: captionPublishType, RequestID: "publish-1", Provider: "google",
		SourceSegmentIDs: []string{"google-1"}, Text: "ผู้ป่วยมีอาการเจ็บหน้าอก",
	}
	agent.publishCaptionCommand("caption-operator-1", command)
	agent.publishCaptionCommand("caption-operator-1", command)

	var publicCount, ackCount int
	for _, packet := range packets {
		switch packet.topic {
		case CaptionPublicTopic:
			publicCount++
			if !packet.reliable || len(packet.destinations) != 0 {
				t.Fatalf("public packet = %#v", packet)
			}
		case CaptionOperatorTopic:
			ackCount++
		}
	}
	if publicCount != 1 || ackCount != 2 {
		t.Fatalf("public packets = %d, acknowledgements = %d, all = %#v", publicCount, ackCount, packets)
	}
}

func TestCaptionPublishRestoresPendingWhenPublicTransportFails(t *testing.T) {
	var packets []publishedData
	agent := newCaptionTestAgent("google", &packets)
	agent.captionOperatorID = "caption-operator-1"
	agent.handleTranscriptMessage(TranscriptMessage{
		Type: "transcript", Text: "ผู้ป่วยมีอาการ", IsFinal: true, Provider: "google",
		Role: domain.TranscriptRoleSource, SegmentID: "google-1",
	})
	agent.dataPublisher = func(payload []byte, topic string, reliable bool, destinations []string) error {
		packets = append(packets, publishedData{
			payload: append([]byte(nil), payload...), topic: topic, reliable: reliable,
			destinations: append([]string(nil), destinations...),
		})
		if topic == CaptionPublicTopic {
			return errors.New("data channel unavailable")
		}
		return nil
	}
	packets = nil

	agent.publishCaptionCommand("caption-operator-1", captionCommandEnvelope{
		Type: captionPublishType, RequestID: "publish-1", Provider: "google",
		SourceSegmentIDs: []string{"google-1"}, Text: "ผู้ป่วยมีอาการเจ็บหน้าอก",
	})

	if got := len(agent.moderator.Snapshot().Pending); got != 1 {
		t.Fatalf("pending count after failed publish = %d, want 1", got)
	}
	if len(packets) != 2 || packets[0].topic != CaptionPublicTopic || packets[1].topic != CaptionOperatorTopic {
		t.Fatalf("failed publish packets = %#v", packets)
	}
}

func TestCaptionPublishRejectsNonOperatorAndWrongProvider(t *testing.T) {
	var packets []publishedData
	agent := newCaptionTestAgent("google", &packets)
	agent.captionOperatorID = "caption-operator-1"

	agent.publishCaptionCommand("caption-operator-2", captionCommandEnvelope{
		Type: captionPublishType, RequestID: "publish-1", Provider: "google",
		SourceSegmentIDs: []string{"google-1"}, Text: "ข้อความ",
	})
	agent.handleCaptionPacket(
		[]byte(`{"type":"caption.subscribe","requestId":"subscribe-1","provider":"gemini"}`),
		"caption-operator-1",
		`{"role":"caption-operator","provider":"gemini"}`,
	)

	if len(packets) != 2 {
		t.Fatalf("rejection packets = %#v", packets)
	}
	for _, packet := range packets {
		if packet.topic != CaptionOperatorTopic || !packet.reliable {
			t.Fatalf("rejection packet = %#v", packet)
		}
	}
}

func TestCaptionOperatorDisconnectKeepsPendingState(t *testing.T) {
	var packets []publishedData
	agent := newCaptionTestAgent("google", &packets)
	agent.captionOperatorID = "caption-operator-1"
	agent.handleTranscriptMessage(TranscriptMessage{
		Type: "transcript", Text: "ข้อความรอตรวจ", IsFinal: true, Provider: "google",
		Role: domain.TranscriptRoleSource, SegmentID: "google-1",
	})

	agent.clearCaptionOperator("caption-operator-1")
	if got := agent.captionOperator(); got != "" {
		t.Fatalf("caption operator = %q, want empty", got)
	}
	if got := len(agent.moderator.Snapshot().Pending); got != 1 {
		t.Fatalf("pending count = %d, want 1", got)
	}
}

func TestCaptionDeskSessionReconnectsDuringGraceAndBlocksOtherSessions(t *testing.T) {
	var packets []publishedData
	agent := newCaptionTestAgent("google", &packets)
	agent.captionOperatorGrace = 20 * time.Millisecond
	agent.subscribeCaptionOperator("caption-operator-1", "desk-session-a", captionCommandEnvelope{
		Type: captionSubscribeType, RequestID: "subscribe-1", Provider: "google",
	})
	agent.handleTranscriptMessage(TranscriptMessage{
		Type: "transcript", Text: "ข้อความรอตรวจ", IsFinal: true, Provider: "google",
		Role: domain.TranscriptRoleSource, SegmentID: "google-1",
	})
	agent.clearCaptionOperator("caption-operator-1")

	agent.subscribeCaptionOperator("caption-operator-2", "desk-session-b", captionCommandEnvelope{
		Type: captionSubscribeType, RequestID: "subscribe-2", Provider: "google",
	})
	var blocked captionOperatorEnvelope
	if err := json.Unmarshal(packets[len(packets)-1].payload, &blocked); err != nil {
		t.Fatal(err)
	}
	if blocked.Code != "operator_already_active" {
		t.Fatalf("takeover during grace = %#v", blocked)
	}

	agent.subscribeCaptionOperator("caption-operator-3", "desk-session-a", captionCommandEnvelope{
		Type: captionSubscribeType, RequestID: "subscribe-3", Provider: "google",
	})
	if got := len(agent.moderator.Snapshot().Pending); got != 1 {
		t.Fatalf("same-session reconnect pending = %d, want 1", got)
	}
	time.Sleep(30 * time.Millisecond)
	if got := len(agent.moderator.Snapshot().Pending); got != 1 {
		t.Fatalf("reconnect grace timer cleared active session pending = %d", got)
	}
}

// The external caption WebSocket is a separate delivery leg from the LiveKit
// caption.public topic. A resend of the same RequestID (the Caption Desk
// replays waiting commands verbatim on reconnect) must not deliver twice.
func TestCaptionPublishDeliversToExternalFeedExactlyOncePerRequestID(t *testing.T) {
	sink := &recordingCaptionSink{}
	var packets []publishedData
	agent := newCaptionTestAgent("google", &packets)
	agent.captionSink = sink
	agent.captionOperatorID = "caption-operator-1"
	agent.handleTranscriptMessage(TranscriptMessage{
		Type: "transcript", Text: "ผู้ป่วยมีอาการ", IsFinal: true, Provider: "google",
		Role: domain.TranscriptRoleSource, SegmentID: "google-1",
	})

	command := captionCommandEnvelope{
		Type: captionPublishType, RequestID: "publish-1", Provider: "google",
		SourceSegmentIDs: []string{"google-1"}, Text: "ผู้ป่วยมีอาการเจ็บหน้าอก",
	}
	agent.publishCaptionCommand("caption-operator-1", command)
	agent.publishCaptionCommand("caption-operator-1", command)

	if got := sink.count(); got != 1 {
		t.Fatalf("external feed deliveries = %d, want 1 (got %v)", got, sink.published)
	}
}

func TestCaptionDeskReconnectCannotChangeFinalizationPolicy(t *testing.T) {
	var packets []publishedData
	agent := newCaptionTestAgent("google", &packets)
	command := captionCommandEnvelope{
		Type: captionSubscribeType, RequestID: "subscribe-1", Provider: "google",
	}
	agent.subscribeCaptionOperatorWithPolicy(
		"caption-operator-1",
		"desk-session-a",
		captionmoderation.CaptionPolicyEarlyFinal,
		command,
	)
	packets = nil
	command.RequestID = "subscribe-2"
	agent.subscribeCaptionOperatorWithPolicy(
		"caption-operator-2",
		"desk-session-a",
		captionmoderation.CaptionPolicyProviderFinal,
		command,
	)

	if agent.captionOperator() != "caption-operator-1" {
		t.Fatalf("operator changed after policy mismatch: %q", agent.captionOperator())
	}
	if len(packets) != 1 || packets[0].topic != CaptionOperatorTopic {
		t.Fatalf("policy mismatch packets = %#v", packets)
	}
	var rejection captionOperatorEnvelope
	if err := json.Unmarshal(packets[0].payload, &rejection); err != nil {
		t.Fatal(err)
	}
	if rejection.Type != captionRejectedType || rejection.Code != "operator_policy_mismatch" {
		t.Fatalf("policy mismatch rejection = %#v", rejection)
	}
}

func TestCaptionDeskSessionExpiryStartsNextOperatorWithoutBacklog(t *testing.T) {
	var packets []publishedData
	agent := newCaptionTestAgent("google", &packets)
	agent.captionOperatorGrace = 5 * time.Millisecond
	agent.subscribeCaptionOperator("caption-operator-1", "desk-session-a", captionCommandEnvelope{
		Type: captionSubscribeType, RequestID: "subscribe-1", Provider: "google",
	})
	agent.handleTranscriptMessage(TranscriptMessage{
		Type: "transcript", Text: "ข้อความเก่า", IsFinal: true, Provider: "google",
		Role: domain.TranscriptRoleSource, SegmentID: "google-1",
	})
	agent.clearCaptionOperator("caption-operator-1")
	time.Sleep(20 * time.Millisecond)

	agent.subscribeCaptionOperator("caption-operator-2", "desk-session-b", captionCommandEnvelope{
		Type: captionSubscribeType, RequestID: "subscribe-2", Provider: "google",
	})
	if snapshot := agent.moderator.Snapshot(); len(snapshot.Pending) != 0 {
		t.Fatalf("new session received expired backlog: %#v", snapshot.Pending)
	}
}

func TestNewCaptionOperatorReceivesActiveDraftWithoutPreJoinFinals(t *testing.T) {
	var packets []publishedData
	agent := newCaptionTestAgent("google", &packets)
	agent.handleTranscriptMessage(TranscriptMessage{
		Type: "transcript", Text: "ข้อความก่อนเข้าห้อง", IsFinal: true, Provider: "google",
		Role: domain.TranscriptRoleSource, SegmentID: "google-before",
	})
	agent.handleTranscriptMessage(TranscriptMessage{
		Type: "transcript", Text: "ข้อความที่กำลังพูด", Provider: "google",
		Role: domain.TranscriptRoleSource, SegmentID: "google-active",
	})

	agent.subscribeCaptionOperator("caption-operator-1", "desk-session-1", captionCommandEnvelope{
		Type: captionSubscribeType, RequestID: "subscribe-1", Provider: "google",
	})
	snapshot := agent.moderator.Snapshot()
	if snapshot.Draft == nil || snapshot.Draft.ID != "google-active" ||
		snapshot.Draft.Text != "ข้อความที่กำลังพูด" {
		t.Fatalf("new operator Draft = %#v, want active Draft at join", snapshot.Draft)
	}
	if len(snapshot.Pending) != 0 {
		t.Fatalf("new operator pending = %#v, want no pre-join finals", snapshot.Pending)
	}
	var delivered captionOperatorEnvelope
	if err := json.Unmarshal(packets[len(packets)-1].payload, &delivered); err != nil {
		t.Fatalf("decode join snapshot: %v", err)
	}
	if delivered.Type != captionSnapshotType || delivered.Draft == nil ||
		delivered.Draft.SegmentID != "google-active" ||
		delivered.Draft.Text != "ข้อความที่กำลังพูด" ||
		len(delivered.Pending) != 0 {
		t.Fatalf("delivered join snapshot = %#v, want active Draft without history", delivered)
	}

	agent.handleTranscriptMessage(TranscriptMessage{
		Type: "transcript", Text: "ข้อความหลังเข้าห้อง", IsFinal: true, Provider: "google",
		Role: domain.TranscriptRoleSource, SegmentID: "google-after",
	})
	agent.subscribeCaptionOperator("caption-operator-1", "desk-session-1", captionCommandEnvelope{
		Type: captionSubscribeType, RequestID: "subscribe-2", Provider: "google",
	})
	if got := len(agent.moderator.Snapshot().Pending); got != 1 {
		t.Fatalf("same operator reconnect pending count = %d, want 1", got)
	}
}

func TestNewCaptionOperatorDoesNotReceiveDraftFinalizedBeforeJoin(t *testing.T) {
	var packets []publishedData
	agent := newCaptionTestAgent("google", &packets)
	agent.handleTranscriptMessage(TranscriptMessage{
		Type: "transcript", Text: "ข้อความที่กำลังพูด", Provider: "google",
		Role: domain.TranscriptRoleSource, SegmentID: "google-before",
	})
	agent.handleTranscriptMessage(TranscriptMessage{
		Type: "transcript", Text: "ข้อความที่พูดจบแล้ว", IsFinal: true, Provider: "google",
		Role: domain.TranscriptRoleSource, SegmentID: "google-before",
	})

	agent.subscribeCaptionOperator("caption-operator-1", "desk-session-1", captionCommandEnvelope{
		Type: captionSubscribeType, RequestID: "subscribe-1", Provider: "google",
	})
	snapshot := agent.moderator.Snapshot()
	if snapshot.Draft != nil || len(snapshot.Pending) != 0 {
		t.Fatalf("new operator snapshot = %#v, want no finalized pre-join transcript", snapshot)
	}
}

func newCaptionTestAgent(provider string, packets *[]publishedData) *Agent {
	return &Agent{
		preferredProvider: provider,
		moderator:         captionmoderation.New(provider, time.Now),
		dataPublisher: func(payload []byte, topic string, reliable bool, destinations []string) error {
			*packets = append(*packets, publishedData{
				payload: append([]byte(nil), payload...), topic: topic, reliable: reliable,
				destinations: append([]string(nil), destinations...),
			})
			return nil
		},
	}
}

func equalStringSlices(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func (p *lifecycleProvider) Start(context.Context) error             { return p.startErr }
func (p *lifecycleProvider) SendAudio([]byte) error                  { return nil }
func (p *lifecycleProvider) Results() <-chan domain.TranscriptResult { return p.results }
func (p *lifecycleProvider) Stop() error {
	p.stopCalls++
	return nil
}
func (p *lifecycleProvider) Err() error      { return p.err }
func (p *lifecycleProvider) SampleRate() int { return 48000 }
func (p *lifecycleProvider) Name() string    { return "test" }

func TestStartProviderReturnsCleanupThatStopsProvider(t *testing.T) {
	provider := &lifecycleProvider{results: make(chan domain.TranscriptResult)}

	cleanup, err := startProvider(context.Background(), provider)
	if err != nil {
		t.Fatalf("startProvider() error = %v", err)
	}
	cleanup()

	if provider.stopCalls != 1 {
		t.Fatalf("Stop() calls = %d, want 1", provider.stopCalls)
	}
}

func TestAgentAllowsOnlyOneActiveAudioTrack(t *testing.T) {
	agent := &Agent{isRunning: true}

	if !agent.waitForAudioTrack(context.Background(), "track-1") {
		t.Fatal("first audio track was rejected")
	}

	acquired := make(chan bool, 1)
	go func() {
		acquired <- agent.waitForAudioTrack(context.Background(), "track-2")
	}()

	agent.releaseAudioTrack("track-1")
	select {
	case ok := <-acquired:
		if !ok {
			t.Fatal("replacement audio track was rejected after the first was released")
		}
	case <-time.After(time.Second):
		t.Fatal("replacement audio track did not take over")
	}
}

func TestAgentRejectsAudioTrackWhileProviderIsStillClosing(t *testing.T) {
	agent := &Agent{
		isRunning:   true,
		asrProvider: &lifecycleProvider{results: make(chan domain.TranscriptResult)},
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if agent.waitForAudioTrack(ctx, "track-2") {
		t.Fatal("audio track was accepted while the previous provider was still active")
	}
}

func TestAgentKeepsOnlyLatestPendingAudioTrack(t *testing.T) {
	agent := &Agent{isRunning: true}
	if !agent.waitForAudioTrack(context.Background(), "track-1") {
		t.Fatal("first audio track was rejected")
	}

	firstPending := make(chan bool, 1)
	secondPending := make(chan bool, 1)
	go func() {
		firstPending <- agent.waitForAudioTrack(context.Background(), "track-2")
	}()
	for {
		agent.mu.Lock()
		pending := agent.pendingTrackID
		agent.mu.Unlock()
		if pending == "track-2" {
			break
		}
	}
	go func() {
		secondPending <- agent.waitForAudioTrack(context.Background(), "track-3")
	}()
	for {
		agent.mu.Lock()
		pending := agent.pendingTrackID
		agent.mu.Unlock()
		if pending == "track-3" {
			break
		}
	}

	agent.releaseAudioTrack("track-1")
	if <-firstPending {
		t.Fatal("superseded replacement track was accepted")
	}
	if !<-secondPending {
		t.Fatal("latest replacement track was rejected")
	}
}

func TestStartProviderCleansUpAfterStartFailure(t *testing.T) {
	provider := &lifecycleProvider{
		startErr: errors.New("start failed"),
		results:  make(chan domain.TranscriptResult),
	}

	if _, err := startProvider(context.Background(), provider); err == nil {
		t.Fatal("startProvider() error = nil, want start failure")
	}
	if provider.stopCalls != 1 {
		t.Fatalf("Stop() calls = %d, want 1", provider.stopCalls)
	}
}

func TestHandleTranscriptionResultsStopsRunningAgentWhenProviderFails(t *testing.T) {
	results := make(chan domain.TranscriptResult)
	close(results)
	provider := &lifecycleProvider{
		err:     errors.New("realtime connection lost"),
		results: results,
	}
	cancelled := make(chan struct{})
	agent := &Agent{
		isRunning:   true,
		asrProvider: provider,
		cancel:      func() { close(cancelled) },
	}

	agent.handleTranscriptionResults(provider, "speaker-1")

	if agent.IsRunning() {
		t.Fatal("agent remained running after provider results closed with an error")
	}
	select {
	case <-cancelled:
	default:
		t.Fatal("agent context was not cancelled after provider failure")
	}
	if provider.stopCalls != 1 {
		t.Fatalf("provider Stop() calls = %d, want 1", provider.stopCalls)
	}
}

func TestHandleTranscriptionResultsKeepsAgentInRoomAfterTrackProviderStopsNormally(t *testing.T) {
	results := make(chan domain.TranscriptResult)
	close(results)
	provider := &lifecycleProvider{results: results}
	cancelled := false
	agent := &Agent{
		isRunning:   true,
		asrProvider: provider,
		cancel:      func() { cancelled = true },
	}

	agent.handleTranscriptionResults(provider, "speaker-1")

	if !agent.IsRunning() {
		t.Fatal("agent left the room after a track-scoped provider stopped normally")
	}
	if cancelled {
		t.Fatal("agent context was cancelled after a track-scoped provider stopped normally")
	}
	if agent.asrProvider != nil {
		t.Fatal("finished track provider remained attached to the room agent")
	}
}

func TestHandleTranscriptionResultsDoesNotReleaseReplacementProvider(t *testing.T) {
	staleResults := make(chan domain.TranscriptResult)
	close(staleResults)
	staleProvider := &lifecycleProvider{results: staleResults}
	replacementProvider := &lifecycleProvider{results: make(chan domain.TranscriptResult)}
	cancelled := false
	agent := &Agent{
		isRunning:   true,
		asrProvider: replacementProvider,
		cancel:      func() { cancelled = true },
	}

	agent.handleTranscriptionResults(staleProvider, "speaker-1")

	if !agent.IsRunning() {
		t.Fatal("agent stopped after a replaced track provider closed")
	}
	if cancelled {
		t.Fatal("agent context was cancelled after a replaced track provider closed")
	}
	if agent.asrProvider != replacementProvider {
		t.Fatal("replacement provider was released when the stale provider closed")
	}
}

func TestHandleTranscriptionResultsIgnoresFailureFromReplacedProvider(t *testing.T) {
	staleResults := make(chan domain.TranscriptResult)
	close(staleResults)
	staleProvider := &lifecycleProvider{
		err:     errors.New("stale provider failed"),
		results: staleResults,
	}
	replacementProvider := &lifecycleProvider{results: make(chan domain.TranscriptResult)}
	cancelled := false
	agent := &Agent{
		isRunning:   true,
		asrProvider: replacementProvider,
		cancel:      func() { cancelled = true },
	}

	agent.handleTranscriptionResults(staleProvider, "speaker-1")

	if !agent.IsRunning() {
		t.Fatal("agent stopped after a replaced provider reported an error")
	}
	if cancelled {
		t.Fatal("agent context was cancelled after a replaced provider reported an error")
	}
	if agent.asrProvider != replacementProvider {
		t.Fatal("replacement provider changed after stale provider failure")
	}
}

func TestNewTranscriptMessageNormalizesThaiSpacing(t *testing.T) {
	message := newTranscriptMessage(
		domain.TranscriptResult{
			Text:         "ทด สอบ ถอด ความ 1 2 3 4",
			IsFinal:      true,
			LanguageCode: "th-TH",
		},
		"google",
		"speaker-1",
	)

	if got, want := message.Text, "ทดสอบถอดความ 1 2 3 4"; got != want {
		t.Fatalf("message text = %q, want %q", got, want)
	}
}

func TestNewInterimTranscriptMessageKeepsNormalizedThaiText(t *testing.T) {
	message := newTranscriptMessage(
		domain.TranscriptResult{
			Text:         "กำ ลัง ทด สอบ",
			IsFinal:      false,
			LanguageCode: "th",
		},
		"google",
		"speaker-1",
	)

	if message.IsFinal {
		t.Fatal("interim message was marked final")
	}
	if got, want := message.Text, "กำลังทดสอบ"; got != want {
		t.Fatalf("interim message text = %q, want %q", got, want)
	}
}

func TestNewFinalTranscriptMessagePreservesThaiAndEnglishPhraseBoundaries(t *testing.T) {
	const transcript = "ค่ะ ครับ สระภาษาอังกฤษคือ a e i o u นั่นเองนะคะ"
	message := newTranscriptMessage(
		domain.TranscriptResult{Text: transcript, IsFinal: true},
		"gpt-realtime-whisper",
		"speaker-1",
	)

	if got := message.Text; got != transcript {
		t.Fatalf("message text = %q, want %q", got, transcript)
	}
}

func TestNewTranscriptMessagePreservesTranslationMetadata(t *testing.T) {
	message := newTranscriptMessage(
		domain.TranscriptResult{
			Text:         "ห้อง ฉุกเฉิน",
			Role:         domain.TranscriptRoleTranslation,
			LanguageCode: "th",
			TurnID:       "gemini-1",
		},
		"gemini",
		"speaker-1",
	)

	if message.Role != domain.TranscriptRoleTranslation || message.LanguageCode != "th" || message.TurnID != "gemini-1" {
		t.Fatalf("translation metadata = role:%q language:%q turn:%q", message.Role, message.LanguageCode, message.TurnID)
	}
	if got, want := message.Text, "ห้อง ฉุกเฉิน"; got != want {
		t.Fatalf("message text = %q, want %q", got, want)
	}
}

func TestDataChannelTranscriptOmitsInternalSpeakerAndConfidence(t *testing.T) {
	message := TranscriptMessage{
		Type:         "transcript",
		Text:         "ผู้ป่วยมีอาการเจ็บหน้าอก",
		IsFinal:      true,
		Confidence:   0.98,
		Provider:     "google",
		Timestamp:    1234,
		Speaker:      "audio-source-1",
		Role:         domain.TranscriptRoleSource,
		LanguageCode: "th",
		SegmentID:    "google-7",
	}

	data, err := json.Marshal(newDataChannelTranscript(message, 7))
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if _, ok := payload["speaker"]; ok {
		t.Fatal("data-channel payload contains internal speaker")
	}
	if _, ok := payload["confidence"]; ok {
		t.Fatal("data-channel payload contains internal confidence")
	}
	if got, want := payload["provider"], "google"; got != want {
		t.Fatalf("provider = %v, want %q", got, want)
	}
	if got, want := payload["sequence"], float64(7); got != want {
		t.Fatalf("sequence = %v, want %v", got, want)
	}
	if got, want := payload["segmentId"], "google-7"; got != want {
		t.Fatalf("segmentId = %v, want %q", got, want)
	}
}

func TestAudioBatchTargetBytesUsesLowLatencyWindow(t *testing.T) {
	if got, want := audioBatchTargetBytes(48000, 40*time.Millisecond), 3840; got != want {
		t.Fatalf("audioBatchTargetBytes() = %d, want %d", got, want)
	}
	if got, want := audioBatchTargetBytes(16000, 40*time.Millisecond), 1280; got != want {
		t.Fatalf("audioBatchTargetBytes() = %d, want %d", got, want)
	}
}

func TestResamplePCM16SupportsProviderRates(t *testing.T) {
	samples := make([]int16, 480)
	if got, want := len(resamplePCM16(samples, 48000, 24000)), 240*2; got != want {
		t.Fatalf("48 kHz to 24 kHz bytes = %d, want %d", got, want)
	}
	if got, want := len(resamplePCM16(samples, 48000, 16000)), 160*2; got != want {
		t.Fatalf("48 kHz to 16 kHz bytes = %d, want %d", got, want)
	}
	if got, want := len(resamplePCM16(samples, 48000, 48000)), 480*2; got != want {
		t.Fatalf("48 kHz passthrough bytes = %d, want %d", got, want)
	}
}

func TestResamplePCM16FiltersFrequenciesAboveTargetNyquist(t *testing.T) {
	samples := make([]int16, 480)
	for i := range samples {
		if i%2 == 0 {
			samples[i] = 12000
		} else {
			samples[i] = -12000
		}
	}

	resampled := resamplePCM16(samples, 48000, 24000)
	for offset := 0; offset+1 < len(resampled); offset += 2 {
		if sample := int16(binary.LittleEndian.Uint16(resampled[offset:])); sample != 0 {
			t.Fatalf("aliased output sample = %d, want 0 after low-pass averaging", sample)
		}
	}
}

func TestFormatTranscriptLog(t *testing.T) {
	longText := strings.Repeat("a", 170)
	tests := []struct {
		name    string
		message TranscriptMessage
		want    string
	}{
		{
			name: "interim logs metadata and text",
			message: TranscriptMessage{
				Text: "growing interim text", Provider: "gemini", Speaker: "audio-source-test-1",
				Role: domain.TranscriptRoleSource, LanguageCode: "th", TurnID: "gemini-12",
			},
			want: "🟡 [Transcript] state=interim provider=gemini role=source turn=gemini-12 lang=th speaker=audio-source-test-1 chars=20 text=\"growing interim text\"",
		},
		{
			name: "final logs paired translation metadata and text",
			message: TranscriptMessage{
				Text: "hello", IsFinal: true, Provider: "gemini", Speaker: "audio-source-test-1",
				Role: domain.TranscriptRoleTranslation, LanguageCode: "en", TurnID: "gemini-12",
			},
			want: "🟢 [Transcript] state=final provider=gemini role=translation turn=gemini-12 lang=en speaker=audio-source-test-1 chars=5 text=\"hello\"",
		},
		{
			name: "missing optional metadata uses visible placeholders",
			message: TranscriptMessage{
				Text: "done", IsFinal: true, Provider: "google", Speaker: "audio-source-test-2",
				Role: domain.TranscriptRoleSource,
			},
			want: "🟢 [Transcript] state=final provider=google role=source turn=- lang=- speaker=audio-source-test-2 chars=4 text=\"done\"",
		},
		{
			name: "long final text is truncated",
			message: TranscriptMessage{
				Text: longText, IsFinal: true, Provider: "gemini", Speaker: "audio-source-test-1",
				Role: domain.TranscriptRoleSource, LanguageCode: "en", TurnID: "gemini-13",
			},
			want: "🟢 [Transcript] state=final provider=gemini role=source turn=gemini-13 lang=en speaker=audio-source-test-1 chars=170 text=\"" + strings.Repeat("a", 160) + "…\"",
		},
		{
			name: "metadata control characters stay on one log line",
			message: TranscriptMessage{
				Text: "done", IsFinal: true, Provider: "gemini\nforged=true", Speaker: "audio-source-test-1\tadmin=true",
				Role: domain.TranscriptRoleSource, LanguageCode: "th\rEN", TurnID: "gemini-1\nstate=final",
			},
			want: "🟢 [Transcript] state=final provider=gemini\\nforged=true role=source turn=gemini-1\\nstate=final lang=th\\rEN speaker=audio-source-test-1\\tadmin=true chars=4 text=\"done\"",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := formatTranscriptLog(tt.message); got != tt.want {
				t.Fatalf("formatTranscriptLog() = %q, want %q", got, tt.want)
			}
		})
	}
}
