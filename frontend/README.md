# Thai Verbatim Transcriber - Frontend

Real-time Thai speech-to-text transcription UI built with React 19 + TypeScript + Vite.

## Quick Start

### Prerequisites
- Node.js 18+
- pnpm (recommended) or npm
- Backend server running on `ws://localhost:3000`

### Installation

```bash
# Recommended: Use pnpm for better performance and smaller disk usage
pnpm install

# Alternative: Use npm
npm install
```

### Development

```bash
# Using pnpm (recommended)
pnpm run dev

# Using npm
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

### Build

```bash
# Using pnpm (recommended)
pnpm run build

# Using npm
npm run build
```

## Configuration

### Environment Variables

```bash
cp .env.example .env
```

| Variable           | Description           | Default               |
| ------------------ | --------------------- | --------------------- |
| `VITE_BACKEND_URL` | Backend WebSocket URL | `ws://localhost:3000` |
| `VITE_LIVEKIT_URL` | LiveKit server URL    | `ws://localhost:7880` |

## Architecture

```
frontend/
├── App.tsx                     # Main app (multi-panel layout)
├── types.ts                    # TypeScript interfaces
├── index.tsx                   # React entry point
├── index.css                   # Tailwind styles
│
├── hooks/
│   ├── useGoogle.ts            # Google Cloud STT WebSocket
│   ├── useAzure.ts             # Azure Speech WebSocket
│   ├── useLiveKit.ts           # LiveKit WebRTC room
│   ├── useVAD.ts               # Voice Activity Detection
│   ├── useAudioVisualizer.ts   # Waveform visualization
│   └── useAudioDevices.ts      # Microphone selection
│
├── components/
│   ├── ConnectionBadge.tsx     # Connection status
│   ├── RecordButton.tsx        # Record control
│   ├── ErrorBanner.tsx         # Error display
│   ├── TranscriptPanel.tsx     # Transcript area
│   ├── LiveKitPanel.tsx        # LiveKit UI
│   ├── Visualizer.tsx          # Audio waveform
│   ├── SettingsModal.tsx       # Settings UI
│   ├── ViewerPage.tsx          # Viewer mode
│   ├── AdminPage.tsx           # Admin panel
│   └── VADInfoBadge.tsx        # VAD status
│
├── lib/
│   ├── api.ts                  # API utilities
│   ├── audio.ts                # Audio processing
│   ├── constants.ts            # App constants
│   └── utils.ts                # Utilities
│
└── public/
    ├── vad.config.js           # VAD WASM config
    └── *.wasm, *.onnx          # VAD model files
```

## Backend Integration

### WebSocket Endpoints
| Path      | Provider         | Sample Rate |
| --------- | ---------------- | ----------- |
| `/google` | Google Cloud STT | 48 kHz      |
| `/azure`  | Azure Speech     | 16 kHz      |

### LiveKit Endpoints
| Method | Path             | Description      |
| ------ | ---------------- | ---------------- |
| POST   | `/livekit/token` | Get access token |
| GET    | `/livekit/rooms` | List rooms       |

### Message Formats

**Client → Server (Audio):**
```javascript
ws.send(audioBuffer);  // Int16Array binary
```

**Server → Client (Transcript):**
```json
{
  "type": "transcript",
  "transcript": "สวัสดีครับ",
  "isFinal": true
}
```

## Features

### Multi-Provider ASR
- Google Cloud STT (streaming)
- Azure Speech (batch)
- LiveKit WebRTC (real-time agent)

### Audio Processing
- **Google:** 48kHz Linear16 PCM
- **Azure:** 16kHz WAV
- Real-time sample rate conversion

### Voice Activity Detection (VAD)
- Silero VAD model (@ricky0123/vad-react)
- Configurable threshold

## Tech Stack

| Category  | Technology           |
| --------- | -------------------- |
| Framework | React 19             |
| Language  | TypeScript           |
| Build     | Vite 6               |
| Styling   | Tailwind CSS         |
| Icons     | Lucide React         |
| VAD       | @ricky0123/vad-react |
| Audio     | Web Audio API        |
| Realtime  | WebSocket, LiveKit   |

## Scripts

| Command               | Description              |
| --------------------- | ------------------------ |
| `pnpm run dev`        | Start dev server         |
| `pnpm run build`      | Build for production     |
| `pnpm run preview`    | Preview production build |
| `pnpm run backend:install` | Install backend deps  |
| `pnpm run backend:start`   | Start backend server  |
| `pnpm run full-setup` | Install frontend + backend |
| `pnpm run full-dev`   | Start frontend + backend  |

**Note:** All npm commands work with pnpm as well.

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 15.4+

### Required APIs
- `getUserMedia`
- `AudioContext`
- `WebSocket`
- `SharedArrayBuffer` (for VAD WASM)
