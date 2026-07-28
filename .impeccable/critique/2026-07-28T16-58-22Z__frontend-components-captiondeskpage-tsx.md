---
target: "Caption Desk UI: Published width and interim legibility"
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
timestamp: 2026-07-28T16-58-22Z
slug: frontend-components-captiondeskpage-tsx
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Interim lacks a visible state label. |
| 2 | Match System / Real World | 3 | Cursor-to-publish matches fast caption work. |
| 3 | User Control and Freedom | 2 | Published captions have no correction affordance. |
| 4 | Consistency and Standards | 3 | Panels are consistent but overly equal in emphasis. |
| 5 | Error Prevention | 3 | Split publishing is guarded, but released text cannot be corrected. |
| 6 | Recognition Rather Than Recall | 3 | Interim meaning must currently be inferred. |
| 7 | Flexibility and Efficiency | 4 | Cursor plus Enter is an excellent expert workflow. |
| 8 | Aesthetic and Minimalist Design | 3 | Published repeats status and consumes too much space. |
| 9 | Error Recovery | 3 | Sending failures recover; post-publication correction does not. |
| 10 | Help and Documentation | 2 | Keyboard behavior is explained, interim state is not. |
| **Total** | | **29/40** | **Good, with hierarchy issues** |

## Design Specificity Verdict

The cursor-based partial-release interaction feels authored for a real-time caption desk. The surrounding composition remains more generic: Published history and interim presentation do not yet express their operational priority clearly.

The deterministic detector returned zero findings. Browser measurements found Published at 417px and Review at 983px in a 1400px content grid: 29.8% versus 70.2%. The interim lane measured 56px tall with 16px subtle text, transparent background, and no label.

## Overall Impression

The editor is correctly dominant, but not dominant enough. Published is useful verification history but visually behaves like a second workspace. Interim is too quiet to scan during live operation.

## What's Working

- Cursor plus Enter makes partial caption release fast and pointer-free.
- Large Thai review text is comfortable to scan.
- Segment, waiting time, queue, and sending metadata provide useful operational context without cards.

## Priority Issues

1. **[P1] Interim is unlabeled and too subtle.** It resembles disabled helper text. Add a persistent `Live draft` label, a restrained teal marker, brighter 18–20px Thai text, and a compact bounded two-line lane.
2. **[P2] Published consumes too much working width.** Bound it to roughly 320–360px or 22–25% of the grid, leaving Review flexible.
3. **[P2] Published rows repeat low-value status UI.** Keep status only for Sending or Failed; successful rows need timestamp and caption text. Reduce padding and row height.
4. **[P2] Both panels carry equal visual weight.** Quiet the history rail through a lower-contrast surface and denser typography while keeping Review primary.
5. **[P2] Published captions have no correction path.** If correction is supported later, prefer a short-lived undo-last action over confirmation dialogs.

## Persona Red Flags

- **Expert operator:** The wide Published rail and repeated success labels reduce editor space and slow verification scanning.
- **Low-vision keyboard operator:** Interim has low emphasis and no state label; the textarea also needs a visible focus-within treatment on its container.
- **Operator under pressure:** An accidental publication has no correction path.

## Minor Observations

- Render `55s behind` rather than `waiting 55s` when delay is the operational concern.
- A compact history rail should remain scrollable and bounded rather than collapsible by default.
- Keep the current 16px panel gap and aligned panel tops.

## Questions to Consider

- Should Published function as a compact verification log rather than a second content panel?
- Should interim be readable peripherally without competing with editable final text?
- Is post-publication correction intentionally outside the first release?
