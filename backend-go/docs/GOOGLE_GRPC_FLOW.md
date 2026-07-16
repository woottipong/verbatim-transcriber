# Google Cloud Speech-to-Text V2 flow

## Position in the system

Google gRPC is an internal provider connection behind the LiveKit agent. Browsers never connect to Google through the Go HTTP server directly.

```text
LiveKit Opus 48 kHz
  → Go agent decode to mono Linear16 PCM
  → GoogleProvider.SendAudio
  → Speech-to-Text V2 StreamingRecognize
  → TranscriptResult
  → LiveKit data channel
```

## Defaults

| Setting | Value |
| --- | --- |
| Location | `asia-southeast1` |
| Model | `chirp_2` |
| Language | `th-TH` |
| Sample rate | 48,000 Hz |
| Encoding | Explicit Linear16 mono |
| Interim results | Enabled |
| Automatic punctuation | Enabled |
| Alternatives | 1 |

The V2 endpoint is `<location>-speech.googleapis.com:443`, and the recognizer path uses `projects/<project>/locations/<location>/recognizers/_`.

## Authentication

`GOOGLE_CLOUD_PROJECT` is always required. Configure either:

- `GOOGLE_APPLICATION_CREDENTIALS` for a service-account JSON file, or
- `GOOGLE_API_KEY` when the key is valid for this API and project.

Do not log or commit credentials.

## Streaming behavior

1. `Start` creates a Speech-to-Text V2 streaming client.
2. The first request carries the recognition configuration.
3. Audio is split so each V2 request stays at or below 15 KiB.
4. Responses emit `TranscriptResult` values with `IsFinal`, confidence, and text.
5. Interim and final counts are logged for diagnosis.

Interim delivery is service-dependent. A short utterance can produce a final response with zero interim updates.

## Five-minute stream handling

Google limits an individual streaming session. The provider:

- enters a reconnect zone at four minutes,
- prefers reconnecting after a final result,
- forces reconnect at 4:50,
- retains one second of PCM in a ring buffer,
- replays that buffer after reconnect,
- recognizes stream-limit errors as a final safety net.

See [ISSUE_GOOGLE_5MIN_LIMIT.md](ISSUE_GOOGLE_5MIN_LIMIT.md) for details.

## Region/model compatibility

Model availability differs by region. Keep `GOOGLE_SPEECH_MODEL` compatible with `GOOGLE_CLOUD_LOCATION`. The repository defaults to `chirp_2` in `asia-southeast1` for Thai realtime use; do not switch to a preview or unavailable model without verifying the target project and location.

## Implementation

- Provider: `backend-go/internal/infrastructure/asr/google.go`
- Tests: `backend-go/internal/infrastructure/asr/google_test.go`
- Agent integration: `backend-go/internal/infrastructure/agent/agent.go`
