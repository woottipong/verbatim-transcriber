package transcript

import (
	"bytes"
	"testing"
)

func TestCaptionHubPublishesPlainUTF8OnlyToMatchingRoomProvider(t *testing.T) {
	hub := NewHub()
	matching := hub.SubscribeCaption("room-a", "google")
	other := hub.SubscribeCaption("room-a", "azure")
	hub.PublishCaption("room-a", "google", "ผู้ป่วยมีอาการเจ็บหน้าอก")
	payload := <-matching.Events()
	if !bytes.Equal(payload, []byte("ผู้ป่วยมีอาการเจ็บหน้าอก")) {
		t.Fatalf("unexpected payload %q", payload)
	}
	select {
	case <-other.Events():
		t.Fatal("caption crossed provider boundary")
	default:
	}
}

func TestCaptionHubDropsEmptyAndDisconnectsSlowSubscriber(t *testing.T) {
	hub := NewHubWithQueueSize(1)
	subscription := hub.SubscribeCaption("room-a", "google")
	hub.PublishCaption("room-a", "google", "")
	hub.PublishCaption("room-a", "google", "one")
	hub.PublishCaption("room-a", "google", "two")
	select {
	case <-subscription.Done():
	default:
		t.Fatal("slow subscriber was not disconnected")
	}
}

func TestCaptionHubInvalidateClosesRoomSubscriptions(t *testing.T) {
	hub := NewHub()
	subscription := hub.SubscribeCaption("room-a", "google")
	hub.Invalidate("room-a")
	select {
	case <-subscription.Done():
	default:
		t.Fatal("room invalidation did not close caption subscription")
	}
}
