# VAD Configuration - Azure & Google Speech

## 📋 สารบัญ

1. [ภาพรวม VAD](#ภาพรวม-vad)
2. [Azure Speech VAD](#azure-speech-vad)
3. [Google Cloud Speech VAD](#google-cloud-speech-vad)
4. [เปรียบเทียบ](#เปรียบเทียบ)
5. [Best Practices](#best-practices)

---

## ภาพรวม VAD

**VAD (Voice Activity Detection)** คือการตรวจจับว่ามีเสียงพูดหรือไม่ ใช้เพื่อ:
- ตัดแบ่ง segment เสียงพูด
- ประหยัด bandwidth (ไม่ส่งช่วงเงียบ)
- ลด latency (เริ่ม process ทันทีที่มีเสียง)

### VAD Locations

```
┌─────────────┐          ┌─────────────┐          ┌─────────────┐
│  Frontend   │          │   Backend   │          │  Cloud STT  │
│    VAD      │          │    VAD      │          │    VAD      │
│ (Optional)  │          │  (None)     │          │ (Built-in)  │
└─────────────┘          └─────────────┘          └─────────────┘
      │                        │                        │
      ▼                        ▼                        ▼
   Silero VAD              Not used              Azure/Google
   (Client-side)                                 (Server-side)
```

---

## Azure Speech VAD

### ✅ Built-in VAD

Azure Speech Service มี VAD ในตัว **ไม่ต้องตั้งค่า** - ทำงานอัตโนมัติ

### Recognition Modes

| Mode             | URL Parameter              | Description              |
| ---------------- | -------------------------- | ------------------------ |
| **conversation** | `recognition=conversation` | สำหรับบทสนทนา, VAD ผ่อนคลาย |
| **dictation**    | `recognition=dictation`    | สำหรับ dictation, รอนานกว่า |
| **interactive**  | `recognition=interactive`  | สำหรับ command, VAD เข้มงวด |

### WebSocket URL Example

```
wss://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1
                                        ^^^^^^^^^^^^
                                        Recognition Mode
```

### VAD Events จาก Azure

```go
// Events ที่ได้รับจาก Azure
case "speech.startDetected":
    // 🗣️ เริ่มตรวจพบเสียงพูด
    
case "speech.endDetected":
    // 🔕 เสียงพูดจบ (VAD detected silence)
    
case "speech.hypothesis":
    // 📝 Interim result (ระหว่างพูด)
    
case "speech.phrase":
    // ✅ Final result (VAD ตัดสินใจแล้ว)
```

### ⚠️ Azure VAD Limitations

1. **ไม่สามารถปรับ threshold** - ใช้ค่า default ของ Azure
2. **ไม่มี silence timeout config** ใน WebSocket API โดยตรง
3. **ขึ้นอยู่กับ recognition mode** ที่เลือก

### Workaround: ใช้ Frontend VAD

ถ้าต้องการควบคุม VAD เอง:

```typescript
// frontend/lib/constants.ts
vadConfig: {
    enabled: true,      // เปิดใช้ Silero VAD
    threshold: 0.4,     // ปรับ sensitivity (0.0-1.0)
}
```

---

## Google Cloud Speech VAD

### ✅ Built-in VAD + Configurable

Google มี VAD ในตัวและ**ตั้งค่าได้บางส่วน**

### StreamingRecognitionConfig

```go
// backend-go/handlers/google.go
StreamingConfig: &speechpb.StreamingRecognitionConfig{
    Config: &speechpb.RecognitionConfig{
        // ... audio config
    },
    InterimResults: true,
    
    // VAD-related settings
    SingleUtterance: false,  // true = หยุดหลังพูดจบประโยคแรก
}
```

### VAD Configuration Options

| Option            | Type | Description                      |
| ----------------- | ---- | -------------------------------- |
| `SingleUtterance` | bool | `true` = ปิด stream หลังเงียบครั้งแรก |
| `InterimResults`  | bool | รับ interim results ระหว่างพูด      |

### ⚠️ Google VAD Limitations

1. **5 นาที streaming limit** - ต้อง reconnect
2. **ไม่มี silence threshold config** โดยตรง
3. **SingleUtterance** ปิด stream ทันทีหลังเงียบ

### Reconnection Strategy

```go
// ต้อง handle reconnect เมื่อถึง limit
if streamDuration > 4*time.Minute {
    // Reconnect before 5-minute limit
    reconnectStream()
}
```

---

## เปรียบเทียบ

### VAD Features

| Feature                | Azure | Google | Deepgram |
| ---------------------- | ----- | ------ | -------- |
| Built-in VAD           | ✅     | ✅      | ✅        |
| Configurable threshold | ❌     | ❌      | ✅        |
| Silence timeout config | ❌     | ❌      | ✅        |
| Speech start event     | ✅     | ❌      | ✅        |
| Speech end event       | ✅     | ❌      | ✅        |
| Streaming limit        | ไม่จำกัด | 5 นาที  | ไม่จำกัด    |

### Deepgram VAD Config (Reference)

```typescript
// Deepgram สามารถตั้งค่าได้ละเอียด
ENDPOINTING: 2000,    // ms รอก่อน finalize
VAD_TURNOFF: 2000,    // ms ก่อนปิด VAD
```

---

## Best Practices

### 1. เมื่อไหร่ควรใช้ Frontend VAD

| Scenario                | Use Frontend VAD?    |
| ----------------------- | -------------------- |
| ประหยัด bandwidth        | ✅ ใช้                 |
| ต้องการควบคุม sensitivity | ✅ ใช้                 |
| Latency สำคัญมาก          | ❌ ไม่ใช้ (เพิ่ม latency) |
| ใช้ Azure/Google เฉยๆ    | ❌ ไม่จำเป็น             |

### 2. Recommended Configuration

```typescript
// สำหรับ Azure/Google - ไม่ต้องใช้ frontend VAD
vadConfig: {
    enabled: false,
    threshold: 0.4,
}

// สำหรับ Deepgram - ใช้ Deepgram's built-in VAD
// หรือใช้ frontend VAD ถ้าต้องการ custom
```

### 3. Handling Long Sessions

```
Azure:
├── ไม่มี limit → ไม่ต้องทำอะไร

Google:
├── 5 นาที limit
├── ต้อง reconnect ก่อนหมดเวลา
└── เก็บ state ไว้ handle reconnect
```

### 4. Audio Quality Tips

```
✅ ใช้ 16kHz sample rate (Azure/Google optimal)
✅ ส่ง audio ต่อเนื่อง ไม่ต้องรอ VAD ถ้าไม่จำเป็น
✅ ปล่อยให้ cloud VAD ทำงาน
❌ อย่าส่ง chunk เล็กเกินไป (< 100ms)
❌ อย่าส่ง chunk ใหญ่เกินไป (> 500ms)
```

---

## Summary

| Provider     | VAD Strategy       | Config Level                        |
| ------------ | ------------------ | ----------------------------------- |
| **Azure**    | Trust built-in VAD | None                                |
| **Google**   | Trust built-in VAD | Minimal (`SingleUtterance`)         |
| **Deepgram** | Can customize      | Full (`endpointing`, `vad_turnoff`) |

**Recommendation:** สำหรับ Azure และ Google ไม่ต้องเปิด frontend VAD เพราะ built-in VAD ทำงานได้ดีอยู่แล้ว ส่ง audio ไปตลอด แล้วให้ cloud จัดการครับ
