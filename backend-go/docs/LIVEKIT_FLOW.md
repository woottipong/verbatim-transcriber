# LiveKit architecture and data flow

## Scope

LiveKit is the application's only client audio transport. Publishers send microphone audio through WebRTC; viewers subscribe without publishing; the Go backend uses HTTP only for tokens, room management, and agent control.

## Components

```text
Publisher                  LiveKit                  Go agent                  ASR
    │ join + publish Opus      │                        │                      │
    ├─────────────────────────►│                        │                      │
    │                          ├── subscribed track ───►│                      │
    │                          │                        ├── PCM audio ─────────►│
    │                          │                        │◄── transcript ────────┤
    │                          │◄── reliable data ──────┤                      │
    │◄── transcript packet ────┤                        │                      │

Viewer
    ├── join, subscribe only ─► LiveKit
    ├── receive participant audio
    └── receive transcript data
```

## Publisher flow

1. `useLiveKit` requests a token from `POST /livekit/token`.
2. The browser connects to the configured LiveKit URL.
3. The browser enables and publishes its microphone track.
4. The UI derives readiness from room connection, microphone state, and agent presence.
5. Transcript data packets are validated and committed or shown as active interim state.

## Agent flow

1. Admin starts an agent with `POST /livekit/agent/start` and a provider name.
2. The agent joins as `agent-<provider>-<timestamp>` and subscribes to audio tracks.
3. Opus is decoded to mono 48 kHz PCM.
4. Audio is batched into roughly 40 ms provider calls.
5. Google receives 48 kHz; Gemini and Azure receive simple 3:1 decimated 16 kHz PCM.
6. Provider results are normalized and published reliably as JSON data packets.

## Viewer flow

1. `useRoomViewer` requests a token with publishing disabled.
2. It subscribes to participant audio and transcript data.
3. It tracks connected agents and derives provider names from packets/identities.
4. It can filter transcript rows by provider.

## HTTP routes

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/livekit/token` | Participant token |
| `GET` | `/livekit/rooms/` | List rooms |
| `GET` | `/livekit/rooms/detailed` | Rooms and participants |
| `GET` / `DELETE` | `/livekit/rooms/:name` | Inspect/delete room |
| `DELETE` | `/livekit/rooms/:room/participants/:identity` | Remove participant |
| `POST` | `/livekit/agent/start` | Start provider agent |
| `POST` | `/livekit/agent/stop` | Stop provider agent |
| `GET` | `/livekit/agent/status` | Running agents |

## Transcript packet

```json
{
  "type": "transcript",
  "text": "emergency room",
  "isFinal": false,
  "confidence": 0.9,
  "provider": "gemini",
  "timestamp": 1784196259000,
  "speaker": "user-123",
  "role": "source",
  "languageCode": "en",
  "turnId": "gemini-1"
}
```

All transcript packets use reliable data-channel delivery. Google/Azure interim values remain replaceable drafts. Gemini source chunks do not map cleanly to traditional interim/final semantics, so the backend creates application-level pseudo-turns after 800 ms of low-energy PCM and 500 ms without transcript activity. Audio is still forwarded unchanged. Source `languageCode` is forwarded only when Gemini returns it; the configured source hint is not exposed as detected metadata. The frontend updates one source row for each `turnId`, while Gemini translation packets use `role: "translation"` and the same ID so the bilingual row stays grouped. Because the source and output streams are independent, alignment is best-effort rather than sentence-perfect.

## Key files

| File | Responsibility |
| --- | --- |
| `frontend/hooks/useLiveKit.ts` | Publisher room and microphone lifecycle |
| `frontend/hooks/useRoomViewer.ts` | Viewer room/audio lifecycle |
| `frontend/lib/transcriptMessages.ts` | Packet validation and state helpers |
| `backend-go/internal/delivery/handler/livekit.go` | Token and room HTTP handlers |
| `backend-go/internal/delivery/handler/agent.go` | Agent lifecycle HTTP handlers |
| `backend-go/internal/infrastructure/agent/agent.go` | Audio decode, provider selection, transcript publication |

## Operational notes

- Remote LiveKit requires suitable external IP, UDP firewall rules, and often TURN.
- IPv6 STUN timeout warnings can coexist with a healthy IPv4 connection; use connection state and audio flow to judge impact.
- The agent's Opus decoder requires CGO and a system Opus library.
- One agent instance is keyed by room and provider.
