# Scanned PDF reference rendering fix

## Root cause

The reference-layer stacking fix from `031bf487` was structurally correct: the
live export root is transparent and the paper colour belongs to the page sheet.
The remaining importer defect was earlier in the pipeline. `renderFirstPdfPageAsDocumentAsset()` treated a completed PDF.js render and a
successful `canvas.toBlob()` as proof that the page had been painted. A blank or
transparent canvas could therefore become a valid-looking PNG with dimensions,
be stored as an asset, and show reference controls even though there was no
reference content to composite.

The first failing stage is therefore C — raster content after PDF.js render and
before PNG ingestion. The prior implementation did not inspect that stage.
The new regression deliberately returns a transparent canvas while allowing
`toBlob()` and image dimensions to succeed; it failed before this fix and now
rejects with `REFERENCE_PDF_RENDER_EMPTY`.

The generated browser scan fixture also confirmed that Chromium can paint a
normal raster image-XObject PDF through the existing layer. That separated the
missing raster-content guarantee from the already-fixed editor layering path.

## Why the previous test was a false positive

The earlier test used a PDF containing only a vector-filled rectangle. It then
changed the imported reference to `stretch` and opacity `1` before sampling a
pixel near page coordinate 10,10. That verified a simple vector paint and the
margin/background stack, but did not exercise a scanned image XObject, PDF.js
image decoding, the default `contain` geometry, or the default opacity `0.35`.

The new fixture is generated in
`e2e/fixtures/scanned-reference-page.ts`. It creates a 1600×2200 grayscale scan
with paper tone, text-like marks, two photographic regions, and a JPEG image
XObject wrapped in a one-page PDF. The same raster is also uploaded directly as
PNG.

## Raster validation

After `page.render()` and before `canvasToBlob`, the importer downsamples the
canvas to at most 250,000 pixels and records:

- canvas width and height;
- sampled pixel count;
- non-transparent and meaningful pixel counts;
- alpha coverage;
- luminance minimum, maximum, and variance;
- a `hasMeaningfulPaint` result.

Fully transparent, empty, or uniform near-white output is rejected. Sparse pages
are retained when the bounded sample contains meaningful painted pixels. The
diagnostic callback is available to tests and development builds. In the
Chromium scan regression, PDF.js produced:

```
rendered canvas       1200 × 1650
sampled pixels        249636
non-transparent       249636
alpha coverage        1
luminance             41 – 239
luminance variance    4237.9029
has meaningful paint  true
```

An empty PDF render now stops before `addAsset`/`setReference`, and the user sees
“That PDF page could not be rendered as a visible reference.” rather than a
success message.

## PDF.js and Tauri/WebKit

The installed version is `pdfjs-dist 5.4.530`. Its installed typings and source
were inspected before configuring the boundary. The supported options used here
are `isImageDecoderSupported`, `isOffscreenCanvasSupported`,
`canvasMaxAreaInBytes`, and `wasmUrl`.

The importer explicitly disables the browser `ImageDecoder` and worker
`OffscreenCanvas` paths for this rendering job. This avoids differences between
Chromium and WebKit for large/custom-profile scanned images. The matching PDF.js
decoder resources are exposed by the Vite plugin in development and emitted in
the production frontend at:

```
pdfjs-wasm/openjpeg.wasm
pdfjs-wasm/openjpeg_nowasm_fallback.js
pdfjs-wasm/qcms_bg.wasm
```

The Tauri environment reports WebKitGTK 2.50.4. There is no WebKit WebDriver or
existing Tauri interaction harness in this checkout, so a full automated
desktop pointer/screenshot test was unavailable. The available Tauri validation
passed: Rust tests passed, the debug Debian bundle built, and the bundled binary
contains all three `pdfjs-wasm` resource paths. The production bundle uses the
same PDF.js configuration and assets as the browser build.

## Default visual state and composition

The primary Chromium test imports the scanned PDF and asserts, before changing
any controls:

```
visible  = true
fit      = contain
opacity  = 0.35
scale    = 1
offsetX  = 0
offsetY  = 0
```

It verifies decoded image dimensions, the PDF raster diagnostic, computed
opacity/object-fit, a transparent live export root, and screenshot differences
between visible and hidden reference states at text-like, photographic, and
light scan coordinates. The visible state differs measurably from the hidden
state at the sampled content pixels.

The final editor stack remains:

```
document-page-sheet       paper background
  ScanReferenceLayer      editor-only scan, z-index 1
  document-page-export-root authored content, z-index 2, transparent live
  editor/transform chrome above the authored content
```

The reference layer has page-sized geometry and `pointer-events: none` unless
reference adjustment is active. Adjustment mode temporarily enables its pointer
events and disables the authored root so the scan can be moved without moving a
photo. The reference remains physically excluded from export.

## PNG control and persistence

Uploading the same generated raster directly as PNG produces a visibly
equivalent result to the PDF path within the test tolerance. This isolates the
layering path from PDF rasterization.

The scanned-PDF regression then adds a page, switches away and back, saves,
reopens the project, waits for the reference image to decode, and repeats the
pixel assertions. The reference remains visible with `contain` and `0.35`
opacity after reopen. The existing asset/reference store path continues to
persist the asset ID and page `reference.assetId`.

The export assertion samples the same dark scan area after PNG export and gets
the paper colour `[250, 248, 245, 255]`, confirming the scan is absent while the
paper background remains correct. Existing PNG/PDF export exclusion tests remain
green.

## Diagnostics

The implementation exposes development/test evidence for these states:

```
REFERENCE_MISSING_STATE
REFERENCE_ASSET_MISSING
REFERENCE_SOURCE_MISSING
REFERENCE_IMAGE_DECODE_FAILED
REFERENCE_PDF_RENDER_EMPTY
REFERENCE_PRESENT_BUT_OCCLUDED
```

The page and reference layer carry source/decode diagnostic data attributes.
Occlusion is checked at the browser composition boundary through computed styles,
page-sized rectangles, and visible-vs-hidden screenshot samples.

## Validation

Passed:

- scanned PDF default-state, PNG equivalence, persistence, and export tests;
- full reconstruction page-space Chromium suite: 7 tests;
- secondary-photo selection, transform alignment, and span preservation suites:
  11 tests;
- full Vitest: 58 files, 607 tests;
- Vitest coverage run: 58 files, 607 tests;
- TypeScript (`npx tsc --noEmit`);
- ESLint with zero warnings;
- production Vite build;
- `npm run validate`;
- recovery tests: 3 passed;
- Rust/Tauri tests: 20 passed;
- Tauri debug Debian bundle build;
- `tauri info` runtime audit.

The full 72-test Chromium run completed 71 tests successfully. The one remaining
failure is the unchanged historical visual snapshot for page 49: its checked-in
image expects 632×816 pixels while the current runtime produces 618×798. No
historical snapshot was updated, and the scanned-reference, reconstruction,
selection, transform, span, export, and persistence tests all passed.

No historical visual snapshots were changed.

## Remaining limitations

- There is no automated WebKit/Tauri interaction harness in the repository, so
  the desktop result is covered by the production bundle/resource audit rather
  than a real WebKit screenshot test.
- Only the first PDF page is imported, as before.
- The raster sanity check is intentionally bounded and detects obvious empty
  output; it cannot determine whether a non-empty scan is semantically the
  correct page.
- Existing file-size and rendered-pixel limits remain in place for very large
  references.
