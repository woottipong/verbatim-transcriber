package agent

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"
)

const (
	CaptionOperatorTopic = "caption.operator"
	CaptionCommandTopic  = "caption.command"
	CaptionPublicTopic   = "caption.public"

	captionSubscribeType        = "caption.subscribe"
	captionPublishType          = "caption.publish"
	maxCaptionCommandTextBytes  = 16_000
	maxCaptionCommandSourceIDs  = 500
	maxCaptionCommandRequestLen = 128

	captionSnapshotType  = "caption.snapshot"
	captionDraftType     = "caption.draft"
	captionPendingType   = "caption.pending"
	captionPublishedType = "caption.published"
	captionRejectedType  = "caption.rejected"
)

var errInvalidCaptionCommand = errors.New("invalid caption command")

type captionCommandEnvelope struct {
	Type             string   `json:"type"`
	RequestID        string   `json:"requestId"`
	Provider         string   `json:"provider"`
	SourceSegmentIDs []string `json:"sourceSegmentIds,omitempty"`
	Text             string   `json:"text,omitempty"`
	RemainingText    string   `json:"remainingText,omitempty"`
}

type captionSourceEnvelope struct {
	SegmentID    string `json:"segmentId"`
	Text         string `json:"text"`
	Provider     string `json:"provider"`
	IsFinal      bool   `json:"isFinal"`
	Sequence     uint64 `json:"sequence"`
	LanguageCode string `json:"languageCode,omitempty"`
}

type captionOperatorEnvelope struct {
	Type             string                  `json:"type"`
	RequestID        string                  `json:"requestId,omitempty"`
	Provider         string                  `json:"provider"`
	Draft            *captionSourceEnvelope  `json:"draft,omitempty"`
	Pending          []captionSourceEnvelope `json:"pending,omitempty"`
	Source           *captionSourceEnvelope  `json:"source,omitempty"`
	PublicationID    string                  `json:"publicationId,omitempty"`
	SourceSegmentIDs []string                `json:"sourceSegmentIds,omitempty"`
	Text             string                  `json:"text,omitempty"`
	PublishedAt      int64                   `json:"publishedAt,omitempty"`
	Code             string                  `json:"code,omitempty"`
	Message          string                  `json:"message,omitempty"`
}

func parseCaptionCommand(payload []byte) (captionCommandEnvelope, error) {
	var command captionCommandEnvelope
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&command); err != nil {
		return captionCommandEnvelope{}, errInvalidCaptionCommand
	}
	if err := ensureJSONEnd(decoder); err != nil {
		return captionCommandEnvelope{}, errInvalidCaptionCommand
	}

	command.Type = strings.TrimSpace(command.Type)
	command.RequestID = strings.TrimSpace(command.RequestID)
	command.Provider = strings.ToLower(strings.TrimSpace(command.Provider))
	if command.RequestID == "" || len(command.RequestID) > maxCaptionCommandRequestLen || !isCaptionProvider(command.Provider) {
		return captionCommandEnvelope{}, errInvalidCaptionCommand
	}

	switch command.Type {
	case captionSubscribeType:
		if command.Text != "" || command.RemainingText != "" || len(command.SourceSegmentIDs) != 0 {
			return captionCommandEnvelope{}, errInvalidCaptionCommand
		}
	case captionPublishType:
		if strings.TrimSpace(command.Text) == "" || len(command.Text) > maxCaptionCommandTextBytes ||
			len(command.RemainingText) > maxCaptionCommandTextBytes ||
			len(command.SourceSegmentIDs) == 0 || len(command.SourceSegmentIDs) > maxCaptionCommandSourceIDs {
			return captionCommandEnvelope{}, errInvalidCaptionCommand
		}
		seen := make(map[string]struct{}, len(command.SourceSegmentIDs))
		for index, rawID := range command.SourceSegmentIDs {
			id := strings.TrimSpace(rawID)
			if id == "" {
				return captionCommandEnvelope{}, errInvalidCaptionCommand
			}
			if _, exists := seen[id]; exists {
				return captionCommandEnvelope{}, errInvalidCaptionCommand
			}
			seen[id] = struct{}{}
			command.SourceSegmentIDs[index] = id
		}
	default:
		return captionCommandEnvelope{}, errInvalidCaptionCommand
	}
	return command, nil
}

func ensureJSONEnd(decoder *json.Decoder) error {
	var extra json.RawMessage
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errInvalidCaptionCommand
	}
	return nil
}

func isCaptionProvider(provider string) bool {
	switch provider {
	case "google", "gemini", "azure", "gpt-realtime-whisper":
		return true
	default:
		return false
	}
}
