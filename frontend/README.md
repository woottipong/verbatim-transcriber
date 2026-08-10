# CaptionLive frontend

React 19 + TypeScript + Vite application for operating CaptionLive rooms, publishing microphone or Chrome Tab audio, and viewing real-time transcripts delivered through LiveKit.

## Workspaces

| Workspace | Route | Purpose |
| --- | --- | --- |
| Control Room | `/#admin` or `/` | Create rooms, manage providers and participants, and generate external transcript feeds |
| Audio Source | `/#stream?room=<room>` | Publish microphone or Chrome Tab audio to a room |
| Transcript | `/#viewer?room=<room>&autoconnect=1` | View the read-only live transcript |
| Caption Desk | `/#caption-desk?room=<room>&provider=<provider>` | Attach to one active provider and publish approved captions |

The frontend never sends audio directly to an ASR provider or to the Go backend. Audio and transcript data use LiveKit; the backend HTTP API is used for tokens, room administration, agent control, and signed external-feed links.

## Requirements

- Node.js 18+
- pnpm
- Go backend at `http://localhost:3000` by default
- LiveKit at `ws://localhost:7880` by default

## Setup

```bash
cp .env.example .env
pnpm install
pnpm dev
```

Open `http://localhost:5173` for the Control Room. Create a room there, then use its generated Audio Source and Transcript links.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_BACKEND_URL` | `http://localhost:3000` | Backend HTTP base URL |
| `VITE_LIVEKIT_URL` | `ws://localhost:7880` | Browser LiveKit URL |
| `VITE_CONTROL_API_KEY` | — | Backend control key for trusted internal deployments; never use in a public frontend build |

These values are embedded by Vite at build time. Use HTTPS/WSS for remote deployments.
The application does not expose a runtime Settings screen for backend connection values. Change the environment and rebuild or restart Vite instead. Only the selected microphone device remains a local browser preference.

## Data flow

```text
Control Room ── HTTP ──> Go backend
     │                    ├── room and token APIs
     │                    ├── provider lifecycle
     │                    └── signed external-feed links
     │
Audio Source ── WebRTC audio ──> LiveKit ──> Go room agent ──> ASR provider
                                      │
                                      └── data channel transcript ──> Audio Source / Transcript
```

## Structure

```text
frontend/
├── App.tsx                       # Lazy-loaded hash routing and page titles
├── components/
│   ├── AdminPage.tsx             # Control Room workspace
│   ├── StreamPage.tsx            # Audio Source workspace
│   ├── ViewerPage.tsx            # Read-only Transcript workspace
│   ├── LiveKitPanel.tsx          # Publisher session and transcript controls
│   ├── TranscriptPresentation.tsx # Shared final and Draft rendering
│   ├── MicrophoneInputStrip.tsx  # Input-level visualization
│   └── ToastViewport.tsx         # Shared top-right notifications
├── hooks/
│   ├── useControlRoomOperations.ts # Room, provider, participant, and feed operations
│   ├── useLiveKit.ts             # Publisher adapter and selected-audio state
│   ├── useRoomViewer.ts          # Viewer adapter and agent discovery
│   ├── useTranscriptViewport.ts  # Stick-to-latest scroll behavior
│   ├── useAudioVisualizer.ts     # Web Audio analyser state
│   └── useAudioDevices.ts        # Input-device discovery
├── lib/
│   ├── liveKitRoomLifecycle.ts   # Shared cancellable room lifecycle
│   ├── transcriptSession.ts      # Transcript ingestion and bounded state
│   ├── transcriptMessages.ts     # Packet validation and state transforms
│   ├── transcriptPresentation.ts # Provider filtering and export projections
│   ├── transcriptExport.ts       # Final source-only text export
│   ├── transcriptUpdates.ts      # Interim update coalescing
│   ├── liveKitSession.ts         # Publisher readiness presentation
│   ├── api.ts                    # Typed backend HTTP adapter
│   ├── audioSources.ts           # Microphone/Chrome Tab capture helpers
│   ├── appRoutes.ts              # Workspace route parsing and link builders
│   └── adminRooms.ts             # Control Room validation and feed helpers
├── public/                        # CaptionLive logo and favicon assets
└── types.ts
```

Keep provider-independent room and transcript behavior in the shared lifecycle/session modules. The React hooks adapt those modules to each workspace and own browser or LiveKit side effects.

## Transcript behavior

### Approved captions

Control Room starts transcription providers normally. Caption Desk lists only the providers already active in the selected room, then connects to that agent with a dedicated server-issued LiveKit identity and one editing buffer:

- the active provider Draft remains a read-only preview and never enters a publish command;
- only provider Final text enters the editable review buffer;
- Draft revisions replace only the preview, and a matching Final clears it;
- `Enter` publishes while `Shift+Enter` inserts a newline;
- IME composition Enter never publishes;
- only one publication per source segment may wait for acknowledgement at a time;
- a rejected publication is restored ahead of newer text.
- one browser session owns each room/provider Desk lane; reconnects within 10 seconds retain its buffer, while a different Desk is rejected;
- after the reconnect grace period expires, the next Desk starts at the current caption without the previous operator's backlog.

Caption Desk is an approval lane, not an agent delivery mode. The raw provider
transcript continues through its existing viewer/feed paths.
The browser cannot publish approved captions directly; it sends a reliable
`caption.publish` command to the active agent, which remains authoritative.

The editor also provides operator-side review assistance:

- Thai typo suggestions are local, optional hints; applying one changes only the
  selected text and never publishes automatically.
- **AI Auto** is optional and available only when the backend reports the
  Caption Desk proofreader as enabled. It reviews newly appended final text in
  bounded batches after 1,200 ms of inactivity, at a 2,500 ms hard ceiling, or
  when the batch reaches 320 grapheme clusters.
- AI suggestions are advisory. A manual edit, publication, or reconnect that
  makes a result stale leaves the operator's current text unchanged; transient
  AI failures keep the original caption and use the shared notification area.
  After three consecutive failures, AI Auto pauses until the operator enables
  it again.
- The latest approved caption is sent as bounded context for the next batch to
  help with names and continuations, but it is never copied into the editor.

### Approved-caption playback in Transcript

Selecting **Caption Desk** in the Transcript source list subscribes to the
room-scoped `caption.public` lane. Every accepted publication is appended to a
browser-local FIFO playback queue exactly as published; this surface does not
infer wording, combine providers, or normalize the operator's whitespace.

- The visible output is a rolling, two-line subtitle window. A line is bounded
  to 35 grapheme clusters before the next line rolls in, so Thai combining
  marks remain attached to their base character.
- Normal motion reveals text at the selected pace (10–20 visible characters per
  second; 17 by default). The playback buffer retains the visible tail and
  continues releasing queued text when its internal limit is reached—there is
  no intentional pause at that boundary.
- A delayed animation frame preserves its elapsed reveal progress; the next
  render can cross a rolling boundary without dropping or reordering queued
  text.
- With `prefers-reduced-motion`, the Viewer disables the roll animation and
  advances through one readable two-line window at a time. It does not skip to
  the newest text or discard the remainder.
- The subtitle toolbar reports `Queue empty` when everything is displayed, or
  `Waiting: <cues> · <characters>` when captions remain pending. `Clear` clears
  both the current caption and this local playback queue.

- Every packet is validated with `parseTranscriptMessage`.
- `TranscriptSession` owns decoding, provider resolution, interim buffering, Gemini source/translation pairing, committed rows, and source cleanup.
- Non-final source values are replaceable Draft entries keyed by provider. Gemini keys Drafts by provider, `turnId`, and role, and pairs source/translation by provider plus `turnId`.
- Draft rendering is coalesced at 33 ms for general interim traffic, 80 ms for Google STT snapshots, and 50 ms for Gemini, with the first update and final result applied immediately.
- Final values become bounded committed rows. At most 500 final rows, 64 active Draft entries, and 256 packet-order watermarks are retained.
- Lines view can show a Gemini translation beneath its source. Text view deliberately shows source text only and marks active Draft text inline.
- Per-provider `.txt` export includes finalized source text only; it excludes Draft and translation text.
- Final chunks remain separate turns so provider boundaries are preserved in display and export.
- Thai spacing normalization belongs to the Go agent. Avoid extra frontend normalization that could collapse interim behavior.

## Session UX

The publisher chooses Microphone or Chrome Tab while disconnected, joins a named room, and publishes that source. Readiness is derived from room connection, selected-audio state, and agent presence. Keep these states explicit in UI changes and do not rely on color alone.

The root route is the Admin workspace. Admin creates a room first and starts its Agent separately. Stream links prefill the room but do not connect or request capture permission automatically. Viewer links with `autoconnect=1` connect once without publishing audio. A normal publisher disconnect ends its audio track; the backend agent remains in the room and waits for the next track.

`LiveKitRoomLifecycle` is shared by publisher and viewer hooks. It invalidates stale connection attempts, tears down failed preparation, distinguishes manual and remote disconnects, and prevents an old room from clearing a replacement room.

`useControlRoomOperations` owns polling and mutations for rooms, provider agents, participants, and signed transcript links. Polling pauses while the document is hidden; request IDs prevent stale responses from overwriting newer state. External-feed generation state and errors remain independent per provider.

The input strip uses the browser's Web Audio analyser only to communicate signal level; it is not browser VAD and does not gate audio publication. Transient operation feedback appears through the shared top-right Toast viewport; persistent connection/audio/transcriber state and inline form validation remain in context.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start Vite on port 5173 |
| `pnpm test` | Run `lib/*.test.ts` with Node's test runner |
| `pnpm typecheck` | Run TypeScript validation without emitting files |
| `pnpm build` | Create a production Vite build |
| `pnpm preview` | Preview the production build |

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
```

Tests cover the LiveKit lifecycle, transcript ingestion and presentation, Control Room helpers, session presentation, viewport behavior, routing, API boundaries, and audio calculations.

## Browser requirements

- Modern Chrome, Edge, Firefox, or Safari with WebRTC and `getUserMedia` for microphone publishing.
- Chrome or a compatible Chromium browser with `getDisplayMedia` for Chrome Tab audio. Select a browser tab and enable **Share tab audio** in the picker.
- `AudioContext` for input-level visualization.
- Microphone or display-capture permission for the selected publisher source.
- A secure context for remote deployments; localhost is allowed during development.

See the root [README](../README.md) for full setup and [AGENTS.md](../AGENTS.md) for development rules.
