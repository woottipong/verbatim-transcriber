package captionmoderation

import (
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

const (
	maxPendingSegments  = 500
	maxProcessedRequest = 256
	maxConsumedDrafts   = 500
)

type Mode string

const (
	ModeLive      Mode = "live"
	ModeModerated Mode = "moderated"
)

var (
	ErrInvalidMode      = errors.New("invalid caption moderation mode")
	ErrInvalidCommand   = errors.New("invalid caption moderation command")
	ErrProviderMismatch = errors.New("caption provider mismatch")
	ErrSourceMismatch   = errors.New("caption source segments do not match pending prefix")
)

type SourceSegment struct {
	ID           string
	Provider     string
	Text         string
	IsFinal      bool
	Sequence     uint64
	LanguageCode string
}

type PublishCommand struct {
	RequestID        string
	Provider         string
	SourceSegmentIDs []string
	Text             string
	RemainingText    string
}

type Publication struct {
	ID               string
	RequestID        string
	Provider         string
	SourceSegmentIDs []string
	Text             string
	PublishedAt      time.Time
}

type Snapshot struct {
	Provider string
	Draft    *SourceSegment
	Pending  []SourceSegment
}

type Moderator struct {
	mu             sync.Mutex
	provider       string
	mode           Mode
	now            func() time.Time
	draft          *SourceSegment
	pending        []SourceSegment
	pendingIndex   map[string]int
	processed      map[string]processedPublication
	processedOrder []string
	consumedDrafts map[string]struct{}
	consumedOrder  []string
	useInterim     bool
}

type processedPublication struct {
	publication  Publication
	sources      []SourceSegment
	hasRemainder bool
	fromDraft    bool
}

func NormalizeMode(value string) (Mode, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", string(ModeLive):
		return ModeLive, nil
	case string(ModeModerated):
		return ModeModerated, nil
	default:
		return "", ErrInvalidMode
	}
}

func New(provider string, mode Mode, now func() time.Time) *Moderator {
	if now == nil {
		now = time.Now
	}
	return &Moderator{
		provider:       strings.ToLower(strings.TrimSpace(provider)),
		mode:           mode,
		now:            now,
		pendingIndex:   make(map[string]int),
		processed:      make(map[string]processedPublication),
		consumedDrafts: make(map[string]struct{}),
	}
}

func (m *Moderator) Ingest(segment SourceSegment) Snapshot {
	m.mu.Lock()
	defer m.mu.Unlock()

	segment.ID = strings.TrimSpace(segment.ID)
	segment.Provider = strings.ToLower(strings.TrimSpace(segment.Provider))
	segment.Text = strings.TrimSpace(segment.Text)
	if m.mode != ModeModerated || segment.ID == "" || segment.Text == "" || segment.Provider != m.provider {
		return m.snapshotLocked()
	}
	if _, consumed := m.consumedDrafts[segment.ID]; consumed {
		return m.snapshotLocked()
	}

	if !segment.IsFinal {
		if m.useInterim && (m.draft == nil || m.draft.ID != segment.ID) {
			m.pending = nil
			m.rebuildPendingIndexLocked()
		}
		if m.draft == nil || segment.Sequence >= m.draft.Sequence {
			copy := segment
			m.draft = &copy
		}
		return m.snapshotLocked()
	}

	if m.draft != nil && m.draft.ID == segment.ID {
		m.draft = nil
	}
	if m.useInterim {
		m.pending = []SourceSegment{segment}
		m.rebuildPendingIndexLocked()
		return m.snapshotLocked()
	}
	if _, exists := m.pendingIndex[segment.ID]; exists {
		return m.snapshotLocked()
	}

	m.pending = append(m.pending, segment)
	if len(m.pending) > maxPendingSegments {
		m.pending = append([]SourceSegment(nil), m.pending[len(m.pending)-maxPendingSegments:]...)
	}
	m.rebuildPendingIndexLocked()
	return m.snapshotLocked()
}

func (m *Moderator) SetUseInterim(enabled bool) Snapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.useInterim == enabled {
		return m.snapshotLocked()
	}
	m.useInterim = enabled
	if enabled {
		m.pending = nil
		m.rebuildPendingIndexLocked()
	}
	return m.snapshotLocked()
}

func (m *Moderator) Snapshot() Snapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.snapshotLocked()
}

func (m *Moderator) Publish(command PublishCommand) (Publication, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	command.RequestID = strings.TrimSpace(command.RequestID)
	command.Provider = strings.ToLower(strings.TrimSpace(command.Provider))
	command.Text = strings.TrimSpace(command.Text)
	command.RemainingText = strings.TrimSpace(command.RemainingText)
	if existing, ok := m.processed[command.RequestID]; command.RequestID != "" && ok {
		return clonePublication(existing.publication), true, nil
	}
	if command.RequestID == "" || command.Text == "" || len(command.SourceSegmentIDs) == 0 {
		return Publication{}, false, ErrInvalidCommand
	}
	if command.RemainingText != "" && len(command.SourceSegmentIDs) != 1 {
		return Publication{}, false, ErrInvalidCommand
	}
	if command.Provider != m.provider {
		return Publication{}, false, ErrProviderMismatch
	}
	sourceIDs := make([]string, len(command.SourceSegmentIDs))
	fromDraft := len(command.SourceSegmentIDs) == 1 &&
		m.draft != nil &&
		strings.TrimSpace(command.SourceSegmentIDs[0]) == m.draft.ID &&
		m.draft.Provider == command.Provider
	if !fromDraft && len(command.SourceSegmentIDs) > len(m.pending) {
		return Publication{}, false, ErrSourceMismatch
	}
	for index, rawID := range command.SourceSegmentIDs {
		id := strings.TrimSpace(rawID)
		if id == "" {
			return Publication{}, false, ErrSourceMismatch
		}
		if !fromDraft && (m.pending[index].ID != id || m.pending[index].Provider != command.Provider) {
			return Publication{}, false, ErrSourceMismatch
		}
		sourceIDs[index] = id
	}

	publication := Publication{
		ID:               uuid.NewString(),
		RequestID:        command.RequestID,
		Provider:         command.Provider,
		SourceSegmentIDs: sourceIDs,
		Text:             command.Text,
		PublishedAt:      m.now(),
	}
	var publishedSources []SourceSegment
	if fromDraft {
		publishedSources = []SourceSegment{*m.draft}
		m.draft = nil
		m.rememberConsumedDraftLocked(sourceIDs[0])
		if command.RemainingText != "" {
			remainder := publishedSources[0]
			remainder.Text = command.RemainingText
			remainder.IsFinal = true
			m.pending = append([]SourceSegment{remainder}, m.pending...)
		}
	} else {
		publishedSources = append([]SourceSegment(nil), m.pending[:len(sourceIDs)]...)
		if command.RemainingText != "" {
			m.pending[0].Text = command.RemainingText
		} else {
			m.pending = append([]SourceSegment(nil), m.pending[len(sourceIDs):]...)
		}
	}
	m.rebuildPendingIndexLocked()
	m.rememberPublicationLocked(publication, publishedSources, command.RemainingText != "", fromDraft)
	return clonePublication(publication), false, nil
}

// Rollback restores a publication to the front of the pending queue when the
// transport rejected it before any public delivery was accepted.
func (m *Moderator) Rollback(requestID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	requestID = strings.TrimSpace(requestID)
	record, ok := m.processed[requestID]
	if !ok {
		return false
	}
	delete(m.processed, requestID)
	for index, candidate := range m.processedOrder {
		if candidate == requestID {
			m.processedOrder = append(m.processedOrder[:index], m.processedOrder[index+1:]...)
			break
		}
	}
	if record.hasRemainder && len(m.pending) > 0 &&
		len(record.sources) == 1 && m.pending[0].ID == record.sources[0].ID {
		m.pending = m.pending[1:]
	}
	if record.fromDraft {
		m.forgetConsumedDraftLocked(record.sources[0].ID)
		draft := record.sources[0]
		m.draft = &draft
	} else {
		m.pending = append(append([]SourceSegment(nil), record.sources...), m.pending...)
	}
	if len(m.pending) > maxPendingSegments {
		m.pending = m.pending[:maxPendingSegments]
	}
	m.rebuildPendingIndexLocked()
	return true
}

func (m *Moderator) processedCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.processed)
}

func (m *Moderator) snapshotLocked() Snapshot {
	snapshot := Snapshot{
		Provider: m.provider,
		Pending:  append([]SourceSegment(nil), m.pending...),
	}
	if m.draft != nil {
		copy := *m.draft
		snapshot.Draft = &copy
	}
	return snapshot
}

func (m *Moderator) rebuildPendingIndexLocked() {
	clear(m.pendingIndex)
	for index, segment := range m.pending {
		m.pendingIndex[segment.ID] = index
	}
}

func (m *Moderator) rememberPublicationLocked(publication Publication, sources []SourceSegment, hasRemainder, fromDraft bool) {
	if len(m.processedOrder) == maxProcessedRequest {
		oldest := m.processedOrder[0]
		delete(m.processed, oldest)
		copy(m.processedOrder, m.processedOrder[1:])
		m.processedOrder = m.processedOrder[:len(m.processedOrder)-1]
	}
	m.processed[publication.RequestID] = processedPublication{
		publication:  clonePublication(publication),
		sources:      append([]SourceSegment(nil), sources...),
		hasRemainder: hasRemainder,
		fromDraft:    fromDraft,
	}
	m.processedOrder = append(m.processedOrder, publication.RequestID)
}

func (m *Moderator) rememberConsumedDraftLocked(id string) {
	if _, exists := m.consumedDrafts[id]; exists {
		return
	}
	if len(m.consumedOrder) == maxConsumedDrafts {
		oldest := m.consumedOrder[0]
		delete(m.consumedDrafts, oldest)
		m.consumedOrder = append([]string(nil), m.consumedOrder[1:]...)
	}
	m.consumedDrafts[id] = struct{}{}
	m.consumedOrder = append(m.consumedOrder, id)
}

func (m *Moderator) forgetConsumedDraftLocked(id string) {
	delete(m.consumedDrafts, id)
	for index, candidate := range m.consumedOrder {
		if candidate == id {
			m.consumedOrder = append(m.consumedOrder[:index], m.consumedOrder[index+1:]...)
			return
		}
	}
}

func clonePublication(publication Publication) Publication {
	publication.SourceSegmentIDs = append([]string(nil), publication.SourceSegmentIDs...)
	return publication
}
