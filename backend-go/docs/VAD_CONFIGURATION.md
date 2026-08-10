# Speech activity and endpointing

## Current behavior

The browser does not run VAD and does not gate publication. The input waveform is signal-level feedback only. Audio is continuously published while the selected Microphone or Chrome Tab track is enabled, and each cloud provider decides when text is interim or final.

```text
Selected browser audio on
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

Gemini Live input transcription does not behave exactly like traditional ASR interim/final snapshots. It can emit useful source-input chunks with `isFinal=false`. The backend therefore creates application-level pseudo-turns: 650 ms of low-energy PCM requests a boundary and publishes the source final immediately, while delayed translation retains the same `turnId` for a fixed 500 ms grace period. PCM is observed but forwarded unchanged. The frontend updates one grouped source row for that `turnId` and shows the translation chip on the same row. This is best-effort alignment, not a sentence-level guarantee from Gemini.

Translated text is exposed; translated/model audio is still discarded.

### GPT Realtime Whisper

GPT Realtime Whisper receives the PCM stream continuously and uses the shared local segmenter to request a commit after 650 ms of low-energy audio. A 30-second hard duration also commits continuous speech so a turn cannot grow without bound. Delta events remain replaceable Draft text until the corresponding completed event is published as final source text.

## UI implications

- **Waveform/input meter:** confirms that selected-source samples reach the browser analyser.
- **Audio input state:** confirms whether the LiveKit track is published.
- **Agent/transcription state:** confirms whether an ASR agent is in the room.
- **Draft:** replaceable active source text for every provider; Gemini may also carry an in-progress paired translation.
- **Committed row:** finalized source text; Gemini translation is visible only in Lines view.
- **Text view:** source text only, with active Draft marked inline and no translation output.
- **Export:** finalized source text only, without Draft or translation output.

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
- `backend-go/internal/infrastructure/asr/openai_transcription.go`
- `backend-go/internal/infrastructure/asr/pcm_segmenter.go`
