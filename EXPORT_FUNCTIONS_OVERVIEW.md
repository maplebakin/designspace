# Design Space — Export Functions (Refined)

## Quick Matrix

| Function | Output | Includes | Excludes | Side Effects | UI Wired |
|---|---|---|---|---|---|
| `fabric/exportUtils.downloadSvg` | `.svg` download | Full canvas SVG, cleaned markup | N/A (depends on canvas state) | Triggers download; temporarily resets zoom/viewport | ❌ (store path uses this only for generic SVG export) |
| `fabric/exportUtils.downloadPng` | `.png` download | Canvas raster with multiplier | N/A (depends on canvas state) | Triggers download; temporarily resets zoom/viewport | ❌ |
| `fabric/exportUtils.downloadJpeg` | `.jpeg` download | Canvas raster with multiplier + quality | N/A (depends on canvas state) | Triggers download; temporarily resets zoom/viewport | ❌ |
| `fabric/exportUtils.downloadPdf` | `.pdf` download | PNG snapshot embedded into 1-page PDF sized to canvas | N/A (depends on canvas state) | Triggers download; temporarily resets zoom/viewport | ❌ |
| `fabric/exportCanvas.exportCanvas` | `Blob` (`png`/`jpeg`) | Non-guide objects, cloned props, optional canvas bg, clip/full-bounds logic | Guide objects | Creates temp canvas internally | ✅ (via `editorStore` for png/jpeg) |
| `fabric/exportCanvas.downloadExportedCanvas` | `.png/.jpeg` download | Result of above blob export | Guide objects | Triggers download | ✅ |
| `services/exportService.exportCanvasToImage` | structured result object | dataURL + filename + size + metadata + validations | No explicit guide filtering | none | ❌ |
| `services/exportService.exportAndDownload` | download + result object | same as above + download | No explicit guide filtering | triggers download | ❌ |
| `utils/renderToPng.renderCanvasToPngBlob` | PNG `Blob` | Core object rendering, optional background, scale | Guides + smart guides | none | ✅ (Export modal PNG) |
| `utils/serializeToSVG.serializeToSVG` | SVG string | Objects, transforms, optional background, font stack | Guides + smart guides | none | ✅ (Export modal SVG) |
| `utils/advancedExports.exportCanvas` | `Blob` (varies by format) | Raster/SVG/PDF/multi-page routing | option-driven | varies | ❌ |
| `utils/advancedExports.exportPdf` | PDF `Blob` | Single-page, scaled-to-page, optional metadata | option-driven | none | ❌ |
| `utils/advancedExports.exportMultiPagePdf` | PDF `Blob` | Multi-page object sets, optional page numbers + metadata | option-driven | none | ❌ |
| `utils/advancedExports.exportWithBleedAndCropMarks` | delegated result | Bleed + optional crop marks | option-driven | may mutate temp canvas | ❌ |

---

## Current Export Pipeline (What users actually hit)

### A) Main editor store action (`editorStore.exportCanvas`)
1. If format = `svg` -> `fabric/exportUtils.downloadSvg`
2. Else (`png`/`jpeg`) -> `fabric/exportCanvas.downloadExportedCanvas`

### B) Export modal (`ExportModal.tsx`)
1. PNG button -> `renderCanvasToPngBlob` -> download
2. SVG button -> `serializeToSVG` -> download

> Meaning there are **two active export paths** in practice: 
> - Store-driven export actions
> - Export modal-specific render/serialize path

---

## Function Contracts (Deep Dive)

## [DOWNLOAD][UI_WIRED_SVG_STORE] `downloadSvg(canvas, fileName='design')`
**Source:** `src/editor/fabric/exportUtils.ts`
- **Input options:** `canvas`, `fileName`
- **Includes:** full canvas dimensions + Fabric SVG output + cleaning pass
- **Excludes:** no explicit object filtering
- **Side effects:** download trigger; temporary zoom/viewport reset then restore
- **Known caveats:** output depends on whatever is visible/serialized in current canvas state

## [RETURNS_BLOB][UI_WIRED_PNG_JPEG_STORE] `exportCanvas(canvas, { format, quality, multiplier, clipToCanvas })`
**Source:** `src/editor/fabric/exportCanvas.ts`
- **Input options:**
  - `format: 'png'|'jpeg'`
  - `quality` (jpeg)
  - `multiplier`
  - `clipToCanvas`
- **Includes:**
  - cloned non-guide objects
  - custom props: `id`, `tokenRole`, `colorLocked`, `isPlaceholder`, `adjustments`
  - optional canvas background
  - scaled stroke widths
- **Excludes:** objects with `isGuide`
- **Side effects:** uses temporary export canvas instance
- **Known caveats:** full-bounds mode adds fixed 20px padding

## [DOWNLOAD][UI_WIRED_PNG_JPEG_STORE] `downloadExportedCanvas(canvas, options)`
**Source:** `src/editor/fabric/exportCanvas.ts`
- **Input options:** same as `exportCanvas`
- **Includes:** blob output from `exportCanvas`
- **Excludes:** same as `exportCanvas`
- **Side effects:** browser download, filename `design-{timestamp}.{format}`

## [RETURNS_BLOB][UI_WIRED_MODAL_PNG] `renderCanvasToPngBlob(canvas, { scale, includeBackground, backgroundColor })`
**Source:** `src/editor/utils/renderToPng.ts`
- **Input options:** scale/background flags
- **Includes:** custom renderer for rect/circle/triangle/polygon/path/text/image + optional bg
- **Excludes:** `isGuide` and `isSmartGuide`, hidden objects
- **Side effects:** none
- **Known caveats:** custom renderer scope may diverge from full Fabric feature parity

## [RETURNS_STRING][UI_WIRED_MODAL_SVG] `serializeToSVG(objects, { width, height, includeBackground, backgroundColor, fontFamily })`
**Source:** `src/editor/utils/serializeToSVG.ts`
- **Input options:** object list + canvas metadata
- **Includes:** transforms, grouped object serialization, optional background rect, text/font attrs
- **Excludes:** `isGuide`, `isSmartGuide`, hidden objects
- **Side effects:** none
- **Known caveats:** serialization is hand-rolled and may not cover every Fabric edge case

## [RETURNS_OBJECT][NOT_WIRED] `exportCanvasToImage(canvas, options)`
**Source:** `src/editor/services/exportService.ts`
- **Input options:** `format`, `quality`, `multiplier`, `fileName` (+ unused flags)
- **Includes:** validation + dataURL + generated filename + size + metadata
- **Excludes:** no explicit guide filtering
- **Side effects:** none
- **Known caveats:** non-raster formats passed to `toDataURL` fallback to PNG

## [DOWNLOAD][NOT_WIRED] `exportAndDownload(canvas, options)`
**Source:** `src/editor/services/exportService.ts`
- **Input options:** same as above
- **Includes:** `exportCanvasToImage` output and download
- **Excludes:** no explicit guide filtering
- **Side effects:** triggers browser download

## [RETURNS_BLOB][NOT_WIRED] `advancedExportManager.exportPdf(...)`
**Source:** `src/editor/utils/advancedExports.ts`
- **Input options:** page/pdf options
- **Includes:** single-page PDF, scaled + centered content, optional metadata
- **Excludes:** guide handling option-dependent
- **Side effects:** uses temp canvas

## [RETURNS_BLOB][NOT_WIRED] `advancedExportManager.exportMultiPagePdf(...)`
**Source:** `src/editor/utils/advancedExports.ts`
- **Input options:** page list + PDF options
- **Includes:** one page per provided page config, optional page numbers/metadata
- **Excludes:** option-dependent
- **Side effects:** temp canvas per page

## [RETURNS_BLOB][NOT_WIRED] `advancedExportManager.exportWithBleedAndCropMarks(...)`
**Source:** `src/editor/utils/advancedExports.ts`
- **Input options:** bleed + crop mark flags + base export options
- **Includes:** bleed expansion + optional crop marks
- **Excludes:** option-dependent
- **Side effects:** temp bleed canvas when needed
- **Known caveats:** advanced SVG branch in this module appears to mix string and dataURL handling logic

---

## Suggested normalization target (for future cleanup)

If you want one canonical pipeline, define a single shared export core with:
- fixed include/exclude rules,
- consistent background behavior,
- shared filename policy,
- shared metadata generation,
- and one UI adapter per surface (store action vs modal).

That would remove drift between current store path and modal path.
