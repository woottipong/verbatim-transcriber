# Thai Verbatim Transcriber

Real-time Thai Speech-to-Text ด้วย Multi-provider ASR Comparison

## Overview

Web application สำหรับถอดความเสียงพูดภาษาไทยแบบ real-time โดยสามารถเปรียบเทียบผลลัพธ์จาก ASR providers หลายตัวพร้อมกัน

**2 โหมดการทำงาน:**

1. **WebSocket Mode** - เชื่อมต่อตรงกับ ASR ผ่าน Backend
2. **LiveKit Mode** - ใช้ WebRTC + Agent สำหรับ room-based transcription

## Features

| Feature             | Description                              |
| ------------------- | ---------------------------------------- |
| Multi-Provider ASR  | Google Cloud STT, Azure Speech           |
| Real-time Streaming | WebSocket + LiveKit WebRTC               |
| Thai Optimized      | ปรับแต่งสำหรับภาษาไทย verbatim transcription |
| Side-by-Side        | เปรียบเทียบผลลัพธ์จาก providers พร้อมกัน       |
| LiveKit Integration | Room-based transcription with agent      |
| Viewer Mode         | ดู transcript + ฟังเสียง real-time          |

---

## Mode 1: WebSocket ASR

**ใช้เมื่อ:** ต้องการ transcribe เสียงของตัวเองโดยตรง (simple, low latency)

### Flow

```
    Browser                      Go Backend                    ASR API
       │                             │                            │
       │  1. Connect WebSocket       │                            │
       │  ws://localhost:3000/google │                            │
       │ ─────────────────────────►  │                            │
       │                             │                            │
       │  2. { type: "connected" }   │                            │
       │  ◄───────────────────────── │                            │
       │                             │                            │
       │  3. Send Binary Audio       │                            │
       │  (PCM 48kHz)                │                            │
       │ ─────────────────────────►  │  4. Forward to ASR         │
       │                             │ ─────────────────────────► │
       │                             │                            │
       │                             │  5. Transcript Result      │
       │                             │ ◄───────────────────────── │
       │  6. JSON Response           │                            │
       │  { type: "transcript",      │                            │
       │    text: "สวัสดี",            │                            │
       │    isFinal: true }          │                            │
       │  ◄───────────────────────── │                            │
       │                             │                            │
       ▼                             ▼                            ▼
```

### Endpoints

| Endpoint  | Provider         | Audio Format | Mode      |
| --------- | ---------------- | ------------ | --------- |
| `/google` | Google Cloud STT | 48kHz PCM    | Streaming |
| `/azure`  | Azure Speech     | 16kHz WAV    | Batch     |

---

## Mode 2: LiveKit (WebRTC)

**ใช้เมื่อ:** ต้องการ room-based, หลายคน join ดูพร้อมกัน, หรือต้องการ Viewer mode

### Flow

```
  Publisher                LiveKit Server              Go Agent                ASR
      │                          │                         │                    │
      │  1. Join Room            │                         │                    │
      │  (WebRTC)                │                         │                    │
      │ ────────────────────────►│                         │                    │
      │                          │                         │                    │
      │  2. Publish Audio Track  │  3. Agent Join Room     │                    │
      │ ────────────────────────►│◄─────────────────────── │                    │
      │                          │                         │                    │
      │                          │  4. Audio Stream (Opus) │                    │
      │                          │ ───────────────────────►│                    │
      │                          │                         │                    │
      │                          │                         │  5. Send to ASR    │
      │                          │                         │ ──────────────────►│
      │                          │                         │                    │
      │                          │                         │  6. Transcript     │
      │                          │                         │◄────────────────── │
      │                          │  7. Data Channel        │                    │
      │  8. Receive Transcript   │◄─────────────────────── │                    │
      │◄──────────────────────── │                         │                    │
      │                          │                         │                    │
      ▼                          ▼                         ▼                    ▼


  Viewer                   LiveKit Server
      │                          │
      │  1. Join Room            │
      │  (Subscribe Only)        │
      │ ────────────────────────►│
      │                          │
      │  2. Receive Audio        │
      │  (from Publisher)        │
      │◄──────────────────────── │
      │                          │
      │  3. Receive Transcript   │
      │  (from Agent)            │
      │◄──────────────────────── │
      │                          │
      │  🔊 Play Audio           │
      │  📝 Show Transcript      │
      │                          │
      ▼                          ▼
```

### ขั้นตอน

**Publisher:**

1. Join room ด้วย `useLiveKit()` hook
2. Publish audio track ไปยัง LiveKit Server
3. รอรับ transcript ผ่าน Data Channel

**Agent (Backend):**

1. Join room เดียวกัน
2. Subscribe audio จาก Publisher
3. ส่ง audio ไป ASR
4. Broadcast transcript กลับ

**Viewer:**

1. Join room ด้วย `useRoomViewer()` (subscribe only)
2. ได้ยินเสียงจาก Publisher
3. เห็น transcript real-time

### ข้อดีของ LiveKit Mode

- หลายคนดูพร้อมกันได้ (Viewer mode)
- Audio + Transcript sync
- Room management (create/delete/list)
- WebRTC = better audio quality
- Multi-speaker support (future)

---

## Project Structure

```
thai-verbatim-transcriber/
├── frontend/                 # React 19 + TypeScript + Vite
│   ├── hooks/                # useGoogle, useAzure, useLiveKit, useRoomViewer
│   ├── components/           # UI components
│   └── lib/                  # Utilities
│
├── backend-go/               # Go + Fiber (Clean Architecture)
│   ├── config/               # Configuration
│   ├── models/               # Request/Response DTOs
│   └── internal/
│       ├── domain/           # Core interfaces
│       ├── delivery/         # Handlers + Routes
│       ├── infrastructure/   # ASR + LiveKit Agent
│       └── pkg/audio/        # Audio utilities
│
└── start.sh                  # Quick start script
```

## Quick Start

### Prerequisites

- Node.js 18+
- Go 1.22+
- pnpm (recommended) or npm
- API Keys (Google/Azure - อย่างน้อย 1 provider)

### 1. Clone & Setup

```bash
git clone https://github.com/woottipong/verbatim-transcriber.git
cd thai-verbatim-transcriber

# Backend
cd backend-go
cp .env.example .env
# Edit .env - add API keys

# Frontend
cd ../frontend
cp .env.example .env

# Recommended: Use pnpm for better performance
pnpm install

# Alternative: Use npm
npm install
```

### 2. Start

```bash
# Option 1: Quick start script
./start.sh

# Option 2: Manual
# Terminal 1 - Backend
cd backend-go && go run main.go

# Terminal 2 - Frontend
cd frontend && pnpm run dev  # or npm run dev
```

### 3. Open Browser

- **Main App:** http://localhost:5173
- **Viewer:** http://localhost:5173#viewer
- **Admin:** http://localhost:5173#admin

## ASR Providers Comparison

| Provider         | Mode      | Sample Rate | Format | Latency | Thai Quality |
| ---------------- | --------- | ----------- | ------ | ------- | ------------ |
| Google Cloud STT | Streaming | 48 kHz      | PCM    | ~300ms  | ⭐⭐⭐⭐⭐        |
| Azure Speech     | Batch     | 16 kHz      | WAV    | ~1-2s   | ⭐⭐⭐⭐         |

## Environment Variables

### Backend (`backend-go/.env`)

```bash
# Server
PORT=3000

# ASR Providers (configure what you have)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json
AZURE_SUBSCRIPTION_KEY=your_key
AZURE_REGION=southeastasia

# LiveKit (optional)
LIVEKIT_API_KEY=your_key
LIVEKIT_API_SECRET=your_secret
LIVEKIT_URL=ws://localhost:7880
```

### Frontend (`frontend/.env`)

```bash
VITE_BACKEND_URL=ws://localhost:3000
VITE_LIVEKIT_URL=ws://localhost:7880
```

## Documentation

| Document                                                          | Description                          |
| ----------------------------------------------------------------- | ------------------------------------ |
| [Frontend README](frontend/README.md)                             | React app details, hooks, components |
| [Backend README](backend-go/README.md)                            | Go server, handlers, API endpoints   |
| **Backend Docs:**                                                 |                                      |
| [WebSocket Format](backend-go/docs/WEBSOCKET_FORMAT.md)           | Message format specification         |
| [Google gRPC Flow](backend-go/docs/GOOGLE_GRPC_FLOW.md)           | Google STT data flow                 |
| [Azure WebSocket Flow](backend-go/docs/AZURE_WEBSOCKET_FLOW.md)   | Azure protocol details               |
| [LiveKit Flow](backend-go/docs/LIVEKIT_FLOW.md)                   | LiveKit WebRTC architecture & flow   |
| [Provider Comparison](backend-go/docs/GOOGLE_AZURE_COMPARISON.md) | Google vs Azure                      |
| [Google 5-Min Limit](backend-go/docs/ISSUE_GOOGLE_5MIN_LIMIT.md)  | Streaming limit & solutions          |
| [VAD Configuration](backend-go/docs/VAD_CONFIGURATION.md)         | Voice Activity Detection             |

## Tech Stack

**Frontend:** React 19, TypeScript, Vite 6, Tailwind CSS, LiveKit Client SDK

**Backend:** Go 1.22+, Fiber v2, gRPC (Google STT), LiveKit Server SDK

## License

MIT
