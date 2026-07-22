# Thai Verbatim Transcriber

LiveKit-based real-time Thai speech transcription for publishers, viewers, and operators. Microphone or Chrome Tab audio travels through WebRTC to a Go room agent, which transcribes with Google Cloud STT, Gemini Live, Azure Speech, or GPT Realtime Whisper and publishes text back through the LiveKit data channel.

## Key features

- One LiveKit workflow for microphone or Chrome Tab audio publishing and transcription.
- Selectable Google, Gemini, Azure, or GPT Realtime Whisper room agents.
- Replaceable Draft text, grouped final rows, a source-only Text view, and per-provider final-only text export.
- Read-only viewer with room audio playback and provider filtering.
- Admin-first room workspace for rooms, participants, share links, and agent lifecycle.
- Secure, read-only transcript WebSocket links for external integrations.
- Input-level visualization, explicit session state, and consistent top-right notifications.

## Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [ASR providers](#asr-providers)
- [Configuration](#configuration)
- [Backend API](#backend-api)
- [Development and testing](#development-and-testing)
- [Troubleshooting](#troubleshooting)

## Architecture

```text
Publisher / Viewer / Admin (React)
              │
              ├── HTTP → Go backend (tokens, rooms, agent control)
              │
              └── WebRTC + data channel
                         │
                    LiveKit server
                         │
                    Go room agent
                         │
              Google / Gemini / Azure / OpenAI Realtime Whisper
```

The public application does not expose direct audio WebSocket endpoints. Azure's WebSocket connection is an internal upstream protocol used only by the Azure provider.

### Repository layout

```text
.
├── AGENTS.md                 # Repository rules for coding agents
├── PRODUCT.md                # Product and design principles
├── start.sh                  # Frontend/backend development launcher
├── frontend/                 # React application
│   ├── components/           # Publisher, viewer, admin, and status UI
│   ├── hooks/                # LiveKit publisher/viewer and audio hooks
│   └── lib/                  # Transcript, session, API, and signal helpers
├── backend-go/               # Fiber API and LiveKit transcription agent
│   ├── config/               # Environment-backed configuration
│   ├── internal/delivery/    # HTTP routes and handlers
│   ├── internal/domain/      # Provider contracts and Thai normalization
│   └── internal/infrastructure/ # LiveKit agent and ASR providers
└── livekit/                  # Local LiveKit Docker Compose setup
```

## Technology

| Area | Technology |
| --- | --- |
| Frontend | React 19, TypeScript 5.8, Vite 6, Tailwind CSS 3 |
| Realtime client | LiveKit Client SDK |
| Backend | Go 1.24, Fiber v2 |
| Realtime server | LiveKit |
| Audio decode | Opus through `gopkg.in/hraban/opus.v2` (CGO) |
| ASR | Google Speech-to-Text V2, Gemini Live API, Azure Speech, OpenAI Realtime Whisper |

## Prerequisites

- Node.js 18 or newer and pnpm.
- Go 1.24.4 or a compatible newer release.
- Docker with Docker Compose for local LiveKit.
- A C compiler, `pkg-config`, and system Opus development library.
- Credentials for at least one ASR provider.

```bash
# macOS
brew install opus pkg-config

# Debian/Ubuntu
sudo apt-get install -y build-essential pkg-config libopus-dev
```

## Getting started

### 1. Start LiveKit

```bash
cp livekit/.env.example livekit/.env
cd livekit
docker compose up -d
docker compose ps
cd ..
```

The development defaults use `devkey` / `secret` and are not production-safe.

### 2. Configure the backend

```bash
cp backend-go/.env.example backend-go/.env
```

Edit `backend-go/.env` and configure LiveKit plus at least one provider. Never commit `.env` or credential JSON files.

### 3. Configure the frontend

```bash
cp frontend/.env.example frontend/.env
cd frontend
pnpm install
cd ..
```

### 4. Run

```bash
./start.sh
```

Or run the services separately:

```bash
# Terminal 1
cd backend-go
go run .

# Terminal 2
cd frontend
pnpm dev
```

Open:

- Admin: [http://localhost:5173](http://localhost:5173)
- Stream publisher: `http://localhost:5173/#stream?room=test`
- Viewer: `http://localhost:5173/#viewer?room=test&autoconnect=1`
- Health: [http://localhost:3000/health](http://localhost:3000/health)

## Application pages

- **Admin:** the root workspace creates/selects rooms, starts or stops a configured provider Agent, and generates Stream, Viewer, and external transcript links.
- **Stream:** selects Microphone or Chrome Tab before connecting, then publishes the chosen audio through LiveKit. A room query parameter only pre-fills the room and never requests capture permission by itself. Chrome Tab capture requires selecting a browser tab and enabling **Share tab audio** in the browser picker.
- **Viewer:** joins without publishing, subscribes to room audio, and filters transcript rows by provider. A Viewer link with `autoconnect=1` connects automatically.

## ASR providers

| Provider | Agent input | Default | Transcript behavior |
| --- | --- | --- | --- |
| Google | 48 kHz Linear16 PCM | `chirp_2`, `th-TH`, `asia-southeast1`, punctuation on | Interim snapshots and final utterances; reconnects before the five-minute limit |
| Gemini | 16 kHz PCM | `gemini-3.5-live-translate-preview`, optional source hint, target defaults to `th` | Replaceable source/translation Draft state is paired by application turn; session resumption, context compression, safe nine-minute rotation, and bounded reconnect keep long-running audio connected |
| GPT Realtime Whisper | 24 kHz PCM16 | Realtime transcription intent with model `gpt-realtime-whisper`, source language defaults to `th` | Replaceable source Draft deltas and completed finals; 650 ms silence/30-second hard boundary; bounded reconnect with recent-audio replay; no translation output |
| Azure | 16 kHz PCM/WAV stream | Thai conversation recognition, `southeastasia` | Interim hypotheses and finalized phrases |

Latency and interim frequency depend on service, model, region, network, and speech pattern. A provider may finalize an utterance without emitting interim updates.

## Configuration

### Backend variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `HOST` | No | `localhost` | Fiber bind host |
| `PORT` | No | `3000` | Fiber HTTP port |
| `ALLOWED_ORIGINS` | No | Local origins | Comma-separated CORS allowlist |
| `LIVEKIT_API_KEY` | For LiveKit routes | — | LiveKit API key |
| `LIVEKIT_API_SECRET` | For LiveKit routes | — | LiveKit API secret |
| `LIVEKIT_WS_URL` | No | `ws://localhost:7880` | LiveKit server URL |
| `TRANSCRIPT_WS_SECRET` | For external transcript links | — | Server-side HS256 signing secret; use at least 32 random bytes |
| `CONTROL_API_KEY` | Required for remote control API | — | At least 32 random bytes; protects room, agent, participant-token, and transcript-link APIs |
| `GOOGLE_CLOUD_PROJECT` | For Google | — | Google Cloud project |
| `GOOGLE_APPLICATION_CREDENTIALS` | Google service account | — | Credential JSON path |
| `GOOGLE_API_KEY` | Alternative Google auth | — | Google API key |
| `GOOGLE_CLOUD_LOCATION` | No | `asia-southeast1` | Speech-to-Text V2 location |
| `GOOGLE_SPEECH_MODEL` | No | `chirp_2` | Google model |
| `GEMINI_API_KEY` | For Gemini | — | Gemini API key |
| `GEMINI_MODEL` | No | `gemini-3.5-live-translate-preview` | Gemini model |
| `GEMINI_LANGUAGE_CODE` | No | — | Optional source language hint; empty enables detection |
| `GEMINI_TARGET_LANGUAGE_CODE` | No | `th` | Supported BCP-47 translation target and UI language badge |
| `OPENAI_API_KEY` | For GPT Realtime Whisper | — | OpenAI API key; enables the `gpt-realtime-whisper` provider |
| `OPENAI_LANGUAGE_CODE` | No | `th` | Source-language hint sent to the transcription session |
| `AZURE_SUBSCRIPTION_KEY` | For Azure | — | Azure Speech key |
| `AZURE_REGION` | No | `southeastasia` | Azure region |

Gemini target examples include `th`, `en`, `de`, `es`, `ja`, `ko`, `vi`, `zh-Hans`, `zh-Hant`, `pt-BR`, and `pt-PT`. Unsupported values are rejected when the provider starts. See the [complete supported target list](backend-go/README.md#gemini-live-translation-target-languages).

### Frontend variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_BACKEND_URL` | `http://localhost:3000` | Backend HTTP base URL |
| `VITE_LIVEKIT_URL` | `ws://localhost:7880` | Browser LiveKit URL |
| `VITE_CONTROL_API_KEY` | — | Shared control API key for trusted internal deployments; do not embed in a public frontend build |

Frontend connection values are embedded by Vite at build time. There is no runtime Settings screen for changing the backend URL; update the environment and rebuild or restart Vite.

## Backend API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Health check |
| `GET` | `/providers` | Provider and LiveKit availability |
| `POST` | `/livekit/token` | Create a participant token |
| `POST` | `/livekit/rooms/` | Create an empty room; does not start an Agent |
| `GET` | `/livekit/rooms/` | List rooms |
| `GET` | `/livekit/rooms/detailed` | List rooms with participants |
| `POST` | `/livekit/rooms/:room/transcript-token` | Issue a 24-hour room-scoped transcript WebSocket URL |
| `GET` | `/livekit/rooms/:room/transcripts/ws?token=...` | Read-only interim/final transcript stream |
| `GET` / `DELETE` | `/livekit/rooms/:name` | Inspect or delete a room |
| `DELETE` | `/livekit/rooms/:room/participants/:identity` | Remove a participant |
| `POST` | `/livekit/agent/start` | Start a room agent |
| `POST` | `/livekit/agent/stop` | Stop a room agent |
| `GET` | `/livekit/agent/status` | List running agents |

```bash
curl -X POST http://localhost:3000/livekit/agent/start \
  -H 'Content-Type: application/json' \
  -d '{"roomName":"test","provider":"google"}'
```

Valid providers are `google`, `gemini`, `azure`, and `gpt-realtime-whisper` when configured.

### External transcript WebSocket

The Admin workspace generates a signed URL for a room after `TRANSCRIPT_WS_SECRET` is configured. The token is bound to the current LiveKit room identity, so deleting and recreating a room with the same name does not reuse the old link. The socket carries source transcripts only; Gemini translation packets remain on the LiveKit data channel for bilingual UI rows. It cannot publish audio or control the room. There is no history/replay, and events are delivered only after the client connects.

The first event is:

```json
{"schemaVersion":"1.0","type":"session.ready","room":"test","timestamp":"2026-07-16T10:00:00.000Z"}
```

Transcript events use a room-scoped sequence:

```json
{
  "schemaVersion": "1.0",
  "type": "transcript.interim",
  "id": "event-id",
  "sequence": 1,
  "room": "test",
  "timestamp": "2026-07-16T10:00:00.123Z",
  "transcript": {
    "text": "กำลังทดสอบ",
    "isFinal": false,
    "confidence": 0.91,
    "provider": "google",
    "speaker": "user-123"
  }
}
```

`transcript.final` events have `isFinal: true`. The gateway consumes the same normalized messages published to LiveKit, so interim and final behavior stays consistent across the Viewer and external integration.

## Transcript message contract

```json
{
  "type": "transcript",
  "text": "ทดสอบหนึ่งสองสาม",
  "isFinal": false,
  "confidence": 0.92,
  "provider": "google",
  "timestamp": 1784196259000,
  "speaker": "user-1784196259605"
}
```

Thai spacing is normalized in the Go agent. Non-final source text is replaceable Draft state keyed by provider and speaker; Gemini also keys source/translation pairs by its application `turnId`. Final values become bounded committed rows. The Lines view can show Gemini translation beneath its source. Text view shows source only and marks any active Draft inline; per-provider `.txt` export contains finalized source text only. For readability, adjacent finals from the same provider, speaker, and language are displayed together when they arrive within 1.6 seconds and the previous chunk has no strong sentence-ending punctuation.

The Stream page coalesces Draft rendering without delaying the first update or a final result: 33 ms for general interim traffic and 100 ms for Gemini. GPT Realtime Whisper continuously streams 24 kHz PCM16, commits after 650 ms of low-energy audio or a 30-second hard duration, and retries recoverable upstream failures with bounded backoff plus up to one second of recent-audio replay. Gemini uses the same 650 ms silence boundary with a fixed 500 ms translation grace period. Gemini also enables Live API session resumption and sliding-window context compression, reconnects on `GoAway` or transport failure, and attempts a nine-minute connection rotation when the server has supplied a safe resumption handle; up to fifteen seconds of audio received during the handoff is replayed.

When an Audio Sender disconnects or unpublishes its track normally, the track-scoped provider is released but the room agent remains connected and waits for the next audio track. An unexpected provider error stops the agent so Admin status does not report a falsely healthy transcriber.

## Development and testing

```bash
# LiveKit
cd livekit
docker compose up -d

# Frontend
cd frontend
pnpm test
pnpm build

# Backend
cd backend-go
go test ./...
go test -race ./...
go build ./...
```

`start.sh` supports `--frontend-only`, `--backend-only`, `--build`, and `--help`; it does not start LiveKit.

## Troubleshooting

- **Port in use:** inspect with `lsof -nP -iTCP:3000 -sTCP:LISTEN` or port `5173`, then stop the stale process.
- **No provider available:** call `/providers`, verify credentials, and restart the backend after changing `.env`.
- **Google model permission/location error:** use a model available in the configured region; the Thai realtime default is `chirp_2` in `asia-southeast1`.
- **No Draft text:** some utterances finalize without interim updates. For Gemini or GPT Realtime Whisper, also verify that PCM audio reaches the provider and that the local silence boundary can complete the active turn.
- **IPv6 STUN timeout:** if ICE reaches `connected`, an IPv6 timeout usually indicates an unavailable IPv6 path, not a failed session.
- **Opus build failure:** install `libopus`/`libopus-dev`, verify `pkg-config --modversion opus`, and ensure `go env CGO_ENABLED` returns `1`.

## Documentation

- [Agent guide](AGENTS.md)
- [Product principles](PRODUCT.md)
- [Frontend](frontend/README.md)
- [Backend](backend-go/README.md)
- [Local LiveKit](livekit/README.md)
- [LiveKit flow](backend-go/docs/LIVEKIT_FLOW.md)
- [Google flow](backend-go/docs/GOOGLE_GRPC_FLOW.md)
- [Azure flow](backend-go/docs/AZURE_WEBSOCKET_FLOW.md)
- [Google five-minute handling](backend-go/docs/ISSUE_GOOGLE_5MIN_LIMIT.md)
- [Cloud VAD and endpointing](backend-go/docs/VAD_CONFIGURATION.md)
- [Editor mode proposal](backend-go/docs/EDITOR_MODE_DESIGN.md)

## Security and deployment

- Never expose ASR credentials or LiveKit secrets to the browser.
- Replace local LiveKit development credentials before remote deployment.
- Use HTTPS/WSS and a restricted `ALLOWED_ORIGINS` list outside localhost.
- Configure external IP, firewall, UDP ports, and TURN for the target LiveKit network.
- The repository does not currently include production frontend/backend deployment manifests.

## License

MIT
