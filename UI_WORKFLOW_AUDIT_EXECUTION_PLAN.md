# Design Space — UI Workflow & Ease-of-Use Execution Plan

_This document is written for Codex/CLI-agent execution._

## Goal

Improve Design Space UX for faster workflows, fewer confusing states, and safer editing actions.

## Success Criteria

- New Project behaves consistently from all entry points
- Save status is always visible and trustworthy
- Project switching is fast (keyboard + UI)
- Canvas resizing no longer forces destructive clear-only behavior
- Navigation surfaces are simplified (less duplication)
- Preset handling is unified and reusable

---

## Ground Rules for Codex

1. Prefer small PR-sized commits (one feature per commit).
2. Do not break existing keyboard shortcuts.
3. Maintain current visual theme/tokens unless explicitly changed.
4. Keep all destructive actions behind confirmations or reversible undo paths.
5. Add tests where feasible (state logic and command behavior at minimum).
6. Run lint + typecheck before each final commit.

Recommended commands per phase:

```bash
npm run lint
npx tsc --noEmit
npm run test -- --run
```

---

## Phase 1 (High Impact / Low Risk)

## 1) Unify New Project Flow

### Problem
Different entry points initialize projects differently (preset/new/file/dashboard), causing user confusion.

### Target behavior
All “new project” actions route through one canonical flow:
- choose preset/custom size
- set unit mode
- initialize project shell
- optional naming prompt

### Implementation

- Create a shared helper in `editorStore`:
  - `createProject(options: { canvasSize?: {width,height}; unitMode?: UnitMode; name?: string; source?: string })`
- Keep `startNewProject` as compatibility wrapper that calls `createProject`.
- Replace direct initialization calls in:
  - `src/editor/components/ProjectDashboard.tsx`
  - `src/editor/components/EditorShell.tsx` (File dropdown: New Project)
  - `src/editor/components/CanvasSettingsPopover.tsx` (“More Presets...” flow)

### Acceptance checks
- New Project from dashboard = same initialization path as File > New Project
- Preset selection preserves chosen dimensions
- No path silently resets to US Letter unless that preset is explicitly chosen

### Commit message
`feat(project-init): unify new project creation flow across entry points`

---

## 2) Persistent Save Status in Header

### Problem
Autosave exists but trust is low if status is not visible where users focus.

### Target behavior
Header shows: `Saved`, `Saving…`, `Unsaved changes`, and optional `Save failed`.

### Implementation

- Add derived status selector in editor state (or expose existing autosave status cleanly).
- Add lightweight `SaveStatusBadge` component in header (near File dropdown).
- Trigger transitions on:
  - local edits
  - autosave start/success/failure
  - manual save/export where relevant

### Files
- `src/editor/state/editorStore.ts`
- `src/editor/components/EditorShell.tsx`
- `src/editor/components/StatusBar.tsx` (optional shared status source)

### Acceptance checks
- User can always tell whether data is saved
- Status updates within ~1–2s after edits/autosave

### Commit message
`feat(save-status): surface persistent autosave status in header`

---

## 3) Quick Open (Recent Projects) — Cmd/Ctrl+K

### Problem
Switching projects requires too much pointer movement.

### Target behavior
A command-palette style quick-open allows keyboard search + open for recent projects.

### Implementation

- Add `ProjectQuickOpenModal` with:
  - open shortcut: `Cmd/Ctrl+K`
  - project search field
  - recent list sorted by lastModified
  - Enter to open selected
- Reuse existing `getAllProjects()` and `loadProject()` store methods.
- Add action in top-right Project area (optional icon/button).

### Files
- `src/editor/components/ProjectQuickOpenModal.tsx` (new)
- `src/editor/components/EditorShell.tsx`
- `src/editor/hooks/useKeyboardShortcuts.ts`

### Acceptance checks
- `Cmd/Ctrl+K` opens quick switch
- Typing filters projects instantly
- Enter opens project and closes modal

### Commit message
`feat(projects): add quick-open command palette for recent projects`

---

## Phase 2 (Workflow Safety + Clarity)

## 4) Non-Destructive Canvas Resize Choices

### Problem
Current resize flow warns then clears content, which is too destructive.

### Target behavior
On resize, users choose one:
1. Resize canvas only (keep object positions)
2. Resize + scale content proportionally
3. Clear and start fresh (current behavior)

### Implementation

- Add modal/confirm replacement for resize actions in `CanvasSettingsPopover`.
- Implement helper(s) in canvas utils:
  - `resizeCanvasOnly(width,height)`
  - `resizeCanvasAndScaleContent(width,height)`
  - `clearAndResizeCanvas(width,height)`
- Make destructive option explicit and visually de-emphasized.

### Files
- `src/editor/components/CanvasSettingsPopover.tsx`
- `src/editor/fabric/canvasUtils.ts`
- optional utility file for transform math

### Acceptance checks
- No forced clear on preset/custom size unless user selects clear option
- Scaling behavior preserves relative layout

### Commit message
`feat(canvas): add safe resize modes (keep, scale, clear)`

---

## 5) Simplify Navigation Surface (Reduce Duplicate Controls)

### Problem
Left rail + floating quick bar duplicate core navigation and increase cognitive load.

### Target behavior
- Left rail remains primary nav.
- Floating quick bar is contextual (onboarding only) or toggleable.

### Implementation

- Introduce feature flag/state for quick bar visibility.
- Show quick bar only when:
  - onboarding visible OR
  - no panel selected OR
  - user explicitly enables it
- Persist preference in local settings if available.

### Files
- `src/editor/components/EditorShell.tsx`
- potentially `src/editor/state/editorStore.ts` for preference state

### Acceptance checks
- Users don’t see duplicate nav unless opted in
- Panel access remains one-click

### Commit message
`refactor(nav): reduce duplicate navigation surfaces in editor`

---

## 6) Unify Preset Catalog Source

### Problem
Presets are split across dashboard and popover, risking drift.

### Target behavior
Single preset registry used everywhere.

### Implementation

- Create `src/editor/config/canvasPresets.ts` with grouped presets:
  - `social`
  - `print`
  - `recent` (computed)
- Replace local hardcoded arrays in:
  - `ProjectDashboard.tsx`
  - `CanvasSettingsPopover.tsx`
  - `ProjectPresetsModal` (if applicable)

### Acceptance checks
- Preset names/dimensions match across all surfaces
- Add/update once, reflected everywhere

### Commit message
`refactor(presets): centralize canvas presets registry`

---

## Phase 3 (Polish + Reliability)

## 7) Improve Project Card Actions

### Changes
- Replace tiny overlay-only duplicate/delete with kebab menu + explicit labels.
- Keep keyboard focus styles and confirm text.
- Optional: add “Rename” and “Open in new session”.

### Commit message
`feat(dashboard): improve project card actions and discoverability`

---

## 8) Session Restore Banner

### Changes
When autosave restore occurs, show banner:
- “Recovered unsaved session from [time]”
- Actions: `Keep`, `Discard`

### Commit message
`feat(recovery): add visible autosave restore banner and controls`

---

## 9) Toast Severity + Details

### Changes
- Toast types: success/info/warn/error
- For error toasts, include optional “Details” affordance
- Keep existing quick-dismiss behavior

### Commit message
`feat(feedback): add toast severity and error detail affordances`

---

## QA Checklist (Codex must run before marking done)

## Project creation/load consistency
- [ ] Dashboard > New Project uses canonical init
- [ ] Dashboard preset creates correct size
- [ ] File > New Project matches behavior
- [ ] DB load and file load produce same viewport/theme/unit behavior

## Save confidence
- [ ] Header status appears on all editor screens
- [ ] Unsaved/Saving/Saved transitions are accurate

## Resize safety
- [ ] Resize options presented clearly
- [ ] Keep/Scale/Clear each works as expected

## Navigation clarity
- [ ] No confusing duplicate controls by default
- [ ] Insert/Layers/Assets still easy to access

## Accessibility basics
- [ ] Icon-only controls have aria-labels
- [ ] Keyboard nav works in new modals
- [ ] Focus trap + Esc close for modals/popovers

---

## Suggested Execution Order

1. Phase 1.1 (unify new project flow)
2. Phase 1.2 (header save status)
3. Phase 1.3 (quick open)
4. Phase 2.4 (safe resize modes)
5. Phase 2.5 (nav simplification)
6. Phase 2.6 (preset registry)
7. Phase 3 polish items

---

## Optional Nice-to-Haves

- First-run coach marks for key tools
- “Recent sizes” quick chips in canvas settings
- User preference: default new-project preset
- Lightweight analytics event hooks for UX tuning (local-only or privacy-safe)

---

## Done Definition

This plan is complete when:
- All Phase 1 items are shipped and verified
- At least one safe-resize mode beyond clear-only is shipped
- Preset drift is eliminated via centralized config
- UX regressions are covered by smoke tests and manual QA checklist
