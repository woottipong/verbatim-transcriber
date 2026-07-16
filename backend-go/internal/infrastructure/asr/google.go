package asr

import (
	"context"
	"fmt"
	"io"
	"log"
	"sync"
	"time"

	"thai-transcriber-backend/internal/domain"

	speech "cloud.google.com/go/speech/apiv2"
	"cloud.google.com/go/speech/apiv2/speechpb"
	"google.golang.org/api/option"
)

// Auto-reconnect timing constants for Google's 5-minute streaming limit.
//
// Timeline:
//
//	0:00 ─────────── 4:00 ─────────── 4:50 ──── 5:00
//	  │                │                │         │
//	  │                │                │         └─ DEAD ❌
//	  │                │                └─ Force reconnect + replay buffer ⚠️
//	  │                └─ "Reconnect Zone" — wait for silence → reconnect ✅
//	  └─ Normal streaming
const (
	reconnectZoneStart     = 4 * time.Minute                // เริ่มรอ isFinal เพื่อ reconnect
	forceReconnectAt       = 4*time.Minute + 50*time.Second // บังคับ reconnect (ก่อน limit 10 วินาที)
	ringBufferDuration     = 1 * time.Second                // เก็บ audio ล่าสุดไว้ replay ตอน reconnect
	maxV2AudioRequestBytes = 15 * 1024
)

// ringBuffer is a circular buffer that keeps the last N bytes of audio.
// Used to replay audio across stream reconnections to prevent word loss.
type ringBuffer struct {
	buf  []byte
	size int
	pos  int
	full bool
}

func newRingBuffer(size int) *ringBuffer {
	return &ringBuffer{
		buf:  make([]byte, size),
		size: size,
	}
}

// Write appends data to the ring buffer, overwriting oldest data if full.
func (rb *ringBuffer) Write(data []byte) {
	for _, b := range data {
		rb.buf[rb.pos] = b
		rb.pos = (rb.pos + 1) % rb.size
		if rb.pos == 0 {
			rb.full = true
		}
	}
}

// Read returns all data in the buffer in chronological order.
func (rb *ringBuffer) Read() []byte {
	if !rb.full {
		return append([]byte{}, rb.buf[:rb.pos]...)
	}
	result := make([]byte, rb.size)
	copy(result, rb.buf[rb.pos:])
	copy(result[rb.size-rb.pos:], rb.buf[:rb.pos])
	return result
}

// Reset clears the buffer.
func (rb *ringBuffer) Reset() {
	rb.pos = 0
	rb.full = false
}

type GoogleProvider struct {
	client          *speech.Client
	stream          speechpb.Speech_StreamingRecognizeClient
	results         chan domain.TranscriptResult
	ctx             context.Context    // parent context from Start()
	cancel          context.CancelFunc // parent cancel
	streamCtx       context.Context    // per-stream context
	streamCancel    context.CancelFunc // per-stream cancel
	mu              sync.Mutex
	closeOnce       sync.Once
	projectID       string
	location        string
	model           string
	isRunning       bool
	stopped         bool // user explicitly called Stop()
	sampleRate      int
	languageCode    string
	autoPunctuation bool
	lastErr         error

	// Auto-reconnect fields
	streamStartTime time.Time     // เวลาที่เริ่ม stream ปัจจุบัน
	audioBuf        *ringBuffer   // ring buffer เก็บ audio 1 วินาทีล่าสุด
	reconnecting    bool          // กำลัง reconnect อยู่
	reconnectCount  int           // จำนวนครั้งที่ reconnect แล้ว
	recvDone        chan struct{} // signal ว่า receiveResponses จบแล้ว
	inReconnectZone bool          // อยู่ใน reconnect zone (>4 นาที)
}

type GoogleConfig struct {
	CredentialsFile       string
	APIKey                string
	ProjectID             string
	Location              string
	Model                 string
	SampleRate            int
	LanguageCode          string
	EnableAutoPunctuation bool
}

func NewGoogleProvider(ctx context.Context, cfg GoogleConfig) (*GoogleProvider, error) {
	if cfg.ProjectID == "" {
		return nil, fmt.Errorf("google cloud project ID is required for Speech-to-Text V2")
	}

	var client *speech.Client
	var err error
	location := cfg.Location
	if location == "" {
		location = "asia-southeast1"
	}
	clientOptions := []option.ClientOption{
		option.WithEndpoint(location + "-speech.googleapis.com:443"),
	}

	if cfg.CredentialsFile != "" {
		clientOptions = append(clientOptions, option.WithAuthCredentialsFile(option.ServiceAccount, cfg.CredentialsFile))
	} else if cfg.APIKey != "" {
		clientOptions = append(clientOptions, option.WithAPIKey(cfg.APIKey))
	}
	client, err = speech.NewClient(ctx, clientOptions...)

	if err != nil {
		return nil, err
	}

	sampleRate := cfg.SampleRate
	if sampleRate == 0 {
		sampleRate = 48000
	}

	langCode := cfg.LanguageCode
	if langCode == "" {
		langCode = "th-TH"
	}
	model := googleModel(cfg.Model)

	// Ring buffer size = 1 second of audio at the given sample rate
	// PCM Int16 = 2 bytes per sample
	bufSize := sampleRate * 2 * int(ringBufferDuration.Seconds())

	return &GoogleProvider{
		client:          client,
		results:         make(chan domain.TranscriptResult, 100),
		projectID:       cfg.ProjectID,
		location:        location,
		model:           model,
		sampleRate:      sampleRate,
		languageCode:    langCode,
		autoPunctuation: cfg.EnableAutoPunctuation,
		audioBuf:        newRingBuffer(bufSize),
	}, nil
}

func buildV2StreamingConfigRequest(cfg GoogleConfig) *speechpb.StreamingRecognizeRequest {
	return &speechpb.StreamingRecognizeRequest{
		Recognizer: fmt.Sprintf("projects/%s/locations/%s/recognizers/_", cfg.ProjectID, cfg.Location),
		StreamingRequest: &speechpb.StreamingRecognizeRequest_StreamingConfig{
			StreamingConfig: &speechpb.StreamingRecognitionConfig{
				Config: &speechpb.RecognitionConfig{
					DecodingConfig: &speechpb.RecognitionConfig_ExplicitDecodingConfig{
						ExplicitDecodingConfig: &speechpb.ExplicitDecodingConfig{
							Encoding:          speechpb.ExplicitDecodingConfig_LINEAR16,
							SampleRateHertz:   int32(cfg.SampleRate),
							AudioChannelCount: 1,
						},
					},
					LanguageCodes: []string{cfg.LanguageCode},
					Model:         googleModel(cfg.Model),
					Features: &speechpb.RecognitionFeatures{
						EnableAutomaticPunctuation: cfg.EnableAutoPunctuation,
						MaxAlternatives:            1,
					},
				},
				StreamingFeatures: &speechpb.StreamingRecognitionFeatures{
					InterimResults: true,
				},
			},
		},
	}
}

func googleModel(model string) string {
	if model == "" {
		return "chirp_2"
	}
	return model
}

func audioChunks(audio []byte) [][]byte {
	if len(audio) == 0 {
		return nil
	}

	chunks := make([][]byte, 0, (len(audio)+maxV2AudioRequestBytes-1)/maxV2AudioRequestBytes)
	for len(audio) > 0 {
		chunkSize := min(len(audio), maxV2AudioRequestBytes)
		chunks = append(chunks, audio[:chunkSize])
		audio = audio[chunkSize:]
	}
	return chunks
}

func (g *GoogleProvider) Name() string {
	return "google"
}

func (g *GoogleProvider) SampleRate() int {
	return g.sampleRate
}

func (g *GoogleProvider) Start(ctx context.Context) error {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.isRunning {
		return nil
	}

	g.ctx, g.cancel = context.WithCancel(ctx)
	g.stopped = false
	g.reconnectCount = 0

	if err := g.startStreamLocked(); err != nil {
		return err
	}

	g.isRunning = true
	log.Printf("✅ [Google] STT stream started (model=%s, location=%s, language=%s)", g.model, g.location, g.languageCode)
	return nil
}

// startStreamLocked creates a new gRPC stream and starts receiving responses.
// Must be called with g.mu held.
func (g *GoogleProvider) startStreamLocked() error {
	g.streamCtx, g.streamCancel = context.WithCancel(g.ctx)

	stream, err := g.client.StreamingRecognize(g.streamCtx)
	if err != nil {
		return err
	}

	g.stream = stream

	err = stream.Send(buildV2StreamingConfigRequest(GoogleConfig{
		ProjectID:             g.projectID,
		Location:              g.location,
		Model:                 g.model,
		SampleRate:            g.sampleRate,
		LanguageCode:          g.languageCode,
		EnableAutoPunctuation: g.autoPunctuation,
	}))
	if err != nil {
		return err
	}

	g.streamStartTime = time.Now()
	g.inReconnectZone = false
	g.recvDone = make(chan struct{})

	go g.receiveResponses()

	return nil
}

func (g *GoogleProvider) receiveResponses() {
	defer func() {
		close(g.recvDone)
	}()
	interimCount := 0

	for {
		resp, err := g.stream.Recv()
		if err == io.EOF {
			g.finishWithError(io.EOF)
			log.Println("📭 [Google] Stream ended (EOF)")
			return
		}
		if err != nil {
			// ถ้ากำลัง reconnect (stream ถูก cancel โดยเรา) → ไม่ใช่ error จริง
			g.mu.Lock()
			if g.reconnecting || g.stopped {
				g.mu.Unlock()
				return
			}

			// ถ้าเป็น 5-minute limit → พยายาม auto-reconnect
			errStr := err.Error()
			if isStreamLimitError(errStr) {
				log.Println("⚠️  [Google] Stream limit reached — auto-reconnecting...")
				g.mu.Unlock()
				g.triggerReconnect("stream_limit")
				return
			}

			g.mu.Unlock()
			g.finishWithError(err)
			log.Printf("❌ [Google] Receive error: %v", err)
			return
		}

		for _, result := range resp.Results {
			if len(result.Alternatives) == 0 {
				continue
			}

			alt := result.Alternatives[0]
			transcript := domain.TranscriptResult{
				Text:       alt.Transcript,
				IsFinal:    result.IsFinal,
				Confidence: float64(alt.Confidence),
			}
			if result.IsFinal {
				log.Printf("📊 [Google] Utterance finalized (interim_updates=%d, model=%s, language=%s)", interimCount, g.model, g.languageCode)
				interimCount = 0
			} else {
				interimCount++
				log.Printf("🟡 [Google] INTERIM #%d (elapsed=%s, stability=%.2f, model=%s): %q",
					interimCount,
					time.Since(g.streamStartTime).Round(10*time.Millisecond),
					result.GetStability(),
					g.model,
					alt.Transcript,
				)
			}

			if !g.emitResult(transcript) {
				log.Println("⚠️ [Google] Results channel full")
			}

			// ✅ ใช้ isFinal เป็นสัญญาณว่าผู้พูดหยุดพูดชั่วคราว (Google VAD)
			// ถ้าอยู่ใน reconnect zone → reconnect ตอนนี้เลย (ช่วงเงียบ)
			if result.IsFinal {
				g.mu.Lock()
				inZone := g.inReconnectZone
				g.mu.Unlock()
				if inZone {
					log.Println("🔄 [Google] isFinal received in reconnect zone — reconnecting at natural pause")
					go g.triggerReconnect("natural_pause")
					return
				}
			}
		}
	}
}

func (g *GoogleProvider) finishWithError(err error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.stopped || g.reconnecting {
		return
	}
	g.lastErr = err
	g.isRunning = false
	g.closeOnce.Do(func() { close(g.results) })
}

func (g *GoogleProvider) emitResult(result domain.TranscriptResult) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.isRunning || g.stopped {
		return false
	}
	select {
	case g.results <- result:
		return true
	default:
		return false
	}
}

func (g *GoogleProvider) SendAudio(data []byte) error {
	g.mu.Lock()
	defer g.mu.Unlock()

	if !g.isRunning || g.stream == nil || g.reconnecting {
		return nil
	}

	// เก็บ audio ลง ring buffer เสมอ (สำหรับ replay ตอน reconnect)
	g.audioBuf.Write(data)

	// ตรวจสอบว่าควร reconnect หรือยัง
	elapsed := time.Since(g.streamStartTime)

	if elapsed >= forceReconnectAt {
		// ⚠️ ใกล้ 5 นาทีแล้ว — บังคับ reconnect ทันที
		log.Println("⚠️  [Google] Force reconnect at 4:50 — approaching 5-min limit")
		go g.triggerReconnect("force_4m50s")
		return nil
	}

	if elapsed >= reconnectZoneStart && !g.inReconnectZone {
		// เข้าสู่ reconnect zone — แจ้ง receiveResponses ให้ reconnect ตอน isFinal ถัดไป
		g.inReconnectZone = true
		log.Printf("🔄 [Google] Entered reconnect zone (elapsed: %s) — waiting for natural pause", elapsed.Round(time.Second))
	}

	// ส่ง audio ไป Google ตามปกติ
	return g.sendAudioLocked(data)
}

func (g *GoogleProvider) sendAudioLocked(data []byte) error {
	for _, chunk := range audioChunks(data) {
		if err := g.stream.Send(&speechpb.StreamingRecognizeRequest{
			StreamingRequest: &speechpb.StreamingRecognizeRequest_Audio{Audio: chunk},
		}); err != nil {
			return err
		}
	}
	return nil
}

// triggerReconnect closes the current stream and creates a new one,
// replaying buffered audio to prevent word loss.
func (g *GoogleProvider) triggerReconnect(reason string) {
	g.mu.Lock()
	if g.reconnecting || g.stopped || !g.isRunning {
		g.mu.Unlock()
		return
	}
	g.reconnecting = true
	g.reconnectCount++
	count := g.reconnectCount
	g.mu.Unlock()

	log.Printf("🔄 [Google] Reconnecting stream (#%d, reason: %s)...", count, reason)

	// 1. ปิด stream เก่า
	g.mu.Lock()
	if g.streamCancel != nil {
		g.streamCancel()
	}
	if g.stream != nil {
		if err := g.stream.CloseSend(); err != nil {
			log.Printf("⚠️ [Google] Failed to close stream before reconnect: %v", err)
		}
	}
	g.mu.Unlock()

	// 2. รอ receiveResponses จบ
	select {
	case <-g.recvDone:
	case <-time.After(2 * time.Second):
		log.Println("⚠️  [Google] Timeout waiting for receiver to stop")
	}

	// 3. สร้าง stream ใหม่
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.stopped {
		g.reconnecting = false
		return
	}

	// ดึง buffered audio ก่อน reset
	bufferedAudio := g.audioBuf.Read()

	if err := g.startStreamLocked(); err != nil {
		log.Printf("❌ [Google] Reconnect failed: %v", err)
		g.lastErr = err
		g.reconnecting = false
		g.isRunning = false
		g.closeOnce.Do(func() { close(g.results) })
		return
	}

	// 4. Replay buffered audio ไปยัง stream ใหม่
	if len(bufferedAudio) > 0 {
		err := g.sendAudioLocked(bufferedAudio)
		if err != nil {
			log.Printf("⚠️  [Google] Failed to replay buffer: %v", err)
		} else {
			log.Printf("🔄 [Google] Replayed %d bytes of buffered audio", len(bufferedAudio))
		}
	}

	g.reconnecting = false
	log.Printf("✅ [Google] Stream reconnected (#%d, elapsed: %s)", count, reason)
}

// isStreamLimitError checks if an error is related to Google's 5-minute limit.
func isStreamLimitError(errStr string) bool {
	limitPatterns := []string{
		"maximum allowed stream duration",
		"DeadlineExceeded",
		"Deadline exceeded",
		"stream duration",
	}
	for _, p := range limitPatterns {
		if containsIgnoreCase(errStr, p) {
			return true
		}
	}
	return false
}

func containsIgnoreCase(s, substr string) bool {
	// Simple case-insensitive contains using lowercase comparison
	ls := len(substr)
	if ls == 0 {
		return true
	}
	for i := 0; i <= len(s)-ls; i++ {
		match := true
		for j := 0; j < ls; j++ {
			a, b := s[i+j], substr[j]
			if a >= 'A' && a <= 'Z' {
				a += 'a' - 'A'
			}
			if b >= 'A' && b <= 'Z' {
				b += 'a' - 'A'
			}
			if a != b {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}

func (g *GoogleProvider) Results() <-chan domain.TranscriptResult {
	return g.results
}

func (g *GoogleProvider) Err() error {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.lastErr
}

func (g *GoogleProvider) Stop() error {
	g.mu.Lock()
	if g.stopped {
		g.mu.Unlock()
		return nil
	}
	g.stopped = true
	g.isRunning = false
	streamCancel := g.streamCancel
	cancel := g.cancel
	stream := g.stream
	client := g.client
	reconnectCount := g.reconnectCount
	g.closeOnce.Do(func() { close(g.results) })
	g.mu.Unlock()

	if streamCancel != nil {
		streamCancel()
	}
	if cancel != nil {
		cancel()
	}

	var closeErr error
	if stream != nil {
		closeErr = stream.CloseSend()
	}
	if client != nil {
		if err := client.Close(); err != nil && closeErr == nil {
			closeErr = err
		}
	}

	log.Printf("🛑 [Google] STT stream stopped (reconnected %d times)", reconnectCount)
	return closeErr
}
