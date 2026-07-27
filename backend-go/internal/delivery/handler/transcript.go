package handler

import (
	"context"
	"net/url"
	"strings"
	"time"

	"thai-transcriber-backend/config"
	"thai-transcriber-backend/internal/infrastructure/transcript"
	"thai-transcriber-backend/models"

	"github.com/gofiber/fiber/v2"
	websocket "github.com/gofiber/websocket/v2"
	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
)

const transcriptTokenTTL = 24 * time.Hour

var liveTranscriptHub = transcript.NewHub()

func TranscriptHub() *transcript.Hub {
	return liveTranscriptHub
}

// HandleCreateTranscriptToken issues a short-lived, room-bound read-only URL.
func HandleCreateTranscriptToken(c *fiber.Ctx, cfg *config.Config) error {
	if strings.TrimSpace(cfg.TranscriptWSSecret) == "" {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Transcript WebSocket links are not configured",
		})
	}

	roomName := c.Params("room")
	if err := validateRoomName(roomName); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	room, err := liveKitRoom(c.UserContext(), cfg, roomName)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "Failed to check room"})
	}
	if room == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Room not found"})
	}

	tokenService := transcript.NewTokenService(cfg.TranscriptWSSecret, transcriptTokenTTL)
	token, expiresAt, err := tokenService.IssueForRoom(roomName, room.Sid, liveTranscriptHub.Generation(roomName))
	if err != nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "Transcript WebSocket links are not configured"})
	}

	return c.JSON(models.TranscriptTokenResponse{
		Token:        token,
		ExpiresAt:    expiresAt.UTC().Format(time.RFC3339),
		WebSocketURL: buildTranscriptWebSocketURL(c, roomName, token),
	})
}

// HandleCreateProviderTranscriptToken issues a provider-bound read-only URL
// whose frames contain only text and finality.
func HandleCreateProviderTranscriptToken(c *fiber.Ctx, cfg *config.Config) error {
	if strings.TrimSpace(cfg.TranscriptWSSecret) == "" {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Transcript WebSocket links are not configured",
		})
	}

	roomName := c.Params("room")
	if err := validateRoomName(roomName); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	provider, ok := validTranscriptProvider(c.Params("provider"))
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "provider must be google, gemini, azure, or gpt-realtime-whisper",
		})
	}

	room, err := liveKitRoom(c.UserContext(), cfg, roomName)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "Failed to check room"})
	}
	if room == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Room not found"})
	}

	tokenService := transcript.NewTokenService(cfg.TranscriptWSSecret, transcriptTokenTTL)
	token, expiresAt, err := tokenService.IssueForProviderRoom(
		roomName,
		provider,
		room.Sid,
		liveTranscriptHub.Generation(roomName),
	)
	if err != nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Transcript WebSocket links are not configured",
		})
	}

	return c.JSON(models.TranscriptTokenResponse{
		Token:        token,
		ExpiresAt:    expiresAt.UTC().Format(time.RFC3339),
		WebSocketURL: buildProviderTranscriptWebSocketURL(c, roomName, provider, token),
		Provider:     provider,
	})
}

func liveKitRoom(parent context.Context, cfg *config.Config, roomName string) (*livekit.Room, error) {
	ctx, cancel := context.WithTimeout(parent, 5*time.Second)
	defer cancel()
	roomClient := lksdk.NewRoomServiceClient(cfg.LiveKitURL, cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)
	rooms, err := roomClient.ListRooms(ctx, &livekit.ListRoomsRequest{})
	if err != nil {
		return nil, err
	}
	for _, room := range rooms.Rooms {
		if room.Name == roomName {
			return room, nil
		}
	}
	return nil, nil
}

func buildTranscriptWebSocketURL(c *fiber.Ctx, roomName, token string) string {
	scheme := strings.ToLower(strings.TrimSpace(strings.Split(c.Get("X-Forwarded-Proto"), ",")[0]))
	if scheme == "" {
		scheme = c.Protocol()
	}
	if scheme == "https" {
		scheme = "wss"
	} else {
		scheme = "ws"
	}

	websocketURL := url.URL{
		Scheme: scheme,
		Host:   c.Get("Host"),
		Path:   "/livekit/rooms/" + url.PathEscape(roomName) + "/transcripts/ws",
	}
	query := websocketURL.Query()
	query.Set("token", token)
	websocketURL.RawQuery = query.Encode()
	return websocketURL.String()
}

func buildProviderTranscriptWebSocketURL(c *fiber.Ctx, roomName, provider, token string) string {
	scheme := websocketScheme(c)
	websocketURL := url.URL{
		Scheme: scheme,
		Host:   c.Get("Host"),
		Path: "/ws/transcript/" + url.PathEscape(provider) +
			"/" + url.PathEscape(roomName),
	}
	query := websocketURL.Query()
	query.Set("token", token)
	websocketURL.RawQuery = query.Encode()
	return websocketURL.String()
}

func websocketScheme(c *fiber.Ctx) string {
	scheme := strings.ToLower(strings.TrimSpace(strings.Split(c.Get("X-Forwarded-Proto"), ",")[0]))
	if scheme == "" {
		scheme = c.Protocol()
	}
	if scheme == "https" {
		return "wss"
	}
	return "ws"
}

func validTranscriptProvider(value string) (string, bool) {
	provider := strings.ToLower(strings.TrimSpace(value))
	switch provider {
	case "google", "gemini", "azure", "gpt-realtime-whisper":
		return provider, true
	default:
		return "", false
	}
}

// TranscriptWebSocketMiddleware authenticates before Fiber upgrades the socket.
func TranscriptWebSocketMiddleware(cfg *config.Config) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if strings.TrimSpace(cfg.TranscriptWSSecret) == "" {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
				"error": "Transcript WebSocket links are not configured",
			})
		}
		roomName := c.Params("room")
		service := transcript.NewTokenService(cfg.TranscriptWSSecret, transcriptTokenTTL)
		room, err := liveKitRoom(c.UserContext(), cfg, roomName)
		if err != nil {
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "Failed to check room"})
		}
		if room == nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Room not found"})
		}
		if _, err := service.VerifyForRoom(c.Query("token"), roomName, room.Sid, liveTranscriptHub.Generation(roomName)); err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid transcript token"})
		}
		if !websocket.IsWebSocketUpgrade(c) {
			return fiber.ErrUpgradeRequired
		}
		return c.Next()
	}
}

// ProviderTranscriptWebSocketMiddleware authenticates a room/provider-bound
// token before Fiber upgrades the provider-specific socket.
func ProviderTranscriptWebSocketMiddleware(cfg *config.Config) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if strings.TrimSpace(cfg.TranscriptWSSecret) == "" {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
				"error": "Transcript WebSocket links are not configured",
			})
		}
		provider, ok := validTranscriptProvider(c.Params("provider"))
		if !ok {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "provider must be google, gemini, azure, or gpt-realtime-whisper",
			})
		}
		roomName := c.Params("room")
		if err := validateRoomName(roomName); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		service := transcript.NewTokenService(cfg.TranscriptWSSecret, transcriptTokenTTL)
		room, err := liveKitRoom(c.UserContext(), cfg, roomName)
		if err != nil {
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "Failed to check room"})
		}
		if room == nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Room not found"})
		}
		if _, err := service.VerifyForProviderRoom(
			c.Query("token"),
			roomName,
			provider,
			room.Sid,
			liveTranscriptHub.Generation(roomName),
		); err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid transcript token"})
		}
		if !websocket.IsWebSocketUpgrade(c) {
			return fiber.ErrUpgradeRequired
		}
		return c.Next()
	}
}

// HandleTranscriptWebSocket streams transcript events only. It does not accept
// audio, LiveKit messages, or commands from the connected client.
func HandleTranscriptWebSocket(hub *transcript.Hub) func(*websocket.Conn) {
	return func(conn *websocket.Conn) {
		roomName := conn.Params("room")
		subscription := hub.Subscribe(roomName)
		defer hub.Unsubscribe(roomName, subscription)
		defer conn.Close()

		const (
			pongWait  = 60 * time.Second
			pingEvery = 30 * time.Second
			writeWait = 10 * time.Second
		)
		_ = conn.SetReadDeadline(time.Now().Add(pongWait))
		conn.SetPongHandler(func(string) error {
			return conn.SetReadDeadline(time.Now().Add(pongWait))
		})

		if err := writeTranscriptMessage(conn, hub.Ready(roomName), writeWait); err != nil {
			return
		}

		readerDone := make(chan struct{})
		go func() {
			defer close(readerDone)
			for {
				if _, _, err := conn.ReadMessage(); err != nil {
					return
				}
			}
		}()

		ticker := time.NewTicker(pingEvery)
		defer ticker.Stop()
		for {
			select {
			case payload, ok := <-subscription.Events():
				if !ok {
					_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseTryAgainLater, "subscriber too slow"), time.Now().Add(writeWait))
					return
				}
				if err := writeTranscriptMessage(conn, payload, writeWait); err != nil {
					return
				}
			case <-subscription.Done():
				return
			case <-readerDone:
				return
			case <-ticker.C:
				if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(writeWait)); err != nil {
					return
				}
			}
		}
	}
}

// HandleProviderTranscriptWebSocket streams lean provider-derived source
// snapshots. It accepts no audio, LiveKit messages, or client commands.
func HandleProviderTranscriptWebSocket(hub *transcript.Hub) func(*websocket.Conn) {
	return func(conn *websocket.Conn) {
		roomName := conn.Params("room")
		provider := conn.Params("provider")
		subscription := hub.SubscribeProvider(roomName, provider)
		defer hub.UnsubscribeProvider(roomName, provider, subscription)
		defer conn.Close()

		const (
			pongWait  = 60 * time.Second
			pingEvery = 30 * time.Second
			writeWait = 10 * time.Second
		)
		_ = conn.SetReadDeadline(time.Now().Add(pongWait))
		conn.SetPongHandler(func(string) error {
			return conn.SetReadDeadline(time.Now().Add(pongWait))
		})

		readerDone := make(chan struct{})
		go func() {
			defer close(readerDone)
			for {
				if _, _, err := conn.ReadMessage(); err != nil {
					return
				}
			}
		}()

		ticker := time.NewTicker(pingEvery)
		defer ticker.Stop()
		for {
			select {
			case payload, ok := <-subscription.Events():
				if !ok {
					_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseTryAgainLater, "subscriber too slow"), time.Now().Add(writeWait))
					return
				}
				if err := writeTranscriptMessage(conn, payload, writeWait); err != nil {
					return
				}
			case <-subscription.Done():
				return
			case <-readerDone:
				return
			case <-ticker.C:
				if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(writeWait)); err != nil {
					return
				}
			}
		}
	}
}

func writeTranscriptMessage(conn *websocket.Conn, payload []byte, timeout time.Duration) error {
	if err := conn.SetWriteDeadline(time.Now().Add(timeout)); err != nil {
		return err
	}
	return conn.WriteMessage(websocket.TextMessage, payload)
}
