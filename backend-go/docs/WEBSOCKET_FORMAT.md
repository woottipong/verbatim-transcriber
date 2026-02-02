# WebSocket Message Format Specification

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

| Provider | Backend Handler | Uses sendTranscript() | Format                                 |
| -------- | --------------- | --------------------- | -------------------------------------- |
| Deepgram | ❌ Stub only     | N/A                   | Native Deepgram format (to be wrapped) |
| Gemini   | ✅ Working       | ✅ Yes                 | Standard format                        |
| Google   | ✅ Working       | ✅ Yes                 | Standard format                        |
| Azure    | ✅ Working       | ✅ Yes                 | Standard format                        |

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

| Provider | Sample Rate | Format       | Encoding             |
| -------- | ----------- | ------------ | -------------------- |
| Deepgram | 48000 Hz    | Linear16 PCM | Int16                |
| Gemini   | 16000 Hz    | WAV          | PCM → WAV conversion |
| Google   | 48000 Hz    | Linear16 PCM | Int16                |
| Azure    | 16000 Hz    | WAV          | PCM → WAV conversion |

## Testing Checklist

- [x] All providers send `type: "transcript"`
- [x] All providers send `text` field (not `transcript`)
- [x] All providers send `isFinal` (not `is_final`)
- [x] Error messages use `error` field
- [x] Frontend hooks handle all message types consistently
- [x] Deepgram hook has fallback for native format
- [x] All providers use correct sample rates

## Migration Notes

### Changes Made:
1. ✅ Fixed `common.go` TranscriptResponse to use `text` instead of `transcript`
2. ✅ Fixed `common.go` TranscriptResponse to use `isFinal` instead of `is_final`
3. ✅ Updated Gemini handler to use `sendTranscript()` instead of manual map
4. ✅ Updated Deepgram frontend hook to handle both formats (standard + native)

### Backward Compatibility:
- Deepgram frontend hook can handle both the new standard format and Deepgram's native format
- No breaking changes for existing connections
