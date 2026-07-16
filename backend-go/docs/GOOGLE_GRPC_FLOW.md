# Google Cloud Speech-to-Text - gRPC Data Flow

## Architecture

```
Browser (Frontend)  ◄── WebSocket (JSON + PCM) ──►  Go Backend (Fiber)  ◄── gRPC (Protobuf) ──►  Google Speech STT
```

---

## Connection Flow

```
Frontend                    Backend                         Google
   │                           │                              │
   │──── WS Connect ──────────►│                              │
   │◄─── {"type":"connected"} ─│                              │
   │                           │                              │
   │──── {"type":"start"} ────►│                              │
   │                           │──── gRPC NewClient() ───────►│
   │                           │◄─── Client OK ───────────────│
   │                           │                              │
   │                           │──── StreamingRecognize() ───►│
   │                           │◄─── Stream OK ───────────────│
   │                           │                              │
   │                           │──── StreamingConfig ────────►│
   │                           │     (RecognitionConfig)      │
   │                           │                              │
   │◄─── {"type":"started"} ──│                              │
   │                           │                              │
```

## Audio Streaming Flow

```
Frontend                    Backend                         Google
   │                           │                              │
   │──── Binary (PCM) ────────►│                              │
   │                           │──── Audio (Proto) ──────────►│
   │                           │                              │
   │                           │◄─── StreamingResponse ───────│  (interim)
   │◄─── {"isFinal":false}  ───│     IsFinal: false           │
   │                           │                              │
   │──── Binary (PCM) ────────►│                              │
   │                           │──── Audio (Proto) ──────────►│
   │                           │                              │
   │                           │◄─── StreamingResponse ───────│  (final)
   │◄─── {"isFinal":true}  ────│     IsFinal: true            │
   │                           │                              │
```

---

## Message Formats

### 1. Frontend → Backend

**Control (JSON):**

```json
{"type": "start"}
{"type": "stop"}
```

**Audio (Binary):** PCM 16-bit signed, 48kHz, mono

### 2. Backend → Google (gRPC/Protobuf)

**StreamingConfig (First message):**

```protobuf
StreamingRecognizeRequest {
  recognizer: "projects/PROJECT_ID/locations/asia-southeast1/recognizers/_"
  streaming_config: StreamingRecognitionConfig {
    config: RecognitionConfig {
      explicit_decoding_config {
        encoding: LINEAR16
        sample_rate_hertz: 48000
        audio_channel_count: 1
      }
      language_codes: "th-TH"
      model: "chirp_2"
      enable_automatic_punctuation: false
    }
    streaming_features { interim_results: true }
  }
}
```

**Audio (Subsequent messages, maximum 15 KB each):**

```protobuf
StreamingRecognizeRequest {
  audio: bytes  // Raw PCM audio data
}
```

### 3. Google → Backend (gRPC Response)

```protobuf
StreamingRecognizeResponse {
  results: [
    StreamingRecognitionResult {
      alternatives: [
        SpeechRecognitionAlternative {
          transcript: "สวัสดีครับ"
          confidence: 0.95
        }
      ]
      is_final: true
      stability: 0.9
    }
  ]
}
```

### 4. Backend → Frontend (Standardized JSON)

```json
{
  "type": "transcript",
  "text": "สวัสดีครับ",
  "isFinal": true,
  "channel": {
    "alternatives": [
      { "transcript": "สวัสดีครับ", "confidence": 0.95 }
    ]
  }
}
```

---

## Recognition Timeline

```
Stream Created ──►  StreamingRecognize() called
       │
       ▼
Config Sent ──►  StreamingConfig message
       │
       ▼
Audio Streaming ──►  Audio messages (continuous)
       │
       ▼
Interim Results ──►  StreamingResponse (IsFinal: false)
       │            "สวัส..."  (stability: 0.5)
       │            "สวัสดี..." (stability: 0.7)
       │            "สวัสดีครับ" (stability: 0.9)
       ▼
Final Result ──►  StreamingResponse (IsFinal: true)
       │          "สวัสดีครับ" (confidence: 0.95)
       ▼
Continue... ──►  Next utterance begins
```

---

## Audio Format Requirements

| Parameter   | Value         | Notes                         |
| ----------- | ------------- | ----------------------------- |
| Format      | LINEAR16      | Linear PCM, uncompressed      |
| Sample Rate | 48,000 Hz     | Matches frontend AudioContext |
| Bit Depth   | 16-bit        | Signed integer                |
| Channels    | 1 (Mono)      | Single channel                |
| Byte Order  | Little Endian | For PCM samples               |

---

## Key Implementation Points

### 1. Client & Stream Creation

```go
client, err := speech.NewClient(ctx, option.WithCredentialsFile(credPath))
stream, err := client.StreamingRecognize(ctx)
```

### 2. Send Config First

```go
err = stream.Send(&speechpb.StreamingRecognizeRequest{
    StreamingRequest: &speechpb.StreamingRecognizeRequest_StreamingConfig{
        StreamingConfig: &speechpb.StreamingRecognitionConfig{
            Config: &speechpb.RecognitionConfig{...},
            InterimResults: true,
        },
    },
})
```

### 3. Stream Audio

```go
err := stream.Send(&speechpb.StreamingRecognizeRequest{
    StreamingRequest: &speechpb.StreamingRecognizeRequest_Audio{
        Audio: audioData,
    },
})
```

### 4. Receive Responses (Goroutine)

```go
go func() {
    for {
        resp, err := stream.Recv()
        if err != nil {
            break
        }
        // Process response...
    }
}()
```

---

## Limitations

### 5-Minute Streaming Limit

- Google Cloud STT มี hard limit 5 นาทีต่อ streaming session
- **แก้ไขแล้ว**: `GoogleProvider` auto-reconnect อัตโนมัติ (รอ isFinal ตอน >4 นาที → reconnect, force ที่ 4:50, replay 1s buffer)
- ผู้ใช้ไม่ต้องทำอะไร — seamless
- **ดูรายละเอียด:** [ISSUE_GOOGLE_5MIN_LIMIT.md](ISSUE_GOOGLE_5MIN_LIMIT.md)

---

## Response Fields

| Field                                 | Type     | Description              |
| ------------------------------------- | -------- | ------------------------ |
| `results[].alternatives[].transcript` | string   | Transcribed text         |
| `results[].alternatives[].confidence` | float    | Confidence score (0-1)   |
| `results[].is_final`                  | bool     | Final vs interim result  |
| `results[].stability`                 | float    | Interim result stability |
| `results[].result_end_time`           | Duration | End time of result       |

## Performance

| Metric                 | Value                          |
| ---------------------- | ------------------------------ |
| Latency (interim)      | ~300-500ms                     |
| Latency (final)        | ~500-1000ms after speech end   |
| Recommended chunk size | 100-250ms of audio             |
| Max streaming duration | **5 minutes** (auto-reconnect) |
| Reconnect overhead     | ~200-500ms                     |

---

## Handler Location

- WebSocket handler: `internal/delivery/handler/asr.go` (unified `HandleASR(conn, cfg, "Google")`)
- ASR provider: `internal/infrastructure/asr/google.go` (auto-reconnect รองรับ 5-min limit)
