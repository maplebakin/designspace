# Unified editor Phase 1E

## Scope and architecture

Phase 1E adds an opt-in, runtime-only `ProjectChangeDiagnosticView` in
`src/editor/session/projectChangeDiagnostic.ts`. Its internal observer
subscribes once to terminal `ProjectChangeCoordinator` transactions and
publishes a bounded snapshot. `ProjectSessionCommands.changeDiagnostic`
exposes only the read-only `getSnapshot`/`subscribe` view. No normal product UI
was added.

`UnifiedEditorSession` creates the observer only when
`enableChangeDiagnostics` is true, feeds it the normalized
`ProjectSessionSnapshot` lifecycle state, and disposes it with the session.
The observer imports only shared session/coordinator contracts; it does not
import Fabric, Tiptap, ProseMirror, either engine store, or persistence code.

## Diagnostic revision and outcome semantics

`observedRevision` starts at zero for each project/session identity. A
committed authored transaction increments it exactly once. Rejected and failed
transactions update their separate counters and `lastOutcome`, but never
increment the revision. `lastCommittedTransaction`, bounded changed page IDs,
and bounded changed domains provide summary state without retaining a session
transaction log.

Selection/page navigation, zoom, focus, hover, guides, previews, hydration,
save lifecycle, and recovery do not create diagnostic revisions. The model
does not reuse Canvas `changeRevision` or Document `revision`: those are
engine-local dirty/save concurrency tokens. The diagnostic revision is not a
schema revision, persistence revision, history depth, or canonical project
revision.

## Clean baseline and legacy comparison

The view observes `projectId`, legacy `isDirty`, and normalized `saveStatus`
through `ProjectSessionSnapshot`. An initial clean/saved checkpoint establishes
baseline revision zero. A later clean baseline advances only after a previously
observed dirty state or saving-to-saved transition; the observer never clears
legacy dirty state itself. `changesSinceLegacyClean` is diagnostic bookkeeping
only.

Comparison states are `consistent-clean`, `consistent-observed-dirty`,
`legacy-dirty-with-unobserved-change`, `observed-change-while-legacy-clean`,
`save-in-progress`, `insufficient-coverage`, and `unknown`. Legacy dirty with
no observed transaction is classified as a possible coverage gap, not repaired
or treated as a hard error. The static coverage model reports trusted page
structure, Canvas geometry, and committed Document overlay geometry while
marking complete authored coverage false.

## Trusted boundaries and known gaps

The observer consumes the Phase 1D stream from:

- normalized page mutations (`add`, `duplicate`, `remove`, and `reorder`;
  selection remains navigation and Canvas duplicate remains rejected);
- Canvas `object:modified` after existing dirty/history/update work and outside
  the hydration guard; and
- successful Document overlay pointer-up/store-commit geometry.

Unobserved authored categories include Tiptap/Fabric text, object add/remove,
styles, grouping, captions, image groups, references, page settings, flow,
inspector changes, assets, drawing, and erase. Document `selectPage` is a
known mismatch: its legacy store currently marks the active page preference
dirty and increments its internal revision, while the Phase 1D stream excludes
selection by design. Document keyboard nudge and inspector overlay commits are
also outside the single callback boundary. These are evidence gaps, not
authority for a new dirty system. A programmatic Fabric `object:modified`
event remains indistinguishable from a user gesture, as documented in Phase
1D.

## Hydration, save/reopen, and recovery

Project identity changes reset the diagnostic runtime state; stale transactions
for the previous project are ignored. Canvas hydration remains silent through
the existing `isCanvasHydrating` guard, and Document hydration/opening only
updates the normalized lifecycle snapshot. Reopening therefore starts at a
new diagnostic baseline and does not replay historical edits.

Existing save and reopen behavior remains authoritative and was exercised by
the unchanged Document store round-trip/autosave tests and the browser
reconstruction persistence flows. Diagnostic tests cover dirty/save checkpoints
and reset semantics, but the diagnostic state is never serialized, passed to a
save writer, or restored from a project. Recovery remains unchanged; Python
and Rust recovery suites passed without diagnostic writes or hydration events.

The session cleanup now defers coordinator/observer disposal by one microtask
with a lifecycle generation guard. This preserves the live runtime through
React StrictMode’s cleanup/setup probe while still disposing on a real
unmount. The StrictMode test proves one committed transaction produces one
diagnostic revision.

## Tests and validation

Added `__tests__/unified-editor-phase-1e.test.ts` with coverage for committed
revision increments, rejected/failed counts, both geometry sources, changed
page/domain summaries, clean baselines, save-in-progress, coverage-gap
classification, project switching, stale transaction isolation, hydration
silence, and listener failure isolation. Extended
`unified-editor-session.test.ts` for opt-in StrictMode lifecycle behavior.

Validation completed:

- focused Phase 1E/session tests: 2 files, 10 passed;
- `npm test`: 45 files, 462 tests passed;
- `npx tsc --noEmit`, `npm run lint`, and `npm run build`: passed;
- Canvas, Product Studio, and Document reconstruction E2E: 38 passed;
- `npm run test:recovery`: 3 passed;
- `cargo test --manifest-path src-tauri/Cargo.toml`: 20 passed.

Build/E2E output retains the existing Browserslist freshness warning only.

## Authority, rollback, and next slice

The observer never calls dirty, save, autosave, history, recovery, asset, or
export operations. It does not alter schemas, IndexedDB, project files,
selection, coordinates, or engine behavior. Deleting the observer, its
optional command property, and the opt-in session prop leaves the legacy
mutation/save paths intact. The focused rollback is to revert the Phase 1E
commit; no migration or data repair is required.

Evidence does not yet support shared dirty/change ownership: the stream is
intentionally incomplete and the Document page-selection mismatch needs a
product/contract decision. It does support a next shadow-only slice:
**Phase 1F should define explicit lifecycle checkpoints and close one coverage
gap at a time, starting with Document page-selection dirty semantics and a
committed text/page-metadata boundary, then Canvas add/remove.** Save/reopen,
recovery, history, autosave, and export must remain legacy-owned until those
observations are covered by round-trip tests.
