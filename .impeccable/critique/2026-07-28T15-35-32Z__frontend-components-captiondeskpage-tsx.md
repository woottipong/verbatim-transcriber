---
target: ui editor
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-07-28T15-35-32Z
slug: frontend-components-captiondeskpage-tsx
---
# Caption Desk UI Critique

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Terminal failure still appears as “Connecting”; queued finals are invisible |
| 2 | Match System / Real World | 3 | Operational language is mostly clear, but “sources” and “Reset” are ambiguous |
| 3 | User Control and Freedom | 2 | Reset can discard corrections; released text has no short undo path |
| 4 | Consistency and Standards | 3 | Controls are cohesive, but header and error banner can contradict each other |
| 5 | Error Prevention | 2 | Caption size is validated only after Publish and Reset is insufficiently explicit |
| 6 | Recognition Rather Than Recall | 3 | Context and shortcuts are visible, but queued work and latest release are not |
| 7 | Flexibility and Efficiency | 3 | Enter and Shift+Enter are efficient; queue navigation and undo are missing |
| 8 | Aesthetic and Minimalist Design | 3 | Focused and quiet, but the wide editor has weak operational density |
| 9 | Error Recovery | 3 | Reconnect preserves edits, though conflicting statuses weaken confidence |
| 10 | Help and Documentation | 2 | Primary shortcut is clear; reset, queue, limits, and recovery rules are not |
| **Total** | | **26/40** | **Acceptable foundation with important confidence gaps** |

## Design Specificity Verdict

The workflow feels authored for live caption moderation: one dominant writing surface, finalized text accumulating into a review buffer, a separate incoming Draft lane, explicit room/provider context, and an Enter-first release model. The visual treatment is less specific. It remains a conventional dark operations panel with generic status pairs, bordered containers, textarea, and footer actions. The interaction model belongs to CaptionLive; its feedback and visual language do not yet fully communicate the tempo and certainty expected from a professional caption desk.

The deterministic detector returned zero findings for `frontend/components/CaptionDeskPage.tsx`. That confirms the component avoids the detector’s known mechanical anti-patterns, but it does not invalidate the workflow issues found through live inspection and source review. The detector did not catch the contradictory terminal status, invisible queued-final backlog, stale release confirmation, or ambiguous Reset semantics.

No reliable user-visible overlay was available because the browser evaluation surface was read-only. Live browser evidence was gathered from a fresh tab at 1680×824. The page had no horizontal overflow, the editor was focused, landmarks and alert semantics were present, and no console errors occurred.

## Overall Impression

The Caption Desk is impressively restrained and puts the transcript first. Its biggest opportunity is operational confidence: the operator must always know whether the desk is truly connected, how far behind they are, and whether the most recent Enter was safely released.

## What’s Working

- The transcript is the clear primary visual anchor. Controls recede and the work surface receives nearly all meaningful space.
- Enter to Publish, Shift+Enter for a new line, and autofocus create a fast expert workflow with little pointer dependency.
- Reconnect is inline and preserves human edits instead of forcing the operator to leave the task.
- Accessibility foundations are sound: semantic banner/main regions, an alert role, heading structure, an accessible textarea name, text alongside status color, and no observed horizontal overflow.

## Priority Issues

### [P1] Finalized backlog is hidden while the operator edits

Incoming finalized segments are queued internally while edited text is active, but the page does not expose the queued count or oldest age. In live moderation, “How far behind am I?” is a primary operational signal. Hidden work makes an operator appear caught up when they are not.

Expose a compact `Next 3 · 8s behind` indicator near the review metadata. A single muted preview line can be shown below the editor if it does not distract from active correction.

Suggested command: `$impeccable harden`

### [P1] Header status contradicts terminal failure

Every non-connected state is currently presented as `Connecting`. Live inspection showed `Connecting` beside `The provider is not running in moderated mode for this room`. This makes a terminal condition look like an active retry.

Map connection states explicitly: Connecting, Connected, Reconnecting, Disconnected, and Failed. For missing rooms or providers, make `Room unavailable` or `Moderated provider unavailable` the primary state and subordinate the Agent status.

Suggested command: `$impeccable clarify`

### [P1] Publish confirmation is stale and non-specific

`Published` remains visible whenever publication history is non-empty. It therefore stops confirming the operator’s latest Enter and becomes historical decoration.

Tie feedback to the latest acknowledgement: `Published just now`, then `Published 4s ago`, followed by a quiet last-published timestamp or count. Announce that exact event through the live region.

Suggested command: `$impeccable harden`

### [P2] Reset is ambiguous and can discard careful corrections

`Reset` silently restores provider text. The label could also mean clear the desk, undo a keystroke, reload the room, or reset the session.

Rename it to `Discard edits` or `Restore transcript`, disable it when the text is unchanged, and offer a short Undo after activation rather than interrupting the speed workflow with a confirmation modal.

Suggested command: `$impeccable clarify`

### [P2] Focus and caption-size protection need strengthening

The textarea removes the browser outline without a guaranteed replacement focus treatment. The UTF-8 size limit is surfaced only after the operator tries to publish.

Give the editor region a clear `focus-within` boundary and show a quiet remaining-size warning only near the limit. Keep the normal state free of character-count noise.

Suggested command: `$impeccable audit`

## Persona Red Flags

**Alex, power operator:** Enter publishing is strong, but Alex cannot see finalized material accumulating during a long correction. There is no precise acknowledgement of the latest release and no fast recovery after restoring provider text.

**Sam, keyboard and low-vision operator:** Native controls and labels work well, but the textarea’s removed outline weakens focus visibility. The persistent Published live-region message is too vague to identify which release completed.

**Riley, stress tester:** A long caption fails only at publish time. Reset can overwrite corrections without recovery. A missing moderated provider can simultaneously show Connecting and a terminal error. Multiple finals can accumulate without any visible backlog.

## Minor Observations

- At 1680×824, the textarea is 1414px wide with 30px text. A controlled reading measure inside the full work surface would improve Thai scanning accuracy.
- `0 sources` sounds implementation-oriented. `No captions ready`, `1 segment ready`, or `3 segments ready` better matches the task.
- Reusing the established CaptionLive mark would strengthen identity more than the current text-only brand treatment.
- The missing-context state explains the required URL parameters but offers no direct route back to Control Room.
- The incoming Draft lane needs a clear label or compact “coming next” treatment so it cannot be confused with publishable text.

## Questions to Consider

- What if the primary metric were `ready now / queued next / seconds behind`, rather than source count?
- Should Published confirm only the latest acknowledgement, or should this surface include a compact release history?
- Is a five-second Undo after an accidental release worth the extra protocol complexity?
- Should interim Draft stay visible during correction, or collapse to one muted “coming next” line?
