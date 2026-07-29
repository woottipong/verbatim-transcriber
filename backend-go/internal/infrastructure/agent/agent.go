// Package agent provides a LiveKit room agent that captures audio from
// participants and performs real-time speech-to-text transcription.
//
// The agent connects to a LiveKit room, subscribes to audio tracks,
// decodes Opus audio, and sends it to ASR providers (Google, Gemini, Azure, or OpenAI Realtime Whisper)
// for transcription. Results are published back to the room via Data Channel.
package agent

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"thai-transcriber-backend/config"
	"thai-transcriber-backend/internal/application/captionmoderation"
	"thai-transcriber-backend/internal/domain"
	"thai-transcriber-backend/internal/infrastructure/asr"

	lksdk "github.com/livekit/server-sdk-go/v2"
	"github.com/pion/webrtc/v4"
	"gopkg.in/hraban/opus.v2"
)

// TranscriptMessage is the normalized internal transcript shared with sinks.
// The LiveKit data-channel contract is intentionally narrower; see
// dataChannelTranscript.
type TranscriptMessage struct {
	Type         string                `json:"type"`
	Text         string                `json:"text"`
	IsFinal      bool                  `json:"isFinal"`
	Confidence   float64               `json:"confidence,omitempty"`
	Provider     string                `json:"provider"`
	Timestamp    int64                 `json:"timestamp"`
	Speaker      string                `json:"speaker,omitempty"`
	Role         domain.TranscriptRole `json:"role,omitempty"`
	LanguageCode string                `json:"languageCode,omitempty"`
	TurnID       string                `json:"turnId,omitempty"`
	SegmentID    string                `json:"segmentId,omitempty"`
}

type dataChannelTranscript struct {
	Type          string                `json:"type"`
	Text          string                `json:"text"`
	IsFinal       bool                  `json:"isFinal"`
	Provider      string                `json:"provider"`
	Timestamp     int64                 `json:"timestamp"`
	Sequence      uint64                `json:"sequence"`
	Role          domain.TranscriptRole `json:"role,omitempty"`
	LanguageCode  string                `json:"languageCode,omitempty"`
	TurnID        string                `json:"turnId,omitempty"`
	SegmentID     string                `json:"segmentId,omitempty"`
	PublicationID string                `json:"publicationId,omitempty"`
}

// TranscriptSink receives the complete normalized transcript used by
// server-side feeds. Browser packets use the narrower dataChannelTranscript.
type TranscriptSink interface {
	Publish(room string, message TranscriptMessage)
}

type CaptionSink interface {
	PublishCaption(room, text string)
}

type dataPublishFunc func(payload []byte, topic string, reliable bool, destinations []string) error

const liveAudioBatchDuration = 40 * time.Millisecond
const maxLoggedTranscriptRunes = 160

func audioBatchTargetBytes(sampleRate int, duration time.Duration) int {
	return sampleRate * 2 * int(duration) / int(time.Second)
}

func resamplePCM16(samples []int16, sourceRate, targetRate int) []byte {
	if len(samples) == 0 || sourceRate <= 0 || targetRate <= 0 {
		return nil
	}
	if sourceRate == targetRate {
		out := make([]byte, len(samples)*2)
		for i, sample := range samples {
			out[i*2] = byte(sample)
			out[i*2+1] = byte(sample >> 8)
		}
		return out
	}
	if targetRate > sourceRate {
		// The LiveKit decoder currently produces 48 kHz audio. Keep this
		// helper conservative rather than inventing samples for an unsupported
		// provider rate.
		return nil
	}
	outputSamples := len(samples) * targetRate / sourceRate
	out := make([]byte, outputSamples*2)
	for i := 0; i < outputSamples; i++ {
		// Average each source interval before decimation so out-of-band energy
		// is attenuated instead of being folded back into the speech band.
		start := i * sourceRate / targetRate
		end := (i + 1) * sourceRate / targetRate
		if end <= start {
			end = start + 1
		}
		if end > len(samples) {
			end = len(samples)
		}
		var sum int64
		for _, sample := range samples[start:end] {
			sum += int64(sample)
		}
		sample := int16(sum / int64(end-start))
		out[i*2] = byte(sample)
		out[i*2+1] = byte(sample >> 8)
	}
	return out
}

func transcriptLogValue(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "-"
	}

	quoted := strconv.QuoteToGraphic(trimmed)
	return quoted[1 : len(quoted)-1]
}

func formatTranscriptLog(message TranscriptMessage) string {
	state := "interim"
	marker := "🟡"
	if message.IsFinal {
		state = "final"
		marker = "🟢"
	}

	role := message.Role
	if role == "" {
		role = domain.TranscriptRoleSource
	}
	textRunes := []rune(message.Text)
	line := fmt.Sprintf(
		"%s [Transcript] state=%s provider=%s role=%s turn=%s lang=%s speaker=%s chars=%d",
		marker,
		state,
		transcriptLogValue(message.Provider),
		role,
		transcriptLogValue(message.TurnID),
		transcriptLogValue(message.LanguageCode),
		transcriptLogValue(message.Speaker),
		len(textRunes),
	)

	logText := message.Text
	if len(textRunes) > maxLoggedTranscriptRunes {
		logText = string(textRunes[:maxLoggedTranscriptRunes]) + "…"
	}
	return fmt.Sprintf("%s text=%q", line, logText)
}

// Agent handles audio transcription in a LiveKit room
type Agent struct {
	config             *config.Config
	room               *lksdk.Room
	asrProvider        domain.ASRProvider
	activeTrackID      string
	pendingTrackID     string
	trackChanged       chan struct{}
	transcriptSequence uint64
	mu                 sync.Mutex
	isRunning          bool
	stopRequested      bool
	cancel             context.CancelFunc
	preferredProvider  string // "google", "gemini", "azure", "gpt-realtime-whisper", or "" for auto
	roomName           string // store room name for status
	transcriptSink     TranscriptSink
	captionSink        CaptionSink
	moderator          *captionmoderation.Moderator
	captionOperatorID  string
	moderationDraftID  string
	dataPublisher      dataPublishFunc
}

// New creates a new LiveKit ASR Agent
// provider can be "google", "gemini", "azure", "gpt-realtime-whisper", or "" for auto-detect
func New(
	cfg *config.Config,
	provider string,
	sinks ...TranscriptSink,
) *Agent {
	var sink TranscriptSink
	var captionSink CaptionSink
	if len(sinks) > 0 {
		sink = sinks[0]
		captionSink, _ = sinks[0].(CaptionSink)
	}
	return &Agent{
		config:            cfg,
		preferredProvider: provider,
		transcriptSink:    sink,
		captionSink:       captionSink,
		moderator:         captionmoderation.New(provider, time.Now),
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
	if a.stopRequested {
		a.mu.Unlock()
		return fmt.Errorf("agent was stopped before connecting")
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
			OnDataPacket: func(packet lksdk.DataPacket, params lksdk.DataReceiveParams) {
				userPacket, ok := packet.(*lksdk.UserDataPacket)
				if !ok || userPacket.Topic != CaptionCommandTopic || params.Sender == nil {
					return
				}
				payload := append([]byte(nil), userPacket.Payload...)
				identity := params.SenderIdentity
				metadata := params.Sender.Metadata()
				// LiveKit delivers reliable packets in order. Process Caption
				// commands synchronously so separate goroutines cannot reorder
				// consecutive operator releases.
				a.handleCaptionPacket(payload, identity, metadata)
			},
		},
		OnParticipantConnected: func(participant *lksdk.RemoteParticipant) {
			log.Printf("👤 [Agent] Participant joined: %s", participant.Identity())
			a.registerCaptionOperator(participant)
		},
		OnParticipantDisconnected: func(participant *lksdk.RemoteParticipant) {
			log.Printf("👋 [Agent] Participant left: %s", participant.Identity())
			a.clearCaptionOperator(participant.Identity())
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
		} else if a.config.HasOpenAITranscriptionKey() {
			identity = "agent-gpt-realtime-whisper"
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

	for _, participant := range room.GetRemoteParticipants() {
		a.registerCaptionOperator(participant)
	}

	// Note: Auto-subscribe is enabled by default in LiveKit
	// Tracks will be subscribed automatically via OnTrackSubscribed callback

	log.Println("✅ [LiveKit Agent] Connected and listening for audio")
	return nil
}

func (a *Agent) registerCaptionOperator(participant *lksdk.RemoteParticipant) {
	if participant == nil ||
		!a.isAuthorizedCaptionOperator(participant.Metadata(), a.preferredProvider) {
		return
	}
	log.Printf("✍️ [Caption] Operator connected for provider=%s", a.preferredProvider)
	a.subscribeCaptionOperator(participant.Identity(), captionCommandEnvelope{
		Type:      captionSubscribeType,
		RequestID: "participant-connected",
		Provider:  a.preferredProvider,
	})
}

// Stop disconnects from the room
func (a *Agent) Stop() {
	a.mu.Lock()
	if !a.isRunning {
		a.stopRequested = true
		a.mu.Unlock()
		return
	}
	a.stopRequested = true
	cancel := a.cancel
	room := a.room
	provider := a.asrProvider
	a.cancel = nil
	a.room = nil
	a.asrProvider = nil
	a.activeTrackID = ""
	a.pendingTrackID = ""
	a.notifyTrackWaitersLocked()
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
	trackID := track.ID()
	if !a.waitForAudioTrack(ctx, trackID) {
		return
	}
	defer a.releaseAudioTrack(trackID)

	// Determine which ASR provider to use based on preference
	var provider domain.ASRProvider
	var err error
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
			if err != nil {
				log.Printf("⚠️ [Agent] Failed to init Gemini provider: %v", err)
			}
		} else {
			log.Println("⚠️ [Agent] Gemini requested but no API key configured")
		}
	case "gpt-realtime-whisper":
		if a.config.HasOpenAITranscriptionKey() {
			provider, err = asr.NewOpenAITranscriptionProvider(ctx, asr.OpenAITranscriptionConfig{
				APIKey:       a.config.OpenAIAPIKey,
				LanguageCode: a.config.OpenAIConfig.LanguageCode,
				SampleRate:   a.config.OpenAIConfig.SampleRate,
			})
			if err != nil {
				log.Printf("⚠️ [Agent] Failed to init OpenAI Realtime Whisper provider: %v", err)
			}
		} else {
			log.Println("⚠️ [Agent] OpenAI Realtime Whisper requested but no API key configured")
		}
	default:
		// Auto-detect: preserve the existing Google/Azure/Gemini priority, then use OpenAI Realtime Whisper.
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
			if err != nil {
				log.Printf("⚠️ [Agent] Failed to init Gemini provider: %v", err)
			}
		}
		if provider == nil && a.config.HasOpenAITranscriptionKey() {
			provider, err = asr.NewOpenAITranscriptionProvider(ctx, asr.OpenAITranscriptionConfig{
				APIKey:       a.config.OpenAIAPIKey,
				LanguageCode: a.config.OpenAIConfig.LanguageCode,
				SampleRate:   a.config.OpenAIConfig.SampleRate,
			})
			if err != nil {
				log.Printf("⚠️ [Agent] Failed to init OpenAI Realtime Whisper provider: %v", err)
			}
		}
	}

	if provider == nil {
		log.Println("❌ [Agent] No ASR provider available")
		return
	}

	targetSampleRate := provider.SampleRate()
	log.Printf("🎯 [Agent] Using %s for transcription (input sample rate: %d Hz)", provider.Name(), targetSampleRate)

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
		a.stopAfterProviderTermination(provider, err)
		return
	}
	defer func() {
		cleanupProvider()
		a.releaseTrackProvider(provider)
	}()
	log.Printf("✅ [Agent] ASR provider started: %s", provider.Name())

	// Handle transcription results
	go a.handleTranscriptionResults(provider, participant.Identity())

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
	loggedDecodedAudio := false
	loggedSentAudio := false

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
		if !loggedDecodedAudio {
			loggedDecodedAudio = true
			log.Printf("🎙️ [Agent] First audio frame decoded: samples=%d pcm_bytes=%d provider_rate=%d", samplesDecoded, samplesDecoded*2, targetSampleRate)
		}

		var pcmBytes []byte

		pcmBytes = resamplePCM16(pcmBuffer[:samplesDecoded], 48000, targetSampleRate)

		// Accumulate into batch
		audioBatch = append(audioBatch, pcmBytes...)

		// Send when batch reaches target size (~100ms of audio)
		if len(audioBatch) >= batchTargetBytes {
			if !loggedSentAudio {
				loggedSentAudio = true
				log.Printf("📤 [Agent] First audio batch to %s: bytes=%d", provider.Name(), len(audioBatch))
			}
			if err := provider.SendAudio(audioBatch); err != nil {
				log.Printf("❌ [Agent] Error sending audio to ASR: %v", err)
				break
			}
			audioBatch = audioBatch[:0] // reset without reallocating
		}
	}

}

func (a *Agent) waitForAudioTrack(ctx context.Context, trackID string) bool {
	registered := false
	for {
		a.mu.Lock()
		if !a.isRunning || a.stopRequested {
			a.mu.Unlock()
			return false
		}
		if registered && a.pendingTrackID != trackID {
			a.mu.Unlock()
			return false
		}
		if a.activeTrackID == "" && a.asrProvider == nil {
			a.activeTrackID = trackID
			if a.pendingTrackID == trackID {
				a.pendingTrackID = ""
			}
			a.mu.Unlock()
			return true
		}

		if !registered {
			a.pendingTrackID = trackID
			a.notifyTrackWaitersLocked()
			registered = true
		}
		wait := a.trackChanged
		if wait == nil {
			wait = make(chan struct{})
			a.trackChanged = wait
		}
		a.mu.Unlock()

		select {
		case <-ctx.Done():
			a.clearPendingAudioTrack(trackID)
			return false
		case <-wait:
		}
	}
}

func (a *Agent) releaseAudioTrack(trackID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.activeTrackID == trackID {
		a.activeTrackID = ""
		a.notifyTrackWaitersLocked()
	}
}

func (a *Agent) clearPendingAudioTrack(trackID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.pendingTrackID == trackID {
		a.pendingTrackID = ""
	}
}

func (a *Agent) notifyTrackWaitersLocked() {
	if a.trackChanged != nil {
		close(a.trackChanged)
		a.trackChanged = nil
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

func (a *Agent) handleTranscriptionResults(provider domain.ASRProvider, speaker string) {
	results := provider.Results()

	for result := range results {
		msg := newTranscriptMessage(result, provider.Name(), speaker)
		log.Print(formatTranscriptLog(msg))
		a.handleTranscriptMessage(msg)
	}

	if providerErr := provider.Err(); providerErr != nil {
		a.stopAfterProviderTermination(provider, providerErr)
		return
	}

	if a.releaseTrackProvider(provider) {
		log.Printf("ℹ️ [Agent] ASR provider %s stopped with its audio track; agent remains in room", provider.Name())
	}
}

func (a *Agent) releaseTrackProvider(provider domain.ASRProvider) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.isRunning || a.stopRequested || a.asrProvider != provider {
		return false
	}
	a.asrProvider = nil
	return true
}

func (a *Agent) stopAfterProviderTermination(provider domain.ASRProvider, providerErr error) {
	a.mu.Lock()
	isCurrentProvider := a.isRunning && !a.stopRequested && a.asrProvider == provider
	a.mu.Unlock()
	if !isCurrentProvider {
		return
	}

	if providerErr != nil {
		log.Printf("❌ [Agent] ASR provider %s stopped unexpectedly: %v", provider.Name(), providerErr)
	} else {
		log.Printf("⚠️ [Agent] ASR provider %s closed its result stream unexpectedly", provider.Name())
	}
	a.Stop()
}

func newTranscriptMessage(result domain.TranscriptResult, provider, speaker string) TranscriptMessage {
	role := result.Role
	if role == "" {
		role = domain.TranscriptRoleSource
	}
	return TranscriptMessage{
		Type:         "transcript",
		Text:         domain.NormalizeProviderTranscriptSpacing(provider, result.LanguageCode, result.Text),
		IsFinal:      result.IsFinal,
		Confidence:   result.Confidence,
		Provider:     provider,
		Timestamp:    time.Now().UnixMilli(),
		Speaker:      speaker,
		Role:         role,
		LanguageCode: result.LanguageCode,
		TurnID:       result.TurnID,
		SegmentID:    result.SegmentID,
	}
}

func (a *Agent) nextTranscriptSequence() uint64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.transcriptSequence++
	return a.transcriptSequence
}

func newDataChannelTranscript(message TranscriptMessage, sequence uint64) dataChannelTranscript {
	return dataChannelTranscript{
		Type:         message.Type,
		Text:         message.Text,
		IsFinal:      message.IsFinal,
		Provider:     message.Provider,
		Timestamp:    message.Timestamp,
		Sequence:     sequence,
		Role:         message.Role,
		LanguageCode: message.LanguageCode,
		TurnID:       message.TurnID,
		SegmentID:    message.SegmentID,
	}
}

func (a *Agent) publishTranscript(data []byte, reliable bool) error {
	return a.publishDataPacket(data, "", reliable, nil)
}

func (a *Agent) publishDataPacket(
	data []byte,
	topic string,
	reliable bool,
	destinations []string,
) error {
	if a.dataPublisher != nil {
		return a.dataPublisher(data, topic, reliable, destinations)
	}
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
		lksdk.WithDataPublishTopic(topic),
		lksdk.WithDataPublishDestination(destinations),
	)
}
