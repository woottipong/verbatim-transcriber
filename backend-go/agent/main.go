package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"thai-transcriber-agent/asr"

	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go"
	"github.com/pion/webrtc/v3"
)

type TranscriptionAgent struct {
	room          *lksdk.Room
	asrProvider   asr.ASRProvider
	asrCredential string
	vadEnabled    bool
}

func main() {
	roomName := os.Getenv("LIVEKIT_ROOM_NAME")
	if roomName == "" {
		roomName = "transcription-room"
	}

	agent := &TranscriptionAgent{
		asrCredential: os.Getenv("GOOGLE_APPLICATION_CREDENTIALS"),
		vadEnabled:    true,
	}

	roomCallback := &lksdk.RoomCallback{
		ParticipantCallback: lksdk.ParticipantCallback{
			OnTrackSubscribed: agent.onTrackSubscribed,
		},
	}

	room, err := lksdk.ConnectToRoom(
		os.Getenv("LIVEKIT_WS_URL"),
		lksdk.ConnectInfo{
			APIKey:              os.Getenv("LIVEKIT_API_KEY"),
			APISecret:           os.Getenv("LIVEKIT_API_SECRET"),
			RoomName:            roomName,
			ParticipantIdentity: "asr-agent",
			ParticipantName:     "ASR Agent",
		},
		roomCallback,
	)
	if err != nil {
		log.Fatal(err)
	}
	defer room.Disconnect()
	agent.room = room

	log.Printf("✅ Agent connected to room: %s", roomName)

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Println("Agent shutting down...")
}

func (a *TranscriptionAgent) onTrackSubscribed(
	track *webrtc.TrackRemote,
	publication *lksdk.RemoteTrackPublication,
	participant *lksdk.RemoteParticipant,
) {
	if track.Kind() == webrtc.RTPCodecTypeAudio {
		log.Printf("🎤 Subscribed to audio track from %s", participant.Identity())
		go a.processAudioTrack(track, participant)
	}
}

func (a *TranscriptionAgent) processAudioTrack(track *webrtc.TrackRemote, participant *lksdk.RemoteParticipant) {
	ctx := context.Background()

	asr, err := asr.NewGoogleProvider(a.asrCredential, 48000)
	if err != nil {
		log.Printf("❌ Failed to create ASR provider: %v", err)
		return
	}
	a.asrProvider = asr
	defer asr.Close()

	if err := asr.Start(ctx); err != nil {
		log.Printf("❌ Failed to start ASR: %v", err)
		return
	}

	audioBuf := make([]byte, 960)
	for {
		_, _, readErr := track.Read(audioBuf)
		if readErr != nil {
			log.Printf("❌ Error reading audio: %v", readErr)
			break
		}

		if err := asr.SendAudio(audioBuf); err != nil {
			log.Printf("❌ Error sending audio: %v", err)
			continue
		}

		select {
		case result := <-asr.Results():
			a.publishTranscript(result, participant.Identity())
		default:
		}
	}
}

func (a *TranscriptionAgent) publishTranscript(result asr.TranscriptResult, speakerID string) {
	message := map[string]interface{}{
		"text":       result.Text,
		"isFinal":    result.IsFinal,
		"confidence": result.Confidence,
		"speaker":    speakerID,
		"timestamp":  time.Now().UnixMilli(),
	}

	data, err := json.Marshal(message)
	if err != nil {
		log.Printf("❌ Failed to marshal transcript: %v", err)
		return
	}

	if err := a.room.LocalParticipant.PublishData(data, livekit.DataPacket_RELIABLE, []string{"transcript"}); err != nil {
		log.Printf("❌ Failed to publish transcript: %v", err)
	}

	log.Printf("📝 Transcript: %s (final: %v)", result.Text, result.IsFinal)
}
