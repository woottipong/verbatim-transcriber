# VAD Configuration - Azure & Google Speech

## Overview

**VAD (Voice Activity Detection)** คือการตรวจจับว่ามีเสียงพูดหรือไม่ ใช้เพื่อ:

- ตัดแบ่ง segment เสียงพูด
- ประหยัด bandwidth (ไม่ส่งช่วงเงียบ)
- ลด latency (เริ่ม process ทันทีที่มีเสียง)

### VAD Locations

```
Frontend VAD          Backend VAD        Cloud STT VAD
(Optional)            (None)             (Built-in)
     │                     │                  │
     ▼                     ▼                  ▼
  Silero VAD          Not used           Azure/Google
  (Client-side)                          (Server-side)
```

---

## Azure Speech VAD

### Built-in VAD

Azure Speech Service มี VAD ในตัว — ทำงานอัตโนมัติไม่ต้องตั้งค่า

### Recognition Modes

| Mode             | URL Parameter              | Description              |
| ---------------- | -------------------------- | ------------------------ |
| **conversation** | `recognition=conversation` | สำหรับบทสนทนา, VAD ผ่อนคลาย |
| **dictation**    | `recognition=dictation`    | สำหรับ dictation, รอนานกว่า |
| **interactive**  | `recognition=interactive`  | สำหรับ command, VAD เข้มงวด |

### VAD Events

```go
case "speech.startDetected":  // 🗣️ เริ่มตรวจพบเสียงพูด
case "speech.endDetected":    // 🔕 เสียงพูดจบ (VAD detected silence)
case "speech.hypothesis":     // 📝 Interim result (ระหว่างพูด)
case "speech.phrase":         // ✅ Final result (VAD ตัดสินใจแล้ว)
```

### ข้อจำกัด

- ไม่สามารถปรับ threshold ได้
- ไม่มี silence timeout config โดยตรงใน WebSocket API
- ขึ้นอยู่กับ recognition mode ที่เลือก

---

## Google Cloud Speech VAD

### Built-in VAD + Configurable

```go
// internal/delivery/handler/google.go
StreamingConfig: &speechpb.StreamingRecognitionConfig{
    Config:         &speechpb.RecognitionConfig{...},
    InterimResults: true,
    SingleUtterance: false,  // true = หยุดหลังพูดจบประโยคแรก
}
```

### Configuration Options

| Option            | Type | Description                      |
| ----------------- | ---- | -------------------------------- |
| `SingleUtterance` | bool | `true` = ปิด stream หลังเงียบครั้งแรก |
| `InterimResults`  | bool | รับ interim results ระหว่างพูด      |

### ข้อจำกัด

- **5 นาที streaming limit** — ต้อง reconnect ([ดูรายละเอียด](ISSUE_GOOGLE_5MIN_LIMIT.md))
- ไม่มี silence threshold config โดยตรง
- `SingleUtterance` ปิด stream ทันทีหลังเงียบ

---

## VAD Features Comparison

| Feature                | Azure | Google |
| ---------------------- | ----- | ------ |
| Built-in VAD           | ✅     | ✅      |
| Configurable threshold | ❌     | ❌      |
| Silence timeout config | ❌     | ❌      |
| Speech start event     | ✅     | ❌      |
| Speech end event       | ✅     | ❌      |
| Streaming limit        | ไม่จำกัด | 5 นาที  |

---

## Best Practices

### เมื่อไหร่ควรใช้ Frontend VAD (Silero)

| Scenario                | Use Frontend VAD?    |
| ----------------------- | -------------------- |
| ประหยัด bandwidth        | ✅ ใช้                 |
| ต้องการควบคุม sensitivity | ✅ ใช้                 |
| Latency สำคัญมาก          | ❌ ไม่ใช้ (เพิ่ม latency) |
| ใช้ Azure/Google เฉยๆ    | ❌ ไม่จำเป็น             |

### Recommended Configuration

```typescript
// สำหรับ Azure/Google — ไม่ต้องใช้ frontend VAD
vadConfig: {
    enabled: false,
    threshold: 0.4,
}
```

**สรุป:** สำหรับ Azure และ Google ไม่ต้องเปิด frontend VAD เพราะ built-in VAD ทำงานได้ดีอยู่แล้ว ส่ง audio ไปตลอดแล้วให้ cloud จัดการ

### Audio Quality Tips

- ✅ ใช้ sample rate ที่ถูกต้อง (48kHz สำหรับ Google, 16kHz สำหรับ Azure)
- ✅ ส่ง audio ต่อเนื่อง ไม่ต้องรอ VAD ถ้าไม่จำเป็น
- ❌ อย่าส่ง chunk เล็กเกินไป (< 100ms)
- ❌ อย่าส่ง chunk ใหญ่เกินไป (> 500ms)
