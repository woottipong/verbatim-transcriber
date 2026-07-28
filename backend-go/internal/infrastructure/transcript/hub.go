package transcript

import (
	"encoding/json"
	"sync"
	"time"

	"thai-transcriber-backend/internal/domain"
	"thai-transcriber-backend/internal/infrastructure/agent"

	"github.com/google/uuid"
)

const (
	defaultSubscriberQueueSize = 32
	schemaVersion              = "1.0"
)

type TranscriptPayload struct {
	Text         string                `json:"text"`
	IsFinal      bool                  `json:"isFinal"`
	Confidence   float64               `json:"confidence,omitempty"`
	Provider     string                `json:"provider"`
	Speaker      string                `json:"speaker,omitempty"`
	Role         domain.TranscriptRole `json:"role,omitempty"`
	LanguageCode string                `json:"languageCode,omitempty"`
	TurnID       string                `json:"turnId,omitempty"`
}

type Event struct {
	SchemaVersion string            `json:"schemaVersion"`
	Type          string            `json:"type"`
	ID            string            `json:"id"`
	Sequence      uint64            `json:"sequence"`
	Room          string            `json:"room"`
	Timestamp     string            `json:"timestamp"`
	Transcript    TranscriptPayload `json:"transcript"`
}

type ReadyEvent struct {
	SchemaVersion string `json:"schemaVersion"`
	Type          string `json:"type"`
	Room          string `json:"room"`
	Timestamp     string `json:"timestamp"`
}

type ProviderEvent struct {
	Text    string `json:"text"`
	IsFinal bool   `json:"isFinal"`
}

type Subscription struct {
	events chan []byte
	done   chan struct{}
}

func (s *Subscription) Events() <-chan []byte { return s.events }
func (s *Subscription) Done() <-chan struct{} { return s.done }

type roomState struct {
	sequence    uint64
	subscribers map[*Subscription]struct{}
}

type providerKey struct {
	room     string
	provider string
}

type Hub struct {
	mu            sync.Mutex
	rooms         map[string]*roomState
	providerRooms map[providerKey]*roomState
	captionRooms  map[string]*roomState
	generations   map[string]uint64
	queueSize     int
	now           func() time.Time
}

func NewHub() *Hub {
	return NewHubWithQueueSize(defaultSubscriberQueueSize)
}

func NewHubWithQueueSize(queueSize int) *Hub {
	if queueSize < 1 {
		queueSize = defaultSubscriberQueueSize
	}
	return &Hub{
		rooms:         make(map[string]*roomState),
		providerRooms: make(map[providerKey]*roomState),
		captionRooms:  make(map[string]*roomState),
		generations:   make(map[string]uint64),
		queueSize:     queueSize,
		now:           time.Now,
	}
}

func (h *Hub) Generation(room string) uint64 {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.generations[room]
}

// Invalidate closes active integrations and advances the room generation so
// links from a deleted room cannot attach to a later room with the same name.
func (h *Hub) Invalidate(room string) {
	if room == "" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.generations[room]++
	if state := h.rooms[room]; state != nil {
		for subscription := range state.subscribers {
			h.removeSubscriptionLocked(room, subscription)
		}
		delete(h.rooms, room)
	}
	for key, state := range h.providerRooms {
		if key.room != room {
			continue
		}
		for subscription := range state.subscribers {
			h.removeProviderSubscriptionLocked(key, subscription)
		}
		delete(h.providerRooms, key)
	}
	if state := h.captionRooms[room]; state != nil {
		for subscription := range state.subscribers {
			h.removeCaptionSubscriptionLocked(room, subscription)
		}
		delete(h.captionRooms, room)
	}
}

func (h *Hub) SubscribeCaption(room string) *Subscription {
	subscription := &Subscription{events: make(chan []byte, h.queueSize), done: make(chan struct{})}
	h.mu.Lock()
	defer h.mu.Unlock()
	state := h.captionRooms[room]
	if state == nil {
		state = &roomState{subscribers: make(map[*Subscription]struct{})}
		h.captionRooms[room] = state
	}
	state.subscribers[subscription] = struct{}{}
	return subscription
}

func (h *Hub) UnsubscribeCaption(room string, subscription *Subscription) {
	if subscription == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.removeCaptionSubscriptionLocked(room, subscription)
}

func (h *Hub) PublishCaption(room, text string) {
	if room == "" || text == "" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	state := h.captionRooms[room]
	if state == nil {
		return
	}
	payload := []byte(text)
	for subscription := range state.subscribers {
		select {
		case subscription.events <- payload:
		default:
			h.removeCaptionSubscriptionLocked(room, subscription)
		}
	}
}

func (h *Hub) Subscribe(room string) *Subscription {
	subscription := &Subscription{
		events: make(chan []byte, h.queueSize),
		done:   make(chan struct{}),
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	state := h.rooms[room]
	if state == nil {
		state = &roomState{subscribers: make(map[*Subscription]struct{})}
		h.rooms[room] = state
	}
	state.subscribers[subscription] = struct{}{}
	return subscription
}

func (h *Hub) SubscribeProvider(room, provider string) *Subscription {
	subscription := &Subscription{
		events: make(chan []byte, h.queueSize),
		done:   make(chan struct{}),
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	key := providerKey{room: room, provider: provider}
	state := h.providerRooms[key]
	if state == nil {
		state = &roomState{subscribers: make(map[*Subscription]struct{})}
		h.providerRooms[key] = state
	}
	state.subscribers[subscription] = struct{}{}
	return subscription
}

func (h *Hub) Unsubscribe(room string, subscription *Subscription) {
	if subscription == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.removeSubscriptionLocked(room, subscription)
}

func (h *Hub) UnsubscribeProvider(room, provider string, subscription *Subscription) {
	if subscription == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.removeProviderSubscriptionLocked(providerKey{room: room, provider: provider}, subscription)
}

func (h *Hub) Publish(room string, message agent.TranscriptMessage) {
	// The external transcript socket predates bilingual rows and remains a
	// source-only stream. Translation packets are paired in LiveKit clients.
	if room == "" || message.Text == "" || message.Role == domain.TranscriptRoleTranslation {
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	if state := h.rooms[room]; state != nil && len(state.subscribers) > 0 {
		state.sequence++
		event := Event{
			SchemaVersion: schemaVersion,
			Type:          "transcript.interim",
			ID:            uuid.NewString(),
			Sequence:      state.sequence,
			Room:          room,
			Timestamp:     h.now().UTC().Format("2006-01-02T15:04:05.000Z07:00"),
			Transcript: TranscriptPayload{
				Text:         message.Text,
				IsFinal:      message.IsFinal,
				Confidence:   message.Confidence,
				Provider:     message.Provider,
				Speaker:      message.Speaker,
				Role:         message.Role,
				LanguageCode: message.LanguageCode,
				TurnID:       message.TurnID,
			},
		}
		if message.IsFinal {
			event.Type = "transcript.final"
		}
		payload, err := json.Marshal(event)
		if err == nil {
			for subscription := range state.subscribers {
				select {
				case subscription.events <- payload:
				default:
					// A slow integration must not stall the ASR pipeline.
					h.removeSubscriptionLocked(room, subscription)
				}
			}
		}
	}

	key := providerKey{room: room, provider: message.Provider}
	if state := h.providerRooms[key]; state != nil && len(state.subscribers) > 0 {
		payload, err := json.Marshal(ProviderEvent{Text: message.Text, IsFinal: message.IsFinal})
		if err != nil {
			return
		}
		for subscription := range state.subscribers {
			select {
			case subscription.events <- payload:
			default:
				h.removeProviderSubscriptionLocked(key, subscription)
			}
		}
	}
}

func (h *Hub) Ready(room string) []byte {
	event := ReadyEvent{
		SchemaVersion: schemaVersion,
		Type:          "session.ready",
		Room:          room,
		Timestamp:     h.now().UTC().Format("2006-01-02T15:04:05.000Z07:00"),
	}
	payload, _ := json.Marshal(event)
	return payload
}

func (h *Hub) removeSubscriptionLocked(room string, subscription *Subscription) {
	state := h.rooms[room]
	if state == nil {
		return
	}
	if _, ok := state.subscribers[subscription]; !ok {
		return
	}
	delete(state.subscribers, subscription)
	close(subscription.done)
	close(subscription.events)
	if len(state.subscribers) == 0 {
		delete(h.rooms, room)
	}
}

func (h *Hub) removeProviderSubscriptionLocked(key providerKey, subscription *Subscription) {
	state := h.providerRooms[key]
	if state == nil {
		return
	}
	if _, ok := state.subscribers[subscription]; !ok {
		return
	}
	delete(state.subscribers, subscription)
	close(subscription.done)
	close(subscription.events)
	if len(state.subscribers) == 0 {
		delete(h.providerRooms, key)
	}
}

func (h *Hub) removeCaptionSubscriptionLocked(room string, subscription *Subscription) {
	state := h.captionRooms[room]
	if state == nil {
		return
	}
	if _, ok := state.subscribers[subscription]; !ok {
		return
	}
	delete(state.subscribers, subscription)
	close(subscription.done)
	close(subscription.events)
	if len(state.subscribers) == 0 {
		delete(h.captionRooms, room)
	}
}
