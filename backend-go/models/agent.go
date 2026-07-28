package models

// AgentStartRequest represents the request to start an ASR agent.
type AgentStartRequest struct {
	RoomName string `json:"roomName"`
	Provider string `json:"provider"` // "google", "gemini", "azure", or "gpt-realtime-whisper"
	Mode     string `json:"mode,omitempty"`
}

// AgentStopRequest represents the request to stop an ASR agent.
type AgentStopRequest struct {
	RoomName string `json:"roomName"`
	Provider string `json:"provider"`
}
