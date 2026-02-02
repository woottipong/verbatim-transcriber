# Azure Speech WebSocket API - Data Flow

## 📊 ภาพรวม Architecture

```
┌─────────────┐     WebSocket     ┌─────────────┐     WebSocket     ┌─────────────┐
│   Browser   │  ◄──────────────► │  Go Backend │  ◄──────────────► │    Azure    │
│  (Frontend) │    JSON + PCM     │   (Fiber)   │   Binary Proto    │ Speech STT  │
└─────────────┘                   └─────────────┘                   └─────────────┘
```

## 🔄 Connection Flow

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                              CONNECTION SEQUENCE                                 │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Frontend                    Backend                         Azure               │
│     │                           │                              │                 │
│     │──── WS Connect ──────────►│                              │                 │
│     │◄─── {"type":"connected"} ─│                              │                 │
│     │                           │                              │                 │
│     │──── {"type":"start"} ────►│                              │                 │
│     │                           │──── WS Connect + Headers ───►│                 │
│     │                           │◄─── Connection OK ───────────│                 │
│     │                           │                              │                 │
│     │                           │──── speech.config (JSON) ───►│                 │
│     │                           │──── audio (RIFF header) ────►│                 │
│     │                           │                              │                 │
│     │◄─── {"type":"started"}  ──│                              │                 │
│     │                           │                              │                 │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## 🎤 Audio Streaming Flow

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                              AUDIO STREAMING                                     │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Frontend                    Backend                         Azure               │
│     │                           │                              │                 │
│     │──── Binary (PCM 16kHz) ──►│                              │                 │
│     │                           │──── Binary (Header+PCM) ────►│                 │
│     │                           │                              │                 │
│     │                           │◄─── speech.hypothesis ───────│   (interim)     │
│     │◄─── {"isFinal":false}  ───│                              │                 │
│     │                           │                              │                 │
│     │──── Binary (PCM) ────────►│                              │                 │
│     │                           │──── Binary (Header+PCM) ────►│                 │
│     │                           │                              │                 │
│     │                           │◄─── speech.phrase ───────────│   (final)       │
│     │◄─── {"isFinal":true}  ────│                              │                 │
│     │                           │                              │                 │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## 📦 Message Formats

### 1. Frontend → Backend (Simple)

**Control Message (Text):**
```json
{"type": "start"}
{"type": "stop"}
```

**Audio Data (Binary):**
```
[PCM 16-bit signed, 16kHz, mono]
```

---

### 2. Backend → Azure (Azure Protocol)

**Text Message (speech.config):**
```
Path: speech.config
X-RequestId: abc123...
X-Timestamp: 2024-01-15T10:30:00.000Z
Content-Type: application/json

{"context":{"system":{"name":"thai-transcriber",...}}}
```

**Binary Message (audio):**
```
┌─────────────────┬─────────────────────────────┬───────────────────┐
│ Header Length   │ Header Text                 │ Audio Data        │
│ (2 bytes, BE)   │ (variable)                  │ (PCM or RIFF)     │
├─────────────────┼─────────────────────────────┼───────────────────┤
│ 00 5A           │ Path: audio\r\n             │ [PCM bytes...]    │
│                 │ X-RequestId: abc...\r\n     │                   │
│                 │ X-Timestamp: ...\r\n        │                   │
│                 │ Content-Type: audio/x-wav   │                   │
│                 │ \r\n                        │                   │
└─────────────────┴─────────────────────────────┴───────────────────┘
```

---

### 3. Azure → Backend (Response)

**speech.hypothesis (Interim):**
```
Path: speech.hypothesis
X-RequestId: abc123...
Content-Type: application/json

{"Text":"กำลังพูด","Offset":1000000,"Duration":500000}
```

**speech.phrase (Final):**
```
Path: speech.phrase
X-RequestId: abc123...
Content-Type: application/json

{
  "RecognitionStatus": "Success",
  "DisplayText": "สวัสดีครับ",
  "Offset": 1000000,
  "Duration": 2000000,
  "NBest": [
    {"Confidence": 0.95, "Display": "สวัสดีครับ", "Lexical": "สวัสดีครับ"}
  ]
}
```

---

### 4. Backend → Frontend (Standardized)

```json
{
  "type": "transcript",
  "text": "สวัสดีครับ",
  "isFinal": true,
  "channel": {
    "alternatives": [
      {"transcript": "สวัสดีครับ", "confidence": 0.95}
    ]
  }
}
```

## 🎯 Azure Events Timeline

```
┌────────────────────────────────────────────────────────────────┐
│                     RECOGNITION TIMELINE                       │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Audio Start ──►  turn.start                                   │
│         │                                                      │
│         ▼                                                      │
│  Speech Detected ──►  speech.startDetected                     │
│         │                                                      │
│         ▼                                                      │
│  Speaking... ──►  speech.hypothesis (x N times)                │
│         │            "สวัส..."                                  │
│         │            "สวัสดี..."                                 │
│         │            "สวัสดีครับ"                                 │
│         ▼                                                      │
│  Silence Detected ──►  speech.endDetected                      │
│         │                                                      │
│         ▼                                                      │
│  Finalized ──►  speech.phrase                                  │
│         │         "สวัสดีครับ" (final)                            │
│         ▼                                                      │
│  Turn Complete ──►  turn.end                                   │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

## 🔊 Audio Format Requirements

| Parameter   | Value         | Notes                    |
| ----------- | ------------- | ------------------------ |
| Format      | PCM           | Linear PCM, uncompressed |
| Sample Rate | 16,000 Hz     | 16kHz required           |
| Bit Depth   | 16-bit        | Signed integer           |
| Channels    | 1 (Mono)      | Single channel           |
| Byte Order  | Little Endian | For PCM samples          |

### RIFF Header (44 bytes)

```
Offset  Size  Description
0       4     "RIFF"
4       4     File size (0 for streaming)
8       4     "WAVE"
12      4     "fmt "
16      4     Chunk size (16)
20      2     Audio format (1 = PCM)
22      2     Channels (1)
24      4     Sample rate (16000)
28      4     Byte rate (32000)
32      2     Block align (2)
34      2     Bits per sample (16)
36      4     "data"
40      4     Data size (0 for streaming)
```

## 🔑 Key Implementation Points

### 1. Connection ID & Request ID
```go
connectionID := uuid.New().String()  // Per WebSocket connection
requestID := uuid.New().String()     // Per recognition session
```

### 2. Binary Message Format
```go
// Header length (2 bytes, Big Endian) + Header + Audio
message := make([]byte, 2 + headerLen + len(audioData))
binary.BigEndian.PutUint16(message[0:2], uint16(headerLen))
```

### 3. Thread Safety
```go
session.mu.Lock()
if session.azureConn != nil {
    sendAudioChunk(session, audioData)
}
session.mu.Unlock()
```

## 📈 Performance Characteristics

| Metric                 | Value                        |
| ---------------------- | ---------------------------- |
| Latency (hypothesis)   | ~200-300ms                   |
| Latency (phrase)       | ~500-1000ms after speech end |
| Recommended chunk size | 100-250ms of audio           |
| Max streaming duration | No hard limit (unlike REST)  |
