package transcript

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"thai-transcriber-backend/internal/domain"
	"thai-transcriber-backend/internal/infrastructure/agent"

	"github.com/google/uuid"
)

const (
	defaultSubscriberQueueSize = 32
	schemaVersion              = "1.0"

	// defaultGenerationRetention bounds how long a deleted room's generation
	// counter is kept before eviction. It must stay longer than the longest
	// transcript/caption token TTL (24h, see main.go) so no still-valid token
	// can ever reference a generation the hub has already forgotten.
	defaultGenerationRetention = 25 * time.Hour
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

// generationEntry bounds how long a room's invalidation counter is retained.
// Without an expiry, a hub that outlives many created/deleted rooms would
// grow this map forever even though old entries stop mattering once every
// token that could reference them has expired.
type generationEntry struct {
	value     uint64
	expiresAt time.Time
}

type Hub struct {
	mu            sync.Mutex
	rooms         map[string]*roomState
	providerRooms map[providerKey]*roomState
	captionRooms  map[string]*roomState
	generations   map[string]generationEntry
	generationTTL time.Duration
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
		generations:   make(map[string]generationEntry),
		generationTTL: defaultGenerationRetention,
		queueSize:     queueSize,
		now:           time.Now,
	}
}

func (h *Hub) Generation(room string) uint64 {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.generations[room].value
}

// evictExpiredGenerationsLocked drops generation counters past retention.
// Called from Invalidate, the only path that grows this map, so the map
// never holds more entries than rooms deleted within the retention window.
func (h *Hub) evictExpiredGenerationsLocked(now time.Time) {
	for room, entry := range h.generations {
		if now.After(entry.expiresAt) {
			delete(h.generations, room)
		}
	}
}

// Invalidate closes active integrations and advances the room generation so
// links from a deleted room cannot attach to a later room with the same name.
func (h *Hub) Invalidate(room string) {
	if room == "" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.now()
	h.evictExpiredGenerationsLocked(now)
	entry := h.generations[room]
	entry.value++
	entry.expiresAt = now.Add(h.generationTTL)
	h.generations[room] = entry
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
	log.Printf("🔌 [Hub] SubscribeCaption room=%s subscribers=%d", room, len(state.subscribers))
	return subscription
}

func (h *Hub) UnsubscribeCaption(room string, subscription *Subscription) {
	if subscription == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.removeCaptionSubscriptionLocked(room, subscription)
	if state := h.captionRooms[room]; state != nil {
		log.Printf("🔌 [Hub] UnsubscribeCaption room=%s subscribers=%d", room, len(state.subscribers))
	} else {
		log.Printf("🔌 [Hub] UnsubscribeCaption room=%s subscribers=0 (room emptied)", room)
	}
}

// CaptionSubscriberCount reports how many caption feed connections are
// attached to a room. A duplicate seen by one external consumer cannot be
// explained by fan-out, so this distinguishes "more clients than expected"
// from "the same client was written to twice".
func (h *Hub) CaptionSubscriberCount(room string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	state := h.captionRooms[room]
	if state == nil {
		return 0
	}
	return len(state.subscribers)
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
	// The fan-out count makes a duplicate at the client unambiguous: one line
	// per approved caption means the duplicate came from upstream, while
	// subscribers>1 means more than one feed connection is attached.
	log.Printf("📡 [Hub] Caption fan-out: room=%s subscribers=%d", room, len(state.subscribers))
	payload := []byte(text)
	for subscription := range state.subscribers {
		select {
		case subscription.events <- payload:
		default:
			log.Printf("⚠️  [Hub] Dropping slow caption subscriber in room %s (queue full, no replay)", room)
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
					log.Printf("⚠️  [Hub] Dropping slow transcript subscriber in room %s (queue full, no replay)", room)
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
				log.Printf("⚠️  [Hub] Dropping slow provider subscriber in room %s provider %s (queue full, no replay)", room, message.Provider)
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
