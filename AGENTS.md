# Repository Agent Guide

## Scope and precedence

This file applies to the entire repository. More specific `AGENTS.md` files may add rules for a subdirectory. Follow system and user instructions first, then the closest repository instructions.

## Project overview

Thai Verbatim Transcriber is a real-time Thai transcription workspace built around LiveKit rooms. A browser publishes microphone or Chrome Tab audio through WebRTC, a Go agent subscribes to the track, sends decoded PCM to one ASR provider, and publishes transcript messages back through the LiveKit data channel.

There is no browser-to-ASR or browser-to-backend audio WebSocket mode. Do not restore the removed `/google`, `/azure`, or `/gemini` client WebSocket endpoints or provider-comparison UI unless explicitly requested.

## Current architecture

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
              Google / Gemini / Azure / GPT Realtime Whisper
```

- `frontend/`: React 19, TypeScript, Vite, Tailwind CSS, LiveKit client.
- `backend-go/`: Go 1.24, Fiber HTTP API, LiveKit room agent, provider implementations.
- `livekit/`: local Docker Compose setup for LiveKit.
- `start.sh`: local frontend/backend launcher. LiveKit must already be running.

## Important entry points

- Frontend shell and hash routing: `frontend/App.tsx`
- Publisher connection: `frontend/hooks/useLiveKit.ts`
- Viewer connection: `frontend/hooks/useRoomViewer.ts`
- Transcript parsing/state helpers: `frontend/lib/transcriptMessages.ts`
- Backend entry point: `backend-go/main.go`
- HTTP routes: `backend-go/internal/delivery/routes.go`
- Agent lifecycle API: `backend-go/internal/delivery/handler/agent.go`
- LiveKit agent/audio pipeline: `backend-go/internal/infrastructure/agent/agent.go`
- Provider interface and Thai normalization: `backend-go/internal/domain/domain.go`
- Provider implementations: `backend-go/internal/infrastructure/asr/`

## Provider behavior

Preserve these provider-specific semantics:

- Google uses Speech-to-Text V2 streaming at 48 kHz, defaults to `chirp_2` in `asia-southeast1`, requests interim results, enables automatic punctuation, and reconnects before the five-minute stream limit.
- Azure receives 16 kHz PCM after the agent resamples 48 kHz WebRTC audio. The provider uses Azure's upstream WebSocket protocol; this is not a public application WebSocket endpoint.
- Gemini uses `gemini-3.5-live-translate-preview` at 16 kHz. The model requires an audio response modality, but model audio is discarded. Source and configured-target text are exposed and paired with application `turnId` values.
- Gemini requests an application turn boundary after the shared 650 ms low-energy window or a 30-second hard duration, then allows a fixed 500 ms translation grace period. Alignment is best-effort.
- GPT Realtime Whisper uses transcription intent at 24 kHz PCM16, publishes source-only Draft/final text, commits after the shared 650 ms silence window or 30-second hard duration, and performs bounded reconnect with up to one second of recent-audio replay.
- Non-final source text remains replaceable Draft state keyed by provider and speaker. Gemini additionally keys source/translation state by `turnId`; final source text becomes a committed row.

## Backend conventions

- Keep provider-independent contracts in `internal/domain` and provider details in `internal/infrastructure/asr`.
- Keep HTTP parsing/status handling in `internal/delivery/handler` and route registration in `internal/delivery/routes.go`.
- Pass `context.Context` through network and long-running operations.
- Provider `Stop` methods must be idempotent. Close result channels exactly once and avoid sending after closure.
- Guard shared agent/provider lifecycle state with the existing mutex patterns.
- Normal audio-track/provider closure must release the track-scoped provider while keeping the room agent connected. Unexpected provider errors stop the agent. Keep stale providers from stopping or clearing a replacement provider.
- Normalize Thai spacing at the agent output boundary with `domain.NormalizeThaiSpacing`; do not add browser-side spacing transformations that destroy interim behavior.
- Never log credentials, tokens, API keys, service-account contents, or complete `.env` values.
- The LiveKit agent uses `hraban/opus` and requires CGO plus a system Opus library.

## Frontend conventions

- Keep publisher, viewer, and admin experiences visually and behaviorally consistent.
- Use `parseTranscriptMessage` for data-channel payload validation.
- Keep committed transcripts bounded; do not allow unbounded state growth.
- Preserve independent interim entries by provider/speaker.
- Avoid provider-specific capture hooks. Microphone and Chrome Tab publishing belong to `useLiveKit`; Chrome Tab capture helpers belong to `frontend/lib/audioSources.ts`.
- Keep selected-audio and session state explicit: room joined, audio source on/off/stopped, and transcription agent connected.
- Lines view may show paired Gemini translation. Text view must remain source-only and may mark active source Draft inline; per-provider `.txt` export must contain finalized source text only.
- Use the shared top-right Toast viewport for transient operation feedback; keep persistent session state and inline validation in context.
- Do not hide operational state using color alone; retain text/icon status and keyboard accessibility.
- Prefer existing components, Tailwind patterns, and dependencies. Do not add a visualization library unless the existing canvas implementation cannot satisfy the requirement.

## Configuration and secrets

- Copy examples; never edit or commit real `.env` files or credential JSON.
- Backend config source: `backend-go/config/config.go` and `backend-go/.env.example`.
- Frontend build-time variables: `frontend/.env.example`.
- Local LiveKit credentials: `livekit/.env.example`; development defaults are not production-safe.
- `VITE_BACKEND_URL` is an HTTP base URL. `VITE_LIVEKIT_URL` and `LIVEKIT_WS_URL` are WebSocket URLs.

## Development commands

```bash
# Start local LiveKit first
cd livekit && docker compose up -d

# Start frontend and backend
./start.sh

# Frontend
cd frontend
pnpm install
pnpm test
pnpm build

# Backend
cd backend-go
go mod download
go test ./...
go test -race ./...
go build ./...
```

Use `pnpm` for frontend dependency operations. Keep `pnpm-lock.yaml` authoritative.

## Verification expectations

- Frontend-only logic/UI change: run `pnpm test` and `pnpm build` in `frontend/`.
- Backend change: run `go test ./...` in `backend-go/`; use `go test -race ./...` for lifecycle, channel, mutex, or agent changes.
- Provider parsing change: add or update focused tests under `backend-go/internal/infrastructure/asr/`.
- Transcript state change: update tests under `frontend/lib/*.test.ts`.
- Documentation/config change: verify referenced files and commands exist, search for stale architecture terms, and run the narrowest affected build/test.

## Documentation rules

- Keep `README.md`, `frontend/README.md`, `backend-go/README.md`, `livekit/README.md`, examples, and technical docs consistent with implementation.
- Treat `backend-go/docs/EDITOR_MODE_DESIGN.md` as a design proposal, not implemented behavior.
- Document upstream provider protocols separately from public application APIs.
- Do not claim latency or recognition quality as guaranteed; describe values as operational expectations when needed.

## Git and generated files

- Preserve unrelated user changes in the dirty worktree.
- Do not stage, commit, reset, clean, or push unless explicitly requested.
- Do not commit `frontend/dist/`, `frontend/node_modules/`, backend binaries, `.env` files, logs, or credentials.
- Use `gofmt` for Go edits. Keep TypeScript compatible with the existing Vite/TypeScript configuration.
