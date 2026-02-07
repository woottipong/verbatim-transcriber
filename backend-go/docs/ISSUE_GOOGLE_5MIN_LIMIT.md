# Issue: Google Cloud Speech-to-Text 5-Minute Streaming Limit

## สรุปปัญหา

Google Cloud Speech-to-Text มีข้อจำกัด **5 นาทีต่อ streaming session** หลังจากนั้น stream จะถูกปิดอัตโนมัติ

| Limit                  | Value                                 |
| ---------------------- | ------------------------------------- |
| Max streaming duration | **5 minutes (300 seconds)**           |
| Error after timeout    | `DEADLINE_EXCEEDED` หรือ stream closes |
| Affected handler       | `internal/delivery/handler/google.go` |

### ผลกระทบ

- ถ้าผู้ใช้พูดยาวกว่า 5 นาที → stream จะตัด
- ถ้าพูดอยู่ตอนที่ stream ตัด → **อาจหายบางคำ**

---

## Solutions ที่พิจารณา

### Option 1: Simple Reconnect

```
Stream 1: ──────────────────────────────┤
                                        │ ← Gap ~200-500ms
Stream 2:                               ├──────────────────
```

| Pros                    | Cons                                 |
| ----------------------- | ------------------------------------ |
| ✅ Simple implementation | ❌ อาจหาย ~0.5 วินาที ถ้าพูดตอน reconnect |

**Complexity:** ⭐

---

### Option 2: Audio Buffer Strategy

```
Audio จาก Frontend → Ring Buffer (1-2 seconds) → Send to Google

เวลา reconnect:
1. สร้าง Stream ใหม่
2. ส่ง buffered audio ไป Stream ใหม่
3. ไม่หายแม้แต่คำเดียว
```

| Pros                  | Cons                    |
| --------------------- | ----------------------- |
| ✅ ไม่หายแม้แต่คำเดียว      | ❌ Memory usage (~256KB) |
| ✅ Seamless experience | ❌ Slightly more complex |

**Complexity:** ⭐⭐

---

### Option 3: VAD-Based Reconnect (แนะนำ)

```
Audio:  ██████░░░░██████████░░░░░░██████░░░░░░░░████████
        พูด   เงียบ  พูด      เงียบ   พูด   เงียบ   พูด
                            ↑
                    4 นาทีแล้ว + เงียบ → Reconnect!
```

```go
if streamDuration > 4*time.Minute && !isSpeaking {
    reconnectStream()  // เงียบแล้ว + ใกล้ 5 นาที → reconnect ตอนนี้
}
```

| Pros               | Cons                        |
| ------------------ | --------------------------- |
| ✅ ไม่สะดุดเลย        | ❌ ถ้าพูดไม่หยุด 5 นาที → ยังมีปัญหา |
| ✅ No buffer needed |                             |

**Complexity:** ⭐⭐

---

### Option 4: Hybrid Strategy (Best)

รวม VAD-based + Buffer fallback

```
0:00 ────────── 4:00 ────────── 4:45 ────────── 5:00
  │               │               │               │
  │               │               │               └─ DEAD ❌
  │               │               └─ Force reconnect ⚠️ (with 1s buffer)
  │               └─ VAD-based reconnect zone "รอช่วงเงียบ → reconnect"
  └─ Normal operation
```

```go
if streamDuration > 4*time.Minute && !isSpeaking {
    reconnectStream()  // ✅ Best case: เงียบแล้ว → reconnect สะอาด
} else if streamDuration > 4*time.Minute + 45*time.Second {
    forceReconnectWithBuffer()  // ⚠️ Fallback: ใกล้ limit → force with buffer
}
```

| Pros             | Cons                     |
| ---------------- | ------------------------ |
| ✅ ครอบคลุมทุก case | ❌ Complex implementation |
| ✅ 99% ไม่สะดุดเลย  | ❌ Need both VAD + buffer |

**Complexity:** ⭐⭐⭐

---

## Comparison Matrix

| Solution         | สะดุด?    | Memory | Complexity | Recommended |
| ---------------- | -------- | ------ | ---------- | ----------- |
| Simple reconnect | ⚠️ ~500ms | None   | ⭐          | ❌           |
| Audio buffer     | ✅ ไม่     | ~256KB | ⭐⭐         | ⚪           |
| VAD-based        | ✅ ไม่*    | None   | ⭐⭐         | ⚪           |
| **Hybrid**       | ✅ ไม่     | ~256KB | ⭐⭐⭐        | ✅           |

\* VAD-based อาจสะดุดถ้าพูดต่อเนื่อง 5 นาทีไม่หยุด

---

## Recommendation

| ระยะ       | Strategy              | เหมาะกับ                  |
| ---------- | --------------------- | ------------------------ |
| Short-term | VAD-based reconnect   | 99% ของ use cases        |
| Long-term  | Hybrid (VAD + buffer) | Production, ทุก edge case |

---

## Implementation Notes

- แก้ไขที่: `internal/delivery/handler/google.go`
- Dependencies ที่อาจต้องเพิ่ม: Ring buffer, VAD state tracking
