package handlers

import (
	"thai-transcriber-backend/config"

	websocketFiber "github.com/gofiber/websocket/v2"
)

// HandleAzure - Stub implementation (native SDK not available)
func HandleAzure(conn *websocketFiber.Conn, cfg *config.Config) {
	logConnection("Azure")

	// Send error immediately - Azure requires native C SDK
	sendError(conn, "Azure", "Azure Speech SDK requires native C library installation. Not available in this build.", nil)

	defer logDisconnection("Azure")

	// Keep connection open briefly
	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			break
		}
	}
}
