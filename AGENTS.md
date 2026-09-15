# Repository Guidelines

Design Space is a desktop-first React/TypeScript workspace with Fabric.js canvas editing, a Tiptap document editor, IndexedDB persistence, and an optional Tauri wrapper.

## Project Structure & Module Organization

- `src/` contains the frontend: canvas features in `src/editor/`, document editing/layout in `src/document/`, and shared code in `src/components/`, `src/hooks/`, and `src/utils/`.
- `__tests__/` contains Vitest tests; `e2e/` contains Chromium Playwright tests, fixtures, and snapshots.
- `src-tauri/` contains the Rust shell and Python recovery tools. Static assets are in `public/`; technical notes are in `docs/`.
- Root JSON files and `public/historical-book/` hold product/theme and reference assets. Do not commit generated `dist/`, `coverage/`, or `test-results/` output.

## Build, Test, and Development Commands

Use Node.js 20+ and install with `npm ci`. Run `npm run dev` for Vite (normally `http://localhost:5174`). Key commands:

- `npm run lint` — ESLint with zero warnings allowed.
- `npx tsc --noEmit` — TypeScript checking.
- `npm test` / `npm run test:coverage` — Vitest, optionally with V8 coverage.
- `npm run test:e2e` — Playwright browser tests; set `DESIGN_SPACE_E2E_PORT` when needed.
- `npm run test:recovery` — Python recovery-tool tests; use `cargo test --manifest-path src-tauri/Cargo.toml` for Rust tests.
- `npm run build` — lint, TypeScript compilation, and the Vite production build.

## Coding Style & Naming Conventions

Use two-space indentation, semicolons, single quotes, and trailing commas. Use PascalCase for React components, camelCase for functions/variables, and kebab-case test names (for example, `document-export.test.ts`). Run ESLint before committing. Preserve versioned project schemas and legacy fields.

## Testing Guidelines

Vitest uses jsdom and discovers `__tests__/**/*.test.ts`; keep tests focused and name them after the behavior under test. Add Playwright coverage for user-visible editor, export, and layout changes; update snapshots only for intentional visual changes. CI runs lint, tests, coverage, and build on Node 20 and 22.

## Commit & Pull Request Guidelines

Use the repository’s concise conventional style: `feat:`, `fix:`, `test:`, or `docs:`, optionally scoped (for example, `feat(document): add crop controls`). PRs should explain the change, list validation commands, link an issue or design note, include visual evidence when relevant, and call out schema or asset compatibility concerns.

## Security & Configuration Tips

Do not commit `.env` files or unapproved fonts, imagery, or templates. `DESIGN_SPACE_INTERNAL_PRODUCT_FORGE=true` enables an internal seller workflow; it is a build flag, not authentication or a public-service boundary.
