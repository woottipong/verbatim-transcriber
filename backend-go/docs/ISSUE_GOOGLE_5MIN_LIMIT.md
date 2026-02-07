# Issue: Google Cloud Speech-to-Text 5-Minute Streaming Limit

## สถานะ: ✅ แก้ไขแล้ว (Auto-Reconnect)

Google Cloud Speech-to-Text มีข้อจำกัด **5 นาทีต่อ streaming session** — ระบบจัดการอัตโนมัติแล้วด้วย **Hybrid Strategy** (isFinal-based + Force fallback + Ring buffer replay)

| Limit                  | Value                                                                   |
| ---------------------- | ----------------------------------------------------------------------- |
| Max streaming duration | **5 minutes (300 seconds)**                                             |
| Error after timeout    | `DEADLINE_EXCEEDED` หรือ stream closes                                   |
| Implementation         | `internal/infrastructure/asr/google.go` (auto-reconnect ภายใน provider) |

### ผลลัพธ์

- ผู้ใช้ **ไม่ต้องทำอะไร** — stream reconnect อัตโนมัติ
- **ไม่หายแม้แต่คำเดียว** — ring buffer 1 วินาที replay ตอน reconnect
- ทำงานทั้ง **WebSocket mode** และ **LiveKit mode** (ใช้ provider เดียวกัน)

---

## Implementation: Hybrid Strategy (isFinal + Force + Buffer)

### Timeline

```
0:00 ─────────── 4:00 ─────────── 4:50 ──── 5:00
  │                │                │         │
  │                │                │         └─ DEAD ❌ (ไม่ถึงจุดนี้)
  │                │                └─ Force reconnect + replay buffer ⚠️
  │                └─ "Reconnect Zone" — รอ isFinal → reconnect ✅
  └─ Normal streaming
```

### Reconnect Strategies (เรียงตาม priority)

#### 1. Natural Pause (Best case — ใช้บ่อยที่สุด)

```
Stream elapsed > 4 min + Google ส่ง isFinal: true → reconnect ทันที
```

- ใช้ Google's own VAD — แม่นยำมาก
- `isFinal: true` = ผู้พูดหยุดชั่วคราว = ช่วงเวลาที่ดีที่สุดสำหรับ reconnect
- **ไม่มีข้อมูลหาย** เพราะ final result ถูกส่งแล้ว

#### 2. Force Reconnect (Fallback — 4:50)

```
Stream elapsed > 4 min 50 sec → บังคับ reconnect + replay 1s buffer
```

- ใช้เมื่อพูดต่อเนื่องไม่หยุด > 50 วินาทีใน reconnect zone
- Ring buffer 1 วินาที (~96KB @ 48kHz) replay ไป stream ใหม่
- **อาจซ้ำ ~1 วินาที** แต่ไม่หาย

#### 3. Stream Limit Error (Safety net)

```
Google ส่ง error: "maximum allowed stream duration" → auto-reconnect
```

- Fallback สุดท้าย — ถ้า strategy 1 & 2 พลาด
- ยัง replay buffer ได้

### Key Design Decisions

| Decision                           | เหตุผล                                              |
| ---------------------------------- | -------------------------------------------------- |
| ใช้ `isFinal` แทน silence detection | Audio มาต่อเนื่อง ไม่มี gap → silence threshold ไม่ work |
| Ring buffer 1 วินาที                 | พอสำหรับ overlap, ไม่เปลือง memory (~96KB)             |
| Reconnect ที่ 4:00 ไม่ใช่ 4:30         | ให้เวลาเหลือเผื่อพูดยาวต่อเนื่อง                           |
| Force ที่ 4:50 ไม่ใช่ 4:55             | เผื่อ network latency 10 วินาที                        |
| อยู่ภายใน GoogleProvider             | ไม่ต้องแก้ handler, agent, หรือ frontend               |

### Implementation Details

```go
// Constants
reconnectZoneStart = 4 * time.Minute          // เริ่มรอ isFinal
forceReconnectAt   = 4*time.Minute + 50*time.Second  // บังคับ reconnect
ringBufferDuration = 1 * time.Second          // เก็บ audio 1 วินาที

// Ring buffer size
bufSize = sampleRate * 2 * 1  // 48000 * 2 = 96,000 bytes (~96KB)
```

**ไฟล์**: `internal/infrastructure/asr/google.go`

---

## Solutions ที่พิจารณา (Archive)

### Option 1: Simple Reconnect ❌

```
Stream 1: ──────────────────────────────┤
                                        │ ← Gap ~200-500ms
Stream 2:                               ├──────────────────
```

| Pros                    | Cons                                 |
| ----------------------- | ------------------------------------ |
| ✅ Simple implementation | ❌ อาจหาย ~0.5 วินาที ถ้าพูดตอน reconnect |

---

### Option 2: Audio Buffer Only ⚪

| Pros             | Cons                          |
| ---------------- | ----------------------------- |
| ✅ ไม่หายแม้แต่คำเดียว | ❌ ไม่รู้จังหวะที่ดีที่สุดสำหรับ reconnect |

---

### Option 3: VAD-Based Only ⚪

| Pros        | Cons                        |
| ----------- | --------------------------- |
| ✅ ไม่สะดุดเลย | ❌ ถ้าพูดไม่หยุด 5 นาที → ยังมีปัญหา |

---

### ✅ Option 4: Hybrid (ที่เลือกใช้)

รวม isFinal-based reconnect + Force fallback + Ring buffer replay

| Pros                                | Cons         |
| ----------------------------------- | ------------ |
| ✅ ครอบคลุมทุก case                    | Memory ~96KB |
| ✅ ใช้ Google VAD (isFinal) ซึ่งแม่นยำมาก |              |
| ✅ ผู้ใช้ไม่รู้ตัว — seamless               |              |
| ✅ ทั้ง WebSocket + LiveKit ได้ประโยชน์  |              |

---

## Comparison Matrix

| Solution             | สะดุด?    | Memory | Complexity | Status  |
| -------------------- | -------- | ------ | ---------- | ------- |
| Simple reconnect     | ⚠️ ~500ms | None   | ⭐          | ❌       |
| Audio buffer only    | ✅ ไม่     | ~96KB  | ⭐⭐         | ⚪       |
| VAD-based only       | ✅ ไม่*    | None   | ⭐⭐         | ⚪       |
| **Hybrid (isFinal)** | ✅ ไม่     | ~96KB  | ⭐⭐⭐        | ✅ ใช้แล้ว |

\* VAD-based อาจสะดุดถ้าพูดต่อเนื่อง 5 นาทีไม่หยุด

---

## Log Examples

```
🔄 [Google] Entered reconnect zone (elapsed: 4m0s) — waiting for natural pause
🔄 [Google] isFinal received in reconnect zone — reconnecting at natural pause
🔄 [Google] Reconnecting stream (#1, reason: natural_pause)...
🔄 [Google] Replayed 96000 bytes of buffered audio
✅ [Google] Stream reconnected (#1, elapsed: natural_pause)
```

```
⚠️  [Google] Force reconnect at 4:50 — approaching 5-min limit
🔄 [Google] Reconnecting stream (#1, reason: force_4m50s)...
✅ [Google] Stream reconnected (#1, elapsed: force_4m50s)
```

```
🛑 [Google] STT stream stopped (reconnected 3 times)
```
