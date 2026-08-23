# Document live-text state-churn fix

## Summary

After the immediate ProseMirror typing path from `12dbc5705ae1589d3721bb95c185cd6869326ebc`, visible characters no longer waited for structured page composition. The remaining desktop lag came from synchronizing the entire Zustand project snapshot on every authored text transaction. This fix keeps the mounted ProseMirror editor as the live draft, then commits a current body/title snapshot at deterministic boundaries through a small text-specific store path.

## Measured bottleneck before the fix

A realistic Chromium reconstruction page was used: three columns, substantial body text, two structured photos, captions, a scanned reference, and a 59-character body typing burst. The post-12dbc compositor did not rebuild during the burst, but persistent state work scaled with the input count:

| Operation | Relative work during the 59-character burst |
| --- | ---: |
| Project replacements / generic `updatePage` | about 59 each |
| Body updates | about 59 |
| Style normalization | about 118 (body path plus generic page path) |
| Whole-page equivalence / metadata omission | about 59 / 118 |
| Group-image collection and repair | about 59 each |
| Authored diff | about 59 |
| Authored projection | about 236 nested projections |
| `DocumentEditorShell` renders | about 120 |
| Project subscriber updates | about 58 |
| Toolbar format reads | about 118 |

The largest measured store contributors were whole-page equivalence plus recursive metadata omission and the generic page-update path. Structured model builds were already frozen during typing, so composition was not reopened as the solution.

## Live draft and commit boundary

`DocumentEditorShell` now stores the latest ProseMirror JSON in an in-memory map keyed by page ID and `title`/`body`. It is not a second document model: the editor remains the only live editing authority. Each ordinary `docChanged` transaction queues the latest JSON and emits the existing `modify-structured-title-content` or `modify-structured-body-content` ProjectChange observation.

The draft is flushed after a 350 ms coalescing window and synchronously before:

- shared autosave and manual Save;
- project-file download, PNG/PDF export, and print;
- page selection, add/duplicate/remove/reorder, and project/session replacement;
- image selection or an image transaction requiring current body JSON;
- text blur, editor teardown, navigation, and shared-session close;
- other generic document metadata mutations that could replace the project.

The store also exposes `commitTitleContentSnapshot` and `commitBodyContentSnapshot`. A flush updates only the target page content, normalizes it once, preserves unrelated page/object references, and does not derive page size or run whole-page JSON equality. Plain text commits do not collect or repair image groups. Image insertion/deletion/replacement and image-layout transactions retain the existing metadata path and group repair behavior.

## ProjectChange and autosave behavior

ProjectChange remains the authored-change authority. There is still one lightweight structured-content observation per committed ProseMirror transaction, so authored revisions and trailing-edge autosave semantics are unchanged. The project snapshot is simply allowed to catch up at the draft boundary.

Autosave remains 900 ms trailing-edge debounce. Its adapter reads the store only after `flushDocumentLiveDrafts()` has synchronously committed any pending editor JSON, so it cannot serialize a stale body or title. Manual Save, page switching, export, recovery-facing close, and reopen paths use the same ordering.

## Toolbar and overflow audit

`updateActiveTextFormatState` still observes selection changes, but its state setter now retains the existing object when formatting values are unchanged. The duplicate update-path read was removed; ordinary character typing leaves one cheap selection-format read per input rather than two.

Overflow callbacks are coalesced with `requestAnimationFrame` and deferred while the live structured text surface is focused. One pending measurement is performed when editing ends. In the measured 59-character burst, overflow measurement was previously about 9 ms total and is now unchanged during the active burst.

## Results after the fix

On the same reconstruction page:

- 59 typed characters produced 59 ProjectChange observations and 0 structured model builds during the burst;
- project replacements, generic `updatePage`, whole-page equivalence, metadata omission, group collection, and group repair stayed at 0 during the burst;
- after the idle flush there was one fast text commit, one normalization, and one project replacement;
- project subscriber updates stayed unchanged during the burst;
- shell renders changed only at setup/flush boundaries (46 to 52 in one run, versus roughly 120 per burst before the memoized document adapter and selection-state guard);
- toolbar reads were reduced to one per input (59 for the burst);
- observed input-to-visible timings were approximately 24–56 ms in Chromium, with every typed character visible in order;
- an 89-character, roughly five-second burst had 0 autosaves while typing and one autosave after the existing 900 ms idle period;
- title typing used the same draft path and passed the same no-project-churn assertions.

Immediate manual Save and immediate page switching both preserve the latest body text. Save/reopen verifies the committed text in the reopened project.

## Desktop/Tauri findings

No automated Tauri/WebKit UI driver is present in this workspace. The desktop webview uses the same frontend bundle and therefore the same live ProseMirror/draft boundary. Runtime diagnostics remain available through the live-text counters and timing marks in the document DOM/console, and shared-session close explicitly flushes before lifecycle teardown. Rust/recovery validation is listed below; a dedicated WebKit input-latency driver remains a limitation.

## Validation

Passed:

- focused live-text state and high-volume editor tests;
- full Vitest: 59 files, 626 tests;
- coverage: 59 files, 626 tests;
- production build (`npm run build`);
- `npm run validate`;
- recovery tests: 3 Python tests;
- Rust/Tauri tests: 20 library tests plus main/doc-test suites;
- TypeScript;
- ESLint;
- structured live-typing Chromium suite;
- unified autosave body/title, immediate Save, and page-switch Chromium suite;
- secondary-photo selection;
- reconstruction page-space, transform alignment, span preservation, and structured text hit-testing suites (the PNG/PDF equivalence test also passes when run serially; one parallel run exceeded its existing pixel tolerance under concurrent load);
- existing image/group/editor regression coverage;
- full Chromium invocation: 79/82 passed under eight-way parallel load. The three failures were a zero-size transient bounding box in a photo drag/selection case and the unchanged `historical-page-49.png` visual snapshot size mismatch. The affected interaction cases pass with one worker; the historical snapshot remains intentionally unchanged.

## Remaining limitations

The canonical project snapshot can lag the live editor by the short 350 ms coalescing interval, but all persistence/navigation/export/close boundaries flush synchronously. ProjectChange still observes each authored ProseMirror transaction by design. There is no automated desktop WebKit interaction harness yet.
