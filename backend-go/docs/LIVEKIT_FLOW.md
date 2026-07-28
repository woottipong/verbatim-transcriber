# LiveKit architecture and data flow

## Scope

LiveKit is the application's only client audio transport. Publishers send microphone or Chrome Tab audio through WebRTC; viewers subscribe without publishing; the Go backend uses HTTP only for tokens, room management, agent control, and signed transcript links.

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
3. The browser publishes the selected source: a LiveKit microphone track, or the audio track returned by Chrome Tab display capture. Display video is stopped and never published.
4. The UI derives readiness from room connection, selected-audio state, and agent presence.
5. Transcript data packets are validated and committed or shown as active interim state.

Audio source changes are allowed only while disconnected. Selecting Chrome Tab opens the browser picker during connect; the operator must select a tab and enable **Share tab audio**.

## Agent flow

1. Admin starts an agent with `POST /livekit/agent/start` and a provider name.
2. The agent joins as `agent-<provider>` (the provider token may itself contain hyphens) and subscribes to audio tracks.
3. Opus is decoded to mono 48 kHz PCM.
4. Audio is batched into roughly 40 ms provider calls.
5. Google receives 48 kHz; Gemini and Azure receive anti-aliased 16 kHz PCM; GPT Realtime Whisper receives anti-aliased 24 kHz PCM16.
6. Provider results are normalized and published reliably as JSON data packets.
7. Normal end-of-track releases the track-scoped provider while the agent stays in the room. An unexpected provider error stops the agent.

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
| `POST` | `/livekit/rooms/:room/transcript-token` | Signed room-bound transcript URL |
| `GET` | `/livekit/rooms/:room/transcripts/ws?token=...` | Read-only source transcript stream |
| `POST` | `/livekit/rooms/:room/transcript-token/:provider` | Signed room/provider-bound transcript URL |
| `GET` | `/ws/transcript/:provider/:room?token=...` | Lean provider source transcript stream |
| `GET` / `DELETE` | `/livekit/rooms/:name` | Inspect/delete room |
| `DELETE` | `/livekit/rooms/:room/participants/:identity` | Remove participant |
| `POST` | `/livekit/agent/start` | Start provider agent |
| `POST` | `/livekit/agent/stop` | Stop provider agent |
| `GET` | `/livekit/agent/status` | Running agents |

The provider-specific socket sends one full provider-derived source snapshot per text frame:

```json
{"text":"ผู้ป่วยมีอาการ","isFinal":false}
```

Clients replace the current Draft for interim frames and commit then clear it for final frames. Gemini translation stays on the LiveKit data channel. The provider socket has no ready event or replay; the legacy room-wide socket retains its versioned event contract.

## Transcript packet

```json
{
  "type": "transcript",
  "text": "emergency room",
  "isFinal": false,
  "provider": "gemini",
  "timestamp": 1784196259000,
  "sequence": 42,
  "role": "source",
  "languageCode": "en",
  "turnId": "gemini-1"
}
```

Interim transcript packets use lossy data-channel delivery so newer Draft state is not queued behind stale revisions; final packets use reliable delivery. A monotonic agent `sequence` lets clients discard delayed Draft packets that arrive after a newer final. Non-final source values remain replaceable Draft state by provider; Gemini keys Drafts by provider, application `turnId`, and role, and pairs source/translation by provider plus `turnId`. Gemini requests a pseudo-turn boundary after 650 ms of low-energy PCM or 30 seconds of continuous audio and then applies a fixed 500 ms translation grace period. Its Live connection uses standard session resumption, sliding-window context compression, `GoAway`/transport-error reconnect, and a nine-minute rotation when a safe resumption handle is available, replaying up to fifteen seconds of audio received during the handoff. GPT Realtime Whisper uses a transcription-only session, streams 24 kHz PCM, manually commits after the shared 650 ms PCM silence boundary or a 30-second hard duration, publishes source interim deltas and completed finals, and performs bounded reconnects with one second of recent-audio replay.

The frontend coalesces general Draft updates to 33 ms and Gemini updates to 50 ms while applying the first update and final result immediately. Lines view may show a Gemini translation paired beneath its source. Text view shows source only and marks active Draft text inline; per-provider `.txt` export includes finalized source text only. Adjacent finals from the same provider and language may be grouped for display/export within a 1.6-second window unless the previous chunk ends with strong punctuation.

## Key files

| File | Responsibility |
| --- | --- |
| `frontend/hooks/useLiveKit.ts` | Publisher room and selected-audio lifecycle |
| `frontend/lib/audioSources.ts` | Chrome Tab capture and audio-track validation |
| `frontend/hooks/useRoomViewer.ts` | Viewer room/audio lifecycle |
| `frontend/lib/transcriptMessages.ts` | Packet validation and state helpers |
| `frontend/lib/transcriptExport.ts` | Final source-only text export |
| `backend-go/internal/delivery/handler/livekit.go` | Token and room HTTP handlers |
| `backend-go/internal/delivery/handler/agent.go` | Agent lifecycle HTTP handlers |
| `backend-go/internal/infrastructure/agent/agent.go` | Audio decode, provider selection, transcript publication |

## Operational notes

- Remote LiveKit requires suitable external IP, UDP firewall rules, and often TURN.
- IPv6 STUN timeout warnings can coexist with a healthy IPv4 connection; use connection state and audio flow to judge impact.
- The agent's Opus decoder requires CGO and a system Opus library.
- One agent instance is keyed by room and provider.
- The current track/provider lifecycle is designed for one active Audio Sender per room/provider agent.
