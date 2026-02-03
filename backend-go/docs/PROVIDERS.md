# Backend Go - ASR Providers

รองรับ 4 ASR providers: Deepgram, Gemini, Google Cloud Speech-to-Text, และ Azure Speech Service

## 📊 Provider Overview

| Provider | Protocol           | Latency    | Streaming Limit | Interim Results |
| -------- | ------------------ | ---------- | --------------- | --------------- |
| Deepgram | WebSocket (Direct) | ~200ms     | No limit        | ✅               |
| Gemini   | REST (Batch)       | ~2-3s      | N/A             | ❌               |
| Google   | gRPC               | ~300-500ms | **5 minutes**   | ✅               |
| Azure    | WebSocket          | ~200-300ms | No limit        | ✅               |

## ✅ Implementation Status

### 1. Handlers
- `handlers/deepgram.go` - Stub (frontend connects directly)
- `handlers/gemini.go` - Batch processing via REST API
- `handlers/google.go` - gRPC streaming
- `handlers/azure.go` - **WebSocket streaming** (with interim results)

### 2. Configuration
- `config/config.go` - All provider configs

### 3. Routes
- `/deepgram` - WebSocket endpoint (stub)
- `/gemini` - WebSocket endpoint for Gemini
- `/google` - WebSocket endpoint for Google Speech-to-Text
- `/azure` - WebSocket endpoint for Azure Speech Service

## 📦 Dependencies

```bash
cd backend-go

# Google Cloud Speech-to-Text (gRPC)
go get cloud.google.com/go/speech/apiv1
go get cloud.google.com/go/speech/apiv1/speechpb

# Fiber WebSocket (for client connections)
# fasthttp/websocket is already included via gofiber/websocket

# Update dependencies
go mod tidy
```

> **Note:** Azure ไม่ต้องใช้ SDK - ใช้ pure Go WebSocket implementation

## 🔧 Environment Variables

```bash
# Deepgram (frontend uses directly)
VITE_DEEPGRAM_API_KEY=your_deepgram_key

# Gemini
GEMINI_API_KEY=your_gemini_key

# Google Cloud Speech-to-Text
# ใช้ Service Account JSON file (recommended)
GOOGLE_APPLICATION_CREDENTIALS=./credential/stt-google.json
# หรือใช้ API key:
# GOOGLE_API_KEY=your_google_api_key

# Azure Speech Service
AZURE_SUBSCRIPTION_KEY=your_subscription_key
AZURE_REGION=southeastasia
```

## 🚀 WebSocket Endpoints

| Provider | Endpoint    | Sample Rate | Format    | Notes               |
| -------- | ----------- | ----------- | --------- | ------------------- |
| Deepgram | `/deepgram` | 48kHz       | PCM Int16 | Frontend direct     |
| Gemini   | `/gemini`   | 16kHz       | PCM Int16 | Batch (~2s chunks)  |
| Google   | `/google`   | 48kHz       | PCM Int16 | gRPC streaming      |
| Azure    | `/azure`    | 16kHz       | PCM Int16 | WebSocket streaming |

### Message Format

**Start Session:**
```json
{
  "type": "start",
  "apiKey": "optional_override_key"
}
```

**Send Audio:**
- Binary message (PCM audio data)

**Stop Session:**
```json
{
  "type": "stop"
}
```

### Response Format (Standardized)

```json
{
  "type": "transcript",
  "text": "ผลลัพธ์การถอดเสียง",
  "isFinal": true,
  "channel": {
    "alternatives": [{
      "transcript": "ผลลัพธ์การถอดเสียง",
      "confidence": 0.95
    }]
  }
}
```

> **Note:** ใช้ `text` และ `isFinal` (ไม่ใช่ `transcript` และ `is_final`)

## 🎤 Audio Configuration

### Google Cloud Speech-to-Text
- **Protocol:** gRPC streaming
- **Model:** `default`
- **Language:** `th-TH`
- **Sample Rate:** 48000 Hz
- **Encoding:** LINEAR16 (PCM)
- **Interim Results:** ✅ Enabled
- **Streaming Limit:** ⚠️ 5 minutes (must reconnect)

### Azure Speech Service
- **Protocol:** WebSocket (pure Go, no SDK)
- **Language:** `th-TH`
- **Sample Rate:** 16000 Hz
- **Bits Per Sample:** 16
- **Channels:** 1 (Mono)
- **Interim Results:** ✅ Enabled (`speech.hypothesis`)
- **Streaming Limit:** No limit

### Gemini
- **Protocol:** REST API (batch)
- **Model:** `gemini-2.0-flash`
- **Sample Rate:** 16000 Hz
- **Batch Size:** ~64KB (~2 seconds)
- **Interim Results:** ❌ Not supported

## 🧪 Testing

```bash
# 1. ตั้งค่า environment variables
cp .env.example .env
# แก้ไข .env ใส่ API keys

# 2. ติดตั้ง dependencies
go mod tidy

# 3. Build & Run server
go build -o server . && ./server

# 4. Test endpoints
# Google: ws://localhost:3000/google
# Azure: ws://localhost:3000/azure
# Gemini: ws://localhost:3000/gemini
```

## 📝 Features Comparison

| Feature         | Deepgram         | Gemini  | Google   | Azure    |
| --------------- | ---------------- | ------- | -------- | -------- |
| Streaming       | ✅                | ❌ Batch | ✅        | ✅        |
| Interim Results | ✅                | ❌       | ✅        | ✅        |
| Thai Support    | ✅                | ✅       | ✅        | ✅        |
| VAD Built-in    | ✅ (configurable) | ❌       | ✅        | ✅        |
| Low Latency     | ✅ ~200ms         | ❌ ~2-3s | ✅ ~300ms | ✅ ~200ms |
| No Time Limit   | ✅                | ✅       | ❌ 5 min  | ✅        |
| Pure Go         | ✅                | ✅       | ✅        | ✅        |

## ⚠️ หมายเหตุ

1. **Google Streaming Limit:**
   - 5 นาทีต่อ session - ต้อง reconnect หลังจากนั้น
   - Frontend ควร handle reconnection

2. **Azure Region:**
   - เลือก region ที่ใกล้ที่สุดเพื่อ latency ต่ำ
   - Thailand: `southeastasia` (Singapore)

3. **Sample Rate:**
   - Google: 48kHz (no downsampling needed)
   - Azure: 16kHz (frontend downsamples)
   - Gemini: 16kHz (frontend downsamples)

4. **Authentication:**
   - Google: API Key หรือ Service Account (ADC)
   - Azure: Subscription Key + Region
   - Gemini: API Key

## 🔗 Related Documentation

- [AZURE_WEBSOCKET_FLOW.md](AZURE_WEBSOCKET_FLOW.md) - Azure WebSocket protocol details
- [GOOGLE_GRPC_FLOW.md](GOOGLE_GRPC_FLOW.md) - Google gRPC flow
- [VAD_CONFIGURATION.md](VAD_CONFIGURATION.md) - VAD settings
- [WEBSOCKET_FORMAT.md](WEBSOCKET_FORMAT.md) - Message format specification

## 🔗 External Documentation

- [Google Cloud Speech-to-Text](https://cloud.google.com/speech-to-text/docs)
- [Azure Speech Service](https://docs.microsoft.com/azure/cognitive-services/speech-service/)
- [Deepgram API](https://developers.deepgram.com/)
- [Gemini API](https://ai.google.dev/gemini-api/docs)
