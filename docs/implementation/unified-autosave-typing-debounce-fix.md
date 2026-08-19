# Unified autosave typing debounce fix

## Root cause

`projectLifecycleAuthority.scheduleAutosave()` returned immediately when an
autosave timer already existed. The first authored transaction therefore
anchored the deadline, while later transactions in the same typing burst did
not move it. The 900 ms Document schedule was acting as a leading-edge
throttle instead of a trailing-edge debounce.

The previous authority test was a false positive: three `projectChange()` calls
were made in the same fake-timer tick and the test then advanced directly to
the deadline. Both a first-change throttle and a latest-change debounce pass
that scenario.

## Final scheduling algorithm

For an eligible dirty session, every committed authored transaction now:

1. clears the existing pending timeout, if any;
2. installs a new full adapter-delay timeout;
3. leaves `pendingAutosave` logically true while the timeout is replaced.

The first change still transitions `pendingAutosave` from false to true. Later
changes only advance `authoredRevision` and replace the timer; they do not emit
an intermediate false state or create extra lifecycle renders.

The timer is not scheduled while a save for the current session is in flight.
When that save completes successfully with newer edits present, a new trailing
edge is scheduled from completion. The save uses the revision captured when it
started, so completion can never mark newer revisions clean.

## Cadence and renderer integration

Document autosave remains 900 ms. Canvas continues to use its existing 2,000
ms adapter delay, with the same trailing-edge behavior.

The legacy Document store intentionally refuses its old timer-driven
`flushAutosave()` path while shared lifecycle mode is active. The unified
Document adapter now calls it with an explicit shared-authority option. The
legacy timer remains disabled; only the unified authority can use this explicit
flush path. A store regression verifies that the default legacy guard remains
intact and the shared path persists successfully.

## Manual saves and failures

Manual Save still cancels the pending autosave and writes the current revision
immediately. Edits made during that write remain dirty and receive a follow-up
trailing-edge schedule after the older save completes.

A failed autosave leaves the session dirty and in the existing error state. It
does not retry automatically. A subsequent authored transaction starts one
new debounce window; it does not trigger a save per keystroke.

## Browser evidence

The shared header exposes runtime diagnostic attributes for the active session:
authored revision and autosave invocation count. The Document Chromium tests
observe save-status mutations as well as those counters.

The body regression types 54 characters individually with 60 ms intervals,
crossing the original 900 ms first-keystroke deadline. The title regression
types 29 characters using the same interaction. In both cases:

- authored revisions continue advancing throughout typing;
- autosave invocations during the continuous burst: 0;
- no `saving` state occurs during the burst;
- autosave invocations after the final 900 ms idle window: exactly 1;
- the typed text remains exact and the editor remains usable.

The fake-timer authority coverage separately proves a 20-change burst at 50 ms
intervals produces zero saves during the burst and one save exactly 100 ms
after the final change. It also proves the Canvas 2,000 ms cadence, in-flight
revision handoff, manual-save behavior, and post-failure rescheduling.

## Validation

Passed during implementation:

- focused authority suite: 13 tests;
- Document store suite, including shared-authority persistence: 25 tests;
- realistic body/title Document Chromium typing suite: 2 tests;
- TypeScript checking;
- ESLint with zero warnings;
- whitespace validation.

The complete project validation is recorded with the commit and includes the
full Vitest (58 files, 617 tests), coverage, production build, recovery, Rust
tests, Tauri Debian bundle, and the full Chromium run. Coverage is 61.64%
statements, 52.81% branches, 60.91% functions, and 63.69% lines. The full
Chromium run passed 75 of 76 tests; the one remaining failure is the
pre-existing `historical-page-49.png` snapshot size mismatch (checked-in
632×816 versus runtime 618×798). All Document-specific interaction tests,
including body/title typing and empty-title geometry, passed. No visual
snapshots were changed.

## Empty title layout fix

An empty title previously rendered the same flex-flow region as an authored
title. The empty Tiptap paragraph contributed its `min-height: 1.25em`, and
the region retained its 14 px bottom margin. At the 36 px default title size
that is approximately 59 CSS px of authored page tax (31.2 fitted viewport px
in the browser regression). This pushed the body origin and flow composition
down on pages that intentionally had no page-level title.

The live editor now keeps the empty title editor in an absolutely positioned,
editor-only region. Its `Add a title` button is a real accessible button,
excluded from export, and focuses the title editor without adding flow height.
The first authored character changes the state to a normal title region, so
the natural title height and 14 px spacing are introduced intentionally.
Deleting the final title character returns the region to the zero-flow state
without requiring a reload. Suppressed empty titles retain the existing
semantics: there is no region and no affordance; authored title content still
renders if it exists.

Page-positioned structured photos are authored from the page-content origin,
not the transient body-editor origin. When a real title changes the body
origin, the compositor subtracts that measured title offset for fixed frames,
adds it back on drag/nudge commits, and leaves flow text relative to the new
body origin. This keeps fixed photo page coordinates stable while allowing
flow layout to move with an authored title. The reconstruction regression
measured the body origin before/after title creation and deletion, verified
the fixed photo frame did not move, switched pages, saved, reopened, and
verified the frame remained at the same page coordinates.

The persisted `body-span` coordinate space remains compatible with existing
historical projects and is not reinterpreted during passive rendering. A real
drag or an explicit change to Fixed position promotes the image to the new
`page` coordinate space, converting its current body-relative Y to the
equivalent page-content Y so the frame does not jump. This keeps old fixture
geometry stable while giving newly authored page-positioned photos the
page-space invariant required by reconstruction work.

Export surfaces omit the empty title region entirely. No Add a title control,
empty editor paragraph, or title margin is exported; authored titles continue
to render once with their existing typography and spacing.

Additional title validation:

- Vitest covers the editor affordance/focus path, authored-to-empty deletion,
  suppressed empty titles, committed export surfaces, and fixed-coordinate
  layout-model anchoring.
- Chromium measures `bodyTop - pageContentTop` against the computed top
  content padding, verifies the empty title has no trailing margin, verifies
  the real title adds natural flow height, and verifies deletion collapses it.
- Chromium verifies fixed photo geometry through title changes, page switching,
  save/reopen, and the existing reference/photo reconstruction workflow.

## Remaining limitations

- The browser diagnostic counters are runtime observability attributes, not a
  persistent telemetry system.
- Save completion timing is dependent on the persistence adapter; the
  deterministic debounce guarantee applies to when the save is invoked, while
  revision watermark handling covers completion races.
- No separate autosave cadence was introduced for title content; title and body
  use the same shared Document lifecycle authority.
- The empty-title affordance is editor-only; pages with `suppressTitle` enabled
  intentionally do not show it. A fixed photo placed above a newly authored
  title remains at its page coordinate and may visually overlap the title by
  design.
- The checked-in historical page-49 Chromium crop still has a pre-existing
  632×816 versus 618×798 runtime-size mismatch; that unrelated snapshot was
  intentionally not updated.
