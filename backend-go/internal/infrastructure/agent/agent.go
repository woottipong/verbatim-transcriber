// Package agent provides a LiveKit room agent that captures audio from
// participants and performs real-time speech-to-text transcription.
//
// The agent connects to a LiveKit room, subscribes to audio tracks,
// decodes Opus audio, and sends it to ASR providers (Google, Gemini, or Azure)
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

// TranscriptSink receives the same normalized transcript messages that are
// published to the LiveKit data channel.
type TranscriptSink interface {
	Publish(room string, message TranscriptMessage)
}

const liveAudioBatchDuration = 40 * time.Millisecond

func audioBatchTargetBytes(sampleRate int, duration time.Duration) int {
	return sampleRate * 2 * int(duration) / int(time.Second)
}

func transcriptDeliveryReliable(_ bool) bool {
	// Transcript snapshots are small and every interim state is meaningful UI.
	// Reliable delivery prevents active drafts from disappearing on busy rooms.
	return true
}

// Agent handles audio transcription in a LiveKit room
type Agent struct {
	config            *config.Config
	room              *lksdk.Room
	asrProvider       domain.ASRProvider
	mu                sync.Mutex
	isRunning         bool
	cancel            context.CancelFunc
	preferredProvider string // "google", "gemini", "azure", or "" for auto
	roomName          string // store room name for status
	transcriptSink    TranscriptSink
}

// New creates a new LiveKit ASR Agent
// provider can be "google", "gemini", "azure", or "" for auto-detect
func New(cfg *config.Config, provider string, sinks ...TranscriptSink) *Agent {
	var sink TranscriptSink
	if len(sinks) > 0 {
		sink = sinks[0]
	}

	return &Agent{
		config:            cfg,
		preferredProvider: provider,
		transcriptSink:    sink,
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
	a.mu.Lock()
	if !a.isRunning {
		a.mu.Unlock()
		cancel()
		return fmt.Errorf("agent stopped before connecting")
	}
	a.cancel = cancel
	a.mu.Unlock()

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
		} else if a.config.HasGeminiKey() {
			identity = "agent-gemini"
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
		cancel()
		a.mu.Lock()
		a.isRunning = false
		a.cancel = nil
		a.mu.Unlock()
		return fmt.Errorf("failed to connect to room: %w", err)
	}

	a.mu.Lock()
	if !a.isRunning {
		a.mu.Unlock()
		cancel()
		room.Disconnect()
		return fmt.Errorf("agent stopped while connecting")
	}
	a.room = room
	a.mu.Unlock()

	// Note: Auto-subscribe is enabled by default in LiveKit
	// Tracks will be subscribed automatically via OnTrackSubscribed callback

	log.Println("✅ [LiveKit Agent] Connected and listening for audio")
	return nil
}

// Stop disconnects from the room
func (a *Agent) Stop() {
	a.mu.Lock()
	if !a.isRunning {
		a.mu.Unlock()
		return
	}
	cancel := a.cancel
	room := a.room
	provider := a.asrProvider
	a.cancel = nil
	a.room = nil
	a.asrProvider = nil
	a.isRunning = false
	a.mu.Unlock()

	if cancel != nil {
		cancel()
	}

	if room != nil {
		room.Disconnect()
	}

	if provider != nil {
		if err := provider.Stop(); err != nil {
			log.Printf("⚠️ [Agent] Failed to stop ASR provider: %v", err)
		}
	}

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
				ProjectID:             a.config.GoogleCloudProject,
				Location:              a.config.GoogleConfig.Location,
				Model:                 a.config.GoogleConfig.Model,
				SampleRate:            48000, // Google can handle 48kHz
				LanguageCode:          a.config.GoogleConfig.LanguageCode,
				EnableAutoPunctuation: a.config.GoogleConfig.EnableAutoPunctuation,
			})
			if err != nil {
				log.Printf("⚠️ [Agent] Failed to init Google provider: %v", err)
			}
		} else {
			log.Println("⚠️ [Agent] Google requested but no API key configured")
		}
	case "gemini":
		if a.config.HasGeminiKey() {
			provider, err = asr.NewGeminiProvider(ctx, asr.GeminiConfig{
				APIKey:             a.config.GeminiAPIKey,
				Model:              a.config.GeminiConfig.Model,
				LanguageCode:       a.config.GeminiConfig.LanguageCode,
				TargetLanguageCode: a.config.GeminiConfig.TargetLanguageCode,
				SampleRate:         a.config.GeminiConfig.SampleRate,
			})
			needsResample = true
			if err != nil {
				log.Printf("⚠️ [Agent] Failed to init Gemini provider: %v", err)
			}
		} else {
			log.Println("⚠️ [Agent] Gemini requested but no API key configured")
		}
	default:
		// Auto-detect: preserve the existing Google/Azure priority, then use Gemini.
		if a.config.HasGoogleKey() {
			provider, err = asr.NewGoogleProvider(ctx, asr.GoogleConfig{
				CredentialsFile:       a.config.GoogleApplicationCredentials,
				APIKey:                a.config.GoogleAPIKey,
				ProjectID:             a.config.GoogleCloudProject,
				Location:              a.config.GoogleConfig.Location,
				Model:                 a.config.GoogleConfig.Model,
				SampleRate:            48000,
				LanguageCode:          a.config.GoogleConfig.LanguageCode,
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
		if provider == nil && a.config.HasGeminiKey() {
			provider, err = asr.NewGeminiProvider(ctx, asr.GeminiConfig{
				APIKey:             a.config.GeminiAPIKey,
				Model:              a.config.GeminiConfig.Model,
				LanguageCode:       a.config.GeminiConfig.LanguageCode,
				TargetLanguageCode: a.config.GeminiConfig.TargetLanguageCode,
				SampleRate:         a.config.GeminiConfig.SampleRate,
			})
			needsResample = true
			if err != nil {
				log.Printf("⚠️ [Agent] Failed to init Gemini provider: %v", err)
			}
		}
	}

	if provider == nil {
		log.Println("❌ [Agent] No ASR provider available")
		return
	}

	log.Printf("🎯 [Agent] Using %s for transcription (resample: %v)", provider.Name(), needsResample)

	a.mu.Lock()
	if !a.isRunning {
		a.mu.Unlock()
		if err := provider.Stop(); err != nil {
			log.Printf("⚠️ [Agent] Failed to stop provider after agent shutdown: %v", err)
		}
		return
	}
	a.asrProvider = provider
	a.mu.Unlock()

	cleanupProvider, err := startProvider(ctx, provider)
	if err != nil {
		log.Printf("❌ [Agent] Failed to start ASR provider: %v", err)
		return
	}
	defer cleanupProvider()

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

	// Keep enough batching to avoid per-packet provider calls while limiting
	// capture-side latency to roughly two 20ms WebRTC audio packets.
	batchTargetBytes := audioBatchTargetBytes(provider.SampleRate(), liveAudioBatchDuration)
	audioBatch := make([]byte, 0, batchTargetBytes*2)

	for {
		select {
		case <-ctx.Done():
			// Flush remaining audio before exit
			if len(audioBatch) > 0 {
				if err := provider.SendAudio(audioBatch); err != nil {
					log.Printf("⚠️ [Agent] Failed to flush audio: %v", err)
				}
			}
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

		// Accumulate into batch
		audioBatch = append(audioBatch, pcmBytes...)

		// Send when batch reaches target size (~100ms of audio)
		if len(audioBatch) >= batchTargetBytes {
			if err := provider.SendAudio(audioBatch); err != nil {
				log.Printf("❌ [Agent] Error sending audio to ASR: %v", err)
				break
			}
			audioBatch = audioBatch[:0] // reset without reallocating
		}
	}

}

func startProvider(ctx context.Context, provider domain.ASRProvider) (func(), error) {
	if err := provider.Start(ctx); err != nil {
		if stopErr := provider.Stop(); stopErr != nil {
			log.Printf("⚠️ [Agent] Failed to clean up ASR provider after start error: %v", stopErr)
		}
		return nil, err
	}

	return func() {
		if err := provider.Stop(); err != nil {
			log.Printf("⚠️ [Agent] Failed to stop ASR provider: %v", err)
		}
	}, nil
}

func (a *Agent) handleTranscriptionResults(provider domain.ASRProvider, participant *lksdk.RemoteParticipant) {
	results := provider.Results()

	for result := range results {
		msg := newTranscriptMessage(result, provider.Name(), participant.Identity())

		// Convert to JSON
		data, err := json.Marshal(msg)
		if err != nil {
			log.Printf("❌ [Agent] Error marshaling transcript: %v", err)
			continue
		}

		if result.IsFinal {
			log.Printf("📝 [%s] %s", participant.Identity(), msg.Text)
		} else {
			log.Printf("🟡 [Agent] INTERIM from %s (provider=%s, reliable=%t): %q",
				participant.Identity(),
				provider.Name(),
				transcriptDeliveryReliable(false),
				msg.Text,
			)
		}

		// Publish via Data Channel to all participants
		if err := a.publishTranscript(data, transcriptDeliveryReliable(result.IsFinal)); err != nil {
			log.Printf("❌ [Agent] Error publishing transcript: %v", err)
		}

		if a.transcriptSink != nil {
			a.transcriptSink.Publish(a.GetRoom(), msg)
		}
	}
}

func newTranscriptMessage(result domain.TranscriptResult, provider, speaker string) TranscriptMessage {
	return TranscriptMessage{
		Type:       "transcript",
		Text:       domain.NormalizeThaiSpacing(result.Text),
		IsFinal:    result.IsFinal,
		Confidence: result.Confidence,
		Provider:   provider,
		Timestamp:  time.Now().UnixMilli(),
		Speaker:    speaker,
	}
}

func (a *Agent) publishTranscript(data []byte, reliable bool) error {
	a.mu.Lock()
	room := a.room
	a.mu.Unlock()
	if room == nil || room.LocalParticipant == nil {
		log.Println("⚠️ [Agent] Cannot publish - room or local participant is nil")
		return nil
	}

	return room.LocalParticipant.PublishDataPacket(
		lksdk.UserData(data),
		lksdk.WithDataPublishReliable(reliable),
	)
}
