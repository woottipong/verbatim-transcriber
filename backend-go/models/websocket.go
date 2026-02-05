package models

// Message represents a control message from the frontend.
// Used to start/stop transcription sessions.
type Message struct {
	Type       string `json:"type"`                 // "start" or "stop"
	APIKey     string `json:"apiKey,omitempty"`     // Optional API key override
	SampleRate int    `json:"sampleRate,omitempty"` // Audio sample rate from frontend
}

// TranscriptResponse represents a transcription result sent to the client.
type TranscriptResponse struct {
	Type    string  `json:"type"`
	Text    string  `json:"text"`
	IsFinal bool    `json:"isFinal"`
	Channel Channel `json:"channel"`
}

// Channel contains the list of recognition alternatives.
type Channel struct {
	Alternatives []Alternative `json:"alternatives"`
}

// Alternative represents a single recognition alternative with confidence score.
type Alternative struct {
	Transcript string  `json:"transcript"`
	Confidence float64 `json:"confidence"`
}

// ErrorResponse represents an error message sent to the client.
type ErrorResponse struct {
	Type  string `json:"type"`
	Error string `json:"error"`
}

// StatusResponse represents a status update sent to the client.
type StatusResponse struct {
	Type string `json:"type"`
}
