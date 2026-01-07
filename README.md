# Design Space

Design Space is a browser-based design studio for themed print and digital layouts. It combines a Fabric.js canvas editor with a token-driven theme system, template tooling, and export pipelines for both web and print.

## Features
- Canvas editor with drag/drop, shape and text tools, and image uploads.
- Layers panel with reorder, visibility toggle, movement lock, color lock, and delete.
- Smart guides and rulers with bleed/safe margin overlays (hold Alt to disable snapping).
- Templates: curated blueprints plus user-saved templates with thumbnails.
- Stickers and asset library with PNG uploads and drag/drop placement.
- Brand Vault for Apocapalette theme tokens and object relinking tools.
- UI theme presets and token-driven UI theming.
- Project presets for print (300 DPI) and digital sizes.
- Export to PNG/JPG/SVG plus print-ready PDF with bleed and trim boxes.
- Import SVG and PDF (first page) as canvas backgrounds.
- Local persistence for autosave and editor UI state.

## Tech Stack
- React 18 + TypeScript + Vite
- Fabric.js canvas rendering
- Tailwind CSS
- Zustand state with persistence
- pdf-lib + pdfjs-dist for PDF workflows
- idb for IndexedDB helpers
- lucide-react icons

## Getting Started
Requirements: Node.js (18+ recommended) and npm.

```bash
npm install
npm run dev
```

Open the local Vite URL printed in the terminal.

## Scripts
```bash
npm run dev       # start the dev server
npm run build     # type-check and build for production
npm run preview   # preview the production build
npm run lint      # run eslint
```

## Core Workflows
### Start a new project
- Use the Project Presets modal to pick print or digital sizes.
- Canvas presets are sized in pixels at 300 DPI for print workflows.

### Add and edit content
- Use the Design tab for layers and quick object creation.
- Drag assets or stickers onto the canvas to drop them in place.
- Use the Insert Placeholder action to create drop targets for images.

### Themes and Brand Vault
- Import Apocapalette JSON files in the Brand Vault.
- Use the Theme sidebar to apply a theme or relink selected objects to tokens.
- Magic Match can select a theme that best fits an image dominant color.

### Export and import
- Export to PNG/JPG/SVG or print-ready PDF from the header menu.
- Import SVGs or load a PDF (page 1) as a background image.

## Data and Persistence
- Autosave snapshots are stored in localStorage.
- UI theme presets and editor preferences are persisted via Zustand.
- Brand Vault collections are also saved to IndexedDB.
- Project files are saved as `.apocaproject.json` bundles with canvas + theme data.

## Project Structure
- `src/editor/components` UI components and layout
- `src/editor/state` Zustand stores for editor and UI theme
- `src/editor/fabric` Fabric.js helpers (guides, exports, templates)
- `src/editor/utils` utilities for color, units, and IndexedDB
- `src/index.css` global styles and Tailwind layers
- `tailwind.config.js` Tailwind configuration

## Configuration Notes
- Canvas presets live in `src/editor/components/ProjectPresets.tsx`.
- Canvas quick presets live in `src/editor/components/CanvasSettingsPopover.tsx`.
- UI theme presets are defined in `src/editor/state/uiThemeStore.ts`.
- Built-in templates live in `src/editor/components/TemplateBrowser.tsx` and `src/editor/fabric/blueprintFactories.ts`.
- Print constants and unit conversion live in `src/editor/utils/units.ts`.

## Build Output
Production builds are emitted to `dist/`.
