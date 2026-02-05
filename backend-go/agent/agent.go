package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"thai-transcriber-backend/agent/asr"
	"thai-transcriber-backend/config"

	lksdk "github.com/livekit/server-sdk-go/v2"
	"github.com/pion/webrtc/v4"
	"gopkg.in/hraban/opus.v2"
)

// TranscriptMessage represents a transcript sent to clients via Data Channel
type TranscriptMessage struct {
	Type       string  `json:"type"`
	Text       string  `json:"text"`
	IsFinal    bool    `json:"isFinal"`
	Confidence float64 `json:"confidence,omitempty"`
	Provider   string  `json:"provider"`
	Timestamp  int64   `json:"timestamp"`
	Speaker    string  `json:"speaker,omitempty"`
}

// Agent handles audio transcription in a LiveKit room
type Agent struct {
	config      *config.Config
	room        *lksdk.Room
	asrProvider asr.Provider
	mu          sync.Mutex
	isRunning   bool
	cancel      context.CancelFunc
}

// New creates a new LiveKit ASR Agent
func New(cfg *config.Config) *Agent {
	return &Agent{
		config: cfg,
	}
}

// Start connects to the LiveKit room and begins processing audio
func (a *Agent) Start(ctx context.Context, roomName string) error {
	a.mu.Lock()
	if a.isRunning {
		a.mu.Unlock()
		return fmt.Errorf("agent already running")
	}
	a.isRunning = true
	a.mu.Unlock()

	ctx, cancel := context.WithCancel(ctx)
	a.cancel = cancel

	log.Println("🚀 [LiveKit Agent] Starting...")
	log.Printf("📡 LiveKit URL: %s", a.config.LiveKitURL)
	log.Printf("🏠 Room: %s", roomName)

	// Create room callback
	roomCallback := &lksdk.RoomCallback{
		ParticipantCallback: lksdk.ParticipantCallback{
			OnTrackSubscribed: func(track *webrtc.TrackRemote, publication *lksdk.RemoteTrackPublication, participant *lksdk.RemoteParticipant) {
				if track.Kind() == webrtc.RTPCodecTypeAudio {
					log.Printf("🎤 [Agent] Subscribed to audio track from %s", participant.Identity())
					go a.processAudioTrack(ctx, track, participant)
				}
			},
			OnTrackUnsubscribed: func(track *webrtc.TrackRemote, publication *lksdk.RemoteTrackPublication, participant *lksdk.RemoteParticipant) {
				log.Printf("🔇 [Agent] Unsubscribed from track of %s", participant.Identity())
			},
		},
		OnParticipantConnected: func(participant *lksdk.RemoteParticipant) {
			log.Printf("👤 [Agent] Participant joined: %s", participant.Identity())
		},
		OnParticipantDisconnected: func(participant *lksdk.RemoteParticipant) {
			log.Printf("👋 [Agent] Participant left: %s", participant.Identity())
		},
		OnDisconnected: func() {
			log.Println("🔌 [Agent] Disconnected from room")
		},
		OnReconnecting: func() {
			log.Println("🔄 [Agent] Reconnecting to room...")
		},
		OnReconnected: func() {
			log.Println("✅ [Agent] Reconnected to room")
		},
	}

	// Connect to room
	room, err := lksdk.ConnectToRoom(
		a.config.LiveKitURL,
		lksdk.ConnectInfo{
			APIKey:              a.config.LiveKitAPIKey,
			APISecret:           a.config.LiveKitAPISecret,
			RoomName:            roomName,
			ParticipantIdentity: "asr-agent",
		},
		roomCallback,
	)
	if err != nil {
		a.mu.Lock()
		a.isRunning = false
		a.mu.Unlock()
		return fmt.Errorf("failed to connect to room: %w", err)
	}

	a.room = room

	// Note: Auto-subscribe is enabled by default in LiveKit
	// Tracks will be subscribed automatically via OnTrackSubscribed callback

	log.Println("✅ [LiveKit Agent] Connected and listening for audio")
	return nil
}

// Stop disconnects from the room
func (a *Agent) Stop() {
	a.mu.Lock()
	defer a.mu.Unlock()

	if !a.isRunning {
		return
	}

	if a.cancel != nil {
		a.cancel()
	}

	if a.room != nil {
		a.room.Disconnect()
	}

	if a.asrProvider != nil {
		a.asrProvider.Stop()
	}

	a.isRunning = false
	log.Println("🛑 [LiveKit Agent] Stopped")
}

// IsRunning returns whether the agent is running
func (a *Agent) IsRunning() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.isRunning
}

func (a *Agent) processAudioTrack(ctx context.Context, track *webrtc.TrackRemote, participant *lksdk.RemoteParticipant) {
	// Determine which ASR provider to use
	var provider asr.Provider
	var err error

	// Try Google first, then Azure
	if a.config.HasGoogleKey() {
		provider, err = asr.NewGoogleProvider(ctx, asr.GoogleConfig{
			CredentialsFile: a.config.GoogleApplicationCredentials,
			APIKey:          a.config.GoogleAPIKey,
			SampleRate:      48000, // WebRTC typically uses 48kHz
		})
		if err != nil {
			log.Printf("⚠️ [Agent] Failed to init Google provider: %v", err)
		}
	}

	if provider == nil && a.config.HasAzureKey() {
		provider, err = asr.NewAzureProvider(ctx, asr.AzureConfig{
			SubscriptionKey: a.config.AzureSubscriptionKey,
			Region:          a.config.AzureRegion,
			SampleRate:      16000, // Azure prefers 16kHz
		})
		if err != nil {
			log.Printf("⚠️ [Agent] Failed to init Azure provider: %v", err)
		}
	}

	if provider == nil {
		log.Println("❌ [Agent] No ASR provider available")
		return
	}

	log.Printf("🎯 [Agent] Using %s for transcription", provider.Name())

	a.mu.Lock()
	a.asrProvider = provider
	a.mu.Unlock()

	// Start ASR provider
	if err := provider.Start(ctx); err != nil {
		log.Printf("❌ [Agent] Failed to start ASR provider: %v", err)
		return
	}

	// Handle transcription results
	go a.handleTranscriptionResults(provider, participant)

	// Read audio samples and send to ASR
	// Create Opus decoder using hraban/opus (CGO binding)
	// WebRTC typically uses 48kHz stereo, but we'll decode to mono
	opusDecoder, err := opus.NewDecoder(48000, 1) // 48kHz, mono
	if err != nil {
		log.Printf("❌ [Agent] Failed to create Opus decoder: %v", err)
		return
	}

	// PCM buffer for decoded audio (max 120ms frame at 48kHz mono = 5760 samples)
	pcmBuffer := make([]int16, 5760)

	log.Println("🎧 [Agent] Starting audio processing loop...")

	packetCount := 0
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		// Read RTP packet
		pkt, _, err := track.ReadRTP()
		if err != nil {
			log.Printf("❌ [Agent] Error reading RTP packet: %v", err)
			break
		}

		// Decode Opus to PCM
		opusData := pkt.Payload
		if len(opusData) == 0 {
			continue
		}

		packetCount++
		if packetCount%100 == 1 {
			log.Printf("📦 [Agent] Packet #%d, Opus size: %d bytes", packetCount, len(opusData))
		}

		// Decode Opus to PCM int16
		samplesDecoded, err := opusDecoder.Decode(opusData, pcmBuffer)
		if err != nil {
			log.Printf("⚠️ [Agent] Opus decode error: %v", err)
			continue
		}

		if samplesDecoded == 0 {
			continue
		}

		if packetCount%100 == 1 {
			log.Printf("🔊 [Agent] Decoded %d samples (%d bytes PCM)", samplesDecoded, samplesDecoded*2)
		}

		// Convert int16 PCM to bytes (Little Endian) for ASR
		pcmBytes := make([]byte, samplesDecoded*2)
		for i := 0; i < samplesDecoded; i++ {
			pcmBytes[i*2] = byte(pcmBuffer[i])
			pcmBytes[i*2+1] = byte(pcmBuffer[i] >> 8)
		}

		// Send PCM to ASR provider
		if err := provider.SendAudio(pcmBytes); err != nil {
			log.Printf("❌ [Agent] Error sending audio to ASR: %v", err)
			break
		}
	}

	provider.Stop()
}

func (a *Agent) handleTranscriptionResults(provider asr.Provider, participant *lksdk.RemoteParticipant) {
	results := provider.Results()

	for result := range results {
		// Create transcript message
		msg := TranscriptMessage{
			Type:       "transcript",
			Text:       result.Text,
			IsFinal:    result.IsFinal,
			Confidence: result.Confidence,
			Provider:   provider.Name(),
			Timestamp:  time.Now().UnixMilli(),
			Speaker:    participant.Identity(),
		}

		// Convert to JSON
		data, err := json.Marshal(msg)
		if err != nil {
			log.Printf("❌ [Agent] Error marshaling transcript: %v", err)
			continue
		}

		// Log transcript
		if result.IsFinal {
			log.Printf("📝 [%s] Final: %s", participant.Identity(), result.Text)
		} else {
			log.Printf("💭 [%s] Interim: %s", participant.Identity(), result.Text)
		}

		// Publish via Data Channel to all participants
		if err := a.publishTranscript(data); err != nil {
			log.Printf("❌ [Agent] Error publishing transcript: %v", err)
		}
	}
}

func (a *Agent) publishTranscript(data []byte) error {
	if a.room == nil || a.room.LocalParticipant == nil {
		return nil
	}

	// Publish to all participants via reliable data channel
	return a.room.LocalParticipant.PublishData(data, lksdk.WithDataPublishReliable(true))
}
