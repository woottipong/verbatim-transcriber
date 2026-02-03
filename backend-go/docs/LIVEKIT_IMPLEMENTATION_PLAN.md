# 🚀 LiveKit Thai Transcription - Implementation Plan

> แผนการพัฒนาระบบ Real-time Thai Transcription ด้วย LiveKit เพื่อ Ultra-low Latency

---

## 📋 Overview

### Current Architecture (WebSocket)
```
Browser → WebSocket → Go Backend → ASR API → WebSocket → Browser
Latency: ~500-2000ms
```

### Target Architecture (LiveKit + WebRTC)
```
Browser → WebRTC → LiveKit Server → Agent → ASR API → Data Channel → Browser
Latency: ~200-500ms (เป้าหมาย)
```

### Key Improvements
| Aspect               | Before     | After      |
| -------------------- | ---------- | ---------- |
| Protocol             | WebSocket  | WebRTC     |
| Latency              | 500-2000ms | 200-500ms  |
| Packet Loss Handling | Poor       | Excellent  |
| Scalability          | Limited    | High       |
| Audio Quality        | Variable   | Consistent |

---

## 📍 Phase 1: Infrastructure Setup (Week 1-2)

### 1.1 LiveKit Server Deployment

**Option A: Docker Self-hosted (แนะนำสำหรับ Development)**
```yaml
# docker-compose.livekit.yml
version: '3.8'
services:
  livekit:
    image: livekit/livekit-server:latest
    ports:
      - "7880:7880"   # HTTP
      - "7881:7881"   # WebRTC TCP
      - "7882:7882/udp" # WebRTC UDP
    environment:
      - LIVEKIT_KEYS=devkey:secret
    command: --dev --bind 0.0.0.0

  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
```

**Option B: LiveKit Cloud (แนะนำสำหรับ Production)**
- Sign up: https://cloud.livekit.io
- ได้ API Key + Secret ทันที
- Free tier: 5,000 participant minutes/month

### 1.2 Token Service (Go Backend)

**File: `backend-go/handlers/livekit.go`**
```go
package handlers

import (
    "time"
    "github.com/gofiber/fiber/v2"
    "github.com/livekit/protocol/auth"
)

type TokenRequest struct {
    Identity string `json:"identity"`
    RoomName string `json:"roomName"`
}

func HandleLiveKitToken(c *fiber.Ctx) error {
    var req TokenRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
    }

    // Create token
    at := auth.NewAccessToken(
        os.Getenv("LIVEKIT_API_KEY"),
        os.Getenv("LIVEKIT_API_SECRET"),
    )

    grant := &auth.VideoGrant{
        RoomJoin: true,
        Room:     req.RoomName,
    }

    at.AddGrant(grant).
        SetIdentity(req.Identity).
        SetValidFor(time.Hour)

    token, err := at.ToJWT()
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to generate token"})
    }

    return c.JSON(fiber.Map{
        "token": token,
        "wsUrl": os.Getenv("LIVEKIT_WS_URL"), // wss://your-livekit-server
    })
}
```

### 1.3 Environment Variables

**Add to `.env`:**
```bash
# LiveKit Configuration
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
LIVEKIT_WS_URL=ws://localhost:7880  # Production: wss://your-domain
```

### 1.4 Tasks Checklist
- [ ] ติดตั้ง Docker และ docker-compose
- [ ] สร้าง `docker-compose.livekit.yml`
- [ ] รัน LiveKit Server locally
- [ ] สร้าง Token Service endpoint
- [ ] ทดสอบ generate token

---

## 📍 Phase 2: ASR Agent Development (Week 3-4)

### 2.1 Agent Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    LiveKit Room                         │
│  ┌─────────────┐         ┌─────────────────────────┐    │
│  │   Browser   │ ──────► │      ASR Agent          │    │
│  │  (Speaker)  │  Audio  │  ┌─────────────────┐    │    │
│  └─────────────┘  Track  │  │   Silero VAD    │    │    │
│                          │  └────────┬────────┘    │    │
│  ┌─────────────┐         │           │             │    │
│  │   Browser   │ ◄────── │  ┌────────▼────────┐    │    │
│  │  (Viewer)   │  Data   │  │  ASR Provider   │    │    │
│  └─────────────┘  Track  │  │ (Google/Azure)  │    │    │
│                          │  └─────────────────┘    │    │
│                          └─────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Go Agent Implementation

**File: `backend-go/agent/main.go`**
```go
package main

import (
    "context"
    "log"
    "os"
    "os/signal"
    "syscall"

    "github.com/livekit/protocol/livekit"
    lksdk "github.com/livekit/server-sdk-go"
)

type TranscriptionAgent struct {
    room       *lksdk.Room
    asrClient  ASRClient
    vadEnabled bool
}

func main() {
    // LiveKit connection
    roomCallback := &lksdk.RoomCallback{
        ParticipantCallback: lksdk.ParticipantCallback{
            OnTrackSubscribed: onTrackSubscribed,
        },
    }

    room, err := lksdk.ConnectToRoom(
        os.Getenv("LIVEKIT_WS_URL"),
        lksdk.ConnectInfo{
            APIKey:              os.Getenv("LIVEKIT_API_KEY"),
            APISecret:           os.Getenv("LIVEKIT_API_SECRET"),
            RoomName:            "transcription-room",
            ParticipantIdentity: "asr-agent",
        },
        roomCallback,
    )
    if err != nil {
        log.Fatal(err)
    }
    defer room.Disconnect()

    // Wait for signal
    sigChan := make(chan os.Signal, 1)
    signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
    <-sigChan

    log.Println("Agent shutting down...")
}

func onTrackSubscribed(
    track *webrtc.TrackRemote,
    publication *lksdk.RemoteTrackPublication,
    participant *lksdk.RemoteParticipant,
) {
    if track.Kind() == webrtc.RTPCodecTypeAudio {
        log.Printf("Subscribed to audio track from %s", participant.Identity())
        go processAudioTrack(track, participant)
    }
}

func processAudioTrack(track *webrtc.TrackRemote, participant *lksdk.RemoteParticipant) {
    // 1. Read audio packets
    // 2. Pass through VAD
    // 3. Send to ASR
    // 4. Publish transcript via Data Channel
}
```

### 2.3 ASR Provider Interface

**File: `backend-go/agent/asr/interface.go`**
```go
package asr

type TranscriptResult struct {
    Text       string  `json:"text"`
    IsFinal    bool    `json:"isFinal"`
    Confidence float64 `json:"confidence"`
    Speaker    string  `json:"speaker,omitempty"`
}

type ASRProvider interface {
    Start(ctx context.Context) error
    SendAudio(data []byte) error
    Results() <-chan TranscriptResult
    Stop() error
}

// Implementations:
// - google.go   (Google STT - Primary, Real-time streaming)
// - azure.go    (Azure Speech - Secondary, WebSocket)
```

### 2.4 Google Cloud STT Integration (Primary - Real-time Streaming)

**File: `backend-go/agent/asr/google.go`**
```go
package asr

import (
    "context"
    speech "cloud.google.com/go/speech/apiv1"
    speechpb "cloud.google.com/go/speech/apiv1/speechpb"
    "google.golang.org/api/option"
)

type GoogleProvider struct {
    client     *speech.Client
    results    chan TranscriptResult
    sampleRate int
}

func NewGoogleProvider(credentialFile string, sampleRate int) (*GoogleProvider, error) {
    ctx := context.Background()
    client, err := speech.NewClient(ctx, option.WithCredentialsFile(credentialFile))
    if err != nil {
        return nil, err
    }
    return &GoogleProvider{
        client:     client,
        results:    make(chan TranscriptResult, 100),
        sampleRate: sampleRate,
    }, nil
}

func (g *GoogleProvider) GetStreamingConfig() *speechpb.StreamingRecognitionConfig {
    return &speechpb.StreamingRecognitionConfig{
        Config: &speechpb.RecognitionConfig{
            Encoding:                   speechpb.RecognitionConfig_LINEAR16,
            SampleRateHertz:            int32(g.sampleRate),
            LanguageCode:               "th-TH",
            Model:                      "latest_long",
            UseEnhanced:                true,
            EnableAutomaticPunctuation: true,
        },
        InterimResults: true,
    }
}
```

### 2.5 Azure Speech Integration (Secondary - WebSocket)

**File: `backend-go/agent/asr/azure.go`**
```go
package asr

import (
    "encoding/json"
    "fmt"
    "github.com/gorilla/websocket"
)

type AzureProvider struct {
    conn           *websocket.Conn
    results        chan TranscriptResult
    subscriptionKey string
    region          string
    sampleRate      int
}

func NewAzureProvider(subscriptionKey, region string, sampleRate int) *AzureProvider {
    return &AzureProvider{
        results:         make(chan TranscriptResult, 100),
        subscriptionKey: subscriptionKey,
        region:          region,
        sampleRate:      sampleRate,
    }
}

func (a *AzureProvider) Start(ctx context.Context) error {
    // Connect to Azure Speech WebSocket
    wsURL := fmt.Sprintf(
        "wss://%s.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1"+
        "?language=th-TH&format=detailed",
        a.region,
    )
    
    headers := http.Header{}
    headers.Set("Ocp-Apim-Subscription-Key", a.subscriptionKey)
    
    conn, _, err := websocket.DefaultDialer.Dial(wsURL, headers)
    if err != nil {
        return err
    }
    a.conn = conn
    
    // Send speech.config with segmentation for faster response
    config := map[string]interface{}{
        "context": map[string]interface{}{
            "system": map[string]string{"name": "LiveKit-Agent"},
            "recognition": map[string]interface{}{
                "segmentationSilenceTimeoutMs": 500,
                "enableInterimResults":         true,
            },
        },
    }
    return a.sendConfig(config)
}
```

### 2.6 Provider Comparison

| Feature         | Google STT          | Azure Speech                     |
| --------------- | ------------------- | -------------------------------- |
| Protocol        | gRPC Streaming      | WebSocket                        |
| Latency         | ~300ms              | ~500ms (with 500ms segmentation) |
| Interim Results | ✅ Native            | ✅ Configurable                   |
| Thai Quality    | Excellent           | Good                             |
| Pricing         | $0.006/15s          | $1/hour                          |
| Best For        | Real-time, accuracy | Cost-effective                   |

**Recommendation:** ใช้ **Google STT** เป็น Primary และ **Azure** เป็น Fallback

### 2.7 Tasks Checklist
- [ ] สร้าง Agent project structure
- [ ] Implement ASR Provider interface
- [ ] Integrate Google STT gRPC (Primary)
- [ ] Integrate Azure Speech WebSocket (Secondary)
- [ ] Add Provider switching logic
- [ ] Implement Data Channel publishing
- [ ] ทดสอบ end-to-end ทั้ง 2 providers

---

## 📍 Phase 3: Frontend Modernization (Week 5-6)

### 3.1 Install LiveKit React SDK

```bash
cd frontend
npm install @livekit/components-react livekit-client
```

### 3.2 LiveKit Provider Setup

**File: `frontend/components/LiveKitProvider.tsx`**
```tsx
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import { Room, RoomEvent, DataPacket_Kind } from 'livekit-client';
import { useState, useCallback, useEffect } from 'react';

interface TranscriptMessage {
    text: string;
    isFinal: boolean;
    confidence: number;
    timestamp: number;
}

export function TranscriptionRoom({ 
    token, 
    serverUrl,
    onTranscript 
}: {
    token: string;
    serverUrl: string;
    onTranscript: (msg: TranscriptMessage) => void;
}) {
    const [room, setRoom] = useState<Room | null>(null);

    const handleDataReceived = useCallback((
        payload: Uint8Array,
        participant?: RemoteParticipant,
        kind?: DataPacket_Kind
    ) => {
        // Decode transcript message
        const decoder = new TextDecoder();
        const message = JSON.parse(decoder.decode(payload)) as TranscriptMessage;
        onTranscript(message);
    }, [onTranscript]);

    return (
        <LiveKitRoom
            token={token}
            serverUrl={serverUrl}
            connect={true}
            audio={true}
            video={false}
            onConnected={(room) => {
                setRoom(room);
                room.on(RoomEvent.DataReceived, handleDataReceived);
            }}
            onDisconnected={() => setRoom(null)}
        >
            <RoomAudioRenderer />
            <ConnectionStatus />
        </LiveKitRoom>
    );
}
```

### 3.3 Transcript Display Component

**File: `frontend/components/LiveTranscript.tsx`**
```tsx
import { useState, useEffect, useRef } from 'react';

interface TranscriptSegment {
    id: string;
    text: string;
    isFinal: boolean;
    timestamp: number;
}

export function LiveTranscript() {
    const [segments, setSegments] = useState<TranscriptSegment[]>([]);
    const [interim, setInterim] = useState<string>('');
    const scrollRef = useRef<HTMLDivElement>(null);

    const handleTranscript = (msg: TranscriptMessage) => {
        if (msg.isFinal) {
            setSegments(prev => [...prev, {
                id: `seg-${Date.now()}`,
                text: msg.text,
                isFinal: true,
                timestamp: msg.timestamp,
            }]);
            setInterim('');
        } else {
            setInterim(msg.text);
        }
    };

    // Auto-scroll
    useEffect(() => {
        scrollRef.current?.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: 'smooth',
        });
    }, [segments, interim]);

    return (
        <div ref={scrollRef} className="h-full overflow-y-auto p-4">
            {segments.map(seg => (
                <div key={seg.id} className="mb-2 p-2 bg-slate-800 rounded">
                    {seg.text}
                </div>
            ))}
            {interim && (
                <div className="mb-2 p-2 bg-indigo-900/30 rounded border-l-4 border-indigo-400">
                    <span className="animate-pulse">●</span> {interim}
                </div>
            )}
        </div>
    );
}
```

### 3.4 Connection Status Component

```tsx
import { useConnectionState, useParticipants } from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';

export function ConnectionStatus() {
    const connectionState = useConnectionState();
    const participants = useParticipants();

    const statusColors = {
        [ConnectionState.Connected]: 'bg-green-500',
        [ConnectionState.Connecting]: 'bg-yellow-500',
        [ConnectionState.Reconnecting]: 'bg-orange-500',
        [ConnectionState.Disconnected]: 'bg-red-500',
    };

    return (
        <div className="flex items-center gap-2 p-2">
            <span className={`w-3 h-3 rounded-full ${statusColors[connectionState]}`} />
            <span className="text-sm text-slate-300">
                {connectionState} • {participants.length} participants
            </span>
        </div>
    );
}
```

### 3.5 Tasks Checklist
- [ ] Install LiveKit React SDK
- [ ] Create LiveKitProvider component
- [ ] Implement Data Channel listener
- [ ] Create LiveTranscript component
- [ ] Add connection status UI
- [ ] Integrate with existing UI
- [ ] ทดสอบ end-to-end

---

## 📍 Phase 4: Optimization (Week 7-8)

### 4.1 Latency Benchmarking

```go
// Add timestamp tracking
type TimestampedTranscript struct {
    Text           string  `json:"text"`
    IsFinal        bool    `json:"isFinal"`
    AudioTimestamp int64   `json:"audioTs"`  // เวลาที่เสียงเข้า Agent
    ASRTimestamp   int64   `json:"asrTs"`    // เวลาที่ได้ผลจาก ASR
    SendTimestamp  int64   `json:"sendTs"`   // เวลาที่ส่งไป Client
}

// Frontend: วัด end-to-end latency
const receiveTimestamp = Date.now();
const e2eLatency = receiveTimestamp - msg.audioTimestamp;
console.log(`E2E Latency: ${e2eLatency}ms`);
```

### 4.2 Audio Quality Settings

```tsx
// LiveKit Room options
const roomOptions = {
    audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000,
        channelCount: 1,
    },
    adaptiveStream: true,
    dynacast: true,
};
```

### 4.3 Auto-reconnection

```tsx
<LiveKitRoom
    options={{
        reconnect: true,
        reconnectPolicy: {
            maxRetries: 10,
            initialDelay: 100,
            maxDelay: 5000,
        },
    }}
/>
```

### 4.4 Tasks Checklist
- [ ] Add timestamp tracking
- [ ] Create latency dashboard
- [ ] Tune audio settings
- [ ] Implement auto-reconnection
- [ ] A/B test ASR providers
- [ ] Optimize VAD thresholds

---

## 📍 Phase 5: Deployment (Week 9-10)

### 5.1 Production Docker Compose

```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  livekit:
    image: livekit/livekit-server:latest
    restart: always
    ports:
      - "7880:7880"
      - "7881:7881"
      - "7882:7882/udp"
    environment:
      - LIVEKIT_CONFIG=/etc/livekit.yaml
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml

  backend:
    build: ./backend-go
    restart: always
    ports:
      - "3000:3000"
    environment:
      - LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
      - LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}
      - DEEPGRAM_API_KEY=${DEEPGRAM_API_KEY}
    depends_on:
      - livekit
      - redis

  agent:
    build: ./backend-go/agent
    restart: always
    environment:
      - LIVEKIT_WS_URL=ws://livekit:7880
      - LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
      - LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}
      - DEEPGRAM_API_KEY=${DEEPGRAM_API_KEY}
    depends_on:
      - livekit

  frontend:
    build: ./frontend
    restart: always
    ports:
      - "80:80"
    depends_on:
      - backend

  redis:
    image: redis:alpine
    restart: always

  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
```

### 5.2 LiveKit Production Config

```yaml
# livekit.yaml
port: 7880
rtc:
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
  
keys:
  api_key: ${LIVEKIT_API_KEY}
  api_secret: ${LIVEKIT_API_SECRET}

logging:
  level: info

redis:
  address: redis:6379
```

### 5.3 Monitoring Dashboard

```yaml
# Grafana Dashboard Metrics
- livekit_room_participants
- livekit_room_duration_seconds
- asr_latency_ms (custom)
- asr_accuracy_score (custom)
- transcript_count_total (custom)
```

### 5.4 Tasks Checklist
- [ ] Create production Docker Compose
- [ ] Configure LiveKit for production
- [ ] Setup SSL/TLS (HTTPS/WSS)
- [ ] Deploy to cloud (AWS/GCP/DO)
- [ ] Setup Prometheus + Grafana
- [ ] Configure alerting
- [ ] Load testing

---

## 📊 Timeline Summary

| Phase   | Duration  | Focus                          |
| ------- | --------- | ------------------------------ |
| Phase 1 | Week 1-2  | Infrastructure & Token Service |
| Phase 2 | Week 3-4  | ASR Agent Development          |
| Phase 3 | Week 5-6  | Frontend Modernization         |
| Phase 4 | Week 7-8  | Optimization & Testing         |
| Phase 5 | Week 9-10 | Production Deployment          |

**Total: ~10 weeks**

---

## 💰 Cost Estimation (Monthly)

| Service       | Cost               | Notes                           |
| ------------- | ------------------ | ------------------------------- |
| LiveKit Cloud | $0-50              | Free tier: 5,000 mins           |
| Google STT    | ~$20-80            | $0.006/15s, Free: 60 mins/month |
| Azure Speech  | ~$10-50            | $1/hour (backup)                |
| Cloud Server  | ~$50-100           | 4 vCPU, 8GB RAM                 |
| **Total**     | **~$80-280/month** | Depends on usage                |

---

## 🎯 Success Metrics

| Metric             | Target  | Current      |
| ------------------ | ------- | ------------ |
| End-to-end Latency | < 500ms | ~1000-2000ms |
| Accuracy (Thai)    | > 90%   | ~94-95%      |
| Uptime             | 99.9%   | TBD          |
| Concurrent Users   | 100+    | ~10          |

---

## 📚 Resources

### Documentation
- [LiveKit Docs](https://docs.livekit.io)
- [LiveKit Server SDK (Go)](https://github.com/livekit/server-sdk-go)
- [LiveKit React Components](https://docs.livekit.io/reference/components/react/)
- [Google Cloud Speech-to-Text](https://cloud.google.com/speech-to-text/docs)
- [Azure Speech Service](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/)

### Examples
- [LiveKit Agent Example](https://github.com/livekit/agents)
- [Google Speech Go SDK](https://pkg.go.dev/cloud.google.com/go/speech)
- [Azure Speech REST API](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text)

---

*Implementation Plan สำหรับ Thai Verbatim Transcriber with LiveKit (Feb 2026)*
