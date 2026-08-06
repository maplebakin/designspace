# Historical book acceptance fixtures

`src/document/fixtures/historicalBookFixtures.ts` is the deterministic source
for the four-page acceptance document. It uses representative German
paragraphs where no verified transcription is available. Page 50 now also
uses the two separately supplied source photographs committed under
`public/historical-book/`; pages 49, 51, and 52 retain the one-pixel fixture
asset because no source photographs were supplied for those pages.

The fixture is a normal version-5 document project, not a test-only shape. It
therefore exercises the same persisted contracts as a user project:

- four independent page stories with German page language;
- 49–52 folios with outside-bottom parity;
- named article-title, body, subsection, quotation, and author-signature
  paragraph roles;
- page 49's blue multiline title, drop cap, lower-right spanning image,
  caption, and wrapping exclusion;
- page 50's titleless three-column continuation, exact readable `Tariverde` and
  `Karatai (Nisipari)` subsection headings, and declarative row group with
  unequal child widths;
- page 51's different-height declarative stack beside flowing text; and
- page 52's short ending, quotation, signature, and intentional lower blank
  area.

The unit suite validates each page's model and portable round-trip. The
Playwright suite imports a JSON serialization of the same factory through the
normal dashboard “Open Product Project” workflow, checks page-specific DOM
landmarks, exports the committed four-page PDF/PNG workflow, and stores focused
page-sheet screenshot baselines under
`e2e/historical-book-layout.spec.ts-snapshots/`.

## Updating visual baselines intentionally

Run the focused browser test after a layout change:

```bash
npx playwright test e2e/historical-book-layout.spec.ts
```

When a visual change is intentional, review all four page crops and regenerate
only these baselines:

```bash
npx playwright test e2e/historical-book-layout.spec.ts \
  -g "exports the committed four-page fixture" --update-snapshots
```

The baseline environment is Chromium at the repository Playwright version,
1920×1080 viewport, CSS-scale screenshots, disabled animations, and browser
font loading. Do not accept a baseline update without checking the title/drop
cap, image/caption boundaries, wrapping region, and folio parity.

The page 50 JPEGs are photographic assets rather than a flattened scan: the
supplied image files were trimmed only to remove their surrounding page text
and printed caption bands, then downsampled for repository size. The editable
captions remain document nodes. The page 50 body remains representative text;
only the readable headings and captions are carried over from the reference.
Record any later transcription or source-image replacement separately with its
provenance.

Page 50 fixture geometry is persisted in page space: the image row spans all
three body columns at `yPx: 390`, uses a `22px` gap, and keeps child widths of
`350px` and `340px` (`left: 350`, `right: 340`). Each child retains its own
natural dimensions, asset ID, centered italic caption, and stable row order.
The page suppresses the otherwise empty title region so the upper text begins
at the historical continuation baseline; this is a generic page-level
`suppressTitle` capability, not a page-ID renderer special case.

WebKitGTK uses different text metrics from Chromium for the same committed
DOM. Before the page 50 fix, that difference allowed the right subsection
heading to fit as the final line of the middle physical column, leaving its
following paragraph below the image row in native PNG/PDF output. The shared
structured-column allocator now keeps a subsection heading with its following
paragraph when the boundary would orphan it. This is a generic semantic rule;
it leaves browser geometry and page 49 unchanged.

The page 50 visual checks include the full sheet plus focused top-column,
image-row, caption, and folio crops. Regenerate them only after inspecting the
reference comparison and confirming that page 49's baselines remain unchanged.

PDF output remains intentionally raster-backed. The browser test verifies four
ordered pages and physical Letter MediaBoxes; selectable PDF text is a future
renderer concern.
