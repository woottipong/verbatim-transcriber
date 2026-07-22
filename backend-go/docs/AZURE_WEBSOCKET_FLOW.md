# Azure Speech upstream WebSocket flow

## Scope

Azure Speech uses a WebSocket internally from the Go provider to Azure. This is an upstream implementation detail, not a public browser/backend WebSocket API.

```text
Browser microphone or Chrome Tab
  → LiveKit WebRTC Opus 48 kHz
  → Go agent decodes and downsamples to 16 kHz PCM
  → AzureProvider WebSocket
  → speech.hypothesis / speech.phrase
  → LiveKit transcript data
```

## Connection

The provider connects to:

```text
wss://<region>.stt.speech.microsoft.com/
  speech/recognition/conversation/cognitiveservices/v1
  ?language=th-TH&format=detailed
```

Authentication uses `AZURE_SUBSCRIPTION_KEY`; the hostname uses `AZURE_REGION`.

## Audio format

| Property | Value |
| --- | --- |
| Sample rate | 16,000 Hz |
| Channels | Mono |
| Sample format | Signed 16-bit little-endian PCM |
| Container framing | WAV/RIFF header followed by binary audio frames |
| Provider buffer threshold | Approximately 200 ms |

The LiveKit agent decodes at 48 kHz and uses interval-averaged 3:1 downsampling before sending audio to Azure. Averaging the source samples attenuates high-frequency aliasing compared with dropping every second or third sample.

## Provider protocol

1. Open WebSocket with subscription and connection headers.
2. Send `speech.config` with agent metadata and segmentation settings.
3. Send `audio` configuration with a WAV/RIFF header.
4. Buffer and send binary PCM audio frames.
5. Parse Azure text frames by their `Path` header.
6. Emit interim text for `speech.hypothesis` and final text for `speech.phrase`.

Default endpointing values are:

| Setting | Default |
| --- | --- |
| Segmentation silence timeout | 300 ms |
| Maximum silence duration | 500 ms |
| Initial silence timeout | 5,000 ms |
| Interim results | Enabled |

These settings favor responsive Thai transcription and may need tuning for noisy or slow-speaking environments.

## Lifecycle

`Stop` is idempotent, closes the provider connection, flushes buffered audio when possible, and closes the result channel exactly once. Normal shutdown errors should not be presented as unexpected provider failures.

## Implementation

- Provider: `backend-go/internal/infrastructure/asr/azure.go`
- Tests: `backend-go/internal/infrastructure/asr/azure_test.go`
- Agent resampling: `backend-go/internal/infrastructure/agent/agent.go`
