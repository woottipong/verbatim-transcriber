# Thai Verbatim Transcriber - Go Backend

Go backend implementation using Fiber framework for WebSocket-based real-time transcription.

## Features

- 🚀 High-performance Go + Fiber WebSocket server
- 🎙️ Dual ASR providers: Deepgram Nova-2 & Gemini 2.0 Flash
- 🔄 Real-time streaming transcription
- 🇹🇭 Optimized for Thai language verbatim transcription

## Setup

### 1. Install Dependencies

```bash
cd backend-go
go mod download
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env and add your API keys
```

### 3. Run Server

```bash
go run main.go
```

## API Endpoints

- **Health Check**: `GET /health`
- **Deepgram WebSocket**: `ws://localhost:3000/deepgram`
- **Gemini WebSocket**: `ws://localhost:3000/gemini`

## WebSocket Protocol

### Control Messages (JSON)

**Start Session:**
```json
{
  "type": "start",
  "apiKey": "optional_override_key"
}
```

**Stop Session:**
```json
{
  "type": "stop"
}
```

### Audio Data (Binary)

Send raw PCM audio (Int16, 48kHz for Deepgram, 16kHz for Gemini)

### Server Responses

**Connected:**
```json
{"type": "connected"}
```

**Transcript:**
```json
{
  "type": "transcript",
  "transcript": "ข้อความที่ถอดเสียง",
  "is_final": true,
  "channel": {
    "alternatives": [{
      "transcript": "ข้อความที่ถอดเสียง",
      "confidence": 0.95
    }]
  }
}
```

**Error:**
```json
{
  "type": "error",
  "error": "error message"
}
```

## Build for Production

```bash
go build -o transcriber-backend main.go
./transcriber-backend
```

## Dependencies

- [Fiber v2](https://github.com/gofiber/fiber) - Web framework
- [Deepgram Go SDK](https://github.com/deepgram/deepgram-go-sdk) - Deepgram API client
- [Google Generative AI Go](https://github.com/google/generative-ai-go) - Gemini API client
