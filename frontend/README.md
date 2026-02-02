# Real-time Thai Transcription - Frontend

Real-time Thai speech-to-text transcription UI built with React 19 + TypeScript + Vite.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Backend server running on `ws://localhost:3000` (or configure via `.env`)

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

### Build

```bash
npm run build
```

## 📦 Configuration

### Backend Connection

By default, the frontend connects to:
- Deepgram: `ws://localhost:3000/deepgram`
- Gemini: `ws://localhost:3000/gemini`

**To customize the backend URL:**

**Option 1:** Environment variable (recommended)
```bash
# Copy template
cp .env.example .env

# Edit .env
VITE_BACKEND_URL=ws://your-server:3000
```

**Option 2:** Edit [lib/constants.ts](lib/constants.ts)
```typescript
export const DEFAULT_CONFIG = {
  backendUrl: 'ws://your-server:3000',  // Change this
  // ...
};
```

## 🏗️ Architecture

```
frontend/
├── App.tsx                     # Main app (dual panel layout)
├── types.ts                    # TypeScript interfaces
├── index.tsx                   # React entry point
├── index.css                   # Tailwind styles
│
├── hooks/
│   ├── useDeepgram.ts          # Deepgram WebSocket streaming
│   ├── useGemini.ts            # Gemini WebSocket streaming
│   ├── useVAD.ts               # Voice Activity Detection
│   ├── useAudioVisualizer.ts   # Waveform visualization
│   └── useAudioDevices.ts      # Microphone selection
│
├── components/
│   ├── ConnectionBadge.tsx     # Connection status
│   ├── RecordButton.tsx        # Record control
│   ├── ErrorBanner.tsx         # Error display
│   ├── TranscriptPanel.tsx     # Transcript area
│   ├── Visualizer.tsx          # Audio waveform
│   ├── SettingsModal.tsx       # Settings UI
│   └── VADInfoBadge.tsx        # VAD status
│
├── lib/
│   ├── constants.ts            # App constants
│   └── utils.ts                # Utilities
│
└── public/
    ├── vad.config.js           # VAD WASM config
    └── *.wasm, *.onnx          # VAD model files
```

## 🔌 Backend Integration

This frontend requires a backend server with WebSocket support:

### Expected WebSocket Endpoints:
- `/deepgram` - Deepgram Nova-2 streaming
- `/gemini` - Gemini 2.0 Flash streaming

### Message Formats:

**Client → Server (Audio):**
```javascript
// Send binary audio data (Int16Array)
ws.send(audioBuffer);
```

**Server → Client (Transcript):**
```json
{
  "type": "transcript",
  "transcript": "ผลลัพธ์การถอดเสียง",
  "is_final": true,
  "confidence": 0.95
}
```

**Server → Client (Error):**
```json
{
  "type": "error",
  "error": "Connection failed"
}
```

## 🎤 Features

### Voice Activity Detection (VAD)
- Uses Silero VAD model (@ricky0123/vad-react)
- Automatically detects speech
- Reduces unnecessary audio streaming
- Configurable threshold in [lib/constants.ts](lib/constants.ts)

### Audio Processing
- **Sample Rate:** 48kHz (Deepgram) / 16kHz (Gemini)
- **Format:** Linear16 PCM
- **Buffer Size:** 4096 samples
- Real-time downsampling for Gemini

### Dual ASR Comparison
- Side-by-side transcript display
- Connection status indicators
- Latency comparison
- Quality comparison (Deepgram vs Gemini)

## 🛠️ Tech Stack

- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite 6** - Build tool
- **Tailwind CSS** - Styling
- **Lucide React** - Icons
- **@ricky0123/vad-react** - Voice Activity Detection
- **Web Audio API** - Audio processing
- **WebSocket** - Real-time communication

## 📝 Scripts

| Command           | Description                              |
| ----------------- | ---------------------------------------- |
| `npm run dev`     | Start dev server (http://localhost:5173) |
| `npm run build`   | Build for production                     |
| `npm run preview` | Preview production build                 |

## 🔧 Customization

### Change Backend URL

Edit [lib/constants.ts](lib/constants.ts):
```typescript
export const DEFAULT_CONFIG = {
  backendUrl: 'ws://your-server:3000',  // Change this
  // ...
};
```

### Adjust VAD Settings

Edit [lib/constants.ts](lib/constants.ts):
```typescript
export const vadConfig = {
  threshold: 0.5,        // Speech detection threshold (0-1)
  minSpeechMs: 250,      // Min speech duration (ms)
  preSpeechPadMs: 300,   // Pre-speech padding (ms)
  positiveSpeechThreshold: 0.8,
  redemptionFrames: 8,
};
```

### Customize UI Theme

Edit [index.css](index.css) (Tailwind CSS)

## ⚠️ Requirements

### Browser Support
- Chrome/Edge 90+
- Firefox 88+
- Safari 15.4+
- Requires:
  - `getUserMedia` API
  - `AudioContext` API
  - `WebSocket` API
  - `SharedArrayBuffer` (for VAD WASM)

### Permissions
- **Microphone:** Required for audio input
- Auto-requested on record start

## 📄 License

Part of Thai Verbatim Transcriber project.

## 🔗 Related

- [Backend (Go)](../backend-go/README.md)
- [Main Project](../README.md)
