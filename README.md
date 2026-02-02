# 🎙️ Thai Verbatim Transcriber

Real-time Thai speech-to-text transcription using Deepgram's Nova-2 model.

![Thai Verbatim Transcriber](https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6)

## ✨ Features

- **Real-time transcription** - See Thai text as you speak
- **Verbatim output** - No auto-formatting (smart_format: false)
- **Dual modes** - Direct API or secure relay server
- **Audio visualization** - Real-time waveform display
- **Interim results** - Preview text before final confirmation

## 🚀 Quick Start

### One Command Setup

```bash
./run.sh
```

This will:
1. Install frontend dependencies
2. Install backend dependencies
3. Start both servers

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
cp .env.example .env
# Edit .env and add your DEEPGRAM_API_KEY
```

**3. Start Servers**

Terminal 1 - Frontend:
```bash
npm run dev
```

Terminal 2 - Backend:
```bash
cd backend && npm start
```

**4. Open Browser**
```
http://localhost:5173
```

## 🏗️ Project Structure

```
├── App.tsx                 # Main application component
├── types.ts                # TypeScript type definitions
├── index.tsx               # React entry point
├── index.css               # Global styles with Tailwind
├── lib/
│   ├── constants.ts        # Application constants
│   └── utils.ts            # Utility functions
├── hooks/
│   ├── useDeepgram.ts      # WebSocket & audio streaming
│   └── useAudioVisualizer.ts # Audio visualization
├── components/
│   ├── ConnectionBadge.tsx # Connection status indicator
│   ├── RecordButton.tsx    # Start/stop recording button
│   ├── ErrorBanner.tsx     # Error display
│   ├── TranscriptPanel.tsx # Transcript display area
│   ├── Visualizer.tsx      # Audio waveform
│   └── SettingsModal.tsx   # Configuration modal
└── backend/
    └── server.ts           # Node.js relay server
```

## ⚙️ Configuration

### Direct Mode (Demo)
- Enter Deepgram API key in Settings
- ⚠️ Exposes API key to browser (testing only)

### Relay Mode (Recommended)
- API key stays secure on server
- Set `DEEPGRAM_API_KEY` in `.env`
- Configure backend URL: `ws://localhost:3000`

## 🔧 Tech Stack

| Category   | Technology                       |
| ---------- | -------------------------------- |
| Frontend   | React 19, TypeScript 5.8, Vite 6 |
| Styling    | Tailwind CSS 3.4                 |
| Icons      | Lucide React                     |
| Audio      | MediaRecorder API, Web Audio API |
| STT Engine | Deepgram Nova-2 (Thai)           |
| Backend    | Node.js, Express, ws             |

## 📝 API Configuration

Deepgram settings (optimized for Thai verbatim):
```typescript
{
  model: 'nova-2',
  language: 'th',
  smart_format: false,  // Keep false for verbatim
  interim_results: true
}
```

## 🛠️ Scripts

```bash
npm run dev           # Start frontend dev server
npm run build         # Production build
npm run preview       # Preview production build
npm run backend:start # Start relay server
npm run full-setup    # Install all dependencies
npm run full-dev      # Start frontend + backend
```

## 📄 License

MIT
