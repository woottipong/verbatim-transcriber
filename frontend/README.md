# React frontend

React 19 + TypeScript + Vite UI for publishing microphone audio to LiveKit, viewing room transcripts, and administering rooms and transcription agents.

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

Open:

- Admin: `http://localhost:5173`
- Stream publisher: `http://localhost:5173/#stream?room=test`
- Viewer: `http://localhost:5173/#viewer?room=test&autoconnect=1`

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_BACKEND_URL` | `http://localhost:3000` | Backend HTTP base URL |
| `VITE_LIVEKIT_URL` | `ws://localhost:7880` | Browser LiveKit URL |

These values are embedded by Vite at build time. Use HTTPS/WSS for remote deployments.

## Structure

```text
frontend/
├── App.tsx                     # Admin-first hash routing and Stream workspace
├── components/
│   ├── LiveKitPanel.tsx        # Session controls and transcript list
│   ├── MicrophoneInputStrip.tsx # Input-level visualization
│   ├── ViewerPage.tsx          # Subscribe-only viewer
│   ├── AdminPage.tsx           # Room and agent management
│   └── SettingsModal.tsx       # Backend URL configuration
├── hooks/
│   ├── useLiveKit.ts           # Publisher room and microphone lifecycle
│   ├── useRoomViewer.ts        # Viewer room/audio lifecycle
│   ├── useAudioVisualizer.ts   # Web Audio analyser state
│   └── useAudioDevices.ts      # Input-device discovery
├── lib/
│   ├── transcriptMessages.ts   # Packet validation and transcript state helpers
│   ├── transcriptUpdates.ts    # Interim update coalescing
│   ├── transcriptViewport.ts   # Scroll-to-latest behavior
│   ├── liveKitSession.ts       # Session status presentation
│   ├── audioSignal.ts          # Waveform calculations
│   ├── runtime.ts              # Config and bounded-state helpers
│   ├── appRoutes.ts            # Admin, Stream, and Viewer deep links
│   └── adminRooms.ts           # Room validation and selection helpers
└── types.ts
```

The frontend has no direct provider microphone hooks and does not stream audio to the Go HTTP server. All microphone audio is published with LiveKit.

## Transcript behavior

- Every packet is validated with `parseTranscriptMessage`.
- Google and Azure interim values are stored as replaceable drafts keyed by provider and speaker.
- Final values become bounded committed rows.
- Gemini input chunks are retained as ordinary rows even when `isFinal=false`; only exact consecutive duplicates are suppressed.
- Thai spacing normalization belongs to the Go agent. Avoid extra frontend normalization that could collapse interim behavior.

## Session UX

The publisher joins a named room and then enables the microphone. Readiness is derived from room connection, microphone state, and agent presence. Keep these states explicit in UI changes and do not rely on color alone.

The root route is the Admin workspace. Admin creates a room first and starts its Agent separately. Stream links prefill the room but do not connect or request microphone permission automatically. Viewer links with `autoconnect=1` connect once without publishing microphone audio.

The microphone strip uses the browser's Web Audio analyser only to communicate input level; it is not browser VAD and does not gate audio publication.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start Vite on port 5173 |
| `pnpm test` | Run `lib/*.test.ts` with Node's test runner |
| `pnpm build` | Create a production Vite build |
| `pnpm preview` | Preview the production build |

## Verification

```bash
pnpm test
pnpm build
```

Tests cover transcript buffering/state, session presentation, viewport behavior, and audio signal calculations. The production build is the TypeScript/Vite integration check.

## Browser requirements

- Modern Chrome, Edge, Firefox, or Safari with WebRTC and `getUserMedia`.
- `AudioContext` for microphone-level visualization.
- Microphone permission for the publisher page.
- A secure context for remote deployments; localhost is allowed during development.

See the root [README](../README.md) for full setup and [AGENTS.md](../AGENTS.md) for development rules.
