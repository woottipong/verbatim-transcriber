# Azure Speech Service Implementation

## ✅ Pure Go REST API Approach

แทนที่จะใช้ native C SDK (`github.com/Microsoft/cognitive-services-speech-sdk-go`) ซึ่งต้องการ:
- Native C libraries
- CGO compilation
- Platform-specific binaries

เราใช้ **Azure Speech REST API** แทน - pure Go, ไม่มี dependencies!

## 🏗️ Architecture

```
Audio Stream → Buffer (64KB batches) → Convert to WAV → REST API → Response
```

### ข้อดี:
- ✅ Pure Go - ไม่ต้อง native dependencies
- ✅ Cross-platform compatible
- ✅ Easy deployment (single binary)
- ✅ ใช้งานได้ทันทีไม่ต้อง install SDK

### ข้อจำกัด:
- ⚠️ Batch mode (~1-2 seconds chunks) - ไม่ใช่ true streaming
- ⚠️ Latency สูงกว่า WebSocket approach นิดหน่อย

## 🔧 Implementation Details

**API Endpoint:**
```
https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1
```

**Request:**
- Method: `POST`
- Headers:
  - `Ocp-Apim-Subscription-Key`: Your Azure subscription key
  - `Content-Type`: `audio/wav; codecs=audio/pcm; samplerate=16000`
- Query params:
  - `language`: `th-TH` (Thai)
  - `format`: `detailed`

**Response:**
```json
{
  "RecognitionStatus": "Success",
  "DisplayText": "ข้อความที่ถอดได้",
  "Offset": 0,
  "Duration": 10000000
}
```

## 📊 เปรียบเทียบกับ Providers อื่น

| Provider     | Mode           | Latency | Implementation    |
| ------------ | -------------- | ------- | ----------------- |
| **Deepgram** | True streaming | ~200ms  | Pure Go WebSocket |
| **Gemini**   | Batch          | ~2-3s   | Pure Go REST      |
| **Google**   | True streaming | ~300ms  | Pure Go gRPC      |
| **Azure**    | Batch (REST)   | ~1-2s   | Pure Go REST      |

## 💡 Recommendation

ถ้าต้องการ true real-time ใช้ **Deepgram** หรือ **Google**

ถ้าไม่เป็นไร latency 1-2 วินาที Azure REST API ก็ใช้งานได้ดี และไม่ต้องกังวลเรื่อง native dependencies!
