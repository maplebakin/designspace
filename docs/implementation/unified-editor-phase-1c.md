# Unified editor Phase 1C

## Scope

Phase 1C adds a normalized page-mutation and asset-reference boundary above the
existing Canvas and Document engines. It does not introduce canonical
mutation state, a canonical asset store, a mixed page model, or a persisted
schema change.

The resulting direction is:

```text
UnifiedEditorSession
  -> UnifiedEditorShell/common page commands
     -> normalized command/result boundary
        -> Canvas adapter -> existing editorStore/Fabric page actions
        -> Document adapter -> existing documentStore/Tiptap page actions
```

The stores remain authoritative for all writes and side effects. The shared
layer now understands what a delegated page action did without knowing the
engine's array/index or object representation.

## Normalized mutation boundary

`src/editor/session/projectMutation.ts` defines the Phase 1C vocabulary:

- `PageMutationCommand` / `ProjectMutationCommand` support `select-page`,
  `add-page`, `duplicate-page`, `remove-page`, and `reorder-page`;
- requests carry `projectId` and stable `pageId`/`sourcePageId` values;
  `targetIndex` is the only positional value and is the requested resulting
  order, not an engine-owned page identity;
- `PageMutationResult` reports `status: 'success' | 'rejected' | 'failed'`,
  `affectedPageIds`, `activePageId`, the resulting `pageOrder`, and optional
  created/removed IDs;
- `MutationEffects` reports authored-content change, page-structure change,
  truthful asset consequences, and the resulting active-page selection effect;
- `MutationError` normalizes stale IDs, invalid reorder targets, last-page
  protection, unsupported operations, unavailable sessions, and engine errors.

`ProjectSessionCommands.mutatePage` is now the only shared page-mutation entry
point. `UnifiedEditorChrome` uses it for page tabs, add/remove, drag reorder,
and Document duplicate. It handles rejected/failed results through the
existing adapter notification path and does not infer success from a legacy
action's return value.

### Adapter translation

`src/editor/session/legacyPageMutationAdapters.ts` contains the engine-specific
translation:

- Canvas resolves page IDs to the current `editorStore.pages` index, delegates
  to `switchToPage`, `addPage`, `deletePage`, or `reorderPages`, then compares
  authoritative post-action page state. Canvas duplicate-page remains an
  explicit `unsupported` result because no native Canvas duplicate action
  currently exists.
- Document resolves IDs to `documentStore.project.pages`, delegates to the
  existing `selectPage`, `addPage`, `duplicatePage`, `removePage`, or
  `reorderPages`, and reports the new page ID/order from the loaded project.
- A Document duplicate reports `retained-reference`: the existing duplicate
  action creates new image/object IDs while retaining references to the same
  engine-owned assets.
- Page removal reports `cleanup-delegated`; neither adapter attempts to prune
  or physically rewrite assets after a page action.
- The adapters reject stale project/page IDs before calling a store and report
  post-action mismatches as `engine-error` rather than claiming a mutation
  happened.

The legacy stores still perform dirty marking, active-page updates, selection
reset, autosave scheduling, thumbnail/serialization work, and history-related
side effects. The shared result only describes those effects for a future
coordinator; it does not reproduce them.

## Shared asset-reference vocabulary

`src/editor/session/assetReference.ts` defines the read-only semantic contract:

- `AssetReferenceKind`: `image`, `svg`, `sticker`, `reference`, or `other`;
- optional stable `assetId`;
- source classification (`data-url`, `blob-url`, `remote`, `legacy`, or the
  reserved embedded/generated values);
- explicit `runtimeOnly` state;
- supported MIME, filename, and natural-dimension metadata.

`ProjectSessionCommands.describePageAssets` exposes adapter-resolved page
descriptions without creating a shared asset database.

`src/editor/session/legacyAssetReferences.ts` provides the current mappings:

- Canvas walks serialized page objects, resolves the current `imageAssets` map
  and sticker library where available, and reports the current image-object ID
  key used by legacy Canvas persistence. It does not relabel that object ID as
  a new canonical media identity.
- Document walks Tiptap image nodes, page overlays, and the editor-only scan
  reference, resolving `assetId`, `assets`, and `assetMetadata` without
  changing the Document asset service.
- A `blob:` source is classified as `blob-url` and `runtimeOnly: true`; it is
  never promoted to shared identity. Data URLs are described as source data,
  and Document metadata remains the preferred source for dimensions/MIME/name.
- Missing sources remain identifiable by stable ID when the engine has one;
  the adapter does not invent bytes, hashes, filenames, or portability claims.

Asset pruning, embedding, source hydration, blob revocation, deduplication,
hashing, portable-file preparation, and export resolution remain entirely
engine-owned. The known legacy issue that Canvas image object IDs currently
also key `imageAssets` is documented by the adapter and deliberately deferred
to canonical asset convergence.

## Embedded shell and viewport boundary

Phase 1B's Canvas page strip was an absolutely positioned sibling with a
`calc(100% - ...)` renderer height. Phase 1C changes the common shell to pass
the shared page strip through a content-region slot. In unified mode the
Canvas adapter mounts it inside `EditorShell` immediately before the existing
Canvas status bar. The outer shell now gives the renderer a normal flex region;
there is no second `unified-canvas-renderer` height subtraction.

The embedded Canvas root uses an explicit
`design-space-legacy-engine-surface` container contract, while standalone
Canvas compatibility consumers retain their old `w-screen h-screen` behavior.
The embedded Document root receives `document-editor-shell--embedded` and
sizes to the host; its standalone compatibility shell retains the legacy
viewport rule.

Both engines continue to measure their actual provided region:

- Canvas `CanvasStage` observes `canvas-container` and fits Fabric to that
  container using its existing Canvas geometry;
- Document `DocumentEditorShell` observes `document-workspace` and calculates
  fit from its measured client box and existing page geometry;
- `PageViewport` remains the shared measurement boundary and does not apply a
  second transform or migrate authored coordinates.

The shared page strip slot is a React content boundary only. No DOM node,
Fabric object, Tiptap editor, or live engine reference enters session state.

## Selection and page-switch behavior

Page mutations continue to clear or reset engine-native selection through the
existing store actions. The result reports only whether the active page ID
changed. Canvas selection remains Fabric/store-owned; Document text, image,
group, and reference focus remain Document-owned. No cross-engine selection,
mixed-layer focus, or persisted selection was added.

The page strip now stores a dragged page ID rather than a source array index,
so a reorder request remains stable if the descriptor order changes while a
drag is in progress. Resulting page descriptors are still regenerated from
the authoritative store state.

## Responsibilities deliberately still legacy-owned

This slice did not change:

- Canvas/Fabric object mutation, grouping, geometry, selection, history,
  persistence, autosave, recovery, or Canvas export;
- Document/Tiptap transactions, layout allocation, image groups, references,
  captions, folios, history, persistence, autosave, recovery, or committed
  browser/Tauri/print export;
- project schemas, Document schema v6, IndexedDB records, portable project
  envelopes, asset pruning/embedding, Product Forge, templates, recipes, or
  editorMode compatibility dispatch;
- unified history, unified revisions, a ProjectChangeCoordinator, a canonical
  asset store, mixed-page writes, mixed-layer z-order, or structured-flow
  exclusions for Fabric objects.

App still uses compatibility mode internally to select the legacy adapter. It
does not expose that discriminator as a new product creation concept.

## Tests and validation

Added `__tests__/unified-editor-phase-1c.test.ts` for:

- Canvas add-page result/created ID;
- Document duplicate, last-page rejection, and stable-ID reorder;
- Canvas and Document asset-reference normalization;
- blob URLs remaining runtime-only;
- Document content/overlay/reference asset mapping.

Updated Phase 1B/session seam tests so common chrome asserts normalized
commands rather than legacy method return shapes.

Validation completed:

- `npx tsc --noEmit` — passed;
- `npm run lint` — passed;
- `npm run build` — passed;
- `npm test` — 43 files, 445 tests passed;
- focused Phase 1C/session suite — 4 files, 14 tests passed;
- Canvas Fabric, product smoke, and Document reconstruction browser suites —
  38 tests passed;
- `npm run test:recovery` — 3 tests passed;
- `cargo test --manifest-path src-tauri/Cargo.toml` — 20 Rust tests passed.

The build emitted the repository's existing Browserslist freshness warning;
it did not fail validation. No Tauri source or export code was modified.

## Deferred issues and risks

- Canvas does not yet have native duplicate-page semantics; the boundary
  rejects that command rather than copying page payloads outside the store.
- Canvas image object IDs and media keys remain historically conflated, and
  some legacy sources do not provide portable metadata. A future canonical
  asset service must preserve old files while separating object and asset
  identity.
- The two engines still have separate histories, autosave timers, recovery
  validators, and export paths. A future coordinator must consume mutation
  results without making these stores write twice.
- Mixed-page pointer ownership, cross-engine focus, z-order, wrapping
  exclusions, export composition, and Fabric accessibility remain unresolved
  by design. The current slice only embeds one legacy renderer per page.
- Standalone legacy shells retain full-viewport assumptions for compatibility;
  the unified route now supplies an explicit embedded container contract. Full
  retirement requires proving all direct shell consumers have moved to the
  unified host.

## Rollback and next slice

The rollback boundary is the focused Phase 1C commit. Reverting it restores
the Phase 1B page command methods and outer Canvas page-strip layout while
leaving all existing persisted project formats and engine stores untouched.
No migration or data repair is needed.

The next recommended slice is a **read-only ProjectChangeCoordinator seam**
that consumes these normalized mutation results and existing dirty/save
observations into a diagnostic transaction/event stream. It should establish
one place to coalesce future page-change transactions and expose revision
intent, while continuing to delegate all writes, autosave, histories, assets,
recovery, and export to the legacy adapters. Only after that seam is covered
by old-file round trips should canonical mutation ownership or asset/history
convergence begin.
