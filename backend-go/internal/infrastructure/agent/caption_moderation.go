package agent

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"thai-transcriber-backend/internal/application/captionmoderation"
	"thai-transcriber-backend/internal/domain"
)

const defaultCaptionDraftInterval = 50 * time.Millisecond

type captionDraftDelivery struct {
	envelope captionOperatorEnvelope
	identity string
}

type captionOperatorMetadata struct {
	Role     string `json:"role"`
	Provider string `json:"provider"`
}

func (a *Agent) handleTranscriptMessage(message TranscriptMessage) {
	sequence := a.nextTranscriptSequence()
	if err := a.publishLiveTranscript(message, sequence); err != nil {
		log.Printf("❌ [Agent] Error publishing transcript: %v", err)
	}
	a.publishRawTranscript(message)

	if message.Role == domain.TranscriptRoleTranslation {
		return
	}

	source := captionmoderation.SourceSegment{
		ID:           a.moderationSegmentID(message, sequence),
		Provider:     message.Provider,
		Text:         message.Text,
		IsFinal:      message.IsFinal,
		Sequence:     sequence,
		LanguageCode: message.LanguageCode,
	}
	a.mu.Lock()
	operatorID := a.captionOperatorID
	reviewStarted := a.captionReviewStarted
	if operatorID == "" && !reviewStarted {
		a.moderator.ObserveCurrentDraft(source)
		a.mu.Unlock()
		return
	}
	a.mu.Unlock()
	if !a.moderator.Ingest(source) {
		return
	}

	if operatorID == "" {
		return
	}
	envelope := captionOperatorEnvelope{
		Type:     captionDraftType,
		Provider: message.Provider,
		Source:   captionSourceFromModeration(source),
	}
	if message.IsFinal {
		envelope.Type = captionPendingType
		envelope.Source = captionSourceFromModeration(source)
	}
	if err := a.publishCaptionOperator(envelope, message.IsFinal, operatorID); err != nil {
		log.Printf("⚠️ [Caption] Failed to deliver %s to operator: %v", envelope.Type, err)
	}
}

func (a *Agent) handleCaptionPacket(payload []byte, senderIdentity, senderMetadata string) {
	command, err := parseCaptionCommand(payload)
	if err != nil {
		return
	}
	if !a.isAuthorizedCaptionOperator(senderMetadata, command.Provider) {
		a.rejectCaptionCommand(senderIdentity, command.RequestID, command.Provider, "operator_unauthorized")
		return
	}
	if command.Provider != a.preferredProvider {
		a.rejectCaptionCommand(senderIdentity, command.RequestID, command.Provider, "provider_mismatch")
		return
	}

	switch command.Type {
	case captionSubscribeType:
		a.subscribeCaptionOperator(senderIdentity, command)
	case captionPublishType:
		a.publishCaptionCommand(senderIdentity, command)
	case captionReviewModeType:
		a.setCaptionReviewMode(senderIdentity, command)
	}
}

func (a *Agent) setCaptionReviewMode(identity string, command captionCommandEnvelope) {
	if a.captionOperator() != identity || command.UseInterim == nil {
		a.rejectCaptionCommand(identity, command.RequestID, command.Provider, "operator_not_primary")
		return
	}
	snapshot := a.moderator.SetUseInterim(*command.UseInterim)
	envelope := captionOperatorEnvelope{
		Type:      captionSnapshotType,
		RequestID: command.RequestID,
		Provider:  command.Provider,
		Draft:     captionSourceFromModeration(snapshot.Draft),
		Pending:   captionSourcesFromModeration(snapshot.Pending),
	}
	if err := a.publishCaptionOperator(envelope, true, identity); err != nil {
		log.Printf("⚠️ [Caption] Failed to confirm review mode: %v", err)
	}
}

func (a *Agent) subscribeCaptionOperator(identity string, command captionCommandEnvelope) {
	a.mu.Lock()
	if a.captionOperatorID != "" && a.captionOperatorID != identity {
		a.mu.Unlock()
		a.rejectCaptionCommand(identity, command.RequestID, command.Provider, "operator_already_active")
		return
	}
	isNewOperator := a.captionOperatorID == ""
	var snapshot captionmoderation.Snapshot
	if isNewOperator && !a.captionReviewStarted {
		snapshot = a.moderator.StartReviewWindow()
		a.captionReviewStarted = true
	} else {
		snapshot = a.moderator.Snapshot()
	}
	a.captionOperatorID = identity
	a.mu.Unlock()

	envelope := captionOperatorEnvelope{
		Type:      captionSnapshotType,
		RequestID: command.RequestID,
		Provider:  command.Provider,
		Draft:     captionSourceFromModeration(snapshot.Draft),
		Pending:   captionSourcesFromModeration(snapshot.Pending),
	}
	if err := a.publishCaptionOperator(envelope, true, identity); err != nil {
		log.Printf("⚠️ [Caption] Failed to send operator snapshot: %v", err)
	}
}

func (a *Agent) publishCaptionCommand(identity string, command captionCommandEnvelope) {
	if a.captionOperator() != identity {
		a.rejectCaptionCommand(identity, command.RequestID, command.Provider, "operator_not_primary")
		return
	}

	publication, replayed, err := a.moderator.Publish(captionmoderation.PublishCommand{
		RequestID:        command.RequestID,
		Provider:         command.Provider,
		SourceSegmentIDs: command.SourceSegmentIDs,
		Text:             command.Text,
		RemainingText:    command.RemainingText,
	})
	if err != nil {
		a.rejectCaptionCommand(identity, command.RequestID, command.Provider, moderationErrorCode(err))
		return
	}

	if !replayed {
		message := dataChannelTranscript{
			Type:          "transcript",
			Text:          publication.Text,
			IsFinal:       true,
			Provider:      publication.Provider,
			Timestamp:     publication.PublishedAt.UnixMilli(),
			Sequence:      a.nextTranscriptSequence(),
			Role:          domain.TranscriptRoleSource,
			PublicationID: publication.ID,
		}
		data, marshalErr := json.Marshal(message)
		if marshalErr != nil {
			a.rejectCaptionCommand(identity, command.RequestID, command.Provider, "publish_failed")
			return
		}
		if publishErr := a.publishDataPacket(data, CaptionPublicTopic, true, nil); publishErr != nil {
			a.moderator.Rollback(command.RequestID)
			a.rejectCaptionCommand(identity, command.RequestID, command.Provider, "publish_failed")
			return
		}
		if a.captionSink != nil {
			a.captionSink.PublishCaption(a.GetRoom(), publication.Text)
		}
	}

	ack := captionOperatorEnvelope{
		Type:             captionPublishedType,
		RequestID:        publication.RequestID,
		Provider:         publication.Provider,
		PublicationID:    publication.ID,
		SourceSegmentIDs: append([]string(nil), publication.SourceSegmentIDs...),
		Text:             publication.Text,
		PublishedAt:      publication.PublishedAt.UnixMilli(),
	}
	if err := a.publishCaptionOperator(ack, true, identity); err != nil {
		log.Printf("⚠️ [Caption] Failed to acknowledge publication: %v", err)
	}
}

func (a *Agent) rejectCaptionCommand(identity, requestID, provider, code string) {
	if strings.TrimSpace(identity) == "" {
		return
	}
	envelope := captionOperatorEnvelope{
		Type:      captionRejectedType,
		RequestID: requestID,
		Provider:  provider,
		Code:      code,
		Message:   captionRejectionMessage(code),
	}
	if err := a.publishCaptionOperator(envelope, true, identity); err != nil {
		log.Printf("⚠️ [Caption] Failed to send rejection: %v", err)
	}
}

func (a *Agent) publishCaptionOperator(
	envelope captionOperatorEnvelope,
	reliable bool,
	identity string,
) error {
	a.captionDeliveryMu.Lock()
	defer a.captionDeliveryMu.Unlock()
	if envelope.Type == captionDraftType && !reliable {
		return a.queueCaptionDraftLocked(envelope, identity)
	}
	if envelope.Type == captionPendingType {
		a.discardPendingCaptionDraftLocked()
	}
	return a.publishCaptionOperatorNow(envelope, reliable, identity)
}

func (a *Agent) queueCaptionDraftLocked(
	envelope captionOperatorEnvelope,
	identity string,
) error {
	now := time.Now()
	interval := a.captionDraftInterval
	if interval <= 0 {
		interval = defaultCaptionDraftInterval
	}
	if a.captionDraftLastSent.IsZero() || now.Sub(a.captionDraftLastSent) >= interval {
		a.captionDraftLastSent = now
		return a.publishCaptionOperatorNow(envelope, false, identity)
	}

	a.captionDraftPending = &captionDraftDelivery{envelope: envelope, identity: identity}
	if a.captionDraftTimer == nil {
		delay := interval - now.Sub(a.captionDraftLastSent)
		a.captionDraftTimer = time.AfterFunc(delay, a.flushCaptionDraft)
	}
	return nil
}

func (a *Agent) flushCaptionDraft() {
	a.captionDeliveryMu.Lock()
	defer a.captionDeliveryMu.Unlock()
	pending := a.captionDraftPending
	a.captionDraftPending = nil
	a.captionDraftTimer = nil
	if pending == nil {
		return
	}
	a.captionDraftLastSent = time.Now()
	if err := a.publishCaptionOperatorNow(pending.envelope, false, pending.identity); err != nil {
		log.Printf("⚠️ [Caption] Failed to deliver coalesced Draft: %v", err)
	}
}

func (a *Agent) discardPendingCaptionDraft() {
	a.captionDeliveryMu.Lock()
	defer a.captionDeliveryMu.Unlock()
	a.discardPendingCaptionDraftLocked()
}

func (a *Agent) discardPendingCaptionDraftLocked() {
	if a.captionDraftTimer != nil {
		a.captionDraftTimer.Stop()
		a.captionDraftTimer = nil
	}
	a.captionDraftPending = nil
}

func (a *Agent) publishCaptionOperatorNow(
	envelope captionOperatorEnvelope,
	reliable bool,
	identity string,
) error {
	payload, err := json.Marshal(envelope)
	if err != nil {
		return err
	}
	return a.publishDataPacket(payload, CaptionOperatorTopic, reliable, []string{identity})
}

func (a *Agent) publishLiveTranscript(message TranscriptMessage, sequence uint64) error {
	data, err := json.Marshal(newDataChannelTranscript(message, sequence))
	if err != nil {
		return err
	}
	return a.publishDataPacket(data, "", message.IsFinal, nil)
}

func (a *Agent) publishRawTranscript(message TranscriptMessage) {
	if a.transcriptSink != nil {
		a.transcriptSink.Publish(a.GetRoom(), message)
	}
}

func (a *Agent) captionOperator() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.captionOperatorID
}

func (a *Agent) clearCaptionOperator(identity string) {
	a.mu.Lock()
	cleared := false
	if a.captionOperatorID == identity {
		a.captionOperatorID = ""
		cleared = true
	}
	a.mu.Unlock()
	if cleared {
		a.discardPendingCaptionDraft()
	}
}

func (a *Agent) isAuthorizedCaptionOperator(metadata, provider string) bool {
	var parsed captionOperatorMetadata
	if err := json.Unmarshal([]byte(metadata), &parsed); err != nil {
		return false
	}
	return parsed.Role == "caption-operator" &&
		strings.EqualFold(strings.TrimSpace(parsed.Provider), provider)
}

func (a *Agent) moderationSegmentID(message TranscriptMessage, sequence uint64) string {
	if id := strings.TrimSpace(message.SegmentID); id != "" {
		return id
	}
	if id := strings.TrimSpace(message.TurnID); id != "" {
		return message.Provider + ":" + id
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if !message.IsFinal {
		if a.moderationDraftID == "" {
			a.moderationDraftID = fmt.Sprintf("%s:%d", message.Provider, sequence)
		}
		return a.moderationDraftID
	}
	if a.moderationDraftID != "" {
		id := a.moderationDraftID
		a.moderationDraftID = ""
		return id
	}
	return fmt.Sprintf("%s:%d", message.Provider, sequence)
}

func captionSourceFromModeration(source any) *captionSourceEnvelope {
	switch value := source.(type) {
	case captionmoderation.SourceSegment:
		return &captionSourceEnvelope{
			SegmentID:    value.ID,
			Text:         value.Text,
			Provider:     value.Provider,
			IsFinal:      value.IsFinal,
			Sequence:     value.Sequence,
			LanguageCode: value.LanguageCode,
		}
	case *captionmoderation.SourceSegment:
		if value == nil {
			return nil
		}
		return captionSourceFromModeration(*value)
	default:
		return nil
	}
}

func captionSourcesFromModeration(sources []captionmoderation.SourceSegment) []captionSourceEnvelope {
	if len(sources) == 0 {
		return nil
	}
	result := make([]captionSourceEnvelope, 0, len(sources))
	for _, source := range sources {
		result = append(result, *captionSourceFromModeration(source))
	}
	return result
}

func moderationErrorCode(err error) string {
	switch {
	case errors.Is(err, captionmoderation.ErrProviderMismatch):
		return "provider_mismatch"
	case errors.Is(err, captionmoderation.ErrSourceMismatch):
		return "source_mismatch"
	default:
		return "invalid_command"
	}
}

func captionRejectionMessage(code string) string {
	switch code {
	case "operator_already_active":
		return "Another operator is already editing this provider."
	case "operator_unauthorized", "operator_not_primary":
		return "This participant cannot publish captions."
	case "provider_mismatch", "source_mismatch":
		return "The pending caption changed. Refresh the review buffer and try again."
	case "publish_failed":
		return "The caption could not be published. Try again."
	default:
		return "The caption command is invalid."
	}
}
