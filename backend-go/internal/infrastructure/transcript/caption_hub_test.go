package transcript

import (
	"bytes"
	"testing"
)

func TestCaptionHubPublishesPlainUTF8OnlyToMatchingRoom(t *testing.T) {
	hub := NewHub()
	matching := hub.SubscribeCaption("room-a")
	other := hub.SubscribeCaption("room-b")
	formatted := "  ผู้ป่วยมีอาการ\\nเจ็บหน้าอก  "
	hub.PublishCaption("room-a", formatted)
	payload := <-matching.Events()
	if !bytes.Equal(payload, []byte(formatted)) {
		t.Fatalf("unexpected payload %q", payload)
	}
	select {
	case <-other.Events():
		t.Fatal("caption crossed room boundary")
	default:
	}
}

func TestCaptionHubDropsEmptyAndDisconnectsSlowSubscriber(t *testing.T) {
	hub := NewHubWithQueueSize(1)
	subscription := hub.SubscribeCaption("room-a")
	hub.PublishCaption("room-a", "")
	hub.PublishCaption("room-a", "one")
	hub.PublishCaption("room-a", "two")
	select {
	case <-subscription.Done():
	default:
		t.Fatal("slow subscriber was not disconnected")
	}
}

func TestCaptionHubInvalidateClosesRoomSubscriptions(t *testing.T) {
	hub := NewHub()
	subscription := hub.SubscribeCaption("room-a")
	hub.Invalidate("room-a")
	select {
	case <-subscription.Done():
	default:
		t.Fatal("room invalidation did not close caption subscription")
	}
}
