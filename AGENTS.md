# Repository Agent Guide

## Scope and precedence

This file applies to the entire repository. More specific `AGENTS.md` files may add rules for a subdirectory. Follow system and user instructions first, then the closest repository instructions. `CLAUDE.md` at the repo root is a thin index for Claude Code that points back here — this file is the canonical contributor guide; if the two ever disagree, this file wins.

## Project overview

CaptionLive is a real-time transcription workspace built around LiveKit rooms. The Audio Source publishes microphone or Chrome Tab audio through WebRTC. Each active room/provider agent subscribes to that track, sends decoded PCM to one ASR provider, then publishes normalized transcript messages to the LiveKit data channel and backend transcript hub. A room may run multiple provider agents concurrently.

Caption Desk is a moderated approval lane layered on top of an active provider agent: an operator reviews/edits the provider's finalized source text and publishes approved captions on a separate topic. It never replaces the raw per-provider transcript path — both run side by side.

There is no browser-to-ASR or browser-to-backend **audio** WebSocket mode. Do not restore the removed `/google`, `/azure`, or `/gemini` client audio WebSocket endpoints. The supported public application WebSockets are read-only transcript/caption outputs; keep them separate from provider upstream protocols.

Use the current product vocabulary in user-facing UI and documentation:

- Product: **CaptionLive**
- Admin/operator surface: **Control Room**
- Publisher surface: **Audio Source**
- Read-only viewer surface: **Transcript**
- Moderated caption-approval surface: **Caption Desk**

## Current architecture

```text
Control Room ── HTTP ─────────────────────────► Go backend
Audio Source ── HTTP token ───────────────────► Go backend
Transcript  ── HTTP token ────────────────────► Go backend
Caption Desk ── HTTP token (sessionId+policy) ─► Go backend

Audio Source ── WebRTC audio ─────────────────► LiveKit room
                                                   │
                                                   ├──► room/provider agent
                                                   │        │
                                                   │        ├──► Google / Gemini /
                                                   │        │    Azure / GPT Realtime Translate
                                                   │        │
                                                   │        └──► caption moderation
                                                   │             (Caption Desk review window)
                                                   │
Transcript ◄── room audio + transcript data ──────┤
Caption Desk ◄── caption.operator/command ────────┤
Transcript ◄── caption.public (approved) ─────────┘

External system ◄── signed provider WebSocket ──── transcript hub
External system ◄── signed caption WebSocket ────── caption hub
```

- `frontend/`: React 19, TypeScript, Vite, Tailwind CSS, LiveKit client.
- `backend-go/`: Go 1.24, Fiber HTTP API, LiveKit room agent, provider implementations, caption moderation.
- `livekit/`: local Docker Compose setup for LiveKit (`docker-compose.yml`/`livekit.yaml`). `docker-compose-prod.yml`/`livekit-prod.yaml` are production-hardened variants (dedicated networks, health checks) and are not part of the local dev flow below.
- `start_backend.sh` and `start_frontend.sh`: separate local backend/frontend launchers. LiveKit must already be running.

## Important entry points

- Frontend shell and hash routing: `frontend/App.tsx`
- Audio Source connection: `frontend/hooks/useLiveKit.ts`
- Transcript connection (raw + approved-caption playback): `frontend/hooks/useRoomViewer.ts`
- Transcript parsing/state helpers: `frontend/lib/transcriptMessages.ts`
- Subtitle grouping, line measurement, cue continuity: `frontend/lib/transcriptPresentation.ts`
- Two-line subtitle paging/timing: `frontend/lib/subtitlePaging.ts`
- Reading-pace progressive reveal: `frontend/lib/progressiveText.ts`, `frontend/hooks/useProgressiveText.ts`
- Caption Desk operator state machine (pure, no network): `frontend/lib/captionDeskSession.ts`
- Caption Desk wire protocol/validation: `frontend/lib/captionDeskMessages.ts`
- Caption Desk operator orchestration (LiveKit room + auth): `frontend/hooks/useCaptionDesk.ts`
- Caption Desk review/publish UI: `frontend/components/caption-desk/CaptionDeskReviewEditor.tsx`, `CaptionDeskPublishedHistory.tsx`
- Approved-caption viewer playback queue: `frontend/lib/captionDeskPlaybackStore.ts`, `frontend/hooks/useCaptionDeskPlayback.ts`
- Viewer token fallback decision helpers: `frontend/lib/viewerToken.ts` (the fetch itself lives in `useRoomViewer.ts`)
- Backend entry point: `backend-go/main.go`
- HTTP routes: `backend-go/internal/delivery/routes.go`
- Agent lifecycle API: `backend-go/internal/delivery/handler/agent.go`
- Transcript-link and WebSocket handlers, including approved-caption WebSocket: `backend-go/internal/delivery/handler/transcript.go`
- Caption Desk token issuance (`HandleCaptionDeskToken`): `backend-go/internal/delivery/handler/livekit.go`
- LiveKit agent/audio pipeline: `backend-go/internal/infrastructure/agent/agent.go`
- Caption Desk data-channel wiring (subscribe/publish, ownership, grace period, draft coalescing): `backend-go/internal/infrastructure/agent/caption_moderation.go`
- Caption Desk envelope parsing/validation: `backend-go/internal/infrastructure/agent/caption_protocol.go`
- Caption review-window domain logic (draft/pending queue, publish idempotency): `backend-go/internal/application/captionmoderation/moderator.go`
- Early-final stable-prefix promotion (only under `early-final` policy): `backend-go/internal/application/captionmoderation/early_final.go`
- External transcript + caption fan-out: `backend-go/internal/infrastructure/transcript/` (`hub.go` owns both `rooms`/`providerRooms` for raw transcripts and `captionRooms` for approved captions)
- Provider interface and Thai normalization: `backend-go/internal/domain/domain.go`
- Provider implementations: `backend-go/internal/infrastructure/asr/`
- Caption Desk Gemini proofreader: `backend-go/internal/infrastructure/proofread/`

## Provider behavior

Preserve these provider-specific semantics:

- Google uses Speech-to-Text V2 streaming at 48 kHz, defaults to `chirp_2` in `asia-southeast1`, requests interim results, enables automatic punctuation, and reconnects before the five-minute stream limit. Interim revisions and their final share an application `segmentId`.
- Azure receives 16 kHz PCM after the agent resamples 48 kHz WebRTC audio. The provider uses Azure's upstream WebSocket protocol; this is not a public application WebSocket endpoint.
- Gemini uses `gemini-3.5-live-translate-preview` at 16 kHz. The model requires an audio response modality, but model audio is discarded. Source and configured-target text are exposed and paired with application `turnId` values.
- Gemini requests an application turn boundary after the shared 650 ms low-energy window or a 30-second hard duration, then allows a fixed 500 ms translation grace period. Alignment is best-effort.
- GPT Realtime Translate uses transcription intent at 24 kHz PCM16, publishes source-only Draft/final text, commits after the shared 650 ms silence window or 30-second hard duration, and performs bounded reconnect with up to one second of recent-audio replay. Its internal provider/model identifier in code, routes, and protocol payloads is still the literal string `gpt-realtime-whisper` — only the user-facing display name changed to "GPT Realtime Translate". Do not rename the identifier without updating it everywhere it's allow-listed (frontend `captionDeskMessages.ts`, `providers.ts`; backend `caption_protocol.go`, provider/route validation) in the same change.
- Non-final source text remains replaceable Draft state keyed by provider. Gemini keys source/translation Drafts by provider, `turnId`, and role; final source text becomes a committed row. Caption Desk applies the same replaceable-Draft / committed-final split, but with a stricter rule on top: its Draft is a read-only preview that can never be edited or published (see "Caption Desk contracts").
- Room/provider agents identify themselves in LiveKit as `agent-{provider}-{roomName}`, except Gemini which uses `agent-gemini-3.5-live-{roomName}`. Agent identity is never a bare `agent-{provider}` anymore. Any code matching agent identity (`providerFromAgentIdentity` in `frontend/lib/providers.ts`, `isCaptionAgentIdentity` in `captionDeskMessages.ts`) must match by prefix, not equality.

## Transcript output contracts

- The LiveKit data channel carries validated transcript packets for the in-app Transcript surface. Lines view may include Gemini source/translation pairs.
- Provider-specific external feeds use `/ws/transcript/:provider/:room?token=...` and send lean JSON text frames shaped as `{"text":"...","isFinal":false}`.
- External interim frames replace the client's active Draft. A final frame is appended to committed output and clears that Draft.
- Provider-specific feeds are signed, read-only, source-transcript-only, and have no audio input, commands, ready event, history, or replay.
- Keep provider identity in the URL/token scope; do not combine providers into an unlabelled payload.
- Text originates from upstream provider results. The gateway may accumulate provider deltas into full snapshots and apply deterministic spacing normalization, but must not invent transcript wording.
- The legacy room-wide versioned WebSocket remains a separate compatibility contract. Do not silently change one contract into the other.

## Caption Desk contracts

Caption Desk is a per-`(room, provider, captionPolicy)` review lane. Preserve these invariants — they are encoded as executable specs in `frontend/lib/captionDeskSession.test.ts`, `backend-go/internal/application/captionmoderation/moderator_test.go`, and `backend-go/internal/infrastructure/agent/caption_protocol_test.go`; treat changes to that behavior as a contract change, not a refactor:

- **Topics**: `caption.operator` (agent → operator, LiveKit data channel), `caption.command` (operator → agent), `caption.public` (agent → all viewers, approved output only).
- **Draft vs Final**: a non-final (`caption.draft`) segment only ever populates a replaceable preview; it can never enter the operator's editable text and can never be published. Only final segments (`caption.pending` / `caption.snapshot.pending`, both always `isFinal: true`) enter the editable/publishable buffer. Do not let a draft become publishable.
- **Single owner per lane**: only one `sessionId` (a `crypto.randomUUID()` minted once per Caption Desk hook mount) may hold the review lane for a given room/provider at a time; a competing `sessionId` is rejected with `operator_already_active`. The same `sessionId` may reconnect (e.g. after a network blip) without losing its review buffer within a **10-second grace period** (`defaultCaptionOperatorGrace` in `caption_moderation.go`); after that, the review window closes via `EndReviewWindow()` and the next operator starts at the current caption rather than inheriting backlog.
- **Policy is fixed per session**: `captionPolicy` (`early-final` or `provider-final`, default `provider-final`) is chosen at first subscribe; the same `sessionId` resubscribing with a different policy is rejected with `operator_policy_mismatch`. `early-final` incrementally promotes stable draft prefixes into synthetic finals before the provider itself finalizes (see `early_final.go`); `provider-final` only finalizes on the provider's own final.
- **Per-packet authorization** is via signed LiveKit participant metadata (`role: "caption-operator"`, `provider`, `sessionId`, `captionPolicy`) minted by `HandleCaptionDeskToken`, not the LiveKit identity string. Only the identity currently recorded as the active operator for that metadata may publish.
- **One in-flight publication per source segment**: publishing is rejected client-side and server-side if any of the segments being published are already referenced by an unacknowledged publish request. Publish is idempotent by `RequestID` — replaying an already-processed request returns the cached result instead of re-broadcasting to `caption.public`, which is what makes replay-on-reconnect safe.
- **Caret-based split publish**: an operator may publish a prefix of the buffer up to the caret and keep the remainder editable, bound to the same trailing source segment. Publishing nothing (`splitIndex === 0`) is rejected.
- **Bounds**: publish text ≤ `MAX_CAPTION_TEXT_BYTES = 16_000` UTF-8 bytes (enforced identically in `captionDeskMessages.ts` and `caption_protocol.go` — keep both in sync); at most `MAX_WAITING_CAPTIONS = 64` unacknowledged publishes at once; published history keeps the last `MAX_RECENTLY_PUBLISHED = 10` entries.
- **Enter publishes, Shift+Enter and IME composition do not** (`shouldPublishOnEnter` in `captionDeskMessages.ts`). Keep the editor's keydown handler and this helper in sync.
- **Approved output has two parallel deliveries** of the same text: the `caption.public` LiveKit data topic (requires a `publicationId`; consumed by a dedicated `TranscriptSession` in the viewer, never merged into the raw per-provider transcript session even if a transport omits the topic) and the external read-only `/ws/caption/:room` WebSocket (plain UTF-8 text frames, no JSON/Draft/ready-event/replay/audio/commands, signed with a distinct `caption` purpose). Every approved publication is its own atomic, already-final "segment" — there is no interim state for approved captions.
- Caption Desk provider text (`'caption-desk'` in presentation code) is already human-punctuated/spaced; when concatenating adjacent approved segments, do not apply the raw-ASR Thai/Netflix spacing heuristics used elsewhere.

## Subtitle presentation and playback

Applies to the two-line live-caption window used by Transcript when following either a raw provider or approved Caption Desk output:

- Default reading pace is **17 characters/sec**, adjustable **10–20 cps** (`progressiveRevealRate`, hard floor/ceiling — do not exceed either bound even via a playback-rate multiplier).
- One subtitle "page" targets NBTC's **35-character line budget** (`NBTC_MAX_CAPTION_LINE_CHARACTERS`), giving a two-line, 70-grapheme rolling window. Character counts are **grapheme counts** (`Intl.Segmenter('grapheme')`), not UTF-16 code units — matters for Thai combining marks.
- A cue's on-screen duration is clamped to **2,000–6,800 ms** at normal pace; when a backlog exists, paging switches to a 2× catch-up rate (34 cps, clamped 900–1,800 ms) so the display works through queued text without falling further behind live. Reaching the display buffer never discards queued text and never introduces a deliberate hold.
- A stale subtitle clears after **5,000 ms** of no new text (or the current page duration + 200 ms, whichever is larger).
- With the OS **Reduce Motion** preference enabled, playback reveals whole rolling windows at once instead of animating grapheme-by-grapheme — order and queued content must still be preserved, just without the character-by-character roll.
- Adjacent finalized transcript rows merge into the same display cue only within a **5,000 ms** continuity window and only if the same provider and the previous segment doesn't already end on a strong sentence terminator (Thai text joins with no space; other text joins Netflix-style with a leading space).
- Line splitting prefers natural-language word/punctuation boundaries near the midpoint over a purely greedy character-fit split, to avoid one long line paired with one short line.

## Backend conventions

- Keep provider-independent contracts in `internal/domain`. Keep ASR provider details in `internal/infrastructure/asr` and non-ASR proofreading provider details in `internal/infrastructure/proofread`.
- Keep caption review/moderation domain logic (pending queue, draft/final transitions, publish idempotency, early-final promotion) in `internal/application/captionmoderation`; keep LiveKit data-channel transport, ownership/grace-period bookkeeping, and per-packet authorization in `internal/infrastructure/agent/caption_moderation.go` and `caption_protocol.go`. Don't let transport concerns leak into the moderator or vice versa.
- Keep HTTP parsing/status handling in `internal/delivery/handler` and route registration in `internal/delivery/routes.go`.
- Pass `context.Context` through network and long-running operations.
- Provider `Stop` methods must be idempotent. Close result channels exactly once and avoid sending after closure. The same idempotency requirement applies to `Moderator.Publish` (safe to replay by `RequestID`) and to ending/starting a Caption Desk review window.
- Guard shared agent/provider lifecycle state with the existing mutex patterns. Caption operator ownership, draft coalescing, and grace-period timers are additional shared state on the same agent and must use the same guarded pattern.
- Normal audio-track/provider closure must release the track-scoped provider while keeping the room agent connected. Unexpected provider errors stop the agent. Keep stale providers from stopping or clearing a replacement provider.
- Normalize spacing at the agent output boundary with `domain.NormalizeProviderTranscriptSpacing`. Only Google Thai removes spaces between adjacent Thai characters; do not add browser-side spacing transformations that destroy interim behavior.
- Track-read (RTP) errors from an expected closure (`io.EOF`, closed-network) should log at info level, not error level — this is a logging-severity distinction only and does not imply any new retry/backoff behavior; don't read reconnect semantics into it.
- Never log credentials, tokens, API keys, service-account contents, or complete `.env` values.
- The LiveKit agent uses `hraban/opus` and requires CGO plus a system Opus library.

## Frontend conventions

- Keep Audio Source, Transcript, Caption Desk, and Control Room experiences visually and behaviorally consistent.
- Keep user-facing product names aligned with the CaptionLive vocabulary above. Internal route/component names may remain `admin`, `stream`, `viewer`, and `caption-desk`.
- Reuse `frontend/public/captionlive-mark.svg`, `captionlive-logo.svg`, and `favicon.svg`; do not replace them with unrelated page icons in the primary header.
- Preserve the Slate + Teal visual system. Use shared semantic tokens in `frontend/index.css`; reserve teal for brand/action/selection, emerald for success, amber for warning, red for danger, and provider colors for provider identity.
- Keep primary headers aligned through `--app-header-row-height`, `--app-header-height`, and `.app-header__content` rather than page-specific fixed heights.
- Use `parseTranscriptMessage` for data-channel payload validation.
- Keep committed transcripts bounded; do not allow unbounded state growth. The same bound applies to Caption Desk's `waiting`/`recentlyPublished` queues and the subtitle playback store's rolling-window retention.
- Preserve independent interim entries by provider and, for Gemini, `turnId` plus role.
- Avoid provider-specific capture hooks. Microphone and Chrome Tab publishing belong to `useLiveKit`; Chrome Tab capture helpers belong to `frontend/lib/audioSources.ts`.
- Keep selected-audio and session state explicit: room joined, audio source on/off/stopped, and transcription agent connected.
- Lines view may show paired Gemini translation. Text view must remain source-only and may mark active source Draft inline; per-provider `.txt` export must contain finalized source text only.
- `useRoomViewer` keeps two independent `TranscriptSession` instances (raw per-provider and approved public-caption); keep them separate rather than merging state, and only ingest into whichever the viewer currently has active to avoid wasted work.
- Viewer token acquisition tries the subscribe-only `/livekit/viewer-token` endpoint first and falls back to the legacy `/livekit/token` only on the specific fallback conditions in `frontend/lib/viewerToken.ts` (404 with a non-`room_not_found` or non-JSON body); a genuine "room doesn't exist" response must still surface as an error, not silently retry.
- Use the shared top-right Toast viewport for transient operation feedback; keep persistent session state and inline validation in context.
- Do not hide operational state using color alone; retain text/icon status and keyboard accessibility.
- Prefer existing components, Tailwind patterns, and dependencies. Do not add a visualization library unless the existing canvas implementation cannot satisfy the requirement.

## Configuration and secrets

- Copy examples; never edit or commit real `.env` files or credential JSON.
- Backend config source: `backend-go/config/config.go` and `backend-go/.env.example`.
- Frontend build-time variables: `frontend/.env.example`.
- Local LiveKit credentials: `livekit/.env.example`; development defaults are not production-safe.
- `livekit/docker-compose-prod.yml` and `livekit-prod.yaml` are production-hardened deployment variants (dedicated networks, health checks); they are not used by local dev (`docker-compose up -d` uses the non-`-prod` compose file) and don't change the commands below.
- `VITE_BACKEND_URL` is an HTTP base URL. `VITE_LIVEKIT_URL` and `LIVEKIT_WS_URL` are WebSocket URLs.

## Development commands

```bash
# Start local LiveKit first
cd livekit && docker compose up -d

# Start backend and frontend in separate terminals
./start_backend.sh
./start_frontend.sh

# Frontend
cd frontend
pnpm install
pnpm test
pnpm build

# Backend
cd backend-go
go mod download
go test ./...
go test -race ./...
go build ./...
```

Use `pnpm` for frontend dependency operations. Keep `pnpm-lock.yaml` authoritative.

## Verification expectations

- Frontend-only logic/UI change: run `pnpm test` and `pnpm build` in `frontend/`.
- Backend change: run `go test ./...` in `backend-go/`; use `go test -race ./...` for lifecycle, channel, mutex, or agent changes — this includes Caption Desk ownership/grace-period/draft-coalescing changes in `internal/infrastructure/agent`.
- Provider parsing change: add or update focused tests under `backend-go/internal/infrastructure/asr/` or `backend-go/internal/infrastructure/proofread/`, according to the provider boundary being changed.
- Caption moderation/review-window change: add or update tests under `backend-go/internal/application/captionmoderation/` and `backend-go/internal/infrastructure/agent/caption_protocol_test.go`.
- Transcript or Caption Desk state change: update tests under `frontend/lib/*.test.ts` (in particular `captionDeskSession.test.ts`, `captionDeskMessages.test.ts`, `subtitlePaging.test.ts`, `progressiveText.test.ts`, `captionDeskPlaybackStore.test.ts` — these encode the contracts above).
- Documentation/config change: verify referenced files and commands exist, search for stale architecture terms, and run the narrowest affected build/test.

## Documentation rules

- Keep `README.md`, `frontend/README.md`, `backend-go/README.md`, `livekit/README.md`, examples, and technical docs consistent with implementation. `backend-go/README.md#http-api` already documents the full HTTP/WebSocket contract including Caption Desk endpoints in detail — extend it rather than duplicating its content elsewhere.
- Keep the root `README.md` focused on the product mental model, end-to-end flow, essential setup, and documentation map. Put provider/API/configuration depth in the owning subproject document.
- Use CaptionLive surface names in user-facing documentation, while retaining internal route or code names where they help developers find implementation.
- Treat `backend-go/docs/EDITOR_MODE_DESIGN.md` as a design proposal, not implemented behavior.
- Document upstream provider protocols separately from public application APIs.
- Do not claim latency or recognition quality as guaranteed; describe values as operational expectations when needed.

## Git and generated files

- Preserve unrelated user changes in the dirty worktree.
- Do not stage, commit, reset, clean, or push unless explicitly requested.
- Do not commit `frontend/dist/`, `frontend/node_modules/`, backend binaries, `.env` files, logs, or credentials.
- Use `gofmt` for Go edits. Keep TypeScript compatible with the existing Vite/TypeScript configuration.
