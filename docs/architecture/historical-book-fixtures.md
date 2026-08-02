# Historical book acceptance fixtures

`src/document/fixtures/historicalBookFixtures.ts` is the deterministic source
for the four-page acceptance document. It deliberately uses a small
repository-local placeholder PNG and representative German paragraphs: the
page-numbered source photographs and a verified transcription were not present
in this repository when the fixture was created.

The fixture is a normal version-5 document project, not a test-only shape. It
therefore exercises the same persisted contracts as a user project:

- four independent page stories with German page language;
- 49–52 folios with outside-bottom parity;
- named article-title, body, subsection, quotation, and author-signature
  paragraph roles;
- page 49's blue multiline title, drop cap, lower-right spanning image,
  caption, and wrapping exclusion;
- page 50's subsection headings and declarative row group;
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
  -g "captures reviewed visual crops" --update-snapshots
```

The baseline environment is Chromium at the repository Playwright version,
1920×1080 viewport, CSS-scale screenshots, disabled animations, and browser
font loading. Do not accept a baseline update without checking the title/drop
cap, image/caption boundaries, wrapping region, and folio parity. If actual
source photographs or a reviewed transcription are later added, update the
fixture assets/text separately and record the source provenance in the change.

PDF output remains intentionally raster-backed. The browser test verifies four
ordered pages and physical Letter MediaBoxes; selectable PDF text is a future
renderer concern.
