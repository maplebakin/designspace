# Design Space

Design Space is a desktop-first browser workspace for building editable, page-based printable products. Its visual language is rooted in tactile zine and craft-planner work, while the implementation uses Fabric.js, React, Zustand, and IndexedDB for a practical canvas-editor workflow.

The main flow is:

1. Start a blank print/digital document or generate a product from a recipe.
2. Edit text, shapes, images, themes, layers, and multiple pages on the Fabric canvas.
3. Save to the browser library or download a portable `.apocaproject.json` file.
4. Export a page or the ordered project as PDF, PNG, JPEG, or SVG.

Chaos Craft Planner and Crochet Pattern Decoder Kit are the current reference product recipes. Full editing is designed for a desktop-sized viewport; constrained screens retain project download and navigation rather than pretending the complete workstation is comfortable on a phone.

## Persistence and compatibility

- Browser-library projects are stored locally with Dexie/IndexedDB. There is no account or server sync.
- Portable project files use the versioned `design-space-project-v1` schema while retaining legacy page/canvas fields for backward compatibility.
- Image assets are embedded into portable and library payloads, including images nested in groups and on inactive pages.
- Invalid or unsupported project files are validated and staged before the current editor state is replaced.
- Undo/redo is page-local; switching pages establishes a new history baseline.

## Export and print scope

Print presets store their logical document as pixels at 300 DPI (for example, US Letter is 2550 × 3300). Export code distinguishes that source density from the requested output density so it does not silently double-scale print documents.

PDF output is raster-backed and preserves page size/order, but it is not yet a press-preflight or accessible tagged-PDF system. Font embedding, crop marks, full bleed handling, output profiles, and guaranteed licensed-font reproduction are not currently provided.

## Product Forge boundary

Product Forge is an internal seller-production workflow, not a public editor capability. Normal builds exclude its ZIP implementation and UI. An explicitly internal build may enable it with:

```bash
DESIGN_SPACE_INTERNAL_PRODUCT_FORGE=true npm run build
```

This is a build boundary, not user authentication. Do not deploy an internal build as a public multi-user service. Forge output separates printable customer deliverables under `customer-files/` from previews, listing copy, manifests, and the seller checklist under `seller-assets/`. Final license/usage terms remain a production preflight decision and are not invented by this repository; add approved terms before turning `customer-files/` into a customer download.

## Development

Requires Node.js 20 or newer.

```bash
npm ci
npm run dev
```

The development server defaults to `http://localhost:5174`.

Quality gates:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run test:coverage
npm run test:e2e
npm run build
npm audit
```

The Tauri wrapper uses the same production frontend and opens at 1200 × 800 or larger.

## Repository licensing

No root license file is currently present. Do not assume rights to redistribute bundled themes, templates, fonts, demo imagery, or the application itself until the project owner adds the applicable license and asset records.
