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
    await expect(sheet).toHaveScreenshot('historical-page-49.png', {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixelRatio: 0.02,
    });

    await page.getByTestId('document-page-tab-1').click();
    await expect(sheet).toHaveScreenshot('historical-page-50.png', {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixelRatio: 0.02,
    });

    await page.getByTestId('document-page-tab-2').click();
    await expect(sheet).toHaveScreenshot('historical-page-51.png', {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixelRatio: 0.02,
    });

    await page.getByTestId('document-page-tab-3').click();
    await expect(sheet).toHaveScreenshot('historical-page-52.png', {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixelRatio: 0.02,
    });

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
});
