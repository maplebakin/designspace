# Document export architecture

Document export starts from a frozen `DocumentProjectPayload` snapshot. The
live editor is never used as an export root. `mountCommittedDocumentExportPages`
clones the normalized project, mounts every page offscreen at one CSS pixel per
96th inch, and renders `DocumentPageView` plus `FlowEditor` for each page. This
keeps paper, margins, folios, named styles, drop caps, image captions, groups,
and structured exclusion rectangles on the same contract as editing.

`DocumentExportService` consumes the resulting ordered
`DocumentExportPageSource[]`:

- selected PNG exports one source at 300 DPI;
- all-page PNG exports sources sequentially as deterministic numbered files;
- PDF rasterizes one page at a time and places each PNG in a jsPDF page with
  that source's physical dimensions; and
- print creates one committed print host containing all cleaned page clones.

The detached page surface is always measured in unzoomed CSS pixels (96 CSS
pixels per inch) and converted once to the rounded raster dimensions. The
live page sheet has a one-pixel editor border; export clones intentionally
reset the root to a relative `(0, 0)` page surface and leave clipping to the
explicit XHTML/SVG wrapper (print restores a page-local clip). This prevents
the bordered sheet's containing-block offset from trimming the final image or
caption rows while preserving the physical page box.

The clean-clone step removes editor chrome, scan references, selection state,
resize handles, placeholders, and other `data-document-export-exclude`
content. Fonts are awaited through `document.fonts.ready` before rasterization.
Low effective source-image DPI is reported to the caller. The export service
does not persist preview geometry and export actions therefore cannot capture a
pointermove that has not been committed to the project store.

PDF is intentionally raster-backed for this roadmap. It preserves page order,
physical MediaBoxes, image placement, wrapping, captions, groups, background,
and folios, but text is not selectable. Rendering is sequential to avoid
holding four 300-DPI canvases simultaneously. A future vector/text renderer can
reuse the same `DocumentExportPageSource` and layout contract.

Mixed-size PDF pages are supported by `exportPdfPagesBlob`. Browser print uses
one shared print CSS host and should be treated as a same-size page workflow;
the historical acceptance fixture uses Letter on all four pages.
