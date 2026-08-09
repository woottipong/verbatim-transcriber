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
const defaultCaptionOperatorGrace = 10 * time.Second

type captionDraftDelivery struct {
	envelope captionOperatorEnvelope
	identity string
}

type captionOperatorMetadata struct {
	Role          string `json:"role"`
	Provider      string `json:"provider"`
	SessionID     string `json:"sessionId"`
	CaptionPolicy string `json:"captionPolicy"`
}

type captionOperatorCredentials struct {
	sessionID string
	policy    captionmoderation.CaptionPolicy
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
	policy := a.captionPolicy
	cutter := a.earlyFinalCutter
	if operatorID == "" && !reviewStarted {
		a.moderator.ObserveCurrentDraft(source)
		a.mu.Unlock()
		return
	}
	a.mu.Unlock()

	if policy == captionmoderation.CaptionPolicyEarlyFinal && cutter != nil {
		a.captionModerationMu.Lock()
		defer a.captionModerationMu.Unlock()
		output := cutter.Observe(source, time.Now())
		if source.IsFinal {
			a.stopEarlyFinalTimer()
		}
		for _, pending := range output.Pending {
			a.deliverModerationSource(pending, operatorID)
		}
		if output.Draft != nil {
			if len(output.Pending) > 0 {
				output.Draft.Sequence = a.nextTranscriptSequence()
			}
			a.deliverModerationSource(*output.Draft, operatorID)
		}
		if output.ClearDraft != nil {
			a.clearModerationDraft(*output.ClearDraft, operatorID)
		}
		if !source.IsFinal {
			a.scheduleEarlyFinalRecheck(cutter)
		}
		return
	}
	a.deliverModerationSource(source, operatorID)
}

func (a *Agent) clearModerationDraft(source captionmoderation.SourceSegment, operatorID string) {
	if !a.moderator.ClearDraft(source) || operatorID == "" {
		return
	}
	envelope := captionOperatorEnvelope{
		Type:     captionDraftClearedType,
		Provider: source.Provider,
		Source:   captionSourceFromModeration(source),
	}
	if err := a.publishCaptionOperator(envelope, true, operatorID); err != nil {
		log.Printf("⚠️ [Caption] Failed to clear operator Draft: %v", err)
	}
}

func (a *Agent) deliverModerationSource(source captionmoderation.SourceSegment, operatorID string) {
	if !a.moderator.Ingest(source) {
		return
	}
	if operatorID == "" {
		return
	}
	envelope := captionOperatorEnvelope{
		Type:     captionDraftType,
		Provider: source.Provider,
		Source:   captionSourceFromModeration(source),
	}
	if source.IsFinal {
		envelope.Type = captionPendingType
	}
	if err := a.publishCaptionOperator(envelope, source.IsFinal, operatorID); err != nil {
		log.Printf("⚠️ [Caption] Failed to deliver %s to operator: %v", envelope.Type, err)
	}
}

func (a *Agent) scheduleEarlyFinalRecheck(cutter *captionmoderation.EarlyFinalCutter) {
	if cutter == nil {
		return
	}
	delay := cutter.ReevaluateAfter(time.Now())
	if delay <= 0 {
		delay = time.Millisecond
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if a.earlyFinalCutter != cutter ||
		a.captionPolicy != captionmoderation.CaptionPolicyEarlyFinal ||
		!a.captionReviewStarted || !a.isRunning {
		return
	}
	if a.earlyFinalTimer != nil {
		a.earlyFinalTimer.Stop()
	}
	a.earlyFinalTimerGeneration++
	generation := a.earlyFinalTimerGeneration
	a.earlyFinalTimer = time.AfterFunc(delay, func() {
		a.reevaluateEarlyFinal(cutter, generation)
	})
}

func (a *Agent) stopEarlyFinalTimer() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.stopEarlyFinalTimerLocked()
}

func (a *Agent) stopEarlyFinalTimerLocked() {
	if a.earlyFinalTimer != nil {
		a.earlyFinalTimer.Stop()
		a.earlyFinalTimer = nil
	}
	a.earlyFinalTimerGeneration++
}

func (a *Agent) reevaluateEarlyFinal(
	cutter *captionmoderation.EarlyFinalCutter,
	generation uint64,
) {
	a.captionModerationMu.Lock()
	defer a.captionModerationMu.Unlock()

	a.mu.Lock()
	if a.earlyFinalCutter != cutter ||
		a.earlyFinalTimerGeneration != generation ||
		a.captionPolicy != captionmoderation.CaptionPolicyEarlyFinal ||
		!a.captionReviewStarted || !a.isRunning {
		a.mu.Unlock()
		return
	}
	a.earlyFinalTimer = nil
	operatorID := a.captionOperatorID
	a.mu.Unlock()

	output := cutter.Reevaluate(time.Now())
	for _, pending := range output.Pending {
		a.deliverModerationSource(pending, operatorID)
	}
	if output.Draft != nil {
		if len(output.Pending) > 0 {
			output.Draft.Sequence = a.nextTranscriptSequence()
		}
		a.deliverModerationSource(*output.Draft, operatorID)
	}
	if output.ClearDraft != nil {
		a.clearModerationDraft(*output.ClearDraft, operatorID)
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
		credentials, ok := a.captionOperatorCredentials(senderMetadata, command.Provider)
		if !ok {
			a.rejectCaptionCommand(senderIdentity, command.RequestID, command.Provider, "operator_unauthorized")
			return
		}
		a.subscribeCaptionOperatorWithPolicy(
			senderIdentity, credentials.sessionID, credentials.policy, command,
		)
	case captionPublishType:
		a.publishCaptionCommand(senderIdentity, command)
	}
}

func (a *Agent) subscribeCaptionOperator(
	identity string,
	sessionID string,
	command captionCommandEnvelope,
) {
	a.subscribeCaptionOperatorWithPolicy(
		identity, sessionID, captionmoderation.CaptionPolicyProviderFinal, command,
	)
}

func (a *Agent) subscribeCaptionOperatorWithPolicy(
	identity string,
	sessionID string,
	policy captionmoderation.CaptionPolicy,
	command captionCommandEnvelope,
) {
	a.mu.Lock()
	if a.captionOperatorSessionID != "" && a.captionOperatorSessionID != sessionID {
		a.mu.Unlock()
		a.rejectCaptionCommand(identity, command.RequestID, command.Provider, "operator_already_active")
		return
	}
	if a.captionOperatorSessionID == sessionID && a.captionPolicy != "" && a.captionPolicy != policy {
		a.mu.Unlock()
		a.rejectCaptionCommand(identity, command.RequestID, command.Provider, "operator_policy_mismatch")
		return
	}
	if a.captionReviewEndTimer != nil {
		a.captionReviewEndTimer.Stop()
		a.captionReviewEndTimer = nil
	}
	isNewSession := a.captionOperatorSessionID == ""
	var snapshot captionmoderation.Snapshot
	var cutterToSchedule *captionmoderation.EarlyFinalCutter
	if isNewSession {
		snapshot = a.moderator.StartReviewWindow()
		a.captionReviewStarted = true
		a.captionOperatorSessionID = sessionID
		a.captionPolicy = policy
		if policy == captionmoderation.CaptionPolicyEarlyFinal {
			a.stopEarlyFinalTimerLocked()
			a.earlyFinalCutter = captionmoderation.NewEarlyFinalCutter(
				captionmoderation.DefaultEarlyFinalConfig(),
			)
			cutterToSchedule = a.earlyFinalCutter
			if snapshot.Draft != nil {
				a.earlyFinalCutter.Observe(*snapshot.Draft, time.Now())
			}
		} else {
			a.stopEarlyFinalTimerLocked()
			a.earlyFinalCutter = nil
		}
	} else {
		snapshot = a.moderator.Snapshot()
	}
	a.captionOperatorID = identity
	a.mu.Unlock()
	if cutterToSchedule != nil && snapshot.Draft != nil {
		a.scheduleEarlyFinalRecheck(cutterToSchedule)
	}

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
			// Approved captions are the broadcast output of record, so keep an
			// audit line identifying exactly which request produced each one.
			log.Printf(
				"📡 [Caption] Approved caption sent to external feed: room=%s provider=%s requestId=%s publicationId=%s",
				a.GetRoom(), publication.Provider, command.RequestID, publication.ID,
			)
			a.captionSink.PublishCaption(a.GetRoom(), publication.Text)
		}
	} else {
		// A duplicate RequestID means the operator resent the same publish
		// (reconnect replay). It is acknowledged again but never re-broadcast.
		log.Printf("♻️  [Caption] Publish replayed, not re-broadcast: requestId=%s publicationId=%s", command.RequestID, publication.ID)
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
	if envelope.Type == captionPendingType || envelope.Type == captionDraftClearedType {
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
		sessionID := a.captionOperatorSessionID
		grace := a.captionOperatorGrace
		if grace <= 0 {
			grace = defaultCaptionOperatorGrace
		}
		if sessionID != "" {
			if a.captionReviewEndTimer != nil {
				a.captionReviewEndTimer.Stop()
			}
			a.captionReviewEndTimer = time.AfterFunc(grace, func() {
				a.expireCaptionOperatorSession(sessionID)
			})
		}
	}
	a.mu.Unlock()
	if cleared {
		a.discardPendingCaptionDraft()
	}
}

func (a *Agent) expireCaptionOperatorSession(sessionID string) {
	a.mu.Lock()
	if a.captionOperatorID != "" || a.captionOperatorSessionID != sessionID {
		a.mu.Unlock()
		return
	}
	a.captionOperatorSessionID = ""
	a.captionPolicy = ""
	a.stopEarlyFinalTimerLocked()
	if a.earlyFinalCutter != nil {
		a.earlyFinalCutter.Reset()
		a.earlyFinalCutter = nil
	}
	a.captionReviewStarted = false
	a.captionReviewEndTimer = nil
	a.mu.Unlock()
	a.moderator.EndReviewWindow()
}

func (a *Agent) isAuthorizedCaptionOperator(metadata, provider string) bool {
	_, ok := a.captionOperatorCredentials(metadata, provider)
	return ok
}

func (a *Agent) captionOperatorSession(metadata, provider string) string {
	credentials, ok := a.captionOperatorCredentials(metadata, provider)
	if !ok {
		return ""
	}
	return credentials.sessionID
}

func (a *Agent) captionOperatorCredentials(
	metadata, provider string,
) (captionOperatorCredentials, bool) {
	var parsed captionOperatorMetadata
	if err := json.Unmarshal([]byte(metadata), &parsed); err != nil {
		return captionOperatorCredentials{}, false
	}
	if parsed.Role != "caption-operator" ||
		!strings.EqualFold(strings.TrimSpace(parsed.Provider), provider) {
		return captionOperatorCredentials{}, false
	}
	sessionID := strings.TrimSpace(parsed.SessionID)
	if sessionID == "" {
		return captionOperatorCredentials{}, false
	}
	policyValue := strings.TrimSpace(parsed.CaptionPolicy)
	if policyValue == "" {
		policyValue = string(captionmoderation.CaptionPolicyProviderFinal)
	}
	policy, ok := captionmoderation.ParseCaptionPolicy(policyValue)
	if !ok {
		return captionOperatorCredentials{}, false
	}
	return captionOperatorCredentials{sessionID: sessionID, policy: policy}, true
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
			SegmentID:        value.ID,
			Text:             value.Text,
			Provider:         value.Provider,
			IsFinal:          value.IsFinal,
			Sequence:         value.Sequence,
			LanguageCode:     value.LanguageCode,
			JoinWithoutSpace: value.JoinWithoutSpace,
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
		return "Another Caption Desk is already active for this provider. Close it or try again later."
	case "operator_policy_mismatch":
		return "This Caption Desk session is already using a different finalization policy."
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
