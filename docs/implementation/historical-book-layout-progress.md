# Historical book layout implementation progress

Implementation started: 2026-07-29  
Baseline commit: `62a604e916f30e07ea862a13254fa5a7bbeabee6`  
Canonical plan: `docs/audits/historical-book-layout-gap-analysis.md`

## Baseline

- Branch: `main`
- Post-audit code changes found: none
- Existing untracked material: the audit report under `docs/audits/`
- Historical reference directory: not present in the repository or Git history
- External page-numbered Darktable cache entries were inspected and were unrelated aquarium photographs; they were not copied or modified
- Verification:
  - `npm run lint` — passed
  - `npx tsc --noEmit` — passed
  - `npm test` — 17 files, 258 tests passed
  - `npm run build` — passed
  - `npm run test:recovery` — 2 tests passed
  - `cargo test --manifest-path src-tauri/Cargo.toml` — 20 Rust tests passed
  - `npm run test:e2e -- e2e/document-reconstruction.spec.ts` — 5 tests passed

## Phase status

| Phase | Status | Commit |
|---|---|---|
| S0 — Authoritative paper background | Complete | Pending phase commit |
| P1 — Multi-page documents and folios | Pending | — |
| P2 — Historical typography styles | Pending | — |
| P3 — Shared layout and image geometry | Pending | — |
| P4 — Image rows and stacks | Pending | — |
| P5 — Persistence, migrations, assets, recovery | Pending | — |
| P6 — Committed multi-page export | Pending | — |
| P7 — Historical fixtures and visual regression | Pending | — |

## S0 — Authoritative paper background

Status: Complete

Planned source of truth: `project.document.background.value`.

Schema changes: none. Existing v2 metadata is used.

Migration behaviour: malformed document paper colours normalize to the existing
cream default; valid three- and six-digit hex colours normalize to a canonical
six-digit uppercase value.

Files changed:

- `src/document/utils/documentColor.ts`
- `src/editor/project/projectSchema.ts`
- `src/document/state/documentStore.ts`
- `src/document/components/DocumentEditorShell.tsx`
- `src/document/components/DocumentPageView.tsx`
- `src/document/components/DocumentSidebar.tsx`
- `src/document/services/documentExportService.ts`
- `__tests__/document-store.test.ts`
- `__tests__/document-editor.test.ts`
- `__tests__/document-export.test.ts`
- `e2e/document-reconstruction.spec.ts`
- this implementation journal

Implemented behaviour:

- blank and normalized document projects use `#FAF8F5`;
- the sidebar edits the project-level paper colour without adding a page field;
- valid three- or six-digit hex colours are canonicalized;
- malformed or CSS-bearing imported values fall back safely;
- valid changes mark the project dirty and use the existing bounded autosave;
- library and portable project reopen preserve the colour;
- the sheet, export root, PNG, raster PDF, and print clone receive the same
  committed value.

Tests and verification:

- `npx vitest run __tests__/document-store.test.ts __tests__/document-editor.test.ts __tests__/document-export.test.ts` — 81 tests passed
- `npm test` — 17 files, 263 tests passed
- `npx tsc --noEmit` — passed
- `npm run lint` — passed
- `npm run build` — passed
- `npm run test:e2e -- e2e/document-reconstruction.spec.ts` — 5 tests passed
- `git diff --check` — passed

Deviations and limitations:

- The colour contract is intentionally limited to validated hex colours rather
  than accepting arbitrary CSS strings.
- Multi-page offscreen rendering remains P6 work; S0 ensures every current
  render/export call receives the authoritative value.
