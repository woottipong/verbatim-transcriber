# WebSocket Message Format Specification

## 📋 Overview

เอกสารนี้อธิบาย message format มาตรฐานที่ใช้สื่อสารระหว่าง **Frontend ↔ Backend** สำหรับทุก ASR providers

```
┌─────────────┐     Standardized JSON      ┌─────────────┐
│   Browser   │ ◄────────────────────────► │  Go Backend │
│  (Frontend) │    + Binary Audio          │   (Fiber)   │
└─────────────┘                            └─────────────┘
```

## Standard JSON Message Format (All Providers)

### 1. Connection Messages

**Connected:**
```json
{
  "type": "connected"
}
```

**Started:**
```json
{
  "type": "started"
}
```

**Stopped:**
```json
{
  "type": "stopped"
}
```

### 2. Transcript Messages

**Format (Standardized across all providers):**
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

## Backend Implementation

All providers use the common `sendTranscript()` function:

```go
func sendTranscript(conn *websocketFiber.Conn, text string, isFinal bool, confidence float64) error {
    return conn.WriteJSON(TranscriptResponse{
        Type:    "transcript",
        Text:    text,
        IsFinal: isFinal,
        Channel: Channel{
            Alternatives: []Alternative{
                {
                    Transcript: text,
                    Confidence: confidence,
                },
            },
        },
    })
}
```

### Provider Status

| Provider | Backend Handler | Protocol            | Uses sendTranscript() | Status                                 |
| -------- | --------------- | ------------------- | --------------------- | -------------------------------------- |
| Deepgram | ❌ Stub only     | WebSocket (Direct)  | N/A                   | Frontend connects directly to Deepgram |
| Gemini   | ✅ Working       | REST + Batch        | ✅ Yes                 | Standard format                        |
| Google   | ✅ Working       | gRPC Streaming      | ✅ Yes                 | Standard format                        |
| Azure    | ✅ Working       | WebSocket Streaming | ✅ Yes                 | Standard format                        |

## Frontend Implementation

All hooks handle messages the same way:

```typescript
const handleSocketMessage = useCallback((event: MessageEvent) => {
    try {
        const data = JSON.parse(event.data);

        switch (data.type) {
            case 'connected':
                console.log('✅ Connected');
                break;

            case 'started':
                setConnectionState(ConnectionState.CONNECTED);
                break;

            case 'transcript':
                if (data.text) {
                    if (data.isFinal) {
                        setTranscripts(prev => [...prev, {
                            id: generateId(),
                            text: data.text,
                            isFinal: true,
                            timestamp: Date.now(),
                        }]);
                        setInterimTranscript('');
                    } else {
                        setInterimTranscript(data.text);
                    }
                }
                break;

            case 'error':
                setError(data.error || 'Unknown error');
                setConnectionState(ConnectionState.ERROR);
                break;

            case 'stopped':
                console.log('Session stopped');
                break;
        }
    } catch (err) {
        console.error('Error parsing message:', err);
    }
}, []);
```

### Hook Status

| Provider | Frontend Hook    | Standardized | Notes                                 |
| -------- | ---------------- | ------------ | ------------------------------------- |
| Deepgram | ✅ useDeepgram.ts | ✅ Yes        | Handles both standard + native format |
| Gemini   | ✅ useGemini.ts   | ✅ Yes        | Standard format only                  |
| Google   | ✅ useGoogle.ts   | ✅ Yes        | Standard format only                  |
| Azure    | ✅ useAzure.ts    | ✅ Yes        | Standard format only                  |

## Audio Format Requirements

| Provider | Sample Rate | Format       | Encoding             | Notes                  |
| -------- | ----------- | ------------ | -------------------- | ---------------------- |
| Deepgram | 48000 Hz    | Linear16 PCM | Int16                | Direct to Deepgram API |
| Gemini   | 16000 Hz    | WAV          | PCM → WAV conversion | Batch processing       |
| Google   | 48000 Hz    | Linear16 PCM | Int16                | gRPC streaming         |
| Azure    | 16000 Hz    | WAV          | PCM + RIFF header    | WebSocket streaming    |

## Architecture Per Provider

```
Deepgram:  Frontend ──────────────────────► Deepgram API (Direct WebSocket)

Gemini:    Frontend ──► Backend ──► Gemini REST API (Batch)

Google:    Frontend ──► Backend ──► Google gRPC (Streaming)

Azure:     Frontend ──► Backend ──► Azure WebSocket (Streaming)
```

## Testing Checklist

- [x] All providers send `type: "transcript"`
- [x] All providers send `text` field (not `transcript`)
- [x] All providers send `isFinal` (not `is_final`)
- [x] Error messages use `error` field
- [x] Frontend hooks handle all message types consistently
- [x] Deepgram hook has fallback for native format
- [x] All providers use correct sample rates
- [x] Azure WebSocket streaming with interim results
- [x] Google gRPC streaming with interim results

## Related Documentation

| Document                                           | Description                             |
| -------------------------------------------------- | --------------------------------------- |
| [AZURE_WEBSOCKET_FLOW.md](AZURE_WEBSOCKET_FLOW.md) | Azure WebSocket binary protocol details |
| [GOOGLE_GRPC_FLOW.md](GOOGLE_GRPC_FLOW.md)         | Google gRPC/Protobuf flow               |
| [VAD_CONFIGURATION.md](VAD_CONFIGURATION.md)       | VAD settings for all providers          |
| [PROVIDERS.md](PROVIDERS.md)                       | Provider overview and setup             |

## Migration Notes

### Changes Made:
1. ✅ Fixed `common.go` TranscriptResponse to use `text` instead of `transcript`
2. ✅ Fixed `common.go` TranscriptResponse to use `isFinal` instead of `is_final`
3. ✅ Updated Gemini handler to use `sendTranscript()` instead of manual map
4. ✅ Updated Deepgram frontend hook to handle both formats (standard + native)
5. ✅ **Azure: Migrated from REST API to WebSocket API** (interim results support)

### Backward Compatibility:
- Deepgram frontend hook can handle both the new standard format and Deepgram's native format
- No breaking changes for existing connections

### Performance Comparison:

| Provider | Latency (Interim) | Latency (Final) | Streaming Limit |
| -------- | ----------------- | --------------- | --------------- |
| Deepgram | ~200ms            | ~300ms          | No limit        |
| Gemini   | N/A (batch)       | ~2-3s           | N/A             |
| Google   | ~300-500ms        | ~500-1000ms     | **5 minutes**   |
| Azure    | ~200-300ms        | ~500-1000ms     | No limit        |
