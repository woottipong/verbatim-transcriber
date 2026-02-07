# Editor Mode: Pre-Implementation Tasks

**Status**: Prep Work (ต้องทำก่อน implement Editor Mode)
**Updated**: February 7, 2026
**Reference**: [EDITOR_MODE_DESIGN.md](EDITOR_MODE_DESIGN.md)

---

## Overview

รายการสิ่งที่ต้องแก้ไข/ปรับปรุงในโค้ดปัจจุบัน ก่อนเริ่ม implement Editor Mode เรียงตาม priority

### Background: ระบบมี 2 โหมดที่ใช้คนละ Protocol

|                    | WebSocket Mode               | LiveKit Mode                          |
| ------------------ | ---------------------------- | ------------------------------------- |
| **ใช้เมื่อ**          | Transcribe ตรง ผ่าน Backend   | Room-based, หลายคน join               |
| **Backend struct** | `models.TranscriptResponse`  | `agent.TranscriptMessage`             |
| **ส่งผ่าน**          | WebSocket `conn.WriteJSON()` | LiveKit Data Channel `PublishData()`  |
| **JSON field**     | `"isFinal"` (camelCase)      | `"isFinal"` (camelCase)               |
| **Handler**        | `delivery/handler/asr.go`    | `infrastructure/agent/agent.go`       |
| **Frontend type**  | `ASRResponse` (types.ts)     | `LiveKitTranscriptMessage` (types.ts) |
| **Frontend hook**  | `useGoogle`, `useAzure`      | `useLiveKit`, `useRoomViewer`         |

> Editor Mode ทำงานบน **LiveKit Mode เท่านั้น** — Task ทั้งหมดที่เกี่ยวกับ Agent/Data Channel จึงเป็นเรื่องของ LiveKit Mode

---

## Priority 1: แก้ Bug + สร้าง Foundation

### 1.1 แก้ `types.ts` — `is_final` ไม่ตรงกับ Backend ทั้ง 2 โหมด

**ปัญหา**: `types.ts` ประกาศ `is_final` (snake_case) แต่ backend ส่ง `isFinal` (camelCase) — ผิดทั้ง WebSocket type และ LiveKit type

**WebSocket Mode** — `ASRResponse`:
```typescript
// types.ts (ปัจจุบัน — ผิด)
export interface ASRResponse {
  type: 'transcript' | 'error' | 'connected';
  is_final?: boolean;  // ❌ snake_case
}
```
```go
// models/websocket.go — backend ส่ง camelCase
type TranscriptResponse struct {
    IsFinal bool `json:"isFinal"`  // ✅ camelCase
}
```
> **หมายเหตุ**: `ASRResponse` ไม่มี hook ไหน import ไปใช้จริง — hooks ทุกตัว parse JSON แบบ untyped แล้วเข้าถึง `data.isFinal` ตรงๆ จึงยังทำงานได้ แต่ type definition ยังผิด

**LiveKit Mode** — `LiveKitTranscriptMessage`:
```typescript
// types.ts (ปัจจุบัน — ผิด)
export interface LiveKitTranscriptMessage {
  text: string;
  is_final: boolean;  // ❌ snake_case
}
```
```go
// agent.go — Agent ส่งผ่าน Data Channel เป็น camelCase
type TranscriptMessage struct {
    IsFinal bool `json:"isFinal"`  // ✅ camelCase
}
```
> **หมายเหตุ**: `useLiveKit.ts` และ `useRoomViewer.ts` ประกาศ interface ซ้ำในไฟล์ตัวเอง (ใช้ `isFinal` ถูก) จึงยังทำงานได้ — แต่ type ใน `types.ts` ยังผิด

**แก้ไข**: เปลี่ยนเป็น `isFinal` ทั้ง `ASRResponse` และ `LiveKitTranscriptMessage` ใน `types.ts` ให้ตรงกับ backend

**ไฟล์**: `frontend/types.ts`

---

### 1.2 Consolidate `LiveKitTranscriptMessage` Interface — ซ้ำ 3 ที่

**ปัญหา**: ประกาศ interface สำหรับ LiveKit transcript ไว้ 3 ที่ ผิดกันเล็กน้อย

| ที่   | File                         | Interface Name             | `isFinal` field | โหมด    |
| --- | ---------------------------- | -------------------------- | --------------- | ------- |
| 1   | `types.ts` L110              | `LiveKitTranscriptMessage` | `is_final` ❌    | LiveKit |
| 2   | `hooks/useLiveKit.ts` L14    | `LiveKitTranscriptMessage` | `isFinal` ✅     | LiveKit |
| 3   | `hooks/useRoomViewer.ts` L22 | `TranscriptMessage`        | `isFinal` ✅     | LiveKit |

> WebSocket hooks (`useGoogle`, `useAzure`) ไม่มีปัญหานี้ — ไม่ได้ใช้ type จาก `types.ts` เลย

**แก้ไข**:
- แก้ `types.ts` ให้ `isFinal` ถูก + เพิ่ม field ที่หายไป (`type`, `speaker`)
- ลบ local interface ออกจาก `useLiveKit.ts` และ `useRoomViewer.ts`
- import จาก `types.ts` ที่เดียว

**ไฟล์**: `frontend/types.ts`, `frontend/hooks/useLiveKit.ts`, `frontend/hooks/useRoomViewer.ts`

---

### 1.3 เพิ่ม Data Channel Message Type Constants (LiveKit Mode)

**ปัญหา**: ไม่มี constants/enum สำหรับ Data Channel message types — hardcoded string ทั้ง backend และ frontend

> เกี่ยวกับ **LiveKit Mode** เท่านั้น — WebSocket mode ใช้ `models.StatusResponse` / `models.TranscriptResponse` แยกต่างหาก

**Backend** — `agent.go` hardcoded `"transcript"`:

```go
msg := TranscriptMessage{
    Type: "transcript",  // hardcoded string
}
```

**Frontend** — ไม่มี enum สำหรับ Data Channel message types

**แก้ไข**:

Backend — สร้าง `models/datachannel.go`:
```go
const (
    // Existing
    DCTypeTranscript      = "transcript"

    // Editor Mode (future)
    DCTypeSetMode         = "set_mode"
    DCTypeTranscriptDraft = "transcript_draft"
    DCTypeApproveTranscript = "approve_transcript"
    DCTypeTranscriptFinal = "transcript_final"
)
```

Frontend — เพิ่มใน `types.ts`:
```typescript
export enum DataChannelMessageType {
  TRANSCRIPT = 'transcript',
  // Editor Mode (future)
  SET_MODE = 'set_mode',
  TRANSCRIPT_DRAFT = 'transcript_draft',
  APPROVE_TRANSCRIPT = 'approve_transcript',
  TRANSCRIPT_FINAL = 'transcript_final',
}
```

**ไฟล์**: `backend-go/models/datachannel.go` (ใหม่), `frontend/types.ts`

---

## Priority 2: Refactor เตรียม Editor Mode (LiveKit Mode)

> ทุก task ใน Priority 2 เกี่ยวกับ **LiveKit Mode** เท่านั้น — ไม่กระทบ WebSocket mode

### 2.1 Backend Agent: Refactor `publishTranscript()` ให้รองรับ Targeted Publish

**ปัจจุบัน**: broadcast ทุกคนใน Room เสมอ — ไม่มี parameter สำหรับเลือก destination

```go
// agent.go (ปัจจุบัน)
func (a *Agent) publishTranscript(data []byte) error {
    return a.room.LocalParticipant.PublishData(data, lksdk.WithDataPublishReliable(true))
}
```

**แก้ไข**: เพิ่ม parameter `destinationIdentities`

```go
// agent.go (ปรับปรุง)
func (a *Agent) publishTranscript(data []byte, destinationIdentities ...string) error {
    opts := []lksdk.DataPublishOption{lksdk.WithDataPublishReliable(true)}
    if len(destinationIdentities) > 0 {
        opts = append(opts, lksdk.WithDataPublishDestination(destinationIdentities))
    }
    return a.room.LocalParticipant.PublishData(data, opts...)
}
```

ไม่กระทบ code เดิมที่เรียกโดยไม่ส่ง destination (broadcast เหมือนเดิม)

**ไฟล์**: `backend-go/internal/infrastructure/agent/agent.go`

---

### 2.2 Frontend LiveKit Hooks: Refactor `handleDataReceived` ให้ Dispatch by Message Type

**ปัจจุบัน**: LiveKit hooks ทั้ง `useLiveKit.ts` และ `useRoomViewer.ts` ไม่เช็ค `message.type` — ถือว่าทุก Data Channel message เป็น transcript

> WebSocket hooks (`useGoogle`, `useAzure`) มี `switch (data.type)` อยู่แล้ว — ไม่ต้องแก้

```typescript
// useLiveKit.ts (ปัจจุบัน — ไม่เช็ค type)
const handleDataReceived = useCallback((payload: Uint8Array) => {
    const message = JSON.parse(decoder.decode(payload));
    // ประมวลผลเป็น transcript เลย ไม่เช็ค type
    if (message.isFinal) { ... }
});
```

**แก้ไข**: เพิ่ม type-switch

```typescript
// useLiveKit.ts (ปรับปรุง)
const handleDataReceived = useCallback((payload: Uint8Array) => {
    const message = JSON.parse(decoder.decode(payload));

    switch (message.type) {
        case 'transcript':
            // Live Mode: existing behavior
            handleTranscript(message);
            break;

        case 'transcript_draft':
            // Editor Mode: draft for Publisher (future)
            break;

        case 'transcript_final':
            // Editor Mode: approved transcript for Viewers (future)
            break;

        default:
            // Fallback: treat as transcript (backward compat)
            handleTranscript(message);
            break;
    }
});
```

**ไฟล์**: `frontend/hooks/useLiveKit.ts`, `frontend/hooks/useRoomViewer.ts`

---

### 2.3 Frontend: เพิ่ม `sendDataMessage()` Helper ใน `useLiveKit` (LiveKit Mode)

**ปัจจุบัน**: `useLiveKit` hook ไม่ expose วิธีส่ง Data Channel message — Publisher ส่ง `set_mode` ไปหา Agent ไม่ได้

> ใช้ LiveKit Data Channel (`localParticipant.publishData()`) ไม่ใช่ WebSocket

**แก้ไข**: เพิ่ม helper function

```typescript
const sendDataMessage = useCallback((message: object) => {
    if (!roomRef.current?.localParticipant) return;
    const data = new TextEncoder().encode(JSON.stringify(message));
    roomRef.current.localParticipant.publishData(data, { reliable: true });
}, []);
```

เพิ่มใน return object:
```typescript
return {
    // ... existing fields ...
    sendDataMessage,  // NEW
};
```

**ไฟล์**: `frontend/hooks/useLiveKit.ts`

---

## Priority 3: Backend Agent — เพิ่ม OnDataPacket Callback (LiveKit Mode)

### 3.1 Agent ต้อง Listen Data Channel Messages จาก Publisher

**ปัจจุบัน**: Agent's `RoomCallback` ไม่มี `OnDataPacket` — Agent รับ Data Channel message จาก Publisher ไม่ได้เลย

> ใช้ LiveKit Data Channel — ไม่เกี่ยวกับ WebSocket mode

```go
// agent.go (ปัจจุบัน — ไม่มี OnDataPacket)
roomCallback := &lksdk.RoomCallback{
    ParticipantCallback: lksdk.ParticipantCallback{
        OnTrackSubscribed:   func(...) { ... },
        OnTrackUnsubscribed: func(...) { ... },
        // ❌ ไม่มี OnDataPacket
    },
}
```

**แก้ไข**: เพิ่ม `OnDataPacket` — ตอนนี้แค่ log ไว้ก่อน ยังไม่ต้อง handle `set_mode`

```go
roomCallback := &lksdk.RoomCallback{
    ParticipantCallback: lksdk.ParticipantCallback{
        OnTrackSubscribed:   func(...) { ... },
        OnTrackUnsubscribed: func(...) { ... },

        // NEW: Listen for Data Channel messages
        OnDataPacket: func(data lksdk.DataPacket, params lksdk.DataReceiveParams) {
            switch val := data.(type) {
            case *lksdk.UserDataPacket:
                log.Printf("📨 [Agent] Data from %s: %s", params.SenderIdentity, string(val.Payload))
                // TODO: handle set_mode, approve_transcript (Editor Mode)
            }
        },
    },
}
```

เพิ่มแค่ callback + log ก่อน — ยังไม่ต้อง implement `handleDataMessage()` จนกว่าจะเริ่ม Editor Mode จริง

**ไฟล์**: `backend-go/internal/infrastructure/agent/agent.go`

---

## สรุป Task List

| #   | Priority | Task                                               | โหมด | ไฟล์                                             | ประเภท     |
| --- | -------- | -------------------------------------------------- | ---- | ----------------------------------------------- | ---------- |
| 1.1 | 🔴 P1     | แก้ `is_final` → `isFinal` ใน types.ts              | ทั้งคู่  | `frontend/types.ts`                             | Bug fix    |
| 1.2 | 🔴 P1     | ลบ duplicate LiveKit interface ใน hooks ทั้ง 2       | LK   | `useLiveKit.ts`, `useRoomViewer.ts`, `types.ts` | Cleanup    |
| 1.3 | 🔴 P1     | สร้าง DC message type constants                     | LK   | `models/datachannel.go`, `types.ts`             | Foundation |
| 2.1 | 🟡 P2     | Refactor Agent `publishTranscript()` + destination | LK   | `agent.go`                                      | Refactor   |
| 2.2 | 🟡 P2     | Refactor `handleDataReceived` + type-switch        | LK   | `useLiveKit.ts`, `useRoomViewer.ts`             | Refactor   |
| 2.3 | 🟡 P2     | เพิ่ม `sendDataMessage()` helper                     | LK   | `useLiveKit.ts`                                 | Feature    |
| 3.1 | 🟢 P3     | เพิ่ม Agent `OnDataPacket` callback                  | LK   | `agent.go`                                      | Foundation |

**P1**: ต้องทำก่อน — แก้ bug `is_final` + รวม duplicate types + สร้าง constants
**P2**: ทำหลัง P1 — refactor LiveKit Agent/hooks เตรียม Editor Mode
**P3**: ทำสุดท้าย — enable Agent รับ Data Channel (log only)

> **โหมด**: ทั้งคู่ = ทั้ง WebSocket + LiveKit, LK = LiveKit Mode เท่านั้น
> **ไม่กระทบ behavior เดิม** — WebSocket Mode และ LiveKit Live Mode ยังทำงานเหมือนเดิมทุกประการ
