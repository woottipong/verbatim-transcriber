// Package agent provides a LiveKit room agent that captures audio from
// participants and performs real-time speech-to-text transcription.
//
// The agent connects to a LiveKit room, subscribes to audio tracks,
// decodes Opus audio, and sends it to ASR providers (Google or Azure)
// for transcription. Results are published back to the room via Data Channel.
package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"thai-transcriber-backend/config"
	"thai-transcriber-backend/internal/domain"
	"thai-transcriber-backend/internal/infrastructure/asr"

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
	config            *config.Config
	room              *lksdk.Room
	asrProvider       domain.ASRProvider
	mu                sync.Mutex
	isRunning         bool
	cancel            context.CancelFunc
	preferredProvider string // "google", "azure", or "" for auto
	roomName          string // store room name for status
}

// New creates a new LiveKit ASR Agent
// provider can be "google", "azure", or "" for auto-detect
func New(cfg *config.Config, provider string) *Agent {
	return &Agent{
		config:            cfg,
		preferredProvider: provider,
	}
}

// GetProvider returns the provider name
func (a *Agent) GetProvider() string {
	return a.preferredProvider
}

// GetRoom returns the room name
func (a *Agent) GetRoom() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.roomName
}

// Start connects to the LiveKit room and begins processing audio
func (a *Agent) Start(ctx context.Context, roomName string) error {
	a.mu.Lock()
	if a.isRunning {
		a.mu.Unlock()
		return fmt.Errorf("agent already running")
	}
	a.isRunning = true
	a.roomName = roomName
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
	// Generate identity with provider name for frontend display
	identity := fmt.Sprintf("agent-%s", a.preferredProvider)
	if a.preferredProvider == "" {
		// Auto-detect: will be determined later, use generic identity
		if a.config.HasGoogleKey() {
			identity = "agent-google"
		} else if a.config.HasAzureKey() {
			identity = "agent-azure"
		} else {
			identity = "agent-unknown"
		}
	}

	room, err := lksdk.ConnectToRoom(
		a.config.LiveKitURL,
		lksdk.ConnectInfo{
			APIKey:              a.config.LiveKitAPIKey,
			APISecret:           a.config.LiveKitAPISecret,
			RoomName:            roomName,
			ParticipantIdentity: identity,
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
	// Determine which ASR provider to use based on preference
	var provider domain.ASRProvider
	var err error
	var needsResample bool // Azure needs 16kHz, WebRTC sends 48kHz

	// Check preferred provider first
	switch a.preferredProvider {
	case "azure":
		if a.config.HasAzureKey() {
			provider, err = asr.NewAzureProvider(ctx, asr.AzureConfig{
				SubscriptionKey:                a.config.AzureSubscriptionKey,
				Region:                         a.config.AzureRegion,
				SampleRate:                     16000, // Azure uses 16kHz
				SegmentationSilenceTimeout:     a.config.AzureConfig.SegmentationSilenceTimeout,
				SegmentationMaxSilenceDuration: a.config.AzureConfig.SegmentationMaxSilenceDuration,
			})
			needsResample = true
			if err != nil {
				log.Printf("⚠️ [Agent] Failed to init Azure provider: %v", err)
			}
		} else {
			log.Println("⚠️ [Agent] Azure requested but no API key configured")
		}
	case "google":
		if a.config.HasGoogleKey() {
			provider, err = asr.NewGoogleProvider(ctx, asr.GoogleConfig{
				CredentialsFile:       a.config.GoogleApplicationCredentials,
				APIKey:                a.config.GoogleAPIKey,
				SampleRate:            48000, // Google can handle 48kHz
				EnableAutoPunctuation: a.config.GoogleConfig.EnableAutoPunctuation,
			})
			if err != nil {
				log.Printf("⚠️ [Agent] Failed to init Google provider: %v", err)
			}
		} else {
			log.Println("⚠️ [Agent] Google requested but no API key configured")
		}
	default:
		// Auto-detect: try Google first, then Azure
		if a.config.HasGoogleKey() {
			provider, err = asr.NewGoogleProvider(ctx, asr.GoogleConfig{
				CredentialsFile:       a.config.GoogleApplicationCredentials,
				APIKey:                a.config.GoogleAPIKey,
				SampleRate:            48000,
				EnableAutoPunctuation: a.config.GoogleConfig.EnableAutoPunctuation,
			})
			if err != nil {
				log.Printf("⚠️ [Agent] Failed to init Google provider: %v", err)
				provider = nil
			}
		}
		if provider == nil && a.config.HasAzureKey() {
			provider, err = asr.NewAzureProvider(ctx, asr.AzureConfig{
				SubscriptionKey:                a.config.AzureSubscriptionKey,
				Region:                         a.config.AzureRegion,
				SampleRate:                     16000,
				SegmentationSilenceTimeout:     a.config.AzureConfig.SegmentationSilenceTimeout,
				SegmentationMaxSilenceDuration: a.config.AzureConfig.SegmentationMaxSilenceDuration,
			})
			needsResample = true
			if err != nil {
				log.Printf("⚠️ [Agent] Failed to init Azure provider: %v", err)
			}
		}
	}

	if provider == nil {
		log.Println("❌ [Agent] No ASR provider available")
		return
	}

	log.Printf("🎯 [Agent] Using %s for transcription (resample: %v)", provider.Name(), needsResample)

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

		// Decode Opus to PCM int16
		samplesDecoded, err := opusDecoder.Decode(opusData, pcmBuffer)
		if err != nil {
			log.Printf("⚠️ [Agent] Opus decode error: %v", err)
			continue
		}

		if samplesDecoded == 0 {
			continue
		}

		var pcmBytes []byte

		if needsResample {
			// Resample from 48kHz to 16kHz (3:1 decimation)
			resampledSamples := samplesDecoded / 3
			pcmBytes = make([]byte, resampledSamples*2)
			for i := 0; i < resampledSamples; i++ {
				// Simple decimation: take every 3rd sample
				sample := pcmBuffer[i*3]
				pcmBytes[i*2] = byte(sample)
				pcmBytes[i*2+1] = byte(sample >> 8)
			}
		} else {
			// No resampling needed (Google uses 48kHz)
			pcmBytes = make([]byte, samplesDecoded*2)
			for i := 0; i < samplesDecoded; i++ {
				pcmBytes[i*2] = byte(pcmBuffer[i])
				pcmBytes[i*2+1] = byte(pcmBuffer[i] >> 8)
			}
		}

		// Send PCM to ASR provider
		if err := provider.SendAudio(pcmBytes); err != nil {
			log.Printf("❌ [Agent] Error sending audio to ASR: %v", err)
			break
		}
	}

	provider.Stop()
}

func (a *Agent) handleTranscriptionResults(provider domain.ASRProvider, participant *lksdk.RemoteParticipant) {
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

		// Log final transcripts only
		if result.IsFinal {
			log.Printf("📝 [%s] %s", participant.Identity(), result.Text)
		}

		// Publish via Data Channel to all participants
		if err := a.publishTranscript(data); err != nil {
			log.Printf("❌ [Agent] Error publishing transcript: %v", err)
		}
	}
}

func (a *Agent) publishTranscript(data []byte) error {
	if a.room == nil || a.room.LocalParticipant == nil {
		log.Println("⚠️ [Agent] Cannot publish - room or local participant is nil")
		return nil
	}

	// Publish to all participants via reliable data channel
	return a.room.LocalParticipant.PublishData(data, lksdk.WithDataPublishReliable(true))
}
