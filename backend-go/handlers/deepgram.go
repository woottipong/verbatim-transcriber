package handlers

import (
	"encoding/json"
	"thai-transcriber-backend/config"

	websocketFiber "github.com/gofiber/websocket/v2"
)

func HandleDeepgram(conn *websocketFiber.Conn, cfg *config.Config) {
	logConnection("Deepgram")
	sendConnected(conn)

	// TODO: Implement Deepgram WebSocket client
	// The Deepgram Go SDK API is still unstable, recommend using REST API or direct WebSocket

	defer logDisconnection("Deepgram")

	for {
		msgType, message, err := conn.ReadMessage()
		if err != nil {
			sendError(conn, "Deepgram", "Read error", err)
			break
		}

		// Handle control messages (JSON)
		if msgType == websocketFiber.TextMessage {
			var msg Message
			if err := json.Unmarshal(message, &msg); err == nil {
				switch msg.Type {
				case "start":
					logStarting("Deepgram")
					sendError(conn, "Deepgram", "Deepgram Go implementation not ready. Please use Node.js backend", nil)

				case "stop":
					logStopping("Deepgram")
					sendStopped(conn)
				}
			}
		}
	}
}
