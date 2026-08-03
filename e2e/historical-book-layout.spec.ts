import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { createHistoricalBookFixtureProject } from '../src/document/fixtures/historicalBookFixtures';

const execFileAsync = promisify(execFile);

type RasterBounds = {
  width: number;
  height: number;
  redBounds: { minX: number; minY: number; maxX: number; maxY: number };
  captionRows: { min: number; max: number } | null;
};

const inspectHistoricalPageRaster = async (
  page: Page,
  bytes: Buffer
): Promise<RasterBounds> => page.evaluate(async (base64) => {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not inspect the exported raster.');
  context.drawImage(bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const offset = (y * canvas.width + x) * 4;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const alpha = pixels[offset + 3];
      if (red > 200 && green < 80 && blue < 80 && alpha > 200) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  const captionRows: number[] = [];
  if (maxY >= 0) {
    for (let y = maxY + 1; y < Math.min(canvas.height, maxY + 260); y += 1) {
      for (let x = Math.max(0, minX - 4); x <= Math.min(canvas.width - 1, maxX + 4); x += 1) {
        const offset = (y * canvas.width + x) * 4;
        const red = pixels[offset];
        const green = pixels[offset + 1];
        const blue = pixels[offset + 2];
        const alpha = pixels[offset + 3];
        if (red < 140 && green < 140 && blue < 140 && alpha > 200) {
          captionRows.push(y);
          break;
        }
      }
    }
  }
  bitmap.close();
  return {
    width: canvas.width,
    height: canvas.height,
    redBounds: { minX, minY, maxX, maxY },
    captionRows: captionRows.length > 0
      ? { min: Math.min(...captionRows), max: Math.max(...captionRows) }
      : null,
  };
}, bytes.toString('base64'));

const readFirstPdfImage = async (pdfPath: string) => {
  const directory = await mkdtemp(join(tmpdir(), 'design-space-pdf-image-'));
  const prefix = join(directory, 'page');
  try {
    await execFileAsync('pdfimages', ['-f', '1', '-l', '1', '-png', pdfPath, prefix]);
    const imagePath = `${prefix}-000.png`;
    return await readFile(imagePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

const loadHistoricalFixture = async (page: Page) => {
  const fixture = createHistoricalBookFixtureProject();
  await page.goto('/');
  await page.getByTestId('dashboard-open-file-input').setInputFiles({
    name: 'historical-book-pages-49-52.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(page.getByTestId('document-editor-shell')).toBeVisible();
};

test.describe('historical book acceptance fixture', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('opens all four page stories and preserves page-specific layout landmarks', async ({ page }) => {
    test.slow();
    test.setTimeout(180_000);
    await loadHistoricalFixture(page);

    await expect(page.getByTestId('document-page-navigation').getByRole('tab'))
      .toHaveCount(4);
    await expect(page.getByTestId('document-starting-folio')).toHaveValue('49');
    await expect(page.getByTestId('document-page')).toHaveCSS(
      'background-color',
      'rgb(250, 248, 245)'
    );

    const pageTab = (index: number) => page.getByTestId(`document-page-tab-${index}`);
    const sheet = page.getByTestId('document-page');
    const exportRoot = page.getByTestId('document-export-root');
    const body = page.locator('.document-flow-prosemirror');

    await pageTab(0).click();
    await expect(exportRoot).toHaveAttribute('data-folio-number', '49');
    await expect(exportRoot).toHaveAttribute('data-folio-side', 'right');
    await expect(body).toHaveCSS('column-count', '3');
    await expect(page.locator('.document-flow-editor')).toHaveClass(
      /document-flow-editor--drop-cap/
    );
    await expect(page.locator('.document-title-prosemirror p')).toHaveCount(2);
    await expect(page.locator('[data-document-span-layout]')).toHaveCount(1);
    await expect(page.locator('figcaption').first()).toContainText('Beispielabbildung');

    await pageTab(1).click();
    await expect(exportRoot).toHaveAttribute('data-folio-number', '50');
    await expect(exportRoot).toHaveAttribute('data-folio-side', 'left');
    await expect(body.locator('[data-document-style-id="subsection-heading"]'))
      .toHaveCount(2);
    await expect(page.locator('[data-document-span-layout]')).toHaveCount(1);
    await expect(page.locator('[data-image-group-count="1"]')).toHaveCount(1);
    await expect(page.locator('figcaption')).toHaveCount(4);

    await pageTab(2).click();
    await expect(exportRoot).toHaveAttribute('data-folio-number', '51');
    await expect(exportRoot).toHaveAttribute('data-folio-side', 'right');
    await expect(page.locator('[data-image-group-count="1"]')).toHaveCount(1);
    await expect(page.locator('figcaption')).toHaveCount(4);

    await pageTab(3).click();
    await expect(exportRoot).toHaveAttribute('data-folio-number', '52');
    await expect(exportRoot).toHaveAttribute('data-folio-side', 'left');
    await expect(body.locator('[data-document-style-id="quotation"]')).toHaveCount(1);
    await expect(body.locator('[data-document-style-id="author-signature"]')).toHaveCount(1);
    await expect(page.locator('[data-document-span-layout]')).toHaveCount(0);
  });

  test('exports the committed four-page fixture and captures reviewed visual crops', async ({ page }) => {
    test.slow();
    test.setTimeout(180_000);
    await loadHistoricalFixture(page);

    const sheet = page.getByTestId('document-page');
    const clearSelection = async () => {
      const visibleStructuredParagraph = page.locator(
        '[data-layout-role="explicit-text-column"] p:visible'
      ).first();
      if (await visibleStructuredParagraph.count() > 0) {
        await visibleStructuredParagraph.click();
      } else {
        await page.locator('.document-flow-prosemirror p:visible').first().click();
      }
      await page.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
        }));
      });
      await page.waitForTimeout(50);
    };
    await clearSelection();
    await expect(sheet).toHaveScreenshot('historical-page-49.png', {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixelRatio: 0.02,
    });
    await expect(page.getByTestId('document-body-region')).toHaveScreenshot(
      'historical-page-49-body-drop-cap-wrap.png',
      { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixelRatio: 0.02 }
    );
    await expect(page.getByTestId('document-folio')).toHaveScreenshot(
      'historical-page-49-folio.png',
      { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixelRatio: 0.02 }
    );

    // Page 49 is the lower-right wrapped-image acceptance case.  Measure the
    // live root in page-space, then compare its image/caption bottom against
    // the actual 300-DPI raster.  The page is zoomed to fit in this viewport;
    // that zoom must not leak into the export surface.
    const livePage49Geometry = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-document-export-root]');
      const sheet = document.querySelector<HTMLElement>('.document-page-sheet');
      const media = document.querySelector<HTMLElement>(
        '[data-layout-role="occupied-columns"] .document-image__media'
      );
      const caption = document.querySelector<HTMLElement>(
        '[data-layout-role="occupied-columns"] figcaption'
      );
      if (!root || !sheet || !media || !caption) {
        throw new Error('Page 49 image geometry is unavailable.');
      }
      const rootRect = root.getBoundingClientRect();
      const sheetRect = sheet.getBoundingClientRect();
      const rootCssWidth = Number(root.dataset.pageWidthIn) * 96;
      const zoom = rootRect.width / rootCssWidth;
      const pageY = (element: HTMLElement) =>
        (element.getBoundingClientRect().bottom - rootRect.top) / zoom;
      const pageTop = (element: HTMLElement) =>
        (element.getBoundingClientRect().top - rootRect.top) / zoom;
      return {
        rootCssWidth,
        rootCssHeight: Number(root.dataset.pageHeightIn) * 96,
        rootRectHeight: rootRect.height,
        sheetRectHeight: sheetRect.height,
        rootTopWithinSheetPx: (rootRect.top - sheetRect.top) / zoom,
        rootBottomWithinSheetPx: (rootRect.bottom - sheetRect.top) / zoom,
        zoom,
        imageBottomPx: pageY(media),
        captionTopPx: pageTop(caption),
        captionBottomPx: pageY(caption),
      };
    });

    // The live sheet has a one-CSS-pixel border.  Its absolute export root is
    // therefore positioned at y=1px and reaches y=1057px even though the
    // logical Letter surface is 1056px high.  That is the geometry mismatch
    // the detached export surface must remove; the raster itself is exactly
    // 1056 * (300 / 96) = 3300px high.
    expect(livePage49Geometry.rootCssHeight).toBe(1056);
    expect(livePage49Geometry.rootRectHeight).toBeCloseTo(
      livePage49Geometry.rootCssHeight * livePage49Geometry.zoom,
      1
    );
    expect(livePage49Geometry.sheetRectHeight).toBeCloseTo(
      livePage49Geometry.rootCssHeight * livePage49Geometry.zoom,
      1
    );
    expect(livePage49Geometry.rootTopWithinSheetPx).toBeCloseTo(1, 0);
    expect(livePage49Geometry.rootBottomWithinSheetPx).toBeCloseTo(1057, 0);

    const page49PngDownloadPromise = page.waitForEvent('download');
    const page49PngButton = page.getByRole('button', { name: 'PNG', exact: true });
    if (!await page49PngButton.isVisible()) {
      await page.getByText('Export', { exact: true }).click();
    }
    await expect(page49PngButton).toBeVisible();
    await page49PngButton.click();
    const page49PngDownload = await page49PngDownloadPromise;
    const page49PngPath = await page49PngDownload.path();
    expect(page49PngPath).not.toBeNull();
    const page49PngRaster = await inspectHistoricalPageRaster(
      page,
      await readFile(page49PngPath!)
    );
    const page49RasterScale = page49PngRaster.width / livePage49Geometry.rootCssWidth;
    expect(page49PngRaster).toMatchObject({ width: 2550, height: 3300 });
    expect(page49PngRaster.redBounds.maxY).toBeGreaterThan(
      livePage49Geometry.imageBottomPx * page49RasterScale - 4
    );
    expect(page49PngRaster.captionRows?.max || 0).toBeGreaterThan(
      livePage49Geometry.captionTopPx * page49RasterScale - 4
    );
    expect(page49PngRaster.captionRows?.max || 0).toBeLessThan(
      livePage49Geometry.captionBottomPx * page49RasterScale + 10
    );

    await page.getByTestId('document-page-tab-1').click();
    await clearSelection();
    await expect(sheet).toHaveScreenshot('historical-page-50.png', {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixelRatio: 0.02,
    });
    await expect(page.getByTestId('document-body-region')).toHaveScreenshot(
      'historical-page-50-body-row.png',
      { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixelRatio: 0.02 }
    );

    await page.getByTestId('document-page-tab-2').click();
    await clearSelection();
    await expect(sheet).toHaveScreenshot('historical-page-51.png', {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixelRatio: 0.02,
    });
    await expect(page.getByTestId('document-body-region')).toHaveScreenshot(
      'historical-page-51-body-stack.png',
      { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixelRatio: 0.02 }
    );

    await page.getByTestId('document-page-tab-3').click();
    await clearSelection();
    await expect(sheet).toHaveScreenshot('historical-page-52.png', {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixelRatio: 0.02,
    });
    await expect(page.getByTestId('document-body-region')).toHaveScreenshot(
      'historical-page-52-body-closing-styles.png',
      { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixelRatio: 0.02 }
    );

    const pdfDownloadPromise = page.waitForEvent('download');
    const pdfButton = page.getByRole('button', { name: 'PDF', exact: true });
    if (!await pdfButton.isVisible()) {
      await page.getByText('Export', { exact: true }).click();
    }
    await expect(pdfButton).toBeVisible();
    await pdfButton.click();
    const pdfDownload = await pdfDownloadPromise;
    const pdfPath = await pdfDownload.path();
    expect(pdfPath).not.toBeNull();
    const pdf = await PDFDocument.load(await readFile(pdfPath!));
    expect(pdf.getPages()).toHaveLength(4);
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(8.5 * 72, 1);
    expect(pdf.getPage(0).getHeight()).toBeCloseTo(11 * 72, 1);

    // jsPDF places the page PNG as one full-size image.  Extracting the first
    // PDF image and checking the same bottom bounds proves the image/caption
    // survived PDF assembly, rather than only proving the MediaBox size.
    const page49PdfRaster = await inspectHistoricalPageRaster(
      page,
      await readFirstPdfImage(pdfPath!)
    );
    expect(page49PdfRaster).toMatchObject({ width: 2550, height: 3300 });
    expect(page49PdfRaster.redBounds.maxY).toBeGreaterThan(
      livePage49Geometry.imageBottomPx * (page49PdfRaster.width / livePage49Geometry.rootCssWidth) - 4
    );
    expect(page49PdfRaster.captionRows?.max || 0).toBeGreaterThan(
      livePage49Geometry.captionTopPx * (page49PdfRaster.width / livePage49Geometry.rootCssWidth) - 4
    );
    expect(page49PdfRaster.captionRows?.max || 0).toBeLessThan(
      livePage49Geometry.captionBottomPx * (page49PdfRaster.width / livePage49Geometry.rootCssWidth) + 4
    );

    const pngDownloads: string[] = [];
    page.on('download', async (download) => {
      pngDownloads.push(download.suggestedFilename());
    });
    const allPngButton = page.getByRole('button', { name: 'PNG all pages' });
    if (!await allPngButton.isVisible()) {
      await page.getByText('Export', { exact: true }).click();
    }
    await expect(allPngButton).toBeVisible();
    const allPngDownloadPromise = page.waitForEvent('download');
    await allPngButton.click();
    await allPngDownloadPromise;
    expect(pngDownloads[0]).toBe(
      'historical-book-pages-4952-fixture-page-01.png'
    );
    await expect(page.getByTestId('document-save-status')).not.toHaveText(
      /failed/i
    );
  });

  test('keeps the wrapped page-49 flow geometry stable while selecting text and images', async ({ page }) => {
    test.slow();
    test.setTimeout(180_000);
    await loadHistoricalFixture(page);
    await page.getByTestId('document-page-tab-0').click();

    const layout = page.locator('[data-document-span-layout]');
    const body = page.locator('.document-flow-prosemirror');
    const imageSlot = page.locator('[data-layout-role="occupied-columns"]').first();

    const readGeometry = async () => layout.evaluate((root) => ({
      availableWidth: root.getAttribute('data-layout-available-width-px'),
      availableHeight: root.getAttribute('data-layout-available-height-px'),
      columnWidth: root.getAttribute('data-column-width-px'),
      exclusions: root.getAttribute('data-layout-exclusions'),
      textBands: root.getAttribute('data-layout-text-bands'),
      imageLeft: root.getAttribute('data-image-left-px'),
      imageTop: root.getAttribute('data-image-top-px'),
      imageWidth: root.getAttribute('data-rendered-image-width-px'),
      imageHeight: root.getAttribute('data-rendered-image-height-px'),
      text: Array.from(root.querySelectorAll(
        '[data-layout-role="explicit-text-column"]'
      )).map((column) => column.textContent || ''),
      imageSlots: root.querySelectorAll(
        '[data-layout-role="occupied-columns"]'
      ).length,
      sourceSpanImages: document.querySelectorAll(
        '.document-flow-prosemirror '
        + '.document-image-node[data-wrap="span-columns"]'
      ).length,
    }));

    const setZoomNear = async (targetPercent: number) => {
      const controls = page.getByTestId('document-zoom-controls');
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const current = Number.parseInt(
          await page.getByTestId('document-zoom-indicator').textContent() || '100',
          10
        );
        if (Math.abs(current - targetPercent) <= 5) return current;
        await controls.getByRole('button', {
          name: current < targetPercent ? 'Zoom in' : 'Zoom out',
        }).click();
      }
      return Number.parseInt(
        await page.getByTestId('document-zoom-indicator').textContent() || '100',
        10
      );
    };

    for (const targetZoom of [66, 100, 150]) {
      const actualZoom = await setZoomNear(targetZoom);
      expect(Math.abs(actualZoom - targetZoom)).toBeLessThanOrEqual(5);
      await expect(layout).toHaveAttribute('data-text-editing', 'false');
      const idleGeometry = await readGeometry();
      expect(idleGeometry.imageSlots).toBe(1);
      expect(idleGeometry.sourceSpanImages).toBe(1);
      expect(JSON.parse(idleGeometry.exclusions || '[]')).toHaveLength(1);

      await page.locator(
        '[data-layout-role="explicit-text-column"] p:visible'
      ).first().click();
      await expect(layout).toHaveAttribute('data-text-editing', 'true');
      await body.press('Control+a');
      await expect.poll(async () => (await readGeometry()).text.join(''))
        .toContain('Am Anfang dieser beispielhaften Seite');
      expect(await readGeometry()).toEqual(idleGeometry);
      await expect(page.locator(
        '.document-flow-editor__content--structured-text-editing '
        + '.document-image-node[data-wrap="span-columns"]'
      )).toHaveCSS('display', 'none');

      await imageSlot.click();
      await expect(layout).toHaveAttribute('data-text-editing', 'false');
      expect(await readGeometry()).toEqual(idleGeometry);

      await page.locator(
        '[data-layout-role="explicit-text-column"] p:visible'
      ).first().click();
      await expect(layout).toHaveAttribute('data-text-editing', 'true');
      expect(await readGeometry()).toEqual(idleGeometry);
    }
  });
});
