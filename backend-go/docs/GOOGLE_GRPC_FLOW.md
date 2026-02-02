# Google Cloud Speech-to-Text - Data Flow

## 📊 ภาพรวม Architecture

```
┌─────────────┐     WebSocket      ┌─────────────┐       gRPC         ┌─────────────┐
│   Browser   │ ◄──────────────► │  Go Backend │ ◄──────────────► │   Google    │
│  (Frontend) │    JSON + PCM     │   (Fiber)   │    Protobuf        │ Speech STT  │
└─────────────┘                   └─────────────┘                   └─────────────┘
```

## 🔄 Connection Flow

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                              CONNECTION SEQUENCE                                  │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Frontend                    Backend                         Google              │
│     │                           │                              │                 │
│     │──── WS Connect ──────────►│                              │                 │
│     │◄─── {"type":"connected"} ─│                              │                 │
│     │                           │                              │                 │
│     │──── {"type":"start"} ────►│                              │                 │
│     │                           │──── gRPC NewClient() ───────►│                 │
│     │                           │◄─── Client OK ───────────────│                 │
│     │                           │                              │                 │
│     │                           │──── StreamingRecognize() ───►│                 │
│     │                           │◄─── Stream OK ───────────────│                 │
│     │                           │                              │                 │
│     │                           │──── StreamingConfig ────────►│                 │
│     │                           │     (RecognitionConfig)      │                 │
│     │                           │                              │                 │
│     │◄─── {"type":"started"} ──│                              │                 │
│     │                           │                              │                 │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## 🎤 Audio Streaming Flow

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                              AUDIO STREAMING                                     │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Frontend                    Backend                         Google              │
│     │                           │                              │                 │
│     │──── Binary (PCM) ────────►│                              │                 │
│     │                           │──── AudioContent (Proto) ───►│                 │
│     │                           │                              │                 │
│     │                           │◄─── StreamingResponse ───────│  (interim)      │
│     │◄─── {"isFinal":false}  ───│     IsFinal: false           │                 │
│     │                           │                              │                 │
│     │──── Binary (PCM) ────────►│                              │                 │
│     │                           │──── AudioContent (Proto) ───►│                 │
│     │                           │                              │                 │
│     │                           │◄─── StreamingResponse ───────│  (final)        │
│     │◄─── {"isFinal":true}  ────│     IsFinal: true            │                 │
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
[PCM 16-bit signed, 48kHz, mono]
```

---

### 2. Backend → Google (gRPC/Protobuf)

**StreamingConfig (First message):**
```protobuf
StreamingRecognizeRequest {
  streaming_config: StreamingRecognitionConfig {
    config: RecognitionConfig {
      encoding: LINEAR16
      sample_rate_hertz: 48000
      language_code: "th-TH"
      model: "default"
      use_enhanced: false
    }
    interim_results: true
  }
}
```

**AudioContent (Subsequent messages):**
```protobuf
StreamingRecognizeRequest {
  audio_content: bytes  // Raw PCM audio data
}
```

---

### 3. Google → Backend (gRPC Response)

**StreamingRecognizeResponse:**
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

---

### 4. Backend → Frontend (Standardized JSON)

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

## 🎯 Recognition Timeline

```
┌────────────────────────────────────────────────────────────────┐
│                     RECOGNITION TIMELINE                        │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Stream Created ──►  StreamingRecognize() called               │
│         │                                                      │
│         ▼                                                      │
│  Config Sent ──►  StreamingConfig message                      │
│         │                                                      │
│         ▼                                                      │
│  Audio Streaming ──►  AudioContent messages (continuous)       │
│         │                                                      │
│         ▼                                                      │
│  Interim Results ──►  StreamingResponse (IsFinal: false)       │
│         │            "สวัส..."  (stability: 0.5)                │
│         │            "สวัสดี..." (stability: 0.7)                │
│         │            "สวัสดีครับ" (stability: 0.9)                │
│         ▼                                                      │
│  Final Result ──►  StreamingResponse (IsFinal: true)           │
│         │          "สวัสดีครับ" (confidence: 0.95)                │
│         ▼                                                      │
│  Continue... ──►  Next utterance begins                        │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

## 🔊 Audio Format Requirements

| Parameter   | Value         | Notes                       |
| ----------- | ------------- | --------------------------- |
| Format      | LINEAR16      | Linear PCM, uncompressed    |
| Sample Rate | 48,000 Hz     | Default config (adjustable) |
| Bit Depth   | 16-bit        | Signed integer              |
| Channels    | 1 (Mono)      | Single channel              |
| Byte Order  | Little Endian | For PCM samples             |

### Supported Encodings

| Encoding  | Description          | Use Case                       |
| --------- | -------------------- | ------------------------------ |
| LINEAR16  | Raw PCM              | Best quality, larger bandwidth |
| FLAC      | Lossless compression | Good quality, smaller size     |
| OGG_OPUS  | Lossy compression    | Streaming, bandwidth limited   |
| WEBM_OPUS | WebM container       | Browser native                 |

## 🔑 Key Implementation Points

### 1. Client & Stream Creation
```go
// Create client (once per session)
client, err := speech.NewClient(ctx, option.WithAPIKey(apiKey))

// Create bidirectional stream
stream, err := client.StreamingRecognize(ctx)
```

### 2. Send Config First
```go
// MUST send config before any audio
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
// Send audio chunks
err := stream.Send(&speechpb.StreamingRecognizeRequest{
    StreamingRequest: &speechpb.StreamingRecognizeRequest_AudioContent{
        AudioContent: audioData,
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

## ⚠️ Limitations & Considerations

### 5-Minute Streaming Limit

```
┌────────────────────────────────────────────────────────────────┐
│                     STREAMING LIMIT                             │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  0:00 ─────────────────────────────────────────────── 5:00     │
│    │                                                    │      │
│    └── Stream active ──────────────────────────────────┘      │
│                                                    │           │
│                                              Stream ends       │
│                                              (must reconnect)  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Workaround:**
```go
// Track stream duration
if time.Since(streamStart) > 4*time.Minute {
    // Close and reconnect before 5-minute limit
    stream.CloseSend()
    stream, _ = client.StreamingRecognize(ctx)
    // Re-send config...
}
```

### Single Utterance Mode

```go
// If enabled, stream closes after first final result
StreamingConfig: &speechpb.StreamingRecognitionConfig{
    SingleUtterance: true,  // Stream ends after first silence
}
```

## 📊 Response Fields

| Field                                 | Type     | Description              |
| ------------------------------------- | -------- | ------------------------ |
| `results[].alternatives[].transcript` | string   | Transcribed text         |
| `results[].alternatives[].confidence` | float    | Confidence score (0-1)   |
| `results[].is_final`                  | bool     | Final vs interim result  |
| `results[].stability`                 | float    | Interim result stability |
| `results[].result_end_time`           | Duration | End time of result       |

## 📈 Performance Characteristics

| Metric                 | Value                        |
| ---------------------- | ---------------------------- |
| Latency (interim)      | ~300-500ms                   |
| Latency (final)        | ~500-1000ms after speech end |
| Recommended chunk size | 100-250ms of audio           |
| Max streaming duration | **5 minutes** (hard limit)   |
| Reconnect overhead     | ~200-500ms                   |

## 🔄 Comparison with Azure

| Feature          | Google        | Azure                    |
| ---------------- | ------------- | ------------------------ |
| Protocol         | gRPC/Protobuf | WebSocket/Binary         |
| Streaming limit  | 5 minutes     | No limit                 |
| Interim results  | ✅             | ✅                        |
| VAD config       | Limited       | Limited                  |
| Setup complexity | Simple (SDK)  | Medium (custom protocol) |
| Thai support     | ✅ th-TH       | ✅ th-TH                  |
