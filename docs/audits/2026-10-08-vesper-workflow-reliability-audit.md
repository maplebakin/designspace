# Design Space: workflow reliability audit

**Date:** 2026-10-08  
**Baseline:** `main` at `3091c9d671e53cfa5496f869929f228ac82cee08`  
**Purpose:** Explain why the application can look polished and pass its checks while still feeling inconsistent during real editing.

## Executive assessment

Design Space is **not** a toy or an empty shell. Its current implementation has two substantial editor engines, local project storage, versioned project formats, revision-aware persistence, history, image assets, file delivery, recovery, and extensive test coverage. The October 8 stabilization commit explicitly addressed many prior audited structural defects. **Do not use September audits as a list of currently open bugs without re-verification.**

The recurring structural risk is **cross-boundary correctness**: the visible editor, its mode-specific store, the shared project lifecycle, local persistence, and download/export confirmation are distinct systems. Intermittent defects arise when the handoff between any two is incomplete, asynchronous, or understood differently by the interface.

This is a source-and-CI audit, **not** a claim that every finding has been reproduced in a running browser. Runtime reproduction status is stated per item.

## Architecture traced

1. `src/main.tsx` and `startupStorageRecovery.ts` initialize storage/migration before mounting.
2. `src/App.tsx` routes the dashboard to `UnifiedEditorSession`.
3. `ProjectDashboard.tsx` inspects files and library records before selecting Canvas or Document mode.
4. `UnifiedEditorSession.tsx` mounts shared chrome, the selected legacy renderer, the change coordinator, and shared lifecycle authority.
5. Canvas mode uses Fabric.js and `editorStore.ts`, `CanvasStage.tsx`, history, scene snapshots, and layer reconciliation.
6. Document mode uses Tiptap/ProseMirror, `documentStore.ts`, `DocumentEditorShell.tsx`, composition/layout geometry, and its own history.
7. `projectLifecycleAuthority.ts` tracks authored vs persisted revision, autosave scheduling, and save acknowledgement; adapters bridge the engines.
8. The project library uses IndexedDB/Dexie. Portable project downloads are distinct from a browser-verified durable save; Tauri adds native delivery.

## Findings ranked by user impact

### R01 — Download from the unsaved-navigation dialog feels unresponsive
**Severity: High usability; confidence: confirmed by code; runtime: not reproduced in this session.**

`UnifiedEditorChrome.tsx` has a "Download Project File" button inside the unsaved-changes leave dialog. It calls `commands.download()` and only returns to Projects if `acknowledgementAllowsDirtyClear` is true. But `persistenceAcknowledgement.ts` deliberately gives browser downloads the `browser-download-initiated` status and `canClearDirty: false`, because browser link activation cannot certify a durable file. Thus, the browser download initiates while the dialog stays open with no explanation. This looks broken even though its safety policy is correct.

**Proposed resolution in this PR:** Show explicit verification guidance and keep the editing session intact. Require the user to inspect the download and explicitly choose to leave/discard unsaved session state. Added a Playwright regression; not included in CI until the E2E gate is enabled.

### R02 — A Canvas file-open readiness failure leaves the user on the editor route
**Severity: High usability; confidence: confirmed branch behavior; runtime: requires injected timeout reproduction.**

In `ProjectDashboard.tsx`, `openProjectInEditor` calls `onProjectOpen` **before** waiting up to five seconds for the Fabric canvas. If readiness fails it only shows "Editor is still initializing. Please try again." and returns. The dashboard is already unmounted, leaving the route in an editor that did not load the requested project. A subsequent `loadAction` failure likewise occurs after route transition and does not roll back automatically.

**Reproduction test:** Delay/suppress Fabric ready beyond five seconds; open a saved canvas project from dashboard; assert that dashboard controls remain available or the editor offers an actionable retry without losing the selection. For load errors, inject a rejected project hydration and verify navigation rollback/error visibility.

**Fix strategy:** Add an explicit opening state and error state at the routing boundary; support recovery/retry or a clean dashboard rollback rather than changing the route and hoping readiness succeeds.

### R03 — Unsaved navigation guard contains a future unsafe conditional
**Severity: Medium preventive safety; confidence: confirmed source branch, not an observed current data-loss event.**

`UnifiedEditorChrome.tsx` previously showed the unsaved dialog only when `readDirty() && session?.canClose !== false`. If any future lifecycle implementation returns `canClose:false` while dirty, that condition instead falls through to navigation. The current `projectLifecycleAuthority.ts` sets `canClose:true`, so the dangerous case is **not currently reachable through that authority**. It is still a fragile inversion at a safety boundary.

**Resolution in this PR:** Prompt whenever the active session is dirty, regardless of `canClose`.

### R04 — Critical user journeys are outside required CI
**Severity: High reliability process; confidence: confirmed.**

The repo currently contains a substantial Playwright E2E suite, including durable storage/selection, recovery, export, undo, text editing, and two editor engines. However, `.github/workflows/ci.yml` runs `npm ci`, lint, Vitest, coverage, and build on Node 20 and 22. It does **not** run `npm run test:e2e`, browser install, `npm run test:recovery`, or Tauri/Rust checks. Green CI is a strong unit/build signal, **not** proof of interactive workflow success.

**Next step:** Add a separate required, budgeted Chromium smoke gate for P0 user journeys, starting with create → edit → save → close → reopen, plus selection-preserving export. Keep the full E2E suite as a broader scheduled/manual job if runtime cost is high.

### R05 — Dashboard language has not caught up to dual editor modes
**Severity: Low/Medium UX; confidence: confirmed by code.**

`ProjectDashboard.tsx` opens both Canvas and Document projects using inspection, but labels the collection "Recent Product Projects" and every project card "Open editable product project". The action to load an external file says "Open Product Project". A document workflow is therefore routed correctly by code but advertised incorrectly in the UI.

**Next step:** Derive labels from the normalized project mode; use "Recent Projects" for the collection and distinguish canvas/document cards and file imports.

### R06 — Several extremely large components concentrate cross-feature coupling
**Severity: Medium maintainability/defect risk; confidence: structural metric; not evidence of a specific runtime bug.**

At audit baseline, `editorStore.ts` is ~5,493 lines; `DocumentEditorShell.tsx` ~4,639; `CanvasStage.tsx` ~1,157; `EditorShell.tsx` ~1,413. The large document component spans live drafts, editor focus/selection, image placement, structured typography, geometry, history, and export triggers. A local change can easily disturb adjacent ownership contracts even when the TypeScript types remain valid.

**Next step:** Refactor by event/ownership boundary only after adding characterization tests, not by arbitrary file size. Prioritize live draft commits, save/close, page navigation, and geometry.

### R07 — Local-first storage and asset lifetime need clearer product explanations
**Severity: Medium UX/data expectations; confidence: verified design contract.**

README and `docs/architecture/state-boundary-contracts.md` explicitly state that the browser library lives in local IndexedDB with no account or server synchronization; upload-session stickers and Vision Board blobs are not necessarily recoverable portable assets. The new snapshot rules reject unresolved blob URLs in durable project saves.

**Next step:** Make "Saved to this browser" vs "Portable file downloaded" vs "Session-only asset" explicit at action points. Provide a basic backup affordance and make restore behavior discoverable. Do not silently label an initiated browser download as `Saved`.

### R08 — Native desktop and browser behavior are not equivalent or fully accepted
**Severity: Medium release risk; confidence: documented gap.**

`docs/architecture/state-boundary-contracts.md` expressly does not guarantee native WebKitGTK/Tauri rendering, native save-dialog cancel/failure, or atomic replacement behavior. Browser Playwright is not a native acceptance substitute.

**Next step:** Establish a smoke checklist on the real target OS: create/open, canvas selection, image imports, save/cancel/failure, page switch, export, native close, and reopening after restart.

### R09 — Recovery is defensive but can feel like an application failure
**Severity: Medium support/UX risk; confidence: confirmed branch behavior, not evidence of actual corruption.**

`startupStorageRecovery.ts` quarantines malformed or oversized localStorage JSON. It also blocks IndexedDB access if estimated origin use exceeds 1 GiB **or if** the storage estimate throws. The latter can represent a browser/platform capability failure, not necessarily a corrupt project library. The dashboard exposes recovery-mode messaging, but the threshold applies to total origin usage, not only Design Space project records.

**Next step:** Validate this threshold and error policy against realistic large-image libraries and browser privacy restrictions. Differentiate "cannot measure storage" from "library is damaged" without deleting user data.

### R10 — Outdated agent briefings can cause regression by instruction
**Severity: High for AI-assisted maintenance; confidence: confirmed contradiction.**

`DESIGN-SPACE-BRIEFING.md` (April 12) states that `App` automatically bypasses the dashboard and that the export modal is DEV-only. In current `App.tsx`, dashboard vs editor routing uses explicit `hasActiveSession`; current `ExportModal.tsx` no longer has that DEV guard. `LLM_PROJECT_CONTEXT.md` describes React 18/Fabric 6, while `package.json` currently uses React 19/Fabric 7. A coding agent that follows those files as present-day truth can diagnose nonexistent bugs, remove working features, and reintroduce stale workarounds.

**Resolution in this PR:** Place prominent historical notices at the top of both documents, linking current README, contributor guide, verified state contracts, and this audit. Preserve the original notes as time-stamped evidence. Consider consolidating a single maintained contributor entry point in a later documentation pass.

## What appears improved, not inherently broken

The October 8 commit brought typed scene snapshots, asset serialization checks, stable persistence acknowledgements, model-specific interaction modes, and tests for history/state handoffs. The prior September forensic audit documented serious image, geometry, history, and ownership problems; current source is materially different. Those historical failures are excellent regression-test ideas, but they should not be represented as current reproductions without a fresh browser test.

The latest `main` CI run completed successfully. A separate PR quality run for the previous Quick Open accessibility change was observed with lint, unit tests and coverage succeeding and build completing on Node 22 while the other job was still running. No local clone/runtime validation was possible in this audit environment.

## Recommended execution order

1. **Protect creative work:** unsaved navigation, async open failures, first-save conflicts, and browser download truthfulness.
2. **Enforce real workflow tests in CI:** at least the small P0 Chromium smoke set.
3. **Clarify dual-mode identity:** dashboard card labels, open flows, save/download semantics, and mode-specific affordances.
4. **Native acceptance:** WebKitGTK/Tauri save and close interleavings.
5. **De-risk layout and selection ownership:** targeted characterization tests before component extraction.
6. **Then polish aesthetics:** responsiveness, spacing, consistent feedback, and discoverability after underlying workflows are trustworthy.

## Minimal manual acceptance script

- Launch fresh with empty storage. Start a canvas project. Type while a text object is selected; use Save and inspect Saved/Unsaved status.
- Open the library project with the editor currently dirty. Verify save/discard/cancel gates do not lose work.
- Initiate Download Project File in the leave dialog; verify that the browser file exists before deliberately leaving. The UI must explain why it did not immediately navigate.
- Reopen a portable file with embedded and grouped images; switch pages and verify geometry, asset pixels, and undo.
- Repeat with a document project. Edit body text quickly, switch pages, undo/redo, save and reopen.
- Inject canvas initialization timeout and failed storage writes. The UI must preserve the current session or provide a clear recovery route.
- Export all pages and compare order, content, density, and page sizes in a fresh viewer.
- On the desktop wrapper, explicitly cancel a native save and confirm dirty content remains in the editor.

## Audit limitations

This review examined current GitHub source, repository history, documentation, and Actions metadata. It **did not** run Design Space against the user's browser database, inspect private workspaces, load a real user project, or execute Chromium/native tests locally. Confirmed source branches, architectural risks, and historical reproduced bugs are clearly distinguished. A passing CI result cannot certify behavior of the native wrapper or excluded E2E tests.
