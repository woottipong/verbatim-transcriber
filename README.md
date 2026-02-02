# 🎙️ Thai Verbatim Transcriber

Real-time Thai speech-to-text transcription comparing **Deepgram Nova-2** vs **Gemini 2.0 Flash** side-by-side.

![Thai Verbatim Transcriber](https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6)

## 📋 Project Overview

| Key | Value |
|-----|-------|
| **Type** | Web App - Real-time Thai Speech-to-Text |
| **Purpose** | Verbatim transcription comparison (Deepgram vs Gemini) |
| **Stack** | React 19 + TypeScript + Vite (Frontend), Node.js + WebSocket (Backend) |
| **Architecture** | Provider-based modular backend, Custom React hooks |
| **Language** | Thai (ภาษาไทย) |

## ✨ Features

- **Dual ASR Comparison** - Deepgram Nova-2 vs Gemini 2.0 Flash side-by-side
- **Real-time Streaming** - Live transcription as you speak
- **Verbatim Output** - No auto-formatting (`smart_format: false`)
- **VAD Integration** - Voice Activity Detection (Silero VAD)
- **Audio Visualization** - Real-time waveform display
- **Interim Results** - Preview text before final confirmation
- **Provider Architecture** - Easy to add new ASR providers

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ useDeepgram  │  │  useGemini   │  │       useVAD         │   │
│  │   (hook)     │  │   (hook)     │  │  (Silero VAD model)  │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         │                 │                      │               │
│         │    WebSocket    │     WebSocket        │  Audio Stream │
│         └────────┬────────┴──────────────────────┘               │
└──────────────────┼───────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Backend (Node.js + WebSocket)                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                     WebSocket Server                        │ │
│  │           /deepgram              /gemini                    │ │
│  └──────────────┬───────────────────────┬─────────────────────┘ │
│                 │                       │                       │
│     ┌───────────▼───────────┐  ┌────────▼────────────┐         │
│     │  DeepgramProvider     │  │   GeminiProvider    │         │
│     │  - Real-time stream   │  │   - Batch process   │         │
│     │  - 48kHz PCM          │  │   - 16kHz WAV       │         │
│     │  - Interim results    │  │   - ~2sec chunks    │         │
│     └───────────┬───────────┘  └────────┬────────────┘         │
│                 │                       │                       │
└─────────────────┼───────────────────────┼───────────────────────┘
                  │                       │
                  ▼                       ▼
         ┌───────────────┐       ┌────────────────┐
         │  Deepgram API │       │   Gemini API   │
         │  (nova-2, th) │       │ (2.0-flash)    │
         └───────────────┘       └────────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- Deepgram API Key (https://deepgram.com)
- Gemini API Key (https://aistudio.google.com)

### One Command Setup

```bash
./run.sh
```

### Manual Setup

**1. Install Dependencies**
```bash
# Frontend
npm install

# Backend
cd backend && npm install
```

**2. Configure Environment**
```bash
# Backend environment
cp backend/.env.example backend/.env
# Edit and add:
# DEEPGRAM_API_KEY=your_key
# GEMINI_API_KEY=your_key
```

**3. Start Servers**

```bash
# Terminal 1 - Backend (port 3000)
cd backend && npm run dev

# Terminal 2 - Frontend (port 5173)
npm run dev
```

**4. Open Browser**
```
http://localhost:5173
```

## 📁 Project Structure

```
thai-verbatim-transcriber/
├── App.tsx                     # Main app component (dual panel layout)
├── types.ts                    # Shared TypeScript interfaces
├── index.tsx                   # React entry point
├── index.css                   # Tailwind CSS styles
│
├── hooks/
│   ├── useDeepgram.ts          # Deepgram WebSocket streaming
│   ├── useGemini.ts            # Gemini WebSocket streaming
│   ├── useVAD.ts               # Voice Activity Detection (Silero)
│   ├── useAudioVisualizer.ts   # Canvas waveform visualization
│   └── useAudioDevices.ts      # Microphone device selection
│
├── components/
│   ├── ConnectionBadge.tsx     # Connection status indicator
│   ├── RecordButton.tsx        # Start/stop recording button
│   ├── ErrorBanner.tsx         # Error display component
│   ├── TranscriptPanel.tsx     # Transcript display area
│   ├── Visualizer.tsx          # Audio waveform canvas
│   ├── SettingsModal.tsx       # Configuration modal
│   └── VADInfoBadge.tsx        # VAD status display
│
├── lib/
│   ├── constants.ts            # Default config, app constants
│   └── utils.ts                # Utility functions
│
├── backend/
│   ├── server.ts               # Legacy entry (redirects to src/)
│   ├── package.json            # Backend dependencies
│   └── src/
│       ├── server.ts           # Main WebSocket server (~130 lines)
│       ├── config.ts           # Centralized configuration
│       ├── types.ts            # Backend TypeScript interfaces
│       ├── providers/
│       │   ├── index.ts        # Provider registry
│       │   ├── deepgram.ts     # Deepgram ASR provider
│       │   └── gemini.ts       # Gemini ASR provider
│       └── utils/
│           ├── index.ts        # Utils barrel export
│           ├── audio.ts        # PCM→WAV conversion
│           └── thai.ts         # Thai text cleanup functions
│
└── public/
    ├── vad.config.js           # VAD WASM configuration
    └── *.wasm, *.onnx          # VAD model files (not in git)
```

## 🔧 Key Technical Details

### Audio Pipeline

```
Microphone (48kHz)
    │
    ▼
ScriptProcessorNode (buffer: 4096)
    │
    ├──► Deepgram: Raw PCM Int16 @ 48kHz (streaming)
    │
    └──► Gemini: Downsample to 16kHz → Batch 64KB → Convert to WAV
```

### ASR Provider Comparison

| Feature | Deepgram Nova-2 | Gemini 2.0 Flash |
|---------|-----------------|------------------|
| **Mode** | True streaming | Batch (~2 sec chunks) |
| **Sample Rate** | 48,000 Hz | 16,000 Hz |
| **Format** | Linear16 PCM | WAV with header |
| **Interim Results** | ✅ Yes | ❌ No |
| **Latency** | ~200ms | ~2-3 sec |
| **Thai Quality** | Excellent | Good (may add filler words) |

### VAD (Voice Activity Detection)

- **Library**: `@ricky0123/vad-react` (Silero VAD model)
- **Purpose**: Detect speech to optimize bandwidth
- **Fallback**: If VAD unavailable, streams all audio
- **Config**: Threshold adjustable (0.1 - 0.9)

### Critical Code Rules

1. **Deepgram**: Keep `smart_format: false` for verbatim output
2. **Gemini**: Use strict prompt to prevent hallucination (adding words not spoken)
3. **Audio**: Always convert to correct sample rate before sending
4. **WebSocket**: Handle connection states (DISCONNECTED → CONNECTING → CONNECTED)

## ⚙️ Configuration

### Frontend Config (`lib/constants.ts`)

```typescript
export const DEFAULT_CONFIG: AppConfig = {
  backendUrl: 'ws://localhost:3000',
  vadConfig: {
    enabled: false,    // VAD disabled by default
    threshold: 0.4,    // Speech detection sensitivity
  },
};
```

### Backend Config (`backend/src/config.ts`)

```typescript
// Deepgram - Streaming ASR
DEEPGRAM_CONFIG = {
  model: 'nova-2',
  language: 'th',
  smart_format: false,  // CRITICAL: Keep false for verbatim
  interim_results: true,
  encoding: 'linear16',
  sample_rate: 48000,
}

// Gemini - Batch ASR
GEMINI_CONFIG = {
  model: 'gemini-2.0-flash',
  temperature: 0,       // Deterministic output
  systemInstruction: '...',  // Anti-hallucination prompt
}
```

## 🛠️ Scripts

```bash
# Frontend
npm run dev           # Start Vite dev server (port 5173)
npm run build         # Production build
npm run preview       # Preview production build

# Backend
cd backend
npm run dev           # Start with ts-node (hot reload)
npm run build         # Compile TypeScript
npm start             # Run compiled JavaScript

# Full Stack
./run.sh              # Install deps + start both servers
./start.sh            # Start both without install
```

## 🔌 API Endpoints

### Backend WebSocket Endpoints

| Endpoint | Provider | Description |
|----------|----------|-------------|
| `ws://localhost:3000/deepgram` | Deepgram | Real-time streaming ASR |
| `ws://localhost:3000/gemini` | Gemini | Batch processing ASR |
| `GET /health` | - | Health check |

### WebSocket Message Format

**Client → Server**: Binary audio data (PCM Int16)

**Server → Client (Deepgram)**:
```json
{
  "type": "Results",
  "channel": {
    "alternatives": [{ "transcript": "ข้อความภาษาไทย" }]
  },
  "is_final": true
}
```

**Server → Client (Gemini)**:
```json
{
  "type": "transcript",
  "text": "ข้อความภาษาไทย",
  "is_final": true
}
```

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| No audio | Check browser microphone permission |
| Connection failed | Verify backend is running on port 3000 |
| Empty transcripts | Check API keys in backend/.env |
| Gemini adds extra words | Known issue - prompt tuning in progress |
| VAD not working | WASM files needed in public/ folder |
| Port 3000 in use | `lsof -ti:3000 \| xargs kill -9` |

## 📝 Adding a New ASR Provider

1. Create `backend/src/providers/newprovider.ts`:
```typescript
import type { ASRProvider } from '../types.js';

export class NewProvider implements ASRProvider {
  name = 'NewProvider';
  
  async connect(ws: WebSocket, onTranscript: (text: string, isFinal: boolean) => void) {
    // Setup connection to ASR service
  }
  
  send(audioData: ArrayBuffer) {
    // Send audio to ASR service
  }
  
  disconnect() {
    // Cleanup
  }
}
```

2. Register in `backend/src/providers/index.ts`
3. Add route in `backend/src/server.ts`
4. Create frontend hook `hooks/useNewProvider.ts`

## 🔒 Security Notes

- **API Keys**: Store in `.env` files (never commit to git)
- **Backend Mode**: Always use relay server in production
- **CORS**: Configured for localhost in development

## 📄 License

MIT

## 👤 Author

Woottipong ([@woottipong](https://github.com/woottipong))
