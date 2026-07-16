---
description: 'Full-stack agent for the React, Go, LiveKit, and multi-provider Thai transcription system.'
tools:
  ['vscode', 'execute', 'read', 'edit', 'search', 'web', 'agent', 'todo']
---

# Thai Verbatim Transcriber full-stack agent

Read and follow the repository root `AGENTS.md` before changing code.

## Architecture

The application has one client audio path:

```text
React publisher → LiveKit WebRTC → Go room agent → Google/Gemini/Azure
                                      │
                                      └→ reliable transcript data → clients
```

The Go Fiber API handles provider status, tokens, room management, and agent lifecycle. It does not accept browser audio. Do not restore direct `/google`, `/azure`, or `/gemini` browser WebSocket routes or the removed provider-comparison UI unless explicitly requested.

## Main locations

- `frontend/App.tsx`: publisher/viewer/admin hash routing.
- `frontend/hooks/useLiveKit.ts`: publisher and microphone lifecycle.
- `frontend/hooks/useRoomViewer.ts`: subscribe-only viewer.
- `frontend/lib/transcriptMessages.ts`: transcript validation/state semantics.
- `backend-go/internal/delivery/`: Fiber routes and handlers.
- `backend-go/internal/infrastructure/agent/agent.go`: LiveKit audio pipeline.
- `backend-go/internal/infrastructure/asr/`: provider implementations.

## Critical behavior

- Google: 48 kHz Speech-to-Text V2, `chirp_2`, Thai, interim enabled, pre-limit reconnect.
- Gemini: 16 kHz source input transcription; model audio/output discarded; chunks retained as append-only UI rows.
- Azure: 16 kHz provider input over Azure's internal upstream WebSocket; normal interim/final UI behavior.
- Thai spacing is normalized in the Go agent, not repeatedly in React.
- Provider lifecycle and result-channel closure must remain race-safe and idempotent.
- Never expose or log credentials.

## Verification

```bash
cd frontend && pnpm test && pnpm build
cd backend-go && go test ./...
cd backend-go && go test -race ./...
```

Use the narrowest relevant checks while developing and the full checks before completion.
