# Issue: Google Cloud Speech-to-Text 5-Minute Streaming Limit

## 📋 สรุปปัญหา

Google Cloud Speech-to-Text มีข้อจำกัด **5 นาทีต่อ streaming session** หลังจากนั้น stream จะถูกปิดอัตโนมัติ ทำให้ต้อง reconnect ใหม่

## 🔍 รายละเอียด

### ข้อจำกัดของ Google

| Limit                  | Value                                 |
| ---------------------- | ------------------------------------- |
| Max streaming duration | **5 minutes (300 seconds)**           |
| Error after timeout    | `DEADLINE_EXCEEDED` หรือ stream closes |
| Workaround             | Must reconnect                        |

### ผลกระทบ

- ถ้าผู้ใช้พูดยาวกว่า 5 นาที → stream จะตัด
- ถ้าพูดอยู่ตอนที่ stream ตัด → **อาจหายบางคำ**

---

## 🛠️ Solutions ที่พิจารณา

### Option 1: Simple Reconnect

```
Stream 1: ──────────────────────────────┤
                                        │ ← Gap ~200-500ms
Stream 2:                               ├──────────────────
```

| Pros                    | Cons                                 |
| ----------------------- | ------------------------------------ |
| ✅ Simple implementation | ❌ อาจหาย ~0.5 วินาที ถ้าพูดตอน reconnect |
| ✅ No extra memory       | ❌ User อาจรู้สึกสะดุด                    |

**Complexity:** ⭐ (ต่ำ)

---

### Option 2: Audio Buffer Strategy

```
Audio จาก Frontend
       │
       ▼
┌─────────────────┐
│  Ring Buffer    │ ← เก็บ audio ไว้ ~1-2 วินาที
│  (1-2 seconds)  │
└────────┬────────┘
         │
         ▼
    Send to Google

เวลา reconnect:
1. สร้าง Stream ใหม่
2. ส่ง buffered audio ไป Stream ใหม่
3. ไม่หายแม้แต่คำเดียว
```

| Pros                  | Cons                    |
| --------------------- | ----------------------- |
| ✅ ไม่หายแม้แต่คำเดียว      | ❌ Memory usage (~256KB) |
| ✅ Seamless experience | ❌ Slightly more complex |

**Complexity:** ⭐⭐ (กลาง)

---

### Option 3: VAD-Based Reconnect (แนะนำ)

```
Audio:  ██████░░░░██████████░░░░░░██████░░░░░░░░████████
        พูด   เงียบ  พูด      เงียบ   พูด   เงียบ   พูด
                            ↑
                    4 นาทีแล้ว + เงียบ → Reconnect!
```

**Logic:**
```go
if streamDuration > 4*time.Minute && !isSpeaking {
    // เงียบแล้ว + ใกล้ 5 นาที → reconnect ตอนนี้!
    reconnectStream()
}
```

| Pros               | Cons                        |
| ------------------ | --------------------------- |
| ✅ ไม่สะดุดเลย        | ❌ ต้องรู้ว่า speaking หรือไม่     |
| ✅ No buffer needed | ❌ ถ้าพูดไม่หยุด 5 นาที → ยังมีปัญหา |
| ✅ Simple logic     |                             |

**Complexity:** ⭐⭐ (กลาง)

---

### Option 4: Hybrid Strategy (Best)

รวม VAD-based + Buffer fallback

```
┌────────────────────────────────────────────────────────────────┐
│                         TIMELINE                               │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  0:00 ────────── 4:00 ────────── 4:45 ────────── 5:00          │
│    │               │               │               │           │
│    │               │               │               └─ DEAD ❌  │
│    │               │               │                           │
│    │               │               └─ Force reconnect ⚠️       │
│    │               │                  (with 1s buffer)         │
│    │               │                                           │
│    │               └─ VAD-based reconnect zone                 │
│    │                  "รอช่วงเงียบ → reconnect"                  │
│    │                                                           │
│    └─ Normal operation                                         │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Logic:**
```go
if streamDuration > 4*time.Minute && !isSpeaking {
    // ✅ Best case: เงียบแล้ว → reconnect สะอาด
    reconnectStream()
} else if streamDuration > 4*time.Minute + 45*time.Second {
    // ⚠️ Fallback: ใกล้ limit → force reconnect with buffer
    forceReconnectWithBuffer()
}
```

| Pros                     | Cons                     |
| ------------------------ | ------------------------ |
| ✅ ครอบคลุมทุก case         | ❌ Complex implementation |
| ✅ 99% ไม่สะดุดเลย          | ❌ Need both VAD + buffer |
| ✅ 1% สะดุดน้อยมาก (~100ms) |                          |

**Complexity:** ⭐⭐⭐ (สูง)

---

### Option 5: Dual Provider Fallback

ใช้ Azure เป็น backup ตอน Google reconnect

```
Google (primary) ────────────────────┤
                                     │ ← 4:30 นาที
Azure (standby)                      ├───► Switch to Azure
                                     │
Google reconnecting...               │
                                     │
Google (new stream) ◄────────────────┤ ← Switch back
```

| Pros               | Cons                              |
| ------------------ | --------------------------------- |
| ✅ Zero downtime    | ❌ ต้องจ่าย 2 providers              |
| ✅ No buffer needed | ❌ Complex switching logic         |
|                    | ❌ Different transcription quality |

**Complexity:** ⭐⭐⭐⭐ (สูงมาก)

---

## 📊 Comparison Matrix

| Solution         | สะดุด?    | Memory | Complexity | Recommended |
| ---------------- | -------- | ------ | ---------- | ----------- |
| Simple reconnect | ⚠️ ~500ms | None   | ⭐          | ❌           |
| Audio buffer     | ✅ ไม่     | ~256KB | ⭐⭐         | ⚪           |
| VAD-based        | ✅ ไม่*    | None   | ⭐⭐         | ⚪           |
| **Hybrid**       | ✅ ไม่     | ~256KB | ⭐⭐⭐        | ✅           |
| Dual provider    | ✅ ไม่     | None   | ⭐⭐⭐⭐       | ❌           |

\* VAD-based อาจสะดุดถ้าพูดต่อเนื่อง 5 นาทีไม่หยุด (rare case)

---

## 🎯 Recommendation

### Short-term (Quick fix)
**VAD-based reconnect** - เพียงพอสำหรับ 99% ของ use cases

### Long-term (Production-ready)
**Hybrid strategy** - ครอบคลุมทุก edge case

---

## 📝 Implementation Notes

### ต้องแก้ไขไฟล์
- `backend-go/handlers/google.go`

### Dependencies ที่อาจต้องเพิ่ม
- Ring buffer implementation (สำหรับ Hybrid)
- VAD state tracking

### Testing Scenarios
- [ ] Normal speech (< 5 min)
- [ ] Long speech with pauses (> 5 min)
- [ ] Continuous speech without pause (> 5 min) - rare
- [ ] Multiple reconnects (> 10 min session)

---

## 🔗 References

- [Google Cloud Speech-to-Text Quotas](https://cloud.google.com/speech-to-text/quotas)
- [Streaming Recognition Limits](https://cloud.google.com/speech-to-text/docs/streaming-recognize)

---

## 📅 Status

| Status        | Date       | Notes                         |
| ------------- | ---------- | ----------------------------- |
| 🟡 Open        | 2026-02-03 | Documented, awaiting decision |
| ⬜ In Progress | -          | -                             |
| ⬜ Resolved    | -          | -                             |

---

## 💬 Discussion

_เพิ่ม comments หรือ decisions ที่นี่_

