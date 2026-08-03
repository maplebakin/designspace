import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { createHistoricalBookFixtureProject } from '../src/document/fixtures/historicalBookFixtures';

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
    await page.getByText('Export', { exact: true }).click();
    await page.getByRole('button', { name: 'PDF', exact: true }).click();
    const pdfDownload = await pdfDownloadPromise;
    const pdfPath = await pdfDownload.path();
    expect(pdfPath).not.toBeNull();
    const pdf = await PDFDocument.load(await readFile(pdfPath!));
    expect(pdf.getPages()).toHaveLength(4);

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
