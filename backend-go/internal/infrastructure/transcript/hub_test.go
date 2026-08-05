package transcript

import (
	"encoding/json"
	"testing"
	"time"

	"thai-transcriber-backend/internal/domain"
	"thai-transcriber-backend/internal/infrastructure/agent"
)

func TestHubPublishesOrderedTypedEvents(t *testing.T) {
	hub := NewHubWithQueueSize(4)
	fixedNow := time.Date(2026, 7, 16, 10, 0, 0, 123000000, time.UTC)
	hub.now = func() time.Time { return fixedNow }
	subscription := hub.Subscribe("room-a")
	defer hub.Unsubscribe("room-a", subscription)

	hub.Publish("room-a", agent.TranscriptMessage{Text: "กำลังทดสอบ", Provider: "gemini", Speaker: "speaker-1", Confidence: 0.91})
	hub.Publish("room-a", agent.TranscriptMessage{Text: "กำลังทดสอบครับ", IsFinal: true, Provider: "gemini", Speaker: "speaker-1", Confidence: 0.93})

	first := decodeEvent(t, <-subscription.Events())
	second := decodeEvent(t, <-subscription.Events())
	if first.Type != "transcript.interim" || second.Type != "transcript.final" {
		t.Fatalf("event types = %q/%q", first.Type, second.Type)
	}
	if first.Sequence != 1 || second.Sequence != 2 {
		t.Fatalf("event sequences = %d/%d, want 1/2", first.Sequence, second.Sequence)
	}
	if first.Room != "room-a" || first.Transcript.Text != "กำลังทดสอบ" || first.Transcript.Provider != "gemini" {
		t.Fatalf("first event = %+v", first)
	}
	if first.Timestamp != "2026-07-16T10:00:00.123Z" {
		t.Fatalf("timestamp = %q", first.Timestamp)
	}
	if first.ID == "" || second.ID == "" || first.ID == second.ID {
		t.Fatalf("event IDs = %q/%q", first.ID, second.ID)
	}
}

func TestHubDoesNotPublishTranslationPacketsToLegacySubscribers(t *testing.T) {
	hub := NewHub()
	subscription := hub.Subscribe("room-a")
	defer hub.Unsubscribe("room-a", subscription)

	hub.Publish("room-a", agent.TranscriptMessage{
		Text:         "ห้องฉุกเฉิน",
		Provider:     "gemini",
		Speaker:      "speaker-1",
		Role:         domain.TranscriptRoleTranslation,
		LanguageCode: "th",
		TurnID:       "gemini-1",
	})

	select {
	case payload := <-subscription.Events():
		t.Fatalf("unexpected translation event: %s", payload)
	default:
	}
}

func TestHubPublishesLeanEventsOnlyToMatchingProvider(t *testing.T) {
	hub := NewHubWithQueueSize(4)
	google := hub.SubscribeProvider("room-a", "google")
	gemini := hub.SubscribeProvider("room-a", "gemini")
	otherRoom := hub.SubscribeProvider("room-b", "google")
	defer hub.UnsubscribeProvider("room-a", "google", google)
	defer hub.UnsubscribeProvider("room-a", "gemini", gemini)
	defer hub.UnsubscribeProvider("room-b", "google", otherRoom)

	hub.Publish("room-a", agent.TranscriptMessage{
		Text:     "ผู้ป่วยมีอาการ",
		Provider: "google",
	})

	if got := string(<-google.Events()); got != `{"text":"ผู้ป่วยมีอาการ","isFinal":false}` {
		t.Fatalf("payload = %s", got)
	}
	assertNoSubscriptionEvent(t, gemini)
	assertNoSubscriptionEvent(t, otherRoom)
}

func TestHubPublishesLeanFinalProviderEvent(t *testing.T) {
	hub := NewHub()
	subscription := hub.SubscribeProvider("room-a", "gpt-realtime-whisper")
	defer hub.UnsubscribeProvider("room-a", "gpt-realtime-whisper", subscription)

	hub.Publish("room-a", agent.TranscriptMessage{
		Text:     "ผู้ป่วยมีอาการเจ็บหน้าอก",
		IsFinal:  true,
		Provider: "gpt-realtime-whisper",
	})

	if got := string(<-subscription.Events()); got != `{"text":"ผู้ป่วยมีอาการเจ็บหน้าอก","isFinal":true}` {
		t.Fatalf("payload = %s", got)
	}
}

func TestHubDoesNotPublishTranslationPacketsToProviderSubscribers(t *testing.T) {
	hub := NewHub()
	subscription := hub.SubscribeProvider("room-a", "gemini")
	defer hub.UnsubscribeProvider("room-a", "gemini", subscription)

	hub.Publish("room-a", agent.TranscriptMessage{
		Text:     "emergency room",
		Provider: "gemini",
		Role:     domain.TranscriptRoleTranslation,
	})

	assertNoSubscriptionEvent(t, subscription)
}

func TestHubRemovesSlowProviderSubscribersWithoutBlocking(t *testing.T) {
	hub := NewHubWithQueueSize(1)
	subscription := hub.SubscribeProvider("room-a", "google")
	hub.Publish("room-a", agent.TranscriptMessage{Text: "first", Provider: "google"})
	hub.Publish("room-a", agent.TranscriptMessage{Text: "second", Provider: "google"})

	select {
	case <-subscription.Done():
	case <-time.After(time.Second):
		t.Fatal("slow provider subscriber was not closed")
	}
}

func TestHubKeepsRoomSequencesIndependent(t *testing.T) {
	hub := NewHub()
	roomA := hub.Subscribe("room-a")
	roomB := hub.Subscribe("room-b")
	defer hub.Unsubscribe("room-a", roomA)
	defer hub.Unsubscribe("room-b", roomB)

	hub.Publish("room-a", agent.TranscriptMessage{Text: "a", Provider: "google"})
	hub.Publish("room-b", agent.TranscriptMessage{Text: "b", Provider: "google"})

	if got := decodeEvent(t, <-roomA.Events()).Sequence; got != 1 {
		t.Fatalf("room A sequence = %d, want 1", got)
	}
	if got := decodeEvent(t, <-roomB.Events()).Sequence; got != 1 {
		t.Fatalf("room B sequence = %d, want 1", got)
	}
}

func TestHubRemovesSlowSubscribersWithoutBlocking(t *testing.T) {
	hub := NewHubWithQueueSize(1)
	subscription := hub.Subscribe("room-a")
	hub.Publish("room-a", agent.TranscriptMessage{Text: "first", Provider: "google"})
	hub.Publish("room-a", agent.TranscriptMessage{Text: "second", Provider: "google"})

	select {
	case <-subscription.Done():
	case <-time.After(time.Second):
		t.Fatal("slow subscriber was not closed")
	}
	_, ok := <-subscription.Events()
	if ok {
		return
	}
}

func TestHubReadyEvent(t *testing.T) {
	hub := NewHub()
	hub.now = func() time.Time { return time.Date(2026, 7, 16, 10, 0, 0, 0, time.UTC) }
	var ready ReadyEvent
	if err := json.Unmarshal(hub.Ready("room-a"), &ready); err != nil {
		t.Fatalf("Ready() returned invalid JSON: %v", err)
	}
	if ready.SchemaVersion != "1.0" || ready.Type != "session.ready" || ready.Room != "room-a" {
		t.Fatalf("ready event = %+v", ready)
	}
}

func TestHubInvalidationClosesSubscribersAndAdvancesGeneration(t *testing.T) {
	hub := NewHub()
	subscription := hub.Subscribe("room-a")
	providerSubscription := hub.SubscribeProvider("room-a", "google")
	hub.Invalidate("room-a")

	select {
	case <-subscription.Done():
	case <-time.After(time.Second):
		t.Fatal("subscription was not closed during invalidation")
	}
	if got := hub.Generation("room-a"); got != 1 {
		t.Fatalf("generation = %d, want 1", got)
	}
	select {
	case <-providerSubscription.Done():
	case <-time.After(time.Second):
		t.Fatal("provider subscription was not closed during invalidation")
	}
}

func TestHubEvictsExpiredGenerationsAfterRetention(t *testing.T) {
	hub := NewHub()
	start := time.Date(2026, 7, 16, 10, 0, 0, 0, time.UTC)
	now := start
	hub.now = func() time.Time { return now }

	hub.Invalidate("room-old")
	if got := hub.Generation("room-old"); got != 1 {
		t.Fatalf("generation before expiry = %d, want 1", got)
	}

	// Past the retention window: any token that could have referenced
	// room-old's generation has already expired on its own, so forgetting
	// the counter here is safe and keeps the map from growing forever.
	now = start.Add(defaultGenerationRetention + time.Minute)
	hub.Invalidate("room-new")

	if got := hub.Generation("room-old"); got != 0 {
		t.Fatalf("generation for expired room = %d, want 0 (evicted)", got)
	}
	if got := hub.Generation("room-new"); got != 1 {
		t.Fatalf("generation for room-new = %d, want 1", got)
	}
	if _, stillPresent := hub.generations["room-old"]; stillPresent {
		t.Fatal("expired room-old entry was not evicted from the generations map")
	}
}

func TestHubRetainsGenerationWithinRetention(t *testing.T) {
	hub := NewHub()
	start := time.Date(2026, 7, 16, 10, 0, 0, 0, time.UTC)
	now := start
	hub.now = func() time.Time { return now }

	hub.Invalidate("room-a")
	now = start.Add(defaultGenerationRetention - time.Minute)
	hub.Invalidate("room-b")

	if got := hub.Generation("room-a"); got != 1 {
		t.Fatalf("generation for room-a = %d, want 1 (should not be evicted yet)", got)
	}
}

func assertNoSubscriptionEvent(t *testing.T, subscription *Subscription) {
	t.Helper()
	select {
	case payload := <-subscription.Events():
		t.Fatalf("unexpected subscription event: %s", payload)
	default:
	}
}

func decodeEvent(t *testing.T, payload []byte) Event {
	t.Helper()
	var event Event
	if err := json.Unmarshal(payload, &event); err != nil {
		t.Fatalf("event JSON error = %v", err)
	}
	return event
}
