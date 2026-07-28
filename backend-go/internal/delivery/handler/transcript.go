package handler

import (
	"errors"
	"net/url"
	"strings"
	"time"

	"thai-transcriber-backend/internal/application/agentsupervisor"
	"thai-transcriber-backend/internal/application/roomoperations"
	"thai-transcriber-backend/internal/application/transcriptaccess"
	"thai-transcriber-backend/internal/infrastructure/transcript"
	"thai-transcriber-backend/models"

	"github.com/gofiber/fiber/v2"
	websocket "github.com/gofiber/websocket/v2"
)

var liveTranscriptHub = transcript.NewHub()

func TranscriptHub() *transcript.Hub {
	return liveTranscriptHub
}

// HandleCreateTranscriptToken issues a short-lived, room-bound read-only URL.
func HandleCreateTranscriptToken(
	c *fiber.Ctx,
	access *transcriptaccess.Policy,
) error {
	roomName := c.Params("room")
	grant, err := access.Issue(c.UserContext(), transcriptaccess.Scope{Room: roomName})
	if err != nil {
		return writeTranscriptAccessIssueError(c, err)
	}

	return c.JSON(models.TranscriptTokenResponse{
		Token:        grant.Token,
		ExpiresAt:    grant.ExpiresAt.UTC().Format(time.RFC3339),
		WebSocketURL: buildTranscriptWebSocketURL(c, grant.Scope.Room, grant.Token),
	})
}

// HandleCreateProviderTranscriptToken issues a provider-bound read-only URL
// whose frames contain only text and finality.
func HandleCreateProviderTranscriptToken(
	c *fiber.Ctx,
	access *transcriptaccess.Policy,
) error {
	roomName := c.Params("room")
	grant, err := access.Issue(c.UserContext(), transcriptaccess.Scope{
		Room:     roomName,
		Provider: c.Params("provider"),
	})
	if err != nil {
		return writeTranscriptAccessIssueError(c, err)
	}

	return c.JSON(models.TranscriptTokenResponse{
		Token:        grant.Token,
		ExpiresAt:    grant.ExpiresAt.UTC().Format(time.RFC3339),
		WebSocketURL: buildProviderTranscriptWebSocketURL(c, grant.Scope.Room, grant.Scope.Provider, grant.Token),
		Provider:     grant.Scope.Provider,
	})
}

func HandleCreateCaptionToken(
	c *fiber.Ctx,
	access *transcriptaccess.Policy,
	supervisor *agentsupervisor.Supervisor,
) error {
	grant, err := access.Issue(c.UserContext(), transcriptaccess.Scope{
		Room: c.Params("room"), Provider: c.Params("provider"), Purpose: transcriptaccess.FeedCaption,
	})
	if err != nil {
		return writeTranscriptAccessIssueError(c, err)
	}
	if !hasConnectedAgent(supervisor, grant.Scope.Room, grant.Scope.Provider) {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"code":  "provider_not_active",
			"error": "Approved caption feeds require an active provider",
		})
	}
	return c.JSON(models.TranscriptTokenResponse{
		Token: grant.Token, ExpiresAt: grant.ExpiresAt.UTC().Format(time.RFC3339),
		WebSocketURL: buildCaptionWebSocketURL(c, grant.Scope.Room, grant.Scope.Provider, grant.Token),
		Provider:     grant.Scope.Provider,
	})
}

func hasConnectedAgent(supervisor *agentsupervisor.Supervisor, room, provider string) bool {
	if supervisor == nil {
		return false
	}
	for _, status := range supervisor.Status() {
		if status.Room == room && status.Provider == provider && status.Running && status.Connected {
			return true
		}
	}
	return false
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

func buildCaptionWebSocketURL(c *fiber.Ctx, roomName, provider, token string) string {
	websocketURL := url.URL{
		Scheme: websocketScheme(c), Host: c.Get("Host"),
		Path: "/ws/caption/" + url.PathEscape(provider) + "/" + url.PathEscape(roomName),
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

// TranscriptWebSocketMiddleware authenticates before Fiber upgrades the socket.
func TranscriptWebSocketMiddleware(access *transcriptaccess.Policy) fiber.Handler {
	return func(c *fiber.Ctx) error {
		roomName := c.Params("room")
		if err := access.Authorize(
			c.UserContext(),
			transcriptaccess.Scope{Room: roomName},
			c.Query("token"),
		); err != nil {
			return writeTranscriptAccessAuthorizationError(c, err)
		}
		if !websocket.IsWebSocketUpgrade(c) {
			return fiber.ErrUpgradeRequired
		}
		return c.Next()
	}
}

// ProviderTranscriptWebSocketMiddleware authenticates a room/provider-bound
// token before Fiber upgrades the provider-specific socket.
func ProviderTranscriptWebSocketMiddleware(access *transcriptaccess.Policy) fiber.Handler {
	return func(c *fiber.Ctx) error {
		roomName := c.Params("room")
		if err := access.Authorize(
			c.UserContext(),
			transcriptaccess.Scope{Room: roomName, Provider: c.Params("provider")},
			c.Query("token"),
		); err != nil {
			return writeTranscriptAccessAuthorizationError(c, err)
		}
		if !websocket.IsWebSocketUpgrade(c) {
			return fiber.ErrUpgradeRequired
		}
		return c.Next()
	}
}

func CaptionWebSocketMiddleware(access *transcriptaccess.Policy) fiber.Handler {
	return func(c *fiber.Ctx) error {
		err := access.Authorize(c.UserContext(), transcriptaccess.Scope{
			Room: c.Params("room"), Provider: c.Params("provider"), Purpose: transcriptaccess.FeedCaption,
		}, c.Query("token"))
		if err != nil {
			return writeTranscriptAccessAuthorizationError(c, err)
		}
		if !websocket.IsWebSocketUpgrade(c) {
			return fiber.ErrUpgradeRequired
		}
		return c.Next()
	}
}

func writeTranscriptAccessIssueError(c *fiber.Ctx, err error) error {
	switch {
	case errors.Is(err, transcriptaccess.ErrInvalidRoom):
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "room name must be 1-128 characters using letters, numbers, hyphens, or underscores",
		})
	case errors.Is(err, transcriptaccess.ErrInvalidProvider):
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "provider must be google, gemini, azure, or gpt-realtime-whisper",
		})
	case errors.Is(err, roomoperations.ErrRoomNotFound):
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Room not found"})
	case errors.Is(err, transcript.ErrTokenServiceDisabled):
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Transcript WebSocket links are not configured",
		})
	default:
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "Failed to issue transcript access"})
	}
}

func writeTranscriptAccessAuthorizationError(c *fiber.Ctx, err error) error {
	switch {
	case errors.Is(err, transcriptaccess.ErrInvalidRoom), errors.Is(err, transcriptaccess.ErrInvalidProvider):
		return writeTranscriptAccessIssueError(c, err)
	case errors.Is(err, roomoperations.ErrRoomNotFound):
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Room not found"})
	case errors.Is(err, transcript.ErrTokenServiceDisabled):
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "Transcript WebSocket links are not configured",
		})
	case errors.Is(err, transcript.ErrInvalidTranscriptToken):
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid transcript token"})
	default:
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "Failed to authorize transcript access"})
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

func HandleCaptionWebSocket(hub *transcript.Hub) func(*websocket.Conn) {
	return func(conn *websocket.Conn) {
		roomName, provider := conn.Params("room"), conn.Params("provider")
		subscription := hub.SubscribeCaption(roomName, provider)
		defer hub.UnsubscribeCaption(roomName, provider, subscription)
		defer conn.Close()

		const (
			pongWait  = 60 * time.Second
			pingEvery = 30 * time.Second
			writeWait = 10 * time.Second
		)
		_ = conn.SetReadDeadline(time.Now().Add(pongWait))
		conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(pongWait)) })
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
