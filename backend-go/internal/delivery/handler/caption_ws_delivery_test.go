package handler_test

import (
	"net"
	"net/http"
	"testing"
	"time"

	"thai-transcriber-backend/internal/delivery/handler"
	"thai-transcriber-backend/internal/infrastructure/transcript"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/websocket/v2"
	gorilla "github.com/gorilla/websocket"
)

// One approved caption must arrive at a caption feed client exactly once.
// This exercises the real delivery leg end to end -- Fiber route, WebSocket
// upgrade, hub subscription and fan-out -- because a duplicate reported by an
// external consumer can only originate upstream of this path if this path is
// provably 1:1.
func TestCaptionFeedDeliversOneMessagePerPublish(t *testing.T) {
	hub := transcript.NewHub()
	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	app.Get("/ws/caption/:room", func(c *fiber.Ctx) error {
		if !websocket.IsWebSocketUpgrade(c) {
			return fiber.ErrUpgradeRequired
		}
		return c.Next()
	}, websocket.New(handler.HandleCaptionWebSocket(hub)))

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() { _ = app.Listener(listener) }()
	t.Cleanup(func() { _ = app.Shutdown() })

	url := "ws://" + listener.Addr().String() + "/ws/caption/test"
	conn := dialCaptionFeed(t, url)
	defer conn.Close()

	// The client is attached only once the hub has registered its subscription,
	// so publishing before that would race the upgrade rather than test fan-out.
	waitForCaptionSubscriber(t, hub, "test")

	hub.PublishCaption("test", "ผู้ป่วยมีอาการเจ็บหน้าอก")

	if got := readCaptionFrame(t, conn); got != "ผู้ป่วยมีอาการเจ็บหน้าอก" {
		t.Fatalf("first frame = %q", got)
	}

	// A second frame within the read deadline means the single publish was
	// delivered more than once.
	_ = conn.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, extra, err := conn.ReadMessage(); err == nil {
		t.Fatalf("caption delivered twice for one publish: duplicate = %q", extra)
	}
}

// Two independent feed clients must each receive the caption exactly once,
// which is what distinguishes "the hub duplicated" from "more than one feed
// connection was attached" when triaging a duplicate in production.
func TestCaptionFeedFansOutOncePerConnection(t *testing.T) {
	hub := transcript.NewHub()
	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	app.Get("/ws/caption/:room", func(c *fiber.Ctx) error {
		if !websocket.IsWebSocketUpgrade(c) {
			return fiber.ErrUpgradeRequired
		}
		return c.Next()
	}, websocket.New(handler.HandleCaptionWebSocket(hub)))

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() { _ = app.Listener(listener) }()
	t.Cleanup(func() { _ = app.Shutdown() })

	url := "ws://" + listener.Addr().String() + "/ws/caption/test"
	first := dialCaptionFeed(t, url)
	defer first.Close()
	second := dialCaptionFeed(t, url)
	defer second.Close()
	waitForCaptionSubscribers(t, hub, "test", 2)

	hub.PublishCaption("test", "ข้อความเดียว")

	for index, conn := range []*gorilla.Conn{first, second} {
		if got := readCaptionFrame(t, conn); got != "ข้อความเดียว" {
			t.Fatalf("client %d first frame = %q", index, got)
		}
		_ = conn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
		if _, extra, err := conn.ReadMessage(); err == nil {
			t.Fatalf("client %d received a duplicate: %q", index, extra)
		}
	}
}

func dialCaptionFeed(t *testing.T, url string) *gorilla.Conn {
	t.Helper()
	var lastErr error
	for attempt := 0; attempt < 50; attempt++ {
		conn, response, err := gorilla.DefaultDialer.Dial(url, nil)
		if err == nil {
			return conn
		}
		if response != nil && response.StatusCode != http.StatusSwitchingProtocols {
			_ = response.Body.Close()
		}
		lastErr = err
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("could not dial caption feed: %v", lastErr)
	return nil
}

func readCaptionFrame(t *testing.T, conn *gorilla.Conn) string {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read caption frame: %v", err)
	}
	return string(payload)
}

func waitForCaptionSubscriber(t *testing.T, hub *transcript.Hub, room string) {
	t.Helper()
	waitForCaptionSubscribers(t, hub, room, 1)
}

func waitForCaptionSubscribers(t *testing.T, hub *transcript.Hub, room string, want int) {
	t.Helper()
	for attempt := 0; attempt < 100; attempt++ {
		if hub.CaptionSubscriberCount(room) >= want {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("caption subscribers did not reach %d for room %s", want, room)
}
