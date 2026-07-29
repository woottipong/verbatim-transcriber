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

var (
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
	now            func() time.Time
	draft          *SourceSegment
	pending        []SourceSegment
	pendingIndex   map[string]int
	processed      map[string]processedPublication
	processedOrder []string
	consumedDrafts map[string]struct{}
	consumedOrder  []string
}

type processedPublication struct {
	publication  Publication
	sources      []SourceSegment
	hasRemainder bool
	fromDraft    bool
}

func New(provider string, now func() time.Time) *Moderator {
	if now == nil {
		now = time.Now
	}
	return &Moderator{
		provider:       strings.ToLower(strings.TrimSpace(provider)),
		now:            now,
		pendingIndex:   make(map[string]int),
		processed:      make(map[string]processedPublication),
		consumedDrafts: make(map[string]struct{}),
	}
}

// Ingest records one provider revision and reports whether it changed review
// state. Call Snapshot only at synchronization boundaries; high-frequency
// transcript ingestion must not clone the full pending queue.
func (m *Moderator) Ingest(segment SourceSegment) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	segment = normalizeSourceSegment(segment)
	if !m.acceptsLocked(segment) {
		return false
	}

	if !segment.IsFinal {
		if m.draft == nil || segment.Sequence >= m.draft.Sequence {
			copy := segment
			m.draft = &copy
			return true
		}
		return false
	}

	if m.draft != nil && m.draft.ID == segment.ID {
		m.draft = nil
	}
	if _, exists := m.pendingIndex[segment.ID]; exists {
		return false
	}

	m.pending = append(m.pending, segment)
	if len(m.pending) > maxPendingSegments {
		m.pending = append([]SourceSegment(nil), m.pending[len(m.pending)-maxPendingSegments:]...)
	}
	m.rebuildPendingIndexLocked()
	return true
}

// ObserveCurrentDraft retains only the active provider Draft before review
// begins. Final segments clear their matching Draft but are not queued, so a
// newly joined operator sees what is live at the join boundary without history.
func (m *Moderator) ObserveCurrentDraft(segment SourceSegment) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	segment = normalizeSourceSegment(segment)
	if !m.acceptsLocked(segment) {
		return false
	}
	if segment.IsFinal {
		if m.draft != nil && m.draft.ID == segment.ID {
			m.draft = nil
			return true
		}
		return false
	}
	if m.draft != nil && segment.Sequence < m.draft.Sequence {
		return false
	}
	copy := segment
	m.draft = &copy
	return true
}

func (m *Moderator) Snapshot() Snapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.snapshotLocked()
}

// StartReviewWindow discards finalized pre-join history while retaining the
// Draft active at the join boundary. Publications and request replay records
// remain intact.
func (m *Moderator) StartReviewWindow() Snapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pending = nil
	m.rebuildPendingIndexLocked()
	return m.snapshotLocked()
}

func normalizeSourceSegment(segment SourceSegment) SourceSegment {
	segment.ID = strings.TrimSpace(segment.ID)
	segment.Provider = strings.ToLower(strings.TrimSpace(segment.Provider))
	segment.Text = strings.TrimSpace(segment.Text)
	return segment
}

func (m *Moderator) acceptsLocked(segment SourceSegment) bool {
	if segment.ID == "" || segment.Text == "" || segment.Provider != m.provider {
		return false
	}
	_, consumed := m.consumedDrafts[segment.ID]
	return !consumed
}

func (m *Moderator) Publish(command PublishCommand) (Publication, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	command.RequestID = strings.TrimSpace(command.RequestID)
	command.Provider = strings.ToLower(strings.TrimSpace(command.Provider))
	if existing, ok := m.processed[command.RequestID]; command.RequestID != "" && ok {
		return clonePublication(existing.publication), true, nil
	}
	if command.RequestID == "" || strings.TrimSpace(command.Text) == "" || len(command.SourceSegmentIDs) == 0 {
		return Publication{}, false, ErrInvalidCommand
	}
	if command.Provider != m.provider {
		return Publication{}, false, ErrProviderMismatch
	}
	sourceIDs := make([]string, len(command.SourceSegmentIDs))
	fromDraft := m.draft != nil &&
		len(command.SourceSegmentIDs) > 0 &&
		strings.TrimSpace(command.SourceSegmentIDs[len(command.SourceSegmentIDs)-1]) == m.draft.ID &&
		m.draft.Provider == command.Provider
	pendingCount := len(command.SourceSegmentIDs)
	if fromDraft {
		pendingCount--
	}
	if pendingCount > len(m.pending) {
		return Publication{}, false, ErrSourceMismatch
	}
	for index, rawID := range command.SourceSegmentIDs {
		id := strings.TrimSpace(rawID)
		if id == "" {
			return Publication{}, false, ErrSourceMismatch
		}
		if index < pendingCount && (m.pending[index].ID != id || m.pending[index].Provider != command.Provider) {
			return Publication{}, false, ErrSourceMismatch
		}
		if index == pendingCount && fromDraft && (m.draft == nil || m.draft.ID != id) {
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
	publishedSources = append(publishedSources, m.pending[:pendingCount]...)
	m.pending = append([]SourceSegment(nil), m.pending[pendingCount:]...)
	if fromDraft {
		publishedSources = append(publishedSources, *m.draft)
		m.draft = nil
		m.rememberConsumedDraftLocked(sourceIDs[len(sourceIDs)-1])
	}
	if command.RemainingText != "" {
		remainder := publishedSources[len(publishedSources)-1]
		remainder.Text = command.RemainingText
		remainder.IsFinal = true
		m.pending = append([]SourceSegment{remainder}, m.pending...)
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
		m.pending[0].ID == record.sources[len(record.sources)-1].ID {
		m.pending = m.pending[1:]
	}
	if record.fromDraft {
		last := len(record.sources) - 1
		m.forgetConsumedDraftLocked(record.sources[last].ID)
		draft := record.sources[last]
		m.draft = &draft
		m.pending = append(append([]SourceSegment(nil), record.sources[:last]...), m.pending...)
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
	m.processedOrder = evictFIFOHead(m.processed, m.processedOrder, maxProcessedRequest)
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
	m.consumedOrder = evictFIFOHead(m.consumedDrafts, m.consumedOrder, maxConsumedDrafts)
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

func evictFIFOHead[K comparable, V any](store map[K]V, order []K, maxCapacity int) []K {
	if len(order) >= maxCapacity && len(order) > 0 {
		delete(store, order[0])
		return append([]K(nil), order[1:]...)
	}
	return order
}

func clonePublication(publication Publication) Publication {
	publication.SourceSegmentIDs = append([]string(nil), publication.SourceSegmentIDs...)
	return publication
}
