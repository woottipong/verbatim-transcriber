package models

// RoomCreateRequest represents a request to create a named LiveKit room.
type RoomCreateRequest struct {
	Name string `json:"name"`
}

// TranscriptTokenResponse represents a room-scoped external transcript link.
type TranscriptTokenResponse struct {
	Token        string `json:"token"`
	ExpiresAt    string `json:"expiresAt"`
	WebSocketURL string `json:"websocketUrl"`
	Provider     string `json:"provider,omitempty"`
}

// TokenRequest represents the request body for LiveKit token generation.
type TokenRequest struct {
	Identity string `json:"identity"`
	RoomName string `json:"roomName"`
	// Optional: specify participant permissions
	CanPublish     *bool `json:"canPublish,omitempty"`
	CanSubscribe   *bool `json:"canSubscribe,omitempty"`
	CanPublishData *bool `json:"canPublishData,omitempty"`
}

// ViewerTokenRequest is intentionally permission-free. Viewer grants are
// server-owned and always subscribe-only.
type ViewerTokenRequest struct {
	RoomName string `json:"roomName"`
}

// TokenResponse represents the response with token and connection info.
type TokenResponse struct {
	Token string `json:"token"`
	WsURL string `json:"wsUrl"`
}

type CaptionDeskTokenResponse struct {
	Token    string `json:"token"`
	WsURL    string `json:"wsUrl"`
	Identity string `json:"identity"`
	Room     string `json:"room"`
	Provider string `json:"provider"`
}

// RoomInfo represents LiveKit room information.
type RoomInfo struct {
	Name            string            `json:"name"`
	NumParticipants int               `json:"numParticipants"`
	Participants    []ParticipantInfo `json:"participants,omitempty"`
	CreationTime    int64             `json:"creationTime"`
}

// ParticipantInfo represents a participant in a LiveKit room.
type ParticipantInfo struct {
	Identity string `json:"identity"`
	Name     string `json:"name"`
	IsAgent  bool   `json:"isAgent"`
	State    string `json:"state"`
}
