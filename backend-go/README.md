# Thai Verbatim Transcriber - Go Backend

Go backend สำหรับ Real-time Thai Speech-to-Text ด้วย Fiber + WebSocket

## Overview

| Feature       | Description                                           |
| ------------- | ----------------------------------------------------- |
| Framework     | Go + Fiber v2 (High-performance)                      |
| Protocol      | WebSocket real-time streaming                         |
| ASR Providers | Gemini, Google Cloud STT, Azure Speech                |
| Language      | Thai (th-TH) verbatim transcription                   |
| Architecture  | Clean Architecture (domain, delivery, infrastructure) |
| Dependencies  | Pure Go - No CGO required                             |

## Architecture

```
backend-go/
├── main.go                 # Entry point
├── config/                 # Configuration management
├── models/                 # Request/Response DTOs
└── internal/
    ├── domain/             # Core interfaces & entities
    ├── delivery/           # HTTP/WebSocket handlers & routes
    │   ├── routes.go
    │   └── handler/
    ├── infrastructure/     # External services
    │   ├── asr/            # ASR provider implementations
    │   └── agent/          # LiveKit agent
    └── pkg/audio/          # Audio utilities (PCM→WAV)
```

## Quick Start

### 1. Install & Configure

```bash
cd backend-go
go mod download
cp .env.example .env   # แก้ไข API keys ที่ต้องการใช้
```

### 2. Run

```bash
go run main.go
```

Startup logs จะแสดง providers ที่เปิดใช้งาน:
```
✅ Enabled ASR providers: [Gemini Google]
⚠️  [Azure] Disabled - AZURE_SUBSCRIPTION_KEY or AZURE_REGION not configured
```

### 3. Build for Production

```bash
go build -o transcriber-backend
./transcriber-backend
```

## ASR Providers

| Provider   | Mode      | Sample Rate | Format    | Latency |
| ---------- | --------- | ----------- | --------- | ------- |
| **Google** | Streaming | 48 kHz      | PCM Int16 | ~300ms  |
| **Gemini** | Batch     | 16 kHz      | WAV       | ~2-3s   |
| **Azure**  | Batch     | 16 kHz      | WAV       | ~1-2s   |

## API Endpoints

### REST Endpoints

| Method | Path         | Description               |
| ------ | ------------ | ------------------------- |
| GET    | `/health`    | Health check              |
| GET    | `/providers` | Check available providers |

### WebSocket Endpoints (Dynamic)

Endpoints เปิดใช้งานตาม API keys ที่ configure:

| Path      | Required Config                           |
| --------- | ----------------------------------------- |
| `/gemini` | `GEMINI_API_KEY`                          |
| `/google` | `GOOGLE_APPLICATION_CREDENTIALS`          |
| `/azure`  | `AZURE_SUBSCRIPTION_KEY` + `AZURE_REGION` |

### LiveKit Endpoints (Optional)

| Method | Path                    | Description               |
| ------ | ----------------------- | ------------------------- |
| POST   | `/livekit/token`        | Generate access token     |
| GET    | `/livekit/rooms`        | List rooms                |
| GET    | `/livekit/rooms/:name`  | Get room details          |
| DELETE | `/livekit/rooms/:name`  | Delete room               |
| POST   | `/livekit/agent/start`  | Start transcription agent |
| POST   | `/livekit/agent/stop`   | Stop agent                |
| GET    | `/livekit/agent/status` | Agent status              |

## WebSocket Protocol

### Client → Server

**Control Messages (JSON):**
```json
{ "type": "start" }
{ "type": "stop" }
```

**Audio Data (Binary):**
- PCM Int16, Little-endian
- Sample rate ตาม provider (48kHz หรือ 16kHz)

### Server → Client

```json
{ "type": "connected" }

{
  "type": "transcript",
  "transcript": "สวัสดีครับ",
  "is_final": true,
  "channel": {
    "alternatives": [{
      "transcript": "สวัสดีครับ",
      "confidence": 0.95
    }]
  }
}

{ "type": "error", "error": "error message" }
```

## Environment Variables

```bash
# Server
HOST=0.0.0.0
PORT=3000

# ASR Providers (optional - enable only what you need)
GEMINI_API_KEY=your_key
GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json
AZURE_SUBSCRIPTION_KEY=your_key
AZURE_REGION=southeastasia

# LiveKit (optional)
LIVEKIT_API_KEY=your_key
LIVEKIT_API_SECRET=your_secret
LIVEKIT_URL=wss://your-livekit-server.com
```

## Check Provider Status

```bash
curl http://localhost:3000/providers
```

```json
{
  "gemini": true,
  "google": true,
  "azure": false,
  "livekit": true
}
```

## Dependencies

| Package                                                               | Purpose             |
| --------------------------------------------------------------------- | ------------------- |
| [gofiber/fiber](https://github.com/gofiber/fiber)                     | Web framework       |
| [gofiber/websocket](https://github.com/gofiber/websocket)             | WebSocket support   |
| [google/generative-ai-go](https://github.com/google/generative-ai-go) | Gemini API          |
| [cloud.google.com/go/speech](https://cloud.google.com/go/speech)      | Google Cloud STT    |
| [livekit/server-sdk-go](https://github.com/livekit/server-sdk-go)     | LiveKit integration |
