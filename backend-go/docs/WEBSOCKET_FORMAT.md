# WebSocket Message Format Specification

## Overview

เอกสารนี้อธิบาย message format มาตรฐานที่ใช้สื่อสารระหว่าง **Frontend ↔ Backend** สำหรับทุก ASR providers

```
Browser (Frontend)  ◄──── Standardized JSON + Binary Audio ────►  Go Backend (Fiber)
```

---

## Standard JSON Message Format

### 1. Connection Messages

```json
{ "type": "connected" }
{ "type": "started" }
{ "type": "stopped" }
```

### 2. Transcript Messages

```json
{
  "type": "transcript",
  "text": "ถอดเสียงเป็นข้อความ",
  "isFinal": true,
  "channel": {
    "alternatives": [
      {
        "transcript": "ถอดเสียงเป็นข้อความ",
        "confidence": 0.95
      }
    ]
  }
}
```

**Key Fields:**

- `type`: Always `"transcript"`
- `text`: The transcribed text (main field used by frontend)
- `isFinal`: `true` for final results, `false` for interim
- `channel.alternatives[0].confidence`: Confidence score (0-1)

### 3. Error Messages

```json
{
  "type": "error",
  "error": "Error message here"
}
```

---

## Client → Server

**Control Messages (JSON):**

```json
{ "type": "start" }
{ "type": "stop" }
```

**Audio Data (Binary):**

- PCM 16-bit signed, mono, Little Endian
- Sample rate ขึ้นกับ provider (48kHz สำหรับ Google, 16kHz สำหรับ Azure)

---

## Backend Implementation

All providers use the common `sendTranscript()` function in `internal/delivery/handler/common.go`:

```go
func sendTranscript(conn *websocketFiber.Conn, text string, isFinal bool, confidence float64) error {
    return conn.WriteJSON(TranscriptResponse{
        Type:    "transcript",
        Text:    text,
        IsFinal: isFinal,
        Channel: Channel{
            Alternatives: []Alternative{
                {Transcript: text, Confidence: confidence},
            },
        },
    })
}
```

### Provider Handler Status

| Provider | Handler                            | Protocol       | Uses sendTranscript() |
| -------- | ---------------------------------- | -------------- | --------------------- |
| Google   | `internal/delivery/handler/asr.go` | gRPC Streaming | ✅                     |
| Azure    | `internal/delivery/handler/asr.go` | WebSocket      | ✅                     |

---

## Audio Format Requirements

| Provider | Sample Rate | Format       | Encoding          |
| -------- | ----------- | ------------ | ----------------- |
| Google   | 48,000 Hz   | Linear16 PCM | Int16             |
| Azure    | 16,000 Hz   | WAV          | PCM + RIFF header |

---

## Architecture Per Provider

```
Google:    Frontend ──► Backend (WebSocket) ──► Google gRPC (Streaming)
Azure:     Frontend ─► Backend (WebSocket) ─► Azure WebSocket (Streaming)
```

---

## Related Documentation

| Document                                           | Description                             |
| -------------------------------------------------- | --------------------------------------- |
| [AZURE_WEBSOCKET_FLOW.md](AZURE_WEBSOCKET_FLOW.md) | Azure WebSocket binary protocol details |
| [GOOGLE_GRPC_FLOW.md](GOOGLE_GRPC_FLOW.md)         | Google gRPC/Protobuf flow               |
