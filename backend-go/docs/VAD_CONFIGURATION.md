# Speech activity and endpointing

## Current behavior

The browser does not run VAD and does not gate microphone publication. The microphone waveform is input-level feedback only. Audio is continuously published while the LiveKit microphone track is enabled, and each cloud provider decides when text is interim or final.

```text
Browser microphone on
  → continuous LiveKit audio
  → cloud provider speech activity / endpointing
  → interim and final transcript results
```

## Provider behavior

### Google

Google StreamingRecognize returns interim results and `is_final` utterances. The provider uses final results as safe reconnect points near the five-minute stream limit. Automatic punctuation is enabled in the current backend configuration.

Short speech may finalize with no interim updates. This is valid provider behavior, not necessarily a frontend bug.

### Azure

Azure conversation recognition uses server-side endpointing. The provider sends:

- segmentation silence timeout: 300 ms,
- maximum silence duration: 500 ms,
- initial silence timeout: 5 seconds,
- interim results enabled.

Azure emits `speech.hypothesis` for interim text and `speech.phrase` for final text.

### Gemini

Gemini Live input transcription does not behave exactly like traditional ASR interim/final snapshots. It can emit useful source-input chunks with `isFinal=false`. The frontend retains those chunks as normal rows and suppresses only exact consecutive duplicates.

The model's translated/model audio is not exposed to the application.

## UI implications

- **Waveform/input meter:** confirms that microphone samples reach the browser analyser.
- **Microphone state:** confirms whether the LiveKit track is published.
- **Agent/transcription state:** confirms whether an ASR agent is in the room.
- **Interim draft:** replaceable active text for Google/Azure.
- **Committed row:** final Google/Azure text or retained Gemini source chunk.

Do not infer speech detection from waveform movement alone. Do not label browser input level as VAD unless a real VAD controller is implemented.

## Tuning guidance

- Tune cloud endpointing only with representative Thai speech and noise conditions.
- Aggressive silence thresholds reduce final latency but can split phrases.
- Automatic punctuation can improve readability but may affect when a service finalizes.
- Avoid frontend whitespace normalization beyond packet validation; Thai normalization occurs at the Go agent output boundary.

## Relevant files

- `frontend/components/MicrophoneInputStrip.tsx`
- `frontend/hooks/useAudioVisualizer.ts`
- `frontend/lib/audioSignal.ts`
- `frontend/lib/transcriptMessages.ts`
- `backend-go/internal/infrastructure/asr/google.go`
- `backend-go/internal/infrastructure/asr/azure.go`
- `backend-go/internal/infrastructure/asr/gemini.go`
