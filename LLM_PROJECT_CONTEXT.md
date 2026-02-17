# Design Space — Comprehensive LLM Project Context

This document is a high-signal project briefing for coding agents (Codex/Claude/OpenCode) so they can quickly understand what Design Space does, how it is structured, and how to safely contribute.

---

## 1) What this project is

**Design Space** is a print-first + digital canvas editor built with React + Fabric.js.

Core use case:
- Create visual designs (zines, social graphics, print layouts)
- Edit on a rich canvas with layers, guides, tools, themes, and assets
- Save/load projects from local IndexedDB
- Export to formats like PNG/JPEG/SVG (and project JSON)

Design philosophy:
- “Ritualistic zine-maker” UX style with practical production workflows
- Print-friendly defaults (300 DPI concepts)
- Accessible, token-driven visual system

---

## 2) Tech stack

- **UI**: React 18 + TypeScript + Vite
- **Canvas engine**: Fabric.js v6 beta
- **State**: Zustand (with persist middleware in places)
- **Local storage**:
  - IndexedDB via Dexie (`src/editor/db.ts`) for project persistence
  - LocalStorage for autosave session restore
- **Styling**: Tailwind + CSS variables/theme tokens
- **Icons**: lucide-react

Scripts:
- `npm run dev`
- `npm run build` (lint + tsc + vite build)
- `npm run lint`
- `npm run test`

---

## 3) Product architecture (high level)

`src/editor/` is the main app domain:

- `components/` → editor UI and dashboard
- `fabric/` → Fabric canvas utilities, object ops, export/viewport/theme helpers
- `state/` → Zustand stores (editor state, history, theme, canvas dimensions)
- `services/` → interaction/event services and asset loading
- `utils/` → domain helpers (units, errors, scheduling, serialization, etc.)
- `config/` → shared UI/runtime configuration (including unified presets)
- `types/` → typed contracts for themes and other domain models

Key composition:
- `EditorShell` is the primary editing frame (header, side panels, stage, status)
- `CanvasStage` owns live Fabric canvas interaction and lifecycle hooks
- `editorStore` is the central orchestrator for user actions + persistence triggers

---

## 4) Main user workflows

### A) Project lifecycle
1. User opens dashboard and creates/open project
2. Editor initializes canvas state (size, units, theme, layers/history baseline)
3. User edits content (objects, text, assets, theme-linked colors)
4. Autosave stores session snapshot in localStorage
5. User can save project to IndexedDB, export file, or load project/file later

### B) Save/load channels
- **Project DB save/load**: IndexedDB records via Dexie
- **Project file import/export**: `.apocaproject.json`
- **Session autosave/restore**: localStorage payload with versioning

### C) Canvas editing
- Tooling includes select/draw/pan/erase/text + insert/shapes/assets/layers/properties
- Grid/snap/guide controls aid precision
- Canvas size and viewport controls exist in settings and presets flows

---

## 5) Critical files to understand first

- `src/editor/state/editorStore.ts`
  - Largest behavior hub: project creation/load, autosave, tool actions, toast, save state
- `src/editor/components/EditorShell.tsx`
  - Main editor layout + top-level UI actions and modal orchestration
- `src/editor/components/CanvasStage.tsx`
  - Fabric canvas lifecycle/event bindings and interaction behavior
- `src/editor/fabric/canvasUtils.ts`
  - Canvas resize/viewport/document utility operations
- `src/editor/db.ts`
  - IndexedDB schema and CRUD for projects/canvas payloads
- `src/editor/config/canvasPresets.ts`
  - Centralized preset registry used across dashboard/popovers/modals

---

## 6) Data model and persistence

## IndexedDB (Dexie)
Defined in `src/editor/db.ts`.

Primary entities:
- `projects`
  - `id`, `name`, `lastModified`, `thumbnail`, `canvasDataId`
- `canvasData`
  - `id`, `jsonPayload`, `projectId`, `lastModified`
- `brandKit`
  - theme/brand metadata

Important notes:
- Project metadata and heavy canvas payload are split
- Duplicate, rename, delete operations are implemented in DB layer

## Project payload
Project payload includes:
- `canvasData`
- `assets`
- `activeTheme`
- `canvasSize`
- `unitMode`
- `lastUpdated`

Autosave payload extends project payload with `autosaveVersion`.

---

## 7) State system map (Zustand)

Primary stores:
- `editorStore` (core orchestration)
- `useHistoryStore` (undo/redo + serialization path helpers)
- `useCanvasStore` (document width/height + pending resize semantics)
- `useThemeStore` and `useUiThemeStore` (theme tokens and UI skin sync)

Notable state concepts:
- `AutoSaveStatus` and derived `SaveStatus`
- toast payloads with variants/actions/details
- project preset modal state
- onboarding/display state
- session restore flags

---

## 8) Recent UX refactor outcomes (important for future changes)

This project recently implemented major workflow improvements:

1. **Unified project initialization**
- Canonical create-project path across dashboard/presets/new project entry points

2. **Persistent save status visibility**
- Header/status surfaces now show saved/saving/unsaved/error states

3. **Quick-open project switching**
- Command palette style open (`Cmd/Ctrl+K`)

4. **Non-destructive resize options**
- Resize mode selection includes safer options beyond clear-only

5. **Navigation simplification**
- Quickbar visibility rules to reduce duplicate UI noise

6. **Centralized presets**
- One source of truth for dimensions across dashboard/settings/modals

7. **Project card action clarity**
- Explicit labeled card actions (kebab menu flow)

8. **Session restore banner**
- Keep/discard controls after autosave recovery

9. **Toast system upgrade**
- Severity variants + error details support

When making UI changes, do not accidentally regress these behaviors.

---

## 9) Guardrails for LLM contributors

1. **Avoid duplicate logic paths**
- Reuse centralized helpers/stores; don’t create parallel “just-for-this-component” behavior.

2. **Keep project init/load semantics consistent**
- New project, DB load, file load, and autosave restore should produce predictable canvas/unit/theme/viewport outcomes.

3. **Respect destructive-action safety**
- Confirm before destructive actions.
- Prefer reversible flows where possible.

4. **Preserve keyboard accessibility**
- Focusable triggers, Esc handling, and keyboard shortcuts should remain intact.

5. **Do not hardcode duplicate presets**
- Use `src/editor/config/canvasPresets.ts`.

6. **Minimize broad refactors in this codebase**
- Small isolated commits are safer due to store complexity.

---

## 10) Testing and validation expectations

Always run:
```bash
npm run lint
npx tsc --noEmit
npm run test -- --run
```

Current known test-environment debt (historically observed):
- module path resolution mismatch in at least one test
- some tests expecting DOM env while executed in Node-like context

If tests fail, classify clearly:
- pre-existing baseline failure
- introduced regression

Never claim “all green” unless verified.

---

## 11) Typical task playbooks for an LLM

### Small UI tweak
1. Find owning component
2. Check store action dependencies
3. Verify keyboard/focus/ARIA
4. Run lint + typecheck
5. Commit narrowly

### Project load/save bug
1. Inspect `editorStore` load/create/autosave codepaths
2. Compare DB load vs file load vs restore behavior
3. Ensure canvas size + unit mode + theme + viewport parity
4. Add/adjust test where feasible

### Canvas behavior change
1. Touch `fabric/canvasUtils.ts` for primitives
2. Update invocations from UI components
3. Verify with grouped objects and non-default zoom

---

## 12) Suggested prompt scaffold for future coding agents

Use this scaffold to brief an LLM quickly:

```text
You are working on Design Space in /home/maddie/Documents/code/Design Space.
Read LLM_PROJECT_CONTEXT.md first.
Then implement <task> with minimal, maintainable changes.
Constraints:
- keep init/load/save behavior consistent across entry points
- no hardcoded duplicate presets
- preserve keyboard accessibility and destructive-action confirmations
Validation:
- npm run lint
- npx tsc --noEmit
- npm run test -- --run
Classify test failures into pre-existing vs introduced.
Provide: summary, files changed, validation output, and risks to manually verify.
```

---

## 13) Current state summary

Design Space is a mature in-progress editor with:
- rich canvas tooling,
- local-first persistence,
- improved UX consistency,
- and a strong foundation for iterative feature work.

The biggest ongoing engineering risk is not missing features — it is **behavior drift across parallel codepaths**. Keep shared flows centralized and changes incremental.
