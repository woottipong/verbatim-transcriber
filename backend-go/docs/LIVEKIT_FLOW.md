# LiveKit WebRTC - Architecture & Data Flow

## Overview

LiveKit Mode ใช้ WebRTC สำหรับ room-based transcription — หลายคน join ดู transcript พร้อมกันได้

```
Publisher (Browser)  ─── WebRTC ───►  LiveKit Server  ◄─── WebRTC ───  Agent (Go Backend)
                                          │
                                          │ WebRTC
                                          ▼
                                    Viewer (Browser)
```

---

## Architecture

```
LiveKit Room: "meeting-123"
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  👤 Publisher                                                     │
│  (Browser)              🔊 Audio Track (WebRTC Opus)             │
│     │  ──────────────────────────────────────────────►           │
│     │                                                            │
│     │                   🤖 Agent (Go Backend)                     │
│     │                      │                                     │
│     │                      │  1. Subscribe Audio (Opus)           │
│     │                      │  2. Decode Opus → PCM (CGO)         │
│     │                      │  3. Send PCM → ASR (Google/Azure)   │
│     │                      │  4. Receive Transcript              │
│     │                      │  5. Publish via Data Channel        │
│     │                      │                                     │
│     │  ◄──────────────── 📝 Data Channel (transcript JSON) ──►  │
│     │                                                            │
│  👁️ Viewer(s)                                                     │
│  (Browser)                                                       │
│     ◄──── 🔊 Audio (from Publisher)                               │
│     ◄──── 📝 Transcript (from Agent)                              │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Connection Flow

### Publisher Flow

```
Publisher                    Go Backend REST              LiveKit Server
   │                             │                            │
   │  1. POST /livekit/token     │                            │
   │  { identity, roomName }     │                            │
   │ ───────────────────────────►│                            │
   │                             │                            │
   │  2. { token, wsUrl }        │                            │
   │ ◄───────────────────────────│                            │
   │                             │                            │
   │  3. Connect WebRTC (token)  │                            │
   │ ────────────────────────────┼───────────────────────────►│
   │                             │                            │
   │  4. Publish Audio Track     │                            │
   │ ────────────────────────────┼───────────────────────────►│
   │                             │                            │
```

### Agent Flow

```
Frontend                     Go Backend REST              Agent (Go)             ASR
   │                             │                           │                    │
   │  1. POST /livekit/agent/start                           │                    │
   │  { roomName, provider }     │                           │                    │
   │ ───────────────────────────►│                           │                    │
   │                             │  2. Create Agent          │                    │
   │                             │ ─────────────────────────►│                    │
   │                             │                           │                    │
   │                             │      3. Join Room (WebRTC)│                    │
   │                             │                           │──── Connect ──────►│
   │                             │                           │                    │
   │                             │      4. Subscribe Audio   │                    │
   │                             │      (Auto-subscribe)     │                    │
   │                             │                           │                    │
   │                             │      5. Decode Opus→PCM   │                    │
   │                             │                           │  6. Send PCM       │
   │                             │                           │ ──────────────────►│
   │                             │                           │                    │
   │                             │                           │  7. Transcript     │
   │                             │                           │ ◄──────────────────│
   │                             │                           │                    │
   │                             │      8. Data Channel      │                    │
   │  ◄─────────────────────────────────  (to all)          │                    │
   │                             │                           │                    │
```

### Viewer Flow

```
Viewer                       Go Backend REST              LiveKit Server
   │                             │                            │
   │  1. POST /livekit/token     │                            │
   │  { identity, roomName,      │                            │
   │    canPublish: false }      │                            │
   │ ───────────────────────────►│                            │
   │                             │                            │
   │  2. { token, wsUrl }        │                            │
   │ ◄───────────────────────────│                            │
   │                             │                            │
   │  3. Connect WebRTC (subscribe only)                      │
   │ ────────────────────────────┼───────────────────────────►│
   │                             │                            │
   │  4. Receive Audio Track (from Publisher)                  │
   │ ◄───────────────────────────┼────────────────────────────│
   │                             │                            │
   │  5. Receive Data Channel (transcript from Agent)         │
   │ ◄───────────────────────────┼────────────────────────────│
   │                             │                            │
   │  🔊 Play Audio + 📝 Show Transcript                       │
   │                             │                            │
```

---

## REST API Endpoints

### Token & Room Management

| Method | Path                   | Description           |
| ------ | ---------------------- | --------------------- |
| POST   | `/livekit/token`       | Generate access token |
| GET    | `/livekit/rooms`       | List rooms            |
| GET    | `/livekit/rooms/:name` | Get room details      |
| DELETE | `/livekit/rooms/:name` | Delete room           |

### Agent Control

| Method | Path                    | Description               |
| ------ | ----------------------- | ------------------------- |
| POST   | `/livekit/agent/start`  | Start transcription agent |
| POST   | `/livekit/agent/stop`   | Stop agent                |
| GET    | `/livekit/agent/status` | List running agents       |

---

## Agent Audio Pipeline

```
WebRTC Audio (Opus, 48kHz)
       │
       ▼
Opus Decoder (hraban/opus, CGO)
       │
       ▼
PCM Int16 (48kHz, mono)
       │
       ├─── Google: ส่งตรง 48kHz ──► gRPC Streaming
       │
       └─── Azure: Resample 48→16kHz (3:1 decimation) ──► REST Batch
```

### Agent Identity

Agent join room ด้วย identity ที่ระบุ provider:
- `agent-google` — ใช้ Google Cloud STT
- `agent-azure` — ใช้ Azure Speech

รองรับหลาย agent ใน room เดียวกัน (เช่น agent-google + agent-azure พร้อมกัน)

---

## Data Channel Message Format

Agent ส่ง transcript ไปยังทุก participant ผ่าน reliable Data Channel:

```json
{
  "type": "transcript",
  "text": "สวัสดีครับ",
  "isFinal": true,
  "confidence": 0.95,
  "provider": "google",
  "timestamp": 1707321600000,
  "speaker": "user-123"
}
```

| Field      | Type    | Description                      |
| ---------- | ------- | -------------------------------- |
| type       | string  | Always `"transcript"`            |
| text       | string  | Transcribed text                 |
| isFinal    | bool    | Final or interim result          |
| confidence | float64 | Confidence score (0-1)           |
| provider   | string  | `"google"` or `"azure"`          |
| timestamp  | int64   | Unix milliseconds                |
| speaker    | string  | Publisher's participant identity |

---

## Key Implementation Files

| File                                     | Description                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| `internal/infrastructure/agent/agent.go` | Agent core: room join, audio subscribe, Opus decode, ASR pipeline, Data Channel publish |
| `internal/delivery/handler/livekit.go`   | Token generation, Room CRUD, Participant management                                     |
| `internal/delivery/handler/agent.go`     | Agent Start/Stop/Status REST handlers (supports multiple agents per room)               |
| `internal/infrastructure/asr/`           | ASR provider implementations (Google gRPC, Azure REST)                                  |
| `internal/domain/domain.go`              | ASRProvider interface                                                                   |

---

## Environment Variables

```bash
LIVEKIT_API_KEY=your_key
LIVEKIT_API_SECRET=your_secret
LIVEKIT_URL=ws://localhost:7880    # Production: wss://your-domain
```

---

## Notes

- **CGO Required:** Agent ใช้ `gopkg.in/hraban/opus.v2` สำหรับ decode Opus audio → ต้อง build ด้วย CGO_ENABLED=1
- **Auto-subscribe:** LiveKit default auto-subscribe ทำให้ Agent ได้รับ audio จากทุก participant อัตโนมัติ
- **Multiple Agents:** รองรับหลาย agent ใน room เดียวกัน ด้วย key `roomName-provider`
- **Broadcast:** Agent publish transcript ไปยัง **ทุก participant** ใน room (ไม่ filter destination)
