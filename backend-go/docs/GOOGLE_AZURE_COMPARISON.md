# Google Cloud STT vs Azure Speech Service

> เปรียบเทียบ Google Cloud Speech-to-Text และ Azure Speech Service สำหรับ Thai Verbatim Transcription

---

## Configuration ปัจจุบัน

### Google Cloud STT

```go
// internal/delivery/handler/google.go
RecognitionConfig{
    Model:                      "latest_long",
    LanguageCode:               "th-TH",
    SampleRateHertz:            48000,
    UseEnhanced:                true,
    EnableAutomaticPunctuation: true,
}
```

- `SingleUtterance: false` — Stream ต่อเนื่อง
- `ProfanityFilter: false` — Verbatim
- Dynamic sample rate — รับจาก frontend audioContext

### Azure Speech Service

```go
// internal/delivery/handler/azure.go
AzureConfig{
    Language:                   "th-TH",
    SampleRate:                 16000,
    SegmentationSilenceTimeout: 500,
}
```

- `segmentationSilenceTimeoutMs: 500` — ตัดประโยคเร็วขึ้น

---

## Provider Comparison

### ผลการทดสอบ (Thai Speech, 32 วินาที)

| Provider   | Final Count | ความยาว       | Confidence    | Latency    |
| ---------- | ----------- | ------------- | ------------- | ---------- |
| **Google** | 13 ครั้ง      | สั้น (5-15 คำ)   | **0.94-0.95** | ~200-500ms |
| **Azure**  | 7 ครั้ง       | ยาว (15-25 คำ) | 0.21-0.98     | ~1-3s      |

### Feature Comparison

| Feature         | Google             | Azure               |
| --------------- | ------------------ | ------------------- |
| Mode            | Streaming (gRPC)   | WebSocket Streaming |
| Sample Rate     | 48 kHz             | 16 kHz              |
| Interim Results | ✅                  | ✅                   |
| Streaming Limit | ⚠️ 5 minutes        | ไม่จำกัด               |
| Thai Quality    | ⭐⭐⭐⭐⭐              | ⭐⭐⭐⭐                |
| Latency         | ~300ms             | ~1-2s               |
| Implementation  | Pure Go (gRPC SDK) | Pure Go (WebSocket) |

### จุดแข็ง / จุดอ่อน

**Google:**
- ✅ เร็ว, confidence สูงสม่ำเสมอ (0.94-0.95)
- ✅ Real-time streaming, interim results
- ❌ **5-minute limit** — ต้อง restart session

**Azure:**
- ✅ **No time limit**
- ✅ รวมประโยคยาว, context ดี
- ❌ ช้ากว่า Google (2-3 เท่า), confidence แปรปรวน

---

## คำแนะนำ

| การใช้งาน                  | แนะนำ         | เหตุผล                |
| ------------------------- | ------------ | -------------------- |
| **Live Transcription**    | **Google** ✅ | เร็ว, แม่นยำ, real-time |
| **Long Sessions (>5min)** | **Azure**    | ไม่มี time limit       |

**Best Practice:** ใช้ side-by-side comparison เพื่อ redundancy และให้ผู้ใช้เลือก

---

## Google Models ที่รองรับ

| Model                | Best For                       | Thai Support |
| -------------------- | ------------------------------ | ------------ |
| **`latest_long`** ✅  | Long-form audio, conversations | ✅ ดีมาก       |
| `latest_short`       | Short commands (< 15 sec)      | ✅ ดี          |
| `command_and_search` | Voice commands                 | ✅ ดี          |
| `default`            | General purpose                | ✅ พอใช้       |

**❌ ห้ามใช้:** `chirp` (ต้องใช้ Vertex AI)

---

## Sample Rate Management

**ปัญหา:** เสียงเพี้ยน หรือแปลไม่ออก → Sample rate ไม่ตรงกัน

**วิธีแก้:** Frontend ส่งค่าจริงจาก audioContext → Backend ใช้ค่านั้น

```
Frontend: [Google] Audio context sample rate: 48000Hz
Backend:  🎤 [Google] Using sample rate from frontend: 48000 Hz
```

**ค่าที่เจอบ่อย:** 48000 Hz (macOS/Win), 44100 Hz (Linux), 16000 Hz (Mobile)

---

## Troubleshooting

### Google: EOF Error

```
❌ [Google] Failed to send audio: EOF
```

**สาเหตุ:** 5-minute limit / Network issue → กด Stop แล้ว Start ใหม่

### Google: Invalid Model

```
❌ Invalid recognition 'config': Incorrect model specified
```

**แก้:** ใช้ `latest_long`, `latest_short`, `command_and_search`, `default` เท่านั้น

### Azure: ช้า

**แก้:** ลด `SegmentationSilenceTimeout` (ค่าปัจจุบัน 500ms)

### Sample Rate Mismatch

**แก้:** ตรวจสอบค่าตรงกันระหว่าง frontend และ backend logs

---

## Related Documentation

| Document                                                 | Description            |
| -------------------------------------------------------- | ---------------------- |
| [GOOGLE_GRPC_FLOW.md](GOOGLE_GRPC_FLOW.md)               | Google gRPC data flow  |
| [AZURE_WEBSOCKET_FLOW.md](AZURE_WEBSOCKET_FLOW.md)       | Azure protocol details |
| [ISSUE_GOOGLE_5MIN_LIMIT.md](ISSUE_GOOGLE_5MIN_LIMIT.md) | 5-min limit solutions  |
