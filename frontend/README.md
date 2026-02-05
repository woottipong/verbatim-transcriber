# Frontend - LiveKit Transcription

Real-time Thai transcription using LiveKit WebRTC for ultra-low latency.

---

## 🎯 Overview

| Feature | WebSocket (Legacy) | LiveKit (Current) |
|---------|------------------|-------------------|
| Protocol | WebSocket | WebRTC |
| Latency | 500-2000ms | 200-500ms |
| Packet Loss | Poor recovery | Excellent recovery |
| Audio Quality | Variable | Consistent |
| Multi-Participant | No | Yes |

---

## 🚀 Quick Start

```bash
npm run dev
```

Then open: http://localhost:5173

---

## 📁 Components

### LiveKit Components

| Component | File | Description |
|-----------|------|-------------|
| `TranscriptionRoom` | `components/LiveKitRoom.tsx` | LiveKit room wrapper with data channel |
| `LiveTranscript` | `components/LiveTranscript.tsx` | Transcript display with real-time updates |

### Legacy WebSocket Components (for reference)

| Component | File | Description |
|-----------|------|-------------|
| `App` | `App.tsx` | Legacy WebSocket implementation |
| `SettingsModal` | `components/SettingsModal.tsx` | Provider settings |
| `ConnectionBadge` | `components/ConnectionBadge.tsx` | Connection status |
| `RecordButton` | `components/RecordButton.tsx` | Start/stop recording |
| `TranscriptPanel` | `components/TranscriptPanel.tsx` | Transcript display (legacy) |
| `VADInfoBadge` | `components/VADInfoBadge.tsx` | VAD status |
| `Visualizer` | `components/Visualizer.tsx` | Audio waveform |
| `ErrorBanner` | `components/ErrorBanner.tsx` | Error display |

---

## 🔧 Configuration

### Environment Variables (`.env`)

```bash
VITE_BACKEND_URL=http://localhost:3000
```

### TypeScript Environment Types

```typescript
// vite-env.d.ts
interface ImportMetaEnv {
  readonly VITE_BACKEND_URL: string
  readonly VITE_DEEPGRAM_API_KEY?: string
}
```

---

## 📡 API Usage

### LiveKit Flow

1. **Request Token**
   ```typescript
   const response = await fetch('http://localhost:3000/livekit/token', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ roomName: 'transcription-room' }),
   });
   const { token, wsUrl } = await response.json();
   ```

2. **Connect to LiveKit**
   ```typescript
   <TranscriptionRoom
     token={token}
     serverUrl={wsUrl}
     onTranscript={(msg) => console.log(msg)}
     onConnected={() => console.log('Connected')}
     onDisconnected={() => console.log('Disconnected')}
   />
   ```

3. **Receive Transcripts**
   ```typescript
   interface TranscriptMessage {
     text: string;
     isFinal: boolean;
     confidence: number;
     speaker: string;
     timestamp: number;
   }
   ```

---

## 🎨 Main Page

### LiveKitTest.tsx (Current Main)

Main page for LiveKit transcription.

**Features:**
- Token generation from backend
- Room name configuration
- Connection status monitoring
- Real-time transcript display
- Speaker identification

**URL:** http://localhost:5173/

---

## 📚 React Hooks

### LiveKit Hooks

| Hook | Source | Description |
|------|--------|-------------|
| `useRoomContext` | `@livekit/components-react` | Access LiveKit room |

### Legacy WebSocket Hooks (for reference)

| Hook | Source | Description |
|------|--------|-------------|
| `useDeepgram` | `hooks/useDeepgram.ts` | Deepgram WebSocket connection |
| `useGemini` | `hooks/useGemini.ts` | Gemini 2.0 Flash batch ASR |
| `useGoogle` | `hooks/useGoogle.ts` | Google Cloud STT streaming |
| `useAzure` | `hooks/useAzure.ts` | Azure Speech streaming |
| `useVAD` | `hooks/useVAD.ts` | Voice Activity Detection |
| `useAudioDevices` | `hooks/useAudioDevices.ts` | Audio device management |

---

## 🔌 Data Flow

```
User speaks
    ↓
Browser captures audio
    ↓
WebRTC stream to LiveKit
    ↓
Agent receives audio
    ↓
Google/Azure STT processes
    ↓
Transcript via data channel
    ↓
Browser displays result
```

---

## 🧪 Testing

### Test LiveKit Connection

1. Open http://localhost:5173
2. Click "Start Session"
3. Grant microphone permission
4. Start speaking in Thai
5. Verify transcripts appear

### Test Token Generation

```bash
curl -X POST http://localhost:3000/livekit/token \
  -H "Content-Type": application/json \
  -d '{"roomName":"test"}'
```

---

## 🐛 Troubleshooting

### No transcripts appearing

1. **Check agent is running**
   ```bash
   cd backend-go/agent
   export $(cat .env | xargs)
   go run main.go
   ```

2. **Check LiveKit server**
   ```bash
   cd livekit && docker-compose ps
   ```

3. **Check browser console**
   - Look for WebRTC errors
   - Check token is valid

### Microphone not working

1. Check browser permissions
2. Verify microphone is selected
3. Check browser console for errors

### Connection fails

1. Verify backend is running: http://localhost:3000/health
2. Check LiveKit server: ws://localhost:7880
3. Verify CORS settings

---

## 📦 Build for Production

```bash
npm run build
```

Output: `dist/`

### Preview Production Build

```bash
npm run preview
```

---

## 🎯 Performance Tips

1. **Use WebRTC for production** - Better performance
2. **Optimize audio settings** - Adjust sample rates
3. **Implement VAD** - Reduce unnecessary processing
4. **Use data channels** - For transcript delivery

---

## 📝 Architecture

```
frontend/
├── components/
│   ├── LiveKitRoom.tsx        # LiveKit wrapper (CURRENT)
│   ├── LiveTranscript.tsx     # Transcript display (CURRENT)
│   ├── SettingsModal.tsx       # Provider settings (LEGACY)
│   ├── ConnectionBadge.tsx     # Status badge (LEGACY)
│   ├── RecordButton.tsx        # Record control (LEGACY)
│   ├── TranscriptPanel.tsx     # Transcript panel (LEGACY)
│   ├── VADInfoBadge.tsx       # VAD status (LEGACY)
│   ├── ErrorBanner.tsx        # Error display (LEGACY)
│   └── Visualizer.tsx        # Audio visualizer (LEGACY)
├── hooks/
│   ├── useDeepgram.ts          # Deepgram hook (LEGACY)
│   ├── useGemini.ts           # Gemini hook (LEGACY)
│   ├── useGoogle.ts           # Google hook (LEGACY)
│   ├── useAzure.ts            # Azure hook (LEGACY)
│   ├── useVAD.ts             # VAD hook (LEGACY)
│   └── useAudioDevices.ts     # Device management (LEGACY)
├── lib/
│   ├── constants.ts           # Constants
│   ├── utils.ts              # Utilities
│   └── api.ts               # API helpers
├── LiveKitTest.tsx          # LiveKit test page (CURRENT MAIN)
├── App.tsx                 # Legacy app (LEGACY)
├── index.html               # Main HTML (uses LiveKitTest.tsx)
├── vite.config.ts           # Vite config
└── package.json             # Dependencies
```

---

## 🔗 References

- [LiveKit Docs](https://docs.livekit.io)
- [LiveKit React Components](https://docs.livekit.io/reference/components/react/)
- [LiveKit Client SDK](https://docs.livekit.io/client-js/)
- [Google Cloud STT](https://cloud.google.com/speech-to-text/docs)

---

## ✨ Features

### LiveKit System (Current)
- [x] Real-time WebRTC streaming
- [x] Ultra-low latency (200-500ms)
- [x] Multi-participant support
- [x] Connection state management
- [x] Real-time transcript display
- [x] Speaker identification

### WebSocket System (Legacy)
- [x] Multiple ASR providers
- [x] Voice Activity Detection
- [x] Audio visualization
- [x] Device selection
- [x] Settings persistence

---

## 🎯 Next Steps

1. [ ] Add Azure Speech fallback to agent
2. [ ] Implement VAD in agent
3. [ ] Optimize latency
4. [ ] Add error recovery
5. [ ] Implement auto-reconnection
6. [ ] Add recording feature
7. [ ] Export transcripts

---

*Last Updated: February 5, 2026*
