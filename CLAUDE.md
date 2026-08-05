# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Source of truth

`AGENTS.md` at the repo root is the canonical contributor guide for this project. Read it in full before changing any code — it covers architecture, provider-specific behavior, transcript contracts, backend/frontend conventions, configuration, verification expectations, and git rules that apply regardless of which agent is operating. **This file does not replace AGENTS.md; if anything here appears to conflict with it, AGENTS.md wins.**

What follows is a condensed index to get oriented quickly. For anything beyond orientation (provider semantics, conventions, doc rules, git rules), go to AGENTS.md directly rather than relying on the summary below.

## Project in one paragraph

CaptionLive is a real-time Thai transcription workspace on LiveKit. Audio Source publishes mic/Chrome-tab audio over WebRTC into a LiveKit room; a Go room/provider agent subscribes to the track, decodes PCM, and streams it to one ASR provider (Google, Gemini, Azure, or GPT Realtime Translate); normalized transcript results go back over the LiveKit data channel (for Transcript/Caption Desk) and out through a signed external WebSocket hub. There is no browser-to-ASR or browser-to-backend audio WebSocket — audio only ever goes browser → LiveKit.

## Commands

```bash
# Local LiveKit (must be running first)
cd livekit && docker compose up -d

# Frontend + backend dev servers
./start.sh

# Frontend (React 19 + TS + Vite + Tailwind)
cd frontend
pnpm install
pnpm test
pnpm build

# Backend (Go 1.24 + Fiber)
cd backend-go
go mod download
go test ./...
go test -race ./...   # required for agent lifecycle/channel/mutex/reconnect changes
go build ./...
```

Use `pnpm` (not npm/yarn) for the frontend; `pnpm-lock.yaml` is authoritative. The Go agent needs CGO plus a system Opus library (`brew install opus pkg-config` / `apt-get install libopus-dev`).

Match verification to what changed — see AGENTS.md's "Verification expectations" for the full mapping (frontend logic → `pnpm test` + `pnpm build`; backend → `go test ./...` or `-race`; provider parsing → tests under `backend-go/internal/infrastructure/asr/`; transcript state → `frontend/lib/*.test.ts`).

## Architecture cheat sheet

```
Audio Source ─WebRTC──► LiveKit room ─► room/provider agent ─► ASR provider (Google/Gemini/Azure/GPT)
                                              │
                                              ├─► LiveKit data channel ─► Transcript / Caption Desk
                                              └─► transcript hub ─► signed external WebSocket
Control Room / Audio Source / Transcript ──HTTP (tokens, rooms, links)──► Go backend
```

- `frontend/`: Control Room (`#admin`), Audio Source (`#stream`), Transcript (`#viewer`), Caption Desk (`#caption-desk`) — see `frontend/App.tsx` for hash routing.
- `backend-go/`: layered as `delivery` (Fiber routes/handlers) → `application` (Room Operations, Room Agent Supervisor, Transcript Feed Access Policy) → `domain` (provider contract + Thai normalization) → `infrastructure` (LiveKit adapter, room agent, ASR providers, transcript/JWT). `main.go` is the composition root.
- Full entry-point list, provider-specific behavior (sample rates, endpointing, reconnect), and transcript output contracts (Draft/final semantics, `/ws/transcript/:provider/:room` frame shape) live in AGENTS.md — this is the part most likely to bite you if skipped.

## Where to look next

- `AGENTS.md` — development rules, conventions, contracts (read first).
- `README.md` — product surfaces, system flow diagrams, getting-started.
- `PRODUCT.md` — brand/design principles and accessibility bar.
- `CONTEXT.md` — domain glossary (Room, Room Agent, Room Agent Supervisor, etc.).
- `backend-go/README.md`, `frontend/README.md`, `livekit/README.md` — subsystem detail (HTTP/WS contracts, env vars, routes).
