# Editor Mode Design: Transcript Review Before Broadcast

> Status: design proposal, not implemented in the current LiveKit transcription flow. Validate this document against current packet/state helpers before implementation.

**Status**: Design Phase (Not Implemented)
**Updated**: February 7, 2026
**Purpose**: ให้ Publisher ตรวจสอบและแก้ไข transcript ก่อนส่งออกไปยัง Viewers

---

## Overview

เพิ่ม Editor Mode ในระบบ LiveKit — Publisher สามารถสลับระหว่าง "Live Mode" (broadcast ทันที) กับ "Editor Mode" (ตรวจทานก่อนส่ง) ผ่าน Data Channel ทั้งหมด ไม่ต้องสร้าง REST endpoint ใหม่

### Business Value

| ประโยชน์        | คำอธิบาย                                  |
| -------------- | --------------------------------------- |
| **ความถูกต้อง**  | มีคนตรวจทานก่อนออกอากาศ แก้ข้อผิดพลาดจาก ASR |
| **ควบคุมคุณภาพ** | กรองคำพูดซ้ำซ้อน, filler words (เอ่อ, อืม)     |
| **Privacy**    | ตัดข้อมูลที่พูดไปโดยไม่ตั้งใจ                    |

### Trade-offs

| ข้อเสีย          | ผลกระทบ                                   |
| -------------- | ----------------------------------------- |
| **Delay**      | เสีย real-time 5-30 วินาที (ขึ้นกับความเร็วคนแก้) |
| **Workload**   | Publisher ต้องทำ 2 อย่าง (พูด + แก้ไข)         |
| **Complexity** | เพิ่ม state management ใน Agent             |

---

## System Modes

### 🔴 Live Mode (Default — พฤติกรรมปัจจุบัน)

```
Microphone → Agent → ASR → Broadcast ทุกคน (ทันที)
```

### ⏸️ Editor Mode

```
Microphone → Agent → ASR → Draft (ส่ง Publisher เท่านั้น) → Review → Broadcast Viewers
```

---

## Design Principle: Data Channel Only

**ทำไมไม่ใช้ REST?**

Agent อยู่ใน LiveKit Room อยู่แล้ว — ใช้ Data Channel ส่งตรงได้เลย:

| Approach       | ข้อดี                                                   | ข้อเสีย                                                          |
| -------------- | ----------------------------------------------------- | -------------------------------------------------------------- |
| ❌ REST API     | คุ้นเคย                                                 | ต้องสร้าง endpoint ใหม่, ต้อง lookup agent instance, latency สูงกว่า |
| ✅ Data Channel | อยู่ใน connection เดียวกัน, latency ต่ำ, ไม่ต้องสร้าง endpoint | ต้องเพิ่ม message handler ใน Agent                                |

LiveKit SDK รองรับครบ:
- **Agent รับ**: `OnDataPacket` callback
- **Agent ส่งเฉพาะคน**: `WithDataPublishDestination([]string{"publisher-id"})`
- **Agent broadcast**: `PublishData()` ไม่ระบุ destination

---

## Data Flow

### Phase 1: Publisher เปลี่ยน Mode

```
Publisher                           Agent
   │                                  │
   │  Data Channel:                   │
   │  { type: "set_mode",             │
   │    mode: "editor" }              │
   │ ────────────────────────────────►│
   │                                  │
   │                                  │  Agent บันทึก:
   │                                  │  editorState.mode = "editor"
   │                                  │  editorState.publisherID = sender
   │                                  │
```

### Phase 2: Transcription → Draft

```
Publisher                           Agent                           ASR
   │                                  │                              │
   │  Audio Track (WebRTC)            │                              │
   │ ────────────────────────────────►│                              │
   │                                  │  Opus → PCM                  │
   │                                  │ ────────────────────────────►│
   │                                  │                              │
   │                                  │  Transcript Result           │
   │                                  │ ◄────────────────────────────│
   │                                  │                              │
   │                                  │  Check mode:                 │
   │                                  │  if "live" → broadcast all   │
   │                                  │  if "editor" → send draft    │
   │                                  │     to Publisher ONLY         │
   │                                  │                              │
   │  Data Channel (targeted):       │                              │
   │  { type: "transcript_draft",     │                              │
   │    id: "uuid-123",               │                              │
   │    text: "สวัสดีครับ เอ่อ..." }    │                              │
   │ ◄────────────────────────────────│                              │
   │                                  │                              │
```

### Phase 3: Publisher Review → Broadcast

```
Publisher                           Agent                           Viewers
   │                                  │                              │
   │  [ตัวเลือก A] ✅ Send            │                              │
   │  Data Channel:                   │                              │
   │  { type: "approve_transcript",   │                              │
   │    id: "uuid-123",               │                              │
   │    action: "send" }              │                              │
   │ ────────────────────────────────►│                              │
   │                                  │  Data Channel (broadcast):   │
   │                                  │  { type: "transcript_final", │
   │                                  │    text: "สวัสดีครับ เอ่อ..." } │
   │                                  │ ────────────────────────────►│
   │                                  │                              │
   │  [ตัวเลือก B] ✏️ Edit + Send    │                              │
   │  Data Channel:                   │                              │
   │  { type: "approve_transcript",   │                              │
   │    id: "uuid-123",               │                              │
   │    edited_text: "สวัสดีครับ...",   │                              │
   │    action: "send" }              │                              │
   │ ────────────────────────────────►│                              │
   │                                  │  Broadcast edited_text       │
   │                                  │ ────────────────────────────►│
   │                                  │                              │
   │  [ตัวเลือก C] ❌ Skip           │                              │
   │  Data Channel:                   │                              │
   │  { type: "approve_transcript",   │                              │
   │    id: "uuid-123",               │                              │
   │    action: "skip" }              │                              │
   │ ────────────────────────────────►│                              │
   │                                  │  (ลบ draft, ไม่ส่ง)           │
   │                                  │                              │
```

---

## Message Types

### 1. set_mode (Publisher → Agent)

```json
{
  "type": "set_mode",
  "mode": "live | editor"
}
```

### 2. transcript_draft (Agent → Publisher Only)

```json
{
  "type": "transcript_draft",
  "id": "uuid-123",
  "text": "สวัสดีครับ เอ่อ วันนี้...",
  "provider": "google",
  "confidence": 0.95,
  "timestamp": 1707321600000
}
```

### 3. approve_transcript (Publisher → Agent)

```json
{
  "type": "approve_transcript",
  "id": "uuid-123",
  "edited_text": "สวัสดีครับ วันนี้...",
  "action": "send | skip"
}
```

`edited_text` ไม่บังคับ — ถ้าไม่ส่ง จะใช้ text เดิมจาก draft

### 4. transcript_final (Agent → All Viewers)

```json
{
  "type": "transcript_final",
  "text": "สวัสดีครับ วันนี้...",
  "provider": "google",
  "timestamp": 1707321605000,
  "speaker": "publisher-identity"
}
```

> **Note**: `transcript` (type ปัจจุบัน) ยังใช้งานปกติใน Live Mode — `transcript_draft` และ `transcript_final` เป็น type ใหม่สำหรับ Editor Mode เท่านั้น

---

## Backend Implementation

### 1. เพิ่ม EditorState ใน Agent

**File**: `internal/infrastructure/agent/agent.go`

```go
type EditorState struct {
    Mode        string            // "live" or "editor"
    PublisherID string            // identity ของ Publisher
    DraftQueue  []DraftTranscript // pending drafts (max 50)
    mu          sync.RWMutex
}

type DraftTranscript struct {
    ID         string  `json:"id"`
    Text       string  `json:"text"`
    Provider   string  `json:"provider"`
    Confidence float64 `json:"confidence"`
    Timestamp  int64   `json:"timestamp"`
}
```

เพิ่มใน Agent struct:

```go
type Agent struct {
    // ... existing fields ...
    editorState *EditorState  // NEW
}
```

### 2. เพิ่ม OnDataPacket Callback

เพิ่มใน `RoomCallback` ที่ `Start()`:

```go
roomCallback := &lksdk.RoomCallback{
    ParticipantCallback: lksdk.ParticipantCallback{
        // ... existing OnTrackSubscribed, OnTrackUnsubscribed ...

        // NEW: Listen for Data Channel messages from Publisher
        OnDataPacket: func(data lksdk.DataPacket, params lksdk.DataReceiveParams) {
            switch val := data.(type) {
            case *lksdk.UserDataPacket:
                a.handleDataMessage(val.Payload, params.SenderIdentity)
            }
        },
    },
    // ... existing callbacks ...
}
```

### 3. เพิ่ม handleDataMessage

```go
func (a *Agent) handleDataMessage(payload []byte, senderID string) {
    var msg map[string]interface{}
    if err := json.Unmarshal(payload, &msg); err != nil {
        return
    }

    msgType, _ := msg["type"].(string)

    switch msgType {
    case "set_mode":
        mode, _ := msg["mode"].(string)
        a.editorState.mu.Lock()
        a.editorState.Mode = mode
        a.editorState.PublisherID = senderID
        if mode == "live" {
            a.editorState.DraftQueue = nil // clear drafts
        }
        a.editorState.mu.Unlock()
        log.Printf("📝 [Agent] Mode changed to: %s by %s", mode, senderID)

    case "approve_transcript":
        a.handleApproval(msg)
    }
}
```

### 4. แก้ handleTranscriptionResults

แก้ logic ที่ส่ง transcript — แยก Live vs Editor:

```go
func (a *Agent) handleTranscriptionResults(provider domain.ASRProvider, participant *lksdk.RemoteParticipant) {
    results := provider.Results()

    for result := range results {
        a.editorState.mu.RLock()
        mode := a.editorState.Mode
        publisherID := a.editorState.PublisherID
        a.editorState.mu.RUnlock()

        if mode == "editor" && result.IsFinal {
            // Editor Mode: send draft to Publisher ONLY
            draft := DraftTranscript{
                ID:         uuid.New().String(),
                Text:       result.Text,
                Provider:   provider.Name(),
                Confidence: result.Confidence,
                Timestamp:  time.Now().UnixMilli(),
            }
            a.sendDraftToPublisher(draft, publisherID)
        } else {
            // Live Mode: broadcast to all (existing behavior)
            a.broadcastTranscript(result, provider, participant)
        }
    }
}
```

### 5. Targeted Publish (Draft → Publisher Only)

```go
func (a *Agent) sendDraftToPublisher(draft DraftTranscript, publisherID string) {
    msg := map[string]interface{}{
        "type":       "transcript_draft",
        "id":         draft.ID,
        "text":       draft.Text,
        "provider":   draft.Provider,
        "confidence": draft.Confidence,
        "timestamp":  draft.Timestamp,
    }

    data, _ := json.Marshal(msg)

    // Send to Publisher ONLY — ไม่ broadcast
    a.room.LocalParticipant.PublishData(
        data,
        lksdk.WithDataPublishReliable(true),
        lksdk.WithDataPublishDestination([]string{publisherID}),
    )

    // Add to draft queue
    a.editorState.mu.Lock()
    a.editorState.DraftQueue = append(a.editorState.DraftQueue, draft)
    // Limit queue size
    if len(a.editorState.DraftQueue) > 50 {
        a.editorState.DraftQueue = a.editorState.DraftQueue[1:]
    }
    a.editorState.mu.Unlock()
}
```

### 6. Handle Approval → Broadcast Final

```go
func (a *Agent) handleApproval(msg map[string]interface{}) {
    id, _ := msg["id"].(string)
    action, _ := msg["action"].(string)

    a.editorState.mu.Lock()
    defer a.editorState.mu.Unlock()

    // Find draft
    var draft *DraftTranscript
    for i, d := range a.editorState.DraftQueue {
        if d.ID == id {
            draft = &a.editorState.DraftQueue[i]
            break
        }
    }

    if draft == nil {
        return
    }

    if action == "send" {
        text := draft.Text
        if editedText, ok := msg["edited_text"].(string); ok && editedText != "" {
            text = editedText
        }

        // Broadcast to ALL participants
        finalMsg := map[string]interface{}{
            "type":      "transcript_final",
            "text":      text,
            "provider":  draft.Provider,
            "timestamp": time.Now().UnixMilli(),
        }

        data, _ := json.Marshal(finalMsg)
        a.room.LocalParticipant.PublishData(
            data,
            lksdk.WithDataPublishReliable(true),
        )
    }

    // Remove from queue
    for i, d := range a.editorState.DraftQueue {
        if d.ID == id {
            a.editorState.DraftQueue = append(
                a.editorState.DraftQueue[:i],
                a.editorState.DraftQueue[i+1:]...,
            )
            break
        }
    }
}
```

---

## Frontend Implementation

### 1. เพิ่มใน useLiveKit hook

**File**: `frontend/hooks/useLiveKit.ts`

เพิ่ม Data Channel handler สำหรับ `transcript_draft`:

```typescript
// Handle data from Agent
room.on(RoomEvent.DataReceived, (payload, participant) => {
  const msg = JSON.parse(new TextDecoder().decode(payload));

  switch (msg.type) {
    case 'transcript':
      // Existing: Live Mode transcript
      handleTranscript(msg);
      break;

    case 'transcript_draft':
      // NEW: Editor Mode draft (Publisher only)
      setDrafts(prev => [...prev, {
        id: msg.id,
        text: msg.text,
        provider: msg.provider,
        confidence: msg.confidence,
        timestamp: msg.timestamp,
        status: 'pending',
      }]);
      break;

    case 'transcript_final':
      // NEW: Editor Mode final (Viewers get this)
      handleTranscript({ ...msg, isFinal: true });
      break;
  }
});
```

### 2. Mode Toggle (Publisher UI)

```typescript
// Send mode change via Data Channel
const toggleMode = (newMode: 'live' | 'editor') => {
  room.localParticipant.publishData(
    new TextEncoder().encode(JSON.stringify({
      type: 'set_mode',
      mode: newMode,
    })),
    { reliable: true }
  );
  setMode(newMode);
};
```

### 3. Approve/Skip (Publisher UI)

```typescript
const approveTranscript = (id: string, editedText?: string) => {
  room.localParticipant.publishData(
    new TextEncoder().encode(JSON.stringify({
      type: 'approve_transcript',
      id,
      edited_text: editedText,
      action: 'send',
    })),
    { reliable: true }
  );
};

const skipTranscript = (id: string) => {
  room.localParticipant.publishData(
    new TextEncoder().encode(JSON.stringify({
      type: 'approve_transcript',
      id,
      action: 'skip',
    })),
    { reliable: true }
  );
};
```

### 4. EditorPanel Component

```tsx
// frontend/components/EditorPanel.tsx

function EditorPanel({ drafts, onApprove, onSkip }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  return (
    <div className="grid grid-cols-2 gap-4 h-full">
      {/* Draft Queue */}
      <div className="border rounded-lg p-4 overflow-auto">
        <h3>📝 Draft Queue ({drafts.filter(d => d.status === 'pending').length})</h3>

        {drafts.map(draft => (
          <div key={draft.id} className="border rounded p-3 mb-2">
            {editingId === draft.id ? (
              <textarea
                value={editText}
                onChange={e => setEditText(e.target.value)}
              />
            ) : (
              <p>{draft.text}</p>
            )}

            <div className="flex gap-2 mt-2">
              {editingId === draft.id ? (
                <button onClick={() => { onApprove(draft.id, editText); setEditingId(null); }}>
                  ✅ Send
                </button>
              ) : (
                <>
                  <button onClick={() => onApprove(draft.id)}>✅ Send</button>
                  <button onClick={() => { setEditingId(draft.id); setEditText(draft.text); }}>✏️ Edit</button>
                  <button onClick={() => onSkip(draft.id)}>❌ Skip</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Sent History */}
      <div className="border rounded-lg p-4 bg-green-50 overflow-auto">
        <h3>✅ Sent to Viewers</h3>
        {/* ... */}
      </div>
    </div>
  );
}
```

---

## Implementation Phases

### Phase 1: Core (MVP)

- [ ] Backend: `EditorState` struct ใน Agent
- [ ] Backend: `OnDataPacket` callback (listen `set_mode`, `approve_transcript`)
- [ ] Backend: `sendDraftToPublisher()` ด้วย `WithDataPublishDestination`
- [ ] Backend: `handleApproval()` → broadcast `transcript_final`
- [ ] Frontend: Mode toggle button (Data Channel)
- [ ] Frontend: EditorPanel component
- [ ] Frontend: Handle `transcript_draft` + `transcript_final` messages

### Phase 2: Enhanced UX

- [ ] Auto-send timer (ถ้าไม่แก้ภายใน X วินาที ส่งอัตโนมัติ)
- [ ] Keyboard shortcuts (Ctrl+Enter = Send, Ctrl+Delete = Skip)
- [ ] Sent transcript history panel
- [ ] Draft count badge

### Phase 3: Advanced (Future)

- [ ] AI-assisted cleanup (ลบ filler words อัตโนมัติ)
- [ ] Batch operations (select multiple + send/skip)
- [ ] "กำลังพิมพ์..." indicator สำหรับ Viewers

---

## Edge Cases

| Case                        | Behavior                                        |
| --------------------------- | ----------------------------------------------- |
| Publisher disconnect        | Clear draft queue, Agent reverts to Live Mode   |
| Switch Editor → Live        | Clear pending drafts, resume normal broadcast   |
| Switch Live → Editor        | Start queuing new transcripts as drafts         |
| Draft queue full (>50)      | Drop oldest draft                               |
| Approve non-existent draft  | Ignore silently                                 |
| Multiple publishers in room | First to send `set_mode` becomes the controller |

---

## Use Cases

### ✅ เหมาะสม

| สถานการณ์        | เหตุผล                     |
| --------------- | ------------------------- |
| การบรรยาย/สัมมนา | ความถูกต้องสำคัญกว่า real-time |
| ข่าว/สื่อมวลชน     | ต้องตรวจสอบก่อนเผยแพร่       |
| การประชุมทางการ  | บันทึกรายงานต้องแม่นยำ         |

### ❌ ไม่เหมาะ

| สถานการณ์       | เหตุผล                        |
| -------------- | ---------------------------- |
| Live Streaming | Real-time interaction สำคัญกว่า |
| Q&A Sessions   | ต้องตอบโต้ทันที                  |
| Casual chat    | ไม่จำเป็นต้องแก้ไข                |

---

## Modified Files Summary

| File                                     | Change                                          |
| ---------------------------------------- | ----------------------------------------------- |
| `internal/infrastructure/agent/agent.go` | เพิ่ม EditorState, OnDataPacket, targeted publish |
| `frontend/hooks/useLiveKit.ts`           | เพิ่ม draft/final message handling, mode toggle   |
| `frontend/components/EditorPanel.tsx`    | Component ใหม่: Draft queue + review UI          |
| `frontend/components/LiveKitPanel.tsx`   | เพิ่ม Mode toggle switch                          |

---

## Changelog

| Date       | Change                                                           |
| ---------- | ---------------------------------------------------------------- |
| 2026-02-06 | Initial design (REST approach)                                   |
| 2026-02-07 | Rewrite: REST → Data Channel, add OnDataPacket, targeted publish |
