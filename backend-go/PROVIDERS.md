# Backend Go - ASR Providers Update

เพิ่ม Azure Speech Service และ Google Cloud Speech-to-Text support

## ✅ เพิ่มแล้ว

### 1. Handlers
- `handlers/google.go` - Google Cloud Speech-to-Text streaming
- `handlers/azure.go` - Azure Speech Service streaming

### 2. Configuration
- เพิ่ม `GoogleConfig` และ `AzureConfig` ใน `config/config.go`
- API keys และ credentials configuration

### 3. Routes
- `/google` - WebSocket endpoint สำหรับ Google Speech-to-Text
- `/azure` - WebSocket endpoint สำหรับ Azure Speech Service

### 4. Environment Variables
อัปเดต `.env.example` พร้อม:
- `GOOGLE_API_KEY`
- `AZURE_SUBSCRIPTION_KEY`
- `AZURE_REGION`

## 📦 Dependencies ที่ต้องติดตั้ง

```bash
cd backend-go

# Google Cloud Speech-to-Text
go get cloud.google.com/go/speech/apiv1
go get cloud.google.com/go/speech/apiv1/speechpb

# Azure Speech SDK
go get github.com/Microsoft/cognitive-services-speech-sdk-go/audio
go get github.com/Microsoft/cognitive-services-speech-sdk-go/speech
go get github.com/Microsoft/cognitive-services-speech-sdk-go/common

# Update dependencies
go mod tidy
```

## 🔧 Configuration

### Google Cloud Speech-to-Text

**Option 1: API Key**
```bash
GOOGLE_API_KEY=your_google_api_key
```

**Option 2: Service Account (ADC)**
```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

### Azure Speech Service

```bash
AZURE_SUBSCRIPTION_KEY=your_subscription_key
AZURE_REGION=southeastasia  # หรือ region อื่นๆ
```

## 🚀 การใช้งาน

### WebSocket Endpoints

| Provider | Endpoint    | Sample Rate | Format    |
| -------- | ----------- | ----------- | --------- |
| Deepgram | `/deepgram` | 48kHz       | PCM Int16 |
| Gemini   | `/gemini`   | 16kHz       | WAV       |
| Google   | `/google`   | 48kHz       | PCM Int16 |
| Azure    | `/azure`    | 48kHz       | PCM Int16 |

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

### Response Format

```json
{
  "type": "transcript",
  "transcript": "ผลลัพธ์การถอดเสียง",
  "is_final": true,
  "channel": {
    "alternatives": [{
      "transcript": "ผลลัพธ์การถอดเสียง",
      "confidence": 0.95
    }]
  }
}
```

## 🎤 Audio Configuration

### Google Cloud Speech-to-Text
- **Model:** `default`
- **Language:** `th-TH`
- **Sample Rate:** 48000 Hz
- **Encoding:** LINEAR16 (PCM)
- **Interim Results:** Enabled

### Azure Speech Service
- **Language:** `th-TH`
- **Sample Rate:** 48000 Hz
- **Bits Per Sample:** 16
- **Channels:** 1 (Mono)
- **Continuous Recognition:** Enabled

## 🧪 Testing

```bash
# 1. ตั้งค่า environment variables
cp .env.example .env
# แก้ไข .env ใส่ API keys

# 2. ติดตั้ง dependencies
go mod download

# 3. Run server
go run main.go

# 4. Test endpoints
# Google: ws://localhost:3000/google
# Azure: ws://localhost:3000/azure
```

## 📝 Features

### Google Cloud Speech-to-Text
- ✅ Streaming recognition
- ✅ Interim results
- ✅ High accuracy for Thai
- ✅ Multiple language support
- ✅ Automatic punctuation
- ⚠️ Requires GCP account

### Azure Speech Service
- ✅ Continuous recognition
- ✅ Real-time transcription
- ✅ Event-based callbacks
- ✅ Low latency
- ✅ Thai language support
- ⚠️ Requires Azure account

## ⚠️ หมายเหตุ

1. **Google API Key vs ADC:**
   - API Key: ง่าย แต่มีข้อจำกัด quota
   - Service Account (ADC): ยืดหยุ่น แนะนำสำหรับ production

2. **Azure Region:**
   - เลือก region ที่ใกล้ที่สุดเพื่อ latency ต่ำ
   - Thailand: `southeastasia` (Singapore)

3. **Sample Rate:**
   - Google & Azure รองรับ 48kHz โดยตรง (ไม่ต้อง downsample)
   - Gemini ต้อง downsample เป็น 16kHz

## 🔗 Documentation

- [Google Cloud Speech-to-Text](https://cloud.google.com/speech-to-text/docs)
- [Azure Speech Service](https://docs.microsoft.com/azure/cognitive-services/speech-service/)
- [Azure Speech SDK for Go](https://github.com/Microsoft/cognitive-services-speech-sdk-go)
