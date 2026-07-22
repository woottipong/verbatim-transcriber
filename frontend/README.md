# React frontend

React 19 + TypeScript + Vite UI for publishing microphone or Chrome Tab audio to LiveKit, viewing room transcripts, and administering rooms and transcription agents.

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
| `VITE_CONTROL_API_KEY` | — | Backend control key for trusted internal deployments; never use in a public frontend build |

These values are embedded by Vite at build time. Use HTTPS/WSS for remote deployments.
The application does not expose a runtime Settings screen for backend connection values. Change the environment and rebuild or restart Vite instead. Only the selected microphone device remains a local browser preference.

## Structure

```text
frontend/
├── App.tsx                     # Admin-first hash routing and Stream workspace
├── components/
│   ├── LiveKitPanel.tsx        # Session controls and transcript list
│   ├── MicrophoneInputStrip.tsx # Input-level visualization
│   ├── StreamPage.tsx           # Publisher-only route and audio-source controls
│   ├── ToastViewport.tsx        # Shared top-right notifications
│   ├── ViewerPage.tsx          # Subscribe-only viewer
│   └── AdminPage.tsx           # Room and agent management
├── hooks/
│   ├── useLiveKit.ts           # Publisher room and selected-audio lifecycle
│   ├── useRoomViewer.ts        # Viewer room/audio lifecycle
│   ├── useAudioVisualizer.ts   # Web Audio analyser state
│   └── useAudioDevices.ts      # Input-device discovery
├── lib/
│   ├── transcriptMessages.ts   # Packet validation and transcript state helpers
│   ├── transcriptExport.ts     # Final source-only text export
│   ├── transcriptUpdates.ts    # Interim update coalescing
│   ├── transcriptViewport.ts   # Scroll-to-latest behavior
│   ├── liveKitSession.ts       # Session status presentation
│   ├── audioSources.ts         # Microphone/Chrome Tab capture helpers
│   ├── audioSignal.ts          # Waveform calculations
│   ├── runtime.ts              # Config and bounded-state helpers
│   ├── appRoutes.ts            # Admin, Stream, and Viewer deep links
│   └── adminRooms.ts           # Room validation and selection helpers
└── types.ts
```

The frontend has no direct ASR-provider capture hooks and does not stream audio to the Go HTTP server. The selected microphone or Chrome Tab audio is always published with LiveKit.

## Transcript behavior

- Every packet is validated with `parseTranscriptMessage`.
- Non-final source values are replaceable Draft entries keyed by provider and speaker; Gemini also uses `turnId` to pair source and translation state.
- Draft rendering is coalesced at 33 ms for general interim traffic and 50 ms for Gemini, with the first update and final result applied immediately.
- Final values become bounded committed rows. At most 500 final rows and 64 active Draft entries are retained.
- Lines view can show a Gemini translation beneath its source. Text view deliberately shows source text only and marks active Draft text inline.
- Per-provider `.txt` export includes finalized source text only; it excludes Draft and translation text.
- Adjacent final chunks from the same provider, speaker, and language are grouped for display/export when they arrive within 1.6 seconds and the previous chunk has no strong sentence-ending punctuation.
- Thai spacing normalization belongs to the Go agent. Avoid extra frontend normalization that could collapse interim behavior.

## Session UX

The publisher chooses Microphone or Chrome Tab while disconnected, joins a named room, and publishes that source. Readiness is derived from room connection, selected-audio state, and agent presence. Keep these states explicit in UI changes and do not rely on color alone.

The root route is the Admin workspace. Admin creates a room first and starts its Agent separately. Stream links prefill the room but do not connect or request capture permission automatically. Viewer links with `autoconnect=1` connect once without publishing audio. A normal publisher disconnect ends its audio track; the backend agent remains in the room and waits for the next track.

The input strip uses the browser's Web Audio analyser only to communicate signal level; it is not browser VAD and does not gate audio publication. Transient operation feedback appears through the shared top-right Toast viewport; persistent connection/audio/transcriber state and inline form validation remain in context.

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

- Modern Chrome, Edge, Firefox, or Safari with WebRTC and `getUserMedia` for microphone publishing.
- Chrome or a compatible Chromium browser with `getDisplayMedia` for Chrome Tab audio. Select a browser tab and enable **Share tab audio** in the picker.
- `AudioContext` for input-level visualization.
- Microphone or display-capture permission for the selected publisher source.
- A secure context for remote deployments; localhost is allowed during development.

See the root [README](../README.md) for full setup and [AGENTS.md](../AGENTS.md) for development rules.
