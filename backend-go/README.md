# Thai Verbatim Transcriber - Go Backend

Go backend implementation using Fiber framework for WebSocket-based real-time transcription.

## Features

- 🚀 High-performance Go + Fiber WebSocket server
- 🎙️ Multi-provider ASR support: **Deepgram**, **Gemini**, **Google Cloud Speech-to-Text**, **Azure Speech Service**
- 🔄 Real-time streaming transcription
- 🇹🇭 Optimized for Thai language verbatim transcription
- ⚡ Dynamic provider activation based on available API keys
- 💯 Pure Go implementation (no native C dependencies required)

> **Note on Azure:** Using REST API approach (batch mode ~1-2 sec chunks) instead of native SDK for pure Go compatibility.

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

**Note:** You only need to configure API keys for the providers you want to use. Endpoints for providers without API keys will be automatically disabled.

### 3. Run Server

```bash
go run main.go
```

The server will log which providers are enabled:
```
✅ Enabled providers: [Gemini Google]
⚠️  [Deepgram] Disabled - DEEPGRAM_API_KEY not configured
⚠️  [Azure] Disabled - AZURE_SUBSCRIPTION_KEY or AZURE_REGION not configured
```

## API Endpoints

- **Health Check**: `GET /health`
- **Providers Status**: `GET /providers` - Check which providers are available
- **Deepgram WebSocket**: `ws://localhost:3000/deepgram` (if `DEEPGRAM_API_KEY` is set)
- **Gemini WebSocket**: `ws://localhost:3000/gemini` (if `GEMINI_API_KEY` is set)
- **Google WebSocket**: `ws://localhost:3000/google` (if `GOOGLE_API_KEY` is set)
- **Azure WebSocket**: `ws://localhost:3000/azure` (if `AZURE_SUBSCRIPTION_KEY` and `AZURE_REGION` are set)

### Check Available Providers

```bash
curl http://localhost:3000/providers
```

Response:
```json
{
  "deepgram": false,
  "gemini": true,
  "google": true,
  "azure": false
}
```

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
