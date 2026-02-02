# 📋 Project Summary - Thai Verbatim Transcriber

Last Updated: February 2, 2026

## 🎯 Overview
Real-time Thai speech-to-text web application comparing **Deepgram Nova-2** vs **Gemini 2.0 Flash** side-by-side for verbatim transcription accuracy.

## 🏗️ Current Architecture

### Project Structure
```
thai-verbatim-transcriber/
│
├── frontend/                   # React 19 + TypeScript + Vite
│   ├── .env                    # Environment config (gitignored)
│   ├── .env.example            # Environment template
│   ├── vite-env.d.ts           # TypeScript env declarations
│   ├── package.json            # Frontend dependencies
│   ├── App.tsx, index.tsx
│   ├── components/, hooks/, lib/
│   ├── public/                 # VAD WASM files
│   └── metadata.json
│
├── backend-go/                 # Go + Fiber WebSocket server
│   ├── .env                    # API keys (gitignored)
│   ├── .env.example            # Environment template
│   ├── main.go
│   ├── config/, handlers/, routes/, utils/
│   └── go.mod
│
├── run.sh                      # Quick start (both servers)
├── start.sh                    # Full setup + start
└── README.md                   # Main documentation
```

## 🔧 Key Technologies

### Frontend
- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite 6** - Build tool & dev server
- **Tailwind CSS** - Styling
- **Web Audio API** - Audio processing (48kHz/16kHz)
- **WebSocket** - Real-time communication
- **Silero VAD** - Voice Activity Detection (optional)
- **Environment Variables** - `VITE_BACKEND_URL` for backend config

### Backend
- **Go 1.22+** - High-performance server
- **Fiber** - Web framework (Express-like)
- **Gorilla WebSocket** - WebSocket handling
- **Deepgram SDK** - Nova-2 streaming ASR
- **Gemini SDK** - 2.0 Flash batch ASR
- **Environment Variables** - `DEEPGRAM_API_KEY`, `GEMINI_API_KEY`

## 📡 Communication Flow

```
Microphone → ScriptProcessorNode → WebSocket Client
                                        ↓
                            ws://localhost:3000/{provider}
                                        ↓
                                  Go WebSocket Server
                                  /     ↓      \
                          Deepgram   Fiber    Gemini
                          (48kHz)   Router    (16kHz)
                              ↓                  ↓
                         Real-time          Batch (~2s)
                         Streaming          Processing
                              ↓                  ↓
                         WebSocket ← JSON ← WebSocket
                              ↓                  ↓
                         React UI          React UI
```

## 🔑 Environment Configuration

### Frontend (.env)
```bash
VITE_BACKEND_URL=ws://localhost:3000  # Backend WebSocket URL
```

### Backend (.env)
```bash
DEEPGRAM_API_KEY=your_key_here
GEMINI_API_KEY=your_key_here
PORT=3000
```

## 🚀 Deployment

### Quick Start
```bash
./run.sh  # Starts both frontend & backend
```

### Manual Start
```bash
# Terminal 1 - Backend
cd backend-go && go run main.go

# Terminal 2 - Frontend
cd frontend && npm run dev
```

### Production Build
```bash
# Frontend
cd frontend && npm run build
# Output: dist/

# Backend
cd backend-go && go build -o transcriber-backend
# Output: transcriber-backend executable
```

## 🎤 Audio Processing

| Provider | Sample Rate | Format    | Mode      | Latency |
| -------- | ----------- | --------- | --------- | ------- |
| Deepgram | 48,000 Hz   | PCM Int16 | Streaming | ~200ms  |
| Gemini   | 16,000 Hz   | WAV       | Batch     | ~2-3s   |

**Audio Pipeline:**
1. Microphone → 48kHz capture
2. ScriptProcessorNode (4096 buffer)
3. **Deepgram:** Direct PCM stream
4. **Gemini:** Downsample → 64KB batches → WAV conversion

## 🔧 Key Features

### Implemented ✅
- Dual ASR comparison (Deepgram + Gemini)
- Real-time audio streaming
- Voice Activity Detection (Silero VAD)
- Audio visualization (waveform)
- Connection state management
- Error handling & recovery
- Interim results preview
- Device selection (microphone)
- Settings persistence (localStorage)
- Environment-based configuration

### Architecture Highlights
- **Modular Backend:** Provider-based handlers (easy to add new ASR)
- **Custom React Hooks:** useDeepgram, useGemini, useVAD
- **Standalone Frontend:** Can be deployed separately with env config
- **Type Safety:** Full TypeScript coverage
- **Performance:** Go backend for high concurrency

## 📝 Recent Changes

### Migration to Modular Structure (Feb 2, 2026)
1. **Frontend Separation**
   - Moved all frontend code to `frontend/` folder
   - Added environment variable support (`VITE_BACKEND_URL`)
   - Created `vite-env.d.ts` for TypeScript env types
   - Frontend can now be deployed standalone

2. **Environment Management**
   - Backend env files moved to `backend-go/`
   - Frontend env files in `frontend/`
   - Each module has its own `.env.example`

3. **Removed from Root**
   - `package.json` (no longer needed)
   - `node_modules/` (moved to frontend/)
   - `package-lock.json`
   - All config files (distributed to modules)

## 🧪 Testing

### Frontend
```bash
cd frontend
npm run build  # Test build
npm run preview  # Test production build
```

### Backend
```bash
cd backend-go
go test ./...  # Run tests (if available)
go run main.go  # Manual testing
```

## 📚 Documentation

- [Main README](README.md) - Project overview & setup
- [Frontend README](frontend/README.md) - Frontend-specific docs
- [Backend README](backend-go/README.md) - Backend-specific docs (if exists)

## 🎯 Future Enhancements

- [ ] Add unit tests (frontend & backend)
- [ ] Docker Compose setup
- [ ] CI/CD pipeline
- [ ] Additional ASR providers (Google Speech-to-Text)
- [ ] Export transcripts (TXT, JSON, SRT)
- [ ] Real-time translation
- [ ] Multi-language support
- [ ] Performance monitoring
- [ ] WebRTC for better audio quality

## 🔗 External Services

| Service    | Usage                    | Docs                                   |
| ---------- | ------------------------ | -------------------------------------- |
| Deepgram   | Speech-to-Text API       | https://developers.deepgram.com        |
| Gemini     | Multimodal AI API        | https://ai.google.dev                  |
| Silero VAD | Voice Activity Detection | https://github.com/snakers4/silero-vad |

## 👥 Development

**Agent Mode:** `fullstack-agent`  
**Languages:** Thai & English  
**Stack Expertise:** React, TypeScript, Go, WebSocket, ASR APIs

---

**ความพร้อม:** Production-ready for deployment  
**ใช้งานได้:** ทั้ง development และ production
