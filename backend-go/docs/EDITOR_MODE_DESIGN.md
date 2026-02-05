# Editor Mode Design: Transcript Review Before Broadcast

**Status**: Design Phase (Not Implemented)
**Created**: February 6, 2026
**Purpose**: ให้ Publisher ตรวจสอบและแก้ไข transcript ก่อนส่งออกไปยัง Viewers

---

## Overview

ระบบแก้ไขข้อความก่อนส่งออกสู่ Viewer เพื่อเพิ่มความถูกต้องของ transcript โดยยอมแลก delay เล็กน้อย

### Business Value

| ประโยชน์        | คำอธิบาย                                  |
| -------------- | --------------------------------------- |
| **ความถูกต้อง**  | มีคนตรวจทานก่อนออกอากาศ แก้ข้อผิดพลาดจาก ASR |
| **ควบคุมคุณภาพ** | กรองคำพูดซ้ำซ้อน, filler words (เอ่อ, อืม)     |
| **Privacy**    | ตัดข้อมูลละเอียดอ่อนที่พูดไปโดยไม่ตั้งใจ           |
| **Branding**   | ข้อความที่ส่งออกมีคุณภาพสูง เหมาะกับงานทางการ   |

### Trade-offs

| ข้อเสีย          | ผลกระทบ                                   |
| -------------- | ----------------------------------------- |
| **Delay**      | เสีย real-time 5-30 วินาที (ขึ้นกับความเร็วคนแก้) |
| **Workload**   | Publisher ต้องทำงาน 2 อย่าง (พูด + แก้ไข)      |
| **Complexity** | เพิ่ม UI/UX และ logic สำหรับ review workflow  |

---

## System Modes

### 🔴 Live Mode (Default)

**Flow:**

```
Microphone → Agent → ASR → Viewers (ทันที)
```

**Characteristics:**

- Real-time transcript แบบเดิม
- ไม่มี delay, auto-broadcast ทันที
- เหมาะกับ: Live streaming, Q&A, casual sessions

### ⏸️ Editor Mode (Optional)

**Flow:**

```
Microphone → Agent → ASR → [Draft Queue] → Publisher Review → Viewers
```

**Characteristics:**

- Publisher ตรวจสอบก่อนส่ง
- มี delay ตามความเร็วการแก้ไข
- เหมาะกับ: การบรรยาย, ข่าว, การประชุมทางการ

---

## Architecture Design

### Flow Comparison: Live vs Editor Mode

#### 🔴 Live Mode Flow (Simple)

```
Step 1: Publisher พูด
   │
   ├─► Audio → LiveKit → Agent
   │
Step 2: Agent ประมวลผล
   │
   ├─► ASR (Google/Azure/Gemini)
   │
   └─► ได้ transcript: "สวัสดีครับ"
   
Step 3: ส่งออกทันที
   │
   └─► Broadcast ไปทุกคน (Publisher + Viewers)
   
⏱️ Latency: ~1-3 วินาที (ASR processing เท่านั้น)
```

#### ⏸️ Editor Mode Flow (With Review)

```
Step 1: Publisher พูด
   │
   ├─► Audio → LiveKit → Agent
   │
Step 2: Agent ประมวลผล
   │
   ├─► ASR (Google/Azure/Gemini)
   │
   └─► ได้ transcript: "สวัสดีครับ เอ่อ วันนี้เรา เอ่อ จะพูด..."
   
Step 3: ส่งเป็น DRAFT (ส่งไป Publisher เท่านั้น)
   │
   └─► Publisher เห็นใน Editor Panel
       │
       ├─► [กรณี 1] กด ✅ Send (ส่งทันที)
       │   └─► Broadcast → Viewers
       │
       ├─► [กรณี 2] กด ✏️ Edit (แก้ไขก่อน)
       │   ├─► "สวัสดีครับ วันนี้เราจะพูด..."
       │   └─► กด ✅ Send → Broadcast → Viewers
       │
       └─► [กรณี 3] กด ❌ Skip (ไม่ส่ง)
           └─► ลบทิ้ง (Viewers ไม่เห็น)
   
⏱️ Latency: ~5-30 วินาที (รอคนแก้ไข)
```

### Step-by-Step Data Flow (Editor Mode)

#### Phase 1: Setup & Speaking

```
1. Publisher เข้า Room
   └─► Send: { type: "set_mode", mode: "editor" }
   
2. Agent บันทึก mode
   └─► EditorState { mode: "editor", publisher_id: "xxx" }
   
3. Publisher พูดผ่าน Mic
   └─► Publish Audio Track → LiveKit Server
```

#### Phase 2: Transcription

```
4. Agent รับ Audio
   │
   ├─► Subscribe Audio Track from Publisher
   │
5. ส่งไป ASR
   │
   ├─► Google Cloud STT (gRPC streaming)
   │   หรือ
   ├─► Azure Speech (REST batch)
   │   หรือ
   └─► Gemini 2.0 Flash (REST batch)
   
6. Agent ได้ Transcript
   └─► Result: "สวัสดีครับ เอ่อ วันนี้..."
```

#### Phase 3: Review Process (ต่างจาก Live Mode)

```
7. Agent ตรวจสอบ Mode
   │
   ├─► if (mode == "live"):
   │   └─► Broadcast ไปทุกคน (จบ)
   │
   └─► if (mode == "editor"):
       └─► ส่งเป็น DRAFT
           │
           ├─► Target: Publisher ONLY
           │
           └─► Message: {
                 type: "transcript_draft",
                 role: "draft",
                 text: "สวัสดีครับ เอ่อ วันนี้...",
                 transcript_id: "uuid-123"
               }
```

#### Phase 4: Publisher Review

```
8. Publisher เห็นใน Editor Panel
   │
   ├─► Draft Queue:
   │   ┌──────────────────────────────────┐
   │   │ "สวัสดีครับ เอ่อ วันนี้..."      │
   │   │ [⏱️ 10s] [✏️] [✅] [❌]          │
   │   └──────────────────────────────────┘
   │
9. Publisher เลือก Action:
   │
   ├─► [Action A] กด ✅ Send Now
   │   └─► ส่ง: { 
   │         type: "approve_transcript",
   │         transcript_id: "uuid-123",
   │         edited_text: "สวัสดีครับ เอ่อ วันนี้...",
   │         action: "send"
   │       }
   │
   ├─► [Action B] กด ✏️ Edit
   │   ├─► แก้เป็น: "สวัสดีครับ วันนี้เราจะพูดเรื่อง AI"
   │   └─► ส่ง: {
   │         type: "approve_transcript",
   │         transcript_id: "uuid-123",
   │         edited_text: "สวัสดีครับ วันนี้เราจะพูดเรื่อง AI",
   │         action: "send"
   │       }
   │
   └─► [Action C] กด ❌ Skip
       └─► ส่ง: {
             type: "approve_transcript",
             transcript_id: "uuid-123",
             action: "skip"
           }
```

#### Phase 5: Final Broadcast

```
10. Agent รับ Approval
    │
    ├─► if (action == "send"):
    │   └─► Broadcast Final Transcript
    │       │
    │       ├─► Target: ALL Viewers
    │       │
    │       └─► Message: {
    │             type: "transcript_final",
    │             role: "final",
    │             text: "สวัสดีครับ วันนี้เราจะพูดเรื่อง AI",
    │             approved_by: "publisher_id"
    │           }
    │
    └─► if (action == "skip"):
        └─► ลบ draft ทิ้ง (ไม่ส่งอะไร)

11. Viewers รับ Transcript
    └─► แสดงใน UI: "สวัสดีครับ วันนี้เราจะพูดเรื่อง AI"
```

### Component Diagram

```
LiveKit Room: "meeting-123"
┌────────────────────────────────────────────────────┐
│                                                    │
│  👤 Publisher                                      │
│  ├─ Audio Track (publishing)                      │
│  └─ Data Channel (receive drafts, send approvals) │
│                                                    │
│  🤖 Agent (Backend)                                │
│  ├─ Audio Track (subscribing)                     │
│  └─ Data Channel (send drafts, receive approvals) │
│                                                    │
│  👥 Viewer 1, 2, 3, ...                            │
│  ├─ Audio Track (subscribing from Publisher)      │
│  └─ Data Channel (receive final transcripts)      │
│                                                    │
└────────────────────────────────────────────────────┘
```

### Message Flow Summary

| Message                | From → To         | When                   | Content                                                  |
| ---------------------- | ----------------- | ---------------------- | -------------------------------------------------------- |
| **set_mode**           | Publisher → Agent | เปิดห้อง/เปลี่ยน mode      | `{ mode: "editor" }`                                     |
| **transcript_draft**   | Agent → Publisher | ASR เสร็จ (editor mode) | `{ text: "...", id: "..." }`                             |
| **approve_transcript** | Publisher → Agent | กด ✅✏️❌                 | `{ id: "...", edited_text: "...", action: "send/skip" }` |
| **transcript_final**   | Agent → Viewers   | หลัง approve            | `{ text: "..." }` (ฉบับสุดท้าย)                             |

### Message Types

#### 1. Mode Control (Publisher → Agent)

```json
{
  "type": "set_mode",
  "mode": "live" | "editor",
  "publisher_id": "unique_publisher_identity"
}
```

#### 2. Draft Transcript (Agent → Publisher Only)

```json
{
  "type": "transcript_draft",
  "role": "draft",
  "text": "สวัสดีครับ วันนี้เราจะพูดเกี่ยวกับ...",
  "transcript_id": "uuid",
  "timestamp": "2026-02-06T10:30:00Z",
  "provider": "google",
  "confidence": 0.95,
  "is_final": true
}
```

#### 3. Approve Action (Publisher → Agent)

```json
{
  "type": "approve_transcript",
  "transcript_id": "uuid",
  "edited_text": "สวัสดีครับ วันนี้เราจะพูดเรื่อง AI",
  "action": "send" | "skip"
}
```

#### 4. Final Transcript (Agent → All Viewers)

```json
{
  "type": "transcript_final",
  "role": "final",
  "text": "สวัสดีครับ วันนี้เราจะพูดเรื่อง AI",
  "timestamp": "2026-02-06T10:30:05Z",
  "approved_by": "publisher_id"
}
```

---

## Backend Implementation Plan

### 1. New Endpoint: Mode Management

```
POST /livekit/set-mode
Body: {
  "room_name": "meeting-123",
  "publisher_identity": "publisher_id",
  "mode": "editor"
}
```

### 2. New Endpoint: Approve Transcript

```
POST /livekit/approve-transcript
Body: {
  "room_name": "meeting-123",
  "transcript_id": "uuid",
  "edited_text": "...",
  "action": "send" | "skip"
}
```

### 3. Agent Modifications

**File**: `internal/delivery/livekit_agent.go` (new file)

```go
type TranscriptMode string

const (
    ModeLive   TranscriptMode = "live"
    ModeEditor TranscriptMode = "editor"
)

type EditorState struct {
    RoomName      string
    PublisherID   string
    Mode          TranscriptMode
    DraftQueue    []DraftTranscript
    mu            sync.RWMutex
}

func (a *Agent) HandleTranscript(text string, confidence float64) {
    state := a.GetEditorState()
  
    if state.Mode == ModeLive {
        // Broadcast ตรงไป Viewers ทันที
        a.BroadcastToAll(text)
    } else {
        // ส่งไป Publisher ให้ review ก่อน
        a.SendDraft(state.PublisherID, text)
    }
}
```

### 4. Data Structure

```go
type DraftTranscript struct {
    ID          string    `json:"id"`
    Text        string    `json:"text"`
    Provider    string    `json:"provider"`
    Confidence  float64   `json:"confidence"`
    Timestamp   time.Time `json:"timestamp"`
    Status      string    `json:"status"` // pending, approved, skipped
}

type ApprovalRequest struct {
    RoomName     string `json:"room_name"`
    TranscriptID string `json:"transcript_id"`
    EditedText   string `json:"edited_text"`
    Action       string `json:"action"` // send, skip
}
```

---

## Frontend Implementation Plan

### 1. New Hook: `useEditorMode`

**File**: `frontend/hooks/useEditorMode.ts`

```typescript
interface DraftTranscript {
  id: string;
  text: string;
  timestamp: Date;
  provider: string;
  confidence: number;
  status: 'pending' | 'editing' | 'sent' | 'skipped';
  autoSendTimer?: number; // countdown seconds
}

export function useEditorMode(roomName: string) {
  const [mode, setMode] = useState<'live' | 'editor'>('live');
  const [drafts, setDrafts] = useState<DraftTranscript[]>([]);
  const [sentTranscripts, setSentTranscripts] = useState<string[]>([]);
  
  // Toggle mode
  const toggleMode = async (newMode: 'live' | 'editor') => {
    await fetch(`${BACKEND_URL}/livekit/set-mode`, {
      method: 'POST',
      body: JSON.stringify({ room_name: roomName, mode: newMode })
    });
    setMode(newMode);
  };
  
  // Approve transcript
  const approveTranscript = async (id: string, editedText: string) => {
    await fetch(`${BACKEND_URL}/livekit/approve-transcript`, {
      method: 'POST',
      body: JSON.stringify({
        room_name: roomName,
        transcript_id: id,
        edited_text: editedText,
        action: 'send'
      })
    });
    // Move to sent list
  };
  
  // Skip transcript
  const skipTranscript = async (id: string) => {
    await fetch(`${BACKEND_URL}/livekit/approve-transcript`, {
      method: 'POST',
      body: JSON.stringify({
        transcript_id: id,
        action: 'skip'
      })
    });
  };
  
  return {
    mode, toggleMode,
    drafts, sentTranscripts,
    approveTranscript, skipTranscript
  };
}
```

### 2. New Component: `EditorPanel`

**File**: `frontend/components/EditorPanel.tsx`

```tsx
export function EditorPanel() {
  const { drafts, approveTranscript, skipTranscript } = useEditorMode();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  
  return (
    <div className="grid grid-cols-2 gap-4 h-full">
      {/* Left: Draft Queue */}
      <div className="border rounded-lg p-4 overflow-auto">
        <h3 className="font-bold mb-3 flex items-center gap-2">
          📝 Draft Queue
          <span className="text-sm font-normal text-gray-500">
            ({drafts.filter(d => d.status === 'pending').length} pending)
          </span>
        </h3>
      
        {drafts.map(draft => (
          <DraftCard
            key={draft.id}
            draft={draft}
            isEditing={editingId === draft.id}
            editText={editText}
            onEdit={() => { setEditingId(draft.id); setEditText(draft.text); }}
            onSave={(text) => approveTranscript(draft.id, text)}
            onSkip={() => skipTranscript(draft.id)}
          />
        ))}
      </div>
    
      {/* Right: Sent History */}
      <div className="border rounded-lg p-4 bg-green-50 overflow-auto">
        <h3 className="font-bold mb-3 text-green-800">
          ✅ Sent to Viewers
        </h3>
        {/* Sent transcript list */}
      </div>
    </div>
  );
}
```

### 3. Mode Toggle UI

```tsx
// Add to Publisher page
<div className="flex items-center gap-3 p-3 bg-gray-100 rounded-lg">
  <label className="flex items-center cursor-pointer">
    <input 
      type="checkbox"
      checked={mode === 'editor'}
      onChange={(e) => toggleMode(e.target.checked ? 'editor' : 'live')}
      className="w-5 h-5"
    />
    <span className="ml-2 font-medium">
      {mode === 'live' ? '🔴 Live Mode' : '⏸️ Editor Mode'}
    </span>
  </label>
  
  {mode === 'editor' && (
    <span className="text-sm text-gray-600">
      คุณจะตรวจทานข้อความก่อนส่งออก
    </span>
  )}
</div>
```

---

## Enhanced Features (Future)

### 1. Auto-Send Timer

**Feature**: ถ้าไม่แก้ไขภายใน X วินาที ให้ส่งอัตโนมัติ

```tsx
interface AutoSendConfig {
  enabled: boolean;
  seconds: 10 | 30 | 60; // configurable
}

// UI
┌─────────────────────────────────────┐
│ "สวัสดีครับ วันนี้..."              │
│ ⏱️ Auto-send in: 8s                 │
│ [✏️ Edit] [✅ Send Now] [❌ Skip]   │
└─────────────────────────────────────┘
```

### 2. Keyboard Shortcuts

| Shortcut      | Action             |
| ------------- | ------------------ |
| `Ctrl+Enter`  | Approve & Send     |
| `Ctrl+E`      | Edit Current Draft |
| `Ctrl+Delete` | Skip Current Draft |
| `Ctrl+1,2,3`  | Quick Select Draft |

### 3. Batch Operations

```tsx
// Select multiple drafts and approve together
<div>
  ☑️ Select All
  ✅ Send Selected (5 items)
  ❌ Skip Selected
</div>
```

### 4. AI-Assisted Cleanup (Future Enhancement)

```
Original: "สวัสดีครับ เอ่อ อืม วันนี้เรา เอ่อ จะพูดเรื่อง..."
           ↓ (AI removes filler words)
Suggested: "สวัสดีครับ วันนี้เราจะพูดเรื่อง..."
           ↓ (Human review)
Final: [✅ Accept] [✏️ Edit More] [↩️ Revert]
```

### 5. Preview Mode for Viewers

แสดงว่า transcript กำลังมา:

```
Viewer UI:
┌─────────────────────────────────────┐
│ Recent Transcripts:                 │
│ - สวัสดีครับ                        │
│ - วันนี้เราจะพูดเรื่อง AI          │
│                                     │
│ 💬 กำลังพิมพ์...                    │
│    (Publisher is reviewing)         │
└─────────────────────────────────────┘
```

---

## Use Cases

### ✅ Recommended Use Cases

| สถานการณ์                 | เหตุผล                     |
| ------------------------ | ------------------------- |
| **การบรรยาย/สัมมนา**      | ความถูกต้องสำคัญกว่า real-time |
| **ข่าว/สื่อมวลชน**          | ต้องตรวจสอบข้อมูลก่อนเผยแพร่   |
| **การประชุมทางการ**       | บันทึกรายงานการประชุมต้องแม่นยำ |
| **Webinar แบบเป็นทางการ** | ภาพลักษณ์และคุณภาพสำคัญ        |

### ❌ Not Recommended Use Cases

| สถานการณ์                 | เหตุผล                        |
| ------------------------ | ---------------------------- |
| **Live Streaming สบายๆ** | Real-time interaction สำคัญกว่า |
| **Q&A Sessions**         | ต้องตอบโต้ทันที                  |
| **Live Shopping**        | ลูกค้าต้องการคำตอบเร็ว            |
| **Casual Conversations** | ไม่จำเป็นต้องแก้ไข                |

---

## Implementation Phases

### Phase 1: Core Functionality (MVP)

- [ ] Backend: Mode toggle API
- [ ] Backend: Draft queue management
- [ ] Backend: Approve/Skip endpoints
- [ ] Frontend: `useEditorMode` hook
- [ ] Frontend: Basic EditorPanel component
- [ ] Frontend: Mode toggle switch

### Phase 2: Enhanced UX

- [ ] Auto-send timer (configurable)
- [ ] Keyboard shortcuts
- [ ] Draft preview before send
- [ ] Sent transcript history

### Phase 3: Advanced Features

- [ ] Batch operations
- [ ] Quick edit templates
- [ ] AI-assisted cleanup
- [ ] Analytics (time to approve, skip rate, etc.)

### Phase 4: Viewer Experience

- [ ] "กำลังพิมพ์..." indicator
- [ ] Smooth transcript updates
- [ ] Typing animation

---

## Technical Considerations

### Security

- **Authorization**: Only the original Publisher can approve their transcripts
- **Room Validation**: Verify Publisher is in the room
- **Rate Limiting**: Prevent spam approve/skip requests

### Performance

- **Draft Queue Size**: Limit to last 50 drafts (configurable)
- **WebSocket Efficiency**: Use binary encoding for large text
- **Memory**: Clear old drafts automatically after X minutes

### Data Persistence (Optional)

```sql
CREATE TABLE transcript_drafts (
  id UUID PRIMARY KEY,
  room_name VARCHAR(255),
  publisher_id VARCHAR(255),
  text TEXT,
  edited_text TEXT,
  status VARCHAR(20), -- pending, approved, skipped
  created_at TIMESTAMP,
  approved_at TIMESTAMP
);
```

### Error Handling

- **Network Failure**: Retry approval with exponential backoff
- **Publisher Disconnect**: Auto-approve pending drafts OR clear queue
- **Agent Crash**: Persist draft queue in Redis/Database

---

## Metrics & Analytics

Track การใช้งาน Editor Mode:

```typescript
interface EditorMetrics {
  total_drafts: number;
  approved_count: number;
  skipped_count: number;
  average_review_time: number; // seconds
  auto_send_count: number;
  manual_edit_count: number;
}
```

---

## Testing Scenarios

### 1. Mode Switching

- [ ] Live → Editor → Live ทำงานปกติ
- [ ] Draft queue ถูก clear เมื่อเปลี่ยนเป็น Live

### 2. Multi-User

- [ ] Publisher เห็น draft, Viewer ไม่เห็น
- [ ] Viewer ได้รับ transcript หลัง approve เท่านั้น

### 3. Performance

- [ ] 100 drafts ใน queue ไม่ช้า
- [ ] Auto-send timer accurate ถึง millisecond

### 4. Edge Cases

- [ ] Publisher disconnect → drafts handling
- [ ] Approve ขณะที่ draft ใหม่เข้ามา
- [ ] Network delay ระหว่าง approve

---

## Alternative Approaches (Considered but Not Chosen)

### 1. Moderator Role (Separate Person)

**Pros**: Publisher focus on content
**Cons**: Need extra person, more complex coordination
**Decision**: Reject - overcomplicated for most use cases

### 2. Backend Review Queue (Database-based)

**Pros**: Can review later, persistent storage
**Cons**: Not real-time, need admin UI
**Decision**: Maybe for v2 - too heavy for MVP

### 3. Client-Side Only (No Agent Change)

**Pros**: Simple implementation
**Cons**: Can't prevent direct broadcast, security issue
**Decision**: Reject - need server-side control

---

## References

- [LiveKit Data Channel Documentation](https://docs.livekit.io/guides/room/data-channel/)
- [Current Project: Mode 2 LiveKit Architecture](./LIVEKIT_EXECUTIVE_SUMMARY.md)
- [WebSocket Format Specification](./WEBSOCKET_FORMAT.md)

---

## Changelog

| Date       | Author      | Change                  |
| ---------- | ----------- | ----------------------- |
| 2026-02-06 | Design Team | Initial design document |
