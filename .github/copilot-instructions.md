# Copilot Instructions

## Project Overview
| Key | Value |
|-----|-------|
| Type | Web App - Real-time Thai Speech-to-Text Transcriber |
| Stack | React 19 + TypeScript + Vite, WebSocket (Deepgram API) |
| Architecture | Custom hooks pattern + Component-based |
| Purpose | Verbatim transcription of Thai audio using Deepgram |

## Code Rules

### MUST (Critical)
- Keep `smart_format: false` for verbatim transcription - no auto-formatting
- Handle WebSocket connection states properly (DISCONNECTED, CONNECTING, CONNECTED)
- Use TypeScript types from `types.ts` for all Deepgram responses
- Store config in localStorage with versioned keys (e.g., `th-asr-config-v2`)
- Support both direct Deepgram connection and relay server modes

### SHOULD
- Auto-scroll transcript view to bottom on new transcripts
- Show interim results in real-time before final transcripts
- Provide clear visual feedback for connection states (icons, colors)
- Handle microphone permissions and MediaRecorder errors gracefully
- Use Lucide React icons for consistent UI

## Tech Stack
| Category | Technology |
|----------|-----------|
| Frontend | React 19.2.4, TypeScript 5.8 |
| Build Tool | Vite 6.2 |
| UI Icons | Lucide React |
| Audio | MediaRecorder API, WebSocket |
| STT Engine | Deepgram (nova-2 model, Thai language) |
| State | React hooks (useState, useEffect, useCallback) |

## Project Structure
```
App.tsx              -> Main app, layout, settings
types.ts             -> TypeScript interfaces (Deepgram, config)
hooks/
  useDeepgram.ts     -> WebSocket + audio streaming logic
  useAudioVisualizer.ts -> Audio visualization
components/
  SettingsModal.tsx  -> Configuration UI (API key, backend)
  Visualizer.tsx     -> Real-time audio waveform
backend/
  server.ts          -> Optional relay server (Node.js)
```

## Commands
```bash
npm install          # Install dependencies
npm run dev          # Start dev server (port 5173)
npm run build        # Production build
```

## Key Features
- Real-time microphone streaming to Deepgram WebSocket
- Dual mode: Direct API or relay server
- Audio visualization with canvas
- Interim + final transcript display
- Settings persistence via localStorage

## Notes
- Deepgram config: `model: nova-2`, `language: th`, `smart_format: false`
- MediaRecorder uses WebM Opus codec (fallback to mp4)
- Backend server is optional reference implementation
- API key should be stored in config, not hardcoded
