import { expect, test } from './test-fixtures';
import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFDict, PDFRawStream, PDFArray } from 'pdf-lib';

test('create, edit, reuse, save/reopen and export the three-page printable pilot through the UI', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(20_000);
  await page.goto('/');
  await page.getByTestId('dashboard-new-document').click();
  await expect(page.getByTestId('document-editor-shell')).toBeVisible();
  await page.getByTestId('document-project-name').fill('The Things We Carry — demonstration');
  await page.getByTestId('document-project-name').press('Tab');
  await page.getByRole('tab', { name: 'Document' }).click();
  await page.getByTestId('document-page-preset').selectOption('letter');
  await page.getByRole('button', { name: 'Apply current page setup to all pages' }).click();
  await page.getByRole('button', { name: 'Apply document typography' }).click();
  await page.getByRole('tab', { name: 'Pages' }).click();
  await page.getByRole('button', { name: 'Add cover design' }).click();
  const title = page.locator('.document-title-prosemirror');
  const body = page.locator('.document-flow-prosemirror').first();
  await title.fill('The Things We Carry');
  await body.locator('p').first().fill('A remembrance and reflection journal · Demonstration edition');
  await body.locator('p').last().fill('WitchClick · Sample content, not the final manuscript');
  await title.click();
  await page.getByRole('tab', { name: 'Writing' }).click();
  await page.getByLabel('Space before text block').fill('140');
  await page.getByLabel('Space after text block').fill('20');
  await page.getByRole('button', { name: 'Set selected block spacing' }).click();
  await expect(title.locator('p')).toHaveCSS('padding-top', '140px');
  await page.getByTestId('document-image-file-input').setInputFiles('e2e/fixtures/publishing-botanical.png');
  await expect(body.locator('img')).toHaveCount(1);
  await page.getByTestId('document-image-width').fill('380');
  await page.getByTestId('document-image-width').press('Tab');
  await page.getByTestId('document-image-wrap').selectOption('behind');
  await page.getByRole('button', { name: 'Photo 1 Behind text' }).click();
  await page.getByLabel('Overlay X position').fill('215');
  await page.getByLabel('Overlay Y position').fill('500');
  await page.getByLabel('Overlay Y position').press('Tab');

  await page.getByRole('tab', { name: 'Pages' }).click();
  await page.getByRole('button', { name: 'Add guide design' }).click();
  await title.fill('One thing worth keeping');
  await body.locator('p').nth(0).fill('Choose an ordinary memory');
  await body.locator('p').nth(1).fill('Demonstration text: Think of one small detail you would like to remember. You can write about a person, a place, an object, or a moment. You may pause or skip this page.');
  await body.locator('p').nth(4).fill('Demonstration example: I remember the sound of the kettle, and how there was always a cup waiting for me.');
  await page.getByLabel('Saved layout name').fill('Reflection guide');
  await page.getByRole('button', { name: 'Save current page as layout' }).click();
  await expect(page.getByLabel('Saved page layouts').locator('option')).toHaveCount(2);

  await page.getByRole('button', { name: 'Add worksheet design' }).click();
  await title.fill('A memory I want to keep');
  await body.locator('p').first().fill('Demonstration prompt: What small detail comes back to you?');
  const rules = body.locator('[data-document-writing-area]');
  await expect(rules).toHaveCount(1);
  await rules.click({ position: { x: 10, y: 10 } });
  await page.getByRole('tab', { name: 'Writing' }).click();
  await page.getByLabel('Writing line count').fill('14');
  await page.getByLabel('Writing line spacing').fill('34');
  await page.getByLabel('Writing rule weight').fill('1.5');
  await page.getByLabel('Writing rule colour').fill('#000000');
  await page.getByRole('button', { name: 'Update selected writing area' }).click();
  await expect(rules).toHaveCSS('min-height', '476px');
  await expect(rules).toHaveAttribute('data-document-writing-area-selected', 'true');
  await expect(rules).toHaveCSS('outline-style', 'solid');
  await expect(page.getByTestId('selected-writing-area-status')).toContainText('14 lines · 34 px · #000000 · 1.5 pt');
  const rendering = await page.evaluate(async () => {
    const { createCleanDocumentClone } = await import('/src/document/services/documentExportService.ts');
    const source = document.querySelector<HTMLElement>('[data-document-export-root]')!;
    const sourceArea = source.querySelector<HTMLElement>('[data-document-writing-area]')!;
    const clone = createCleanDocumentClone(source);
    const cloneArea = clone.querySelector<HTMLElement>('[data-document-writing-area]')!;
    const liveStyle = getComputedStyle(sourceArea);
    return {
      liveRule: liveStyle.backgroundImage,
      exportRule: cloneArea.style.backgroundImage,
      liveSize: liveStyle.backgroundSize,
      exportSize: cloneArea.style.backgroundSize,
      exportSelectedMarker: cloneArea.hasAttribute('data-document-writing-area-selected'),
      exportSelectedClass: cloneArea.classList.contains('document-writing-area--selected'),
    };
  });
  expect(rendering.liveRule).toContain('rgb(0, 0, 0)');
  expect(rendering.exportRule).toBe(rendering.liveRule);
  expect(rendering.exportSize).toBe(rendering.liveSize);
  expect(rendering.exportSelectedMarker).toBe(false);
  expect(rendering.exportSelectedClass).toBe(false);

  await rules.first().click({ position: { x: 10, y: 10 } });
  await rules.first().fill('This writing area remains editable.');

  // A duplicated worksheet is a second editable writing area; selection and
  // inspector values must follow it, then return to the original page.
  await page.getByRole('tab', { name: 'Pages' }).click();
  await page.getByRole('button', { name: 'Duplicate current page' }).click();
  await expect(page.getByTestId('document-page-navigation').getByRole('tab')).toHaveCount(4);
  const secondRules = page.locator('.document-flow-prosemirror').first().locator('[data-document-writing-area]');
  await secondRules.click({ position: { x: 10, y: 10 } });
  await page.getByRole('tab', { name: 'Writing' }).click();
  await expect(secondRules).toHaveAttribute('data-document-writing-area-selected', 'true');
  await expect(page.getByLabel('Writing line count')).toHaveValue('14');
  await page.getByLabel('Writing line count').fill('7');
  await page.getByLabel('Writing line spacing').fill('28');
  await page.getByLabel('Writing rule weight').fill('0.5');
  await page.getByLabel('Writing rule colour').fill('#713B59');
  await page.getByRole('button', { name: 'Update selected writing area' }).click();
  await expect(page.getByLabel('Writing line count')).toHaveValue('7');
  await expect(page.getByLabel('Writing line spacing')).toHaveValue('28');
  await expect(page.getByLabel('Writing rule weight')).toHaveValue('0.5');
  await expect(page.getByLabel('Writing rule colour')).toHaveValue('#713b59');
  await expect(page.getByTestId('selected-writing-area-status')).toContainText('7 lines · 28 px · #713B59 · 0.5 pt');
  await page.getByTestId('document-page-tab-2').click();
  const originalRules = page.locator('.document-flow-prosemirror').first().locator('[data-document-writing-area]');
  await originalRules.click({ position: { x: 10, y: 10 } });
  await expect(page.getByLabel('Writing line count')).toHaveValue('14');
  await expect(page.getByLabel('Writing rule colour')).toHaveValue('#000000');
  await page.getByTestId('document-page-tab-3').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('document-remove-page').click();
  await expect(page.getByTestId('document-page-navigation').getByRole('tab')).toHaveCount(3);

  // A saved layout is a fresh editable page and survives a library reopen.
  await page.getByRole('tab', { name: 'Pages' }).click();
  await page.getByLabel('Saved page layouts').selectOption({ label: 'Reflection guide' });
  await page.getByRole('button', { name: 'Insert saved layout' }).click();
  await expect(page.getByTestId('document-page-navigation').getByRole('tab')).toHaveCount(4);
  await title.fill('An independent guide copy');
  await page.getByTestId('document-page-tab-1').click();
  await expect(title).toHaveText('One thing worth keeping');
  await page.getByTestId('document-page-tab-3').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('document-remove-page').click();
  await expect(page.getByTestId('document-page-navigation').getByRole('tab')).toHaveCount(3);

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('document-save-status')).toHaveText('Saved');
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await page.getByTestId('dashboard-project-card').filter({ hasText: 'The Things We Carry' }).getByRole('button', { name: /open/i }).click();
  await expect(page.getByTestId('document-page-navigation').getByRole('tab')).toHaveCount(3);
  await page.getByTestId('document-page-tab-2').click();
  await expect(rules.first()).toHaveCSS('min-height', '476px');
  await expect(rules.first()).toHaveText('This writing area remains editable.');
  await expect(body.locator('[data-document-writing-area]')).toHaveCount(1);
  await expect(body.locator('[data-document-writing-area]')).toHaveCSS('background-image', /rgb\(0, 0, 0\)/);
  expect(await rules.first().evaluate((element) => getComputedStyle(element).backgroundImage)).toContain('rgb(0, 0, 0) 32px, rgb(0, 0, 0) 34px');
  await expect(title.locator('p')).toHaveCSS('font-family', 'Cinzel, serif');
  await page.evaluate(async () => {
    await document.fonts.ready;
    if (!document.fonts.check('400 18px "Cormorant Garamond"') || !document.fonts.check('700 38px "Cinzel"')) throw new Error('Publishing fonts are not loaded.');
  });

  await page.getByRole('tab', { name: 'Document' }).click();
  await page.getByRole('button', { name: 'Review all pages' }).click();
  await expect(page.getByRole('dialog', { name: 'Review document' }).getByRole('button', { name: /Edit page/ })).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath('pilot-review.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close review' }).click();

  // Download exactly what the user authored, not a product-specific fixture.
  await page.getByRole('button', { name: 'File', exact: true }).click();
  const projectDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Project', exact: true }).click();
  const projectFile = await projectDownload;
  await writeFile(testInfo.outputPath('pilot.apocaproject.json'), await readFile((await projectFile.path())!));

  const exportPdf = async (grayscale: boolean, paper: 'letter' | 'a4' = 'letter') => {
    await page.getByRole('checkbox', { name: 'Export in grayscale' }).setChecked(grayscale);
    await page.getByText('Export', { exact: true }).click();
    const pending = page.waitForEvent('download', { timeout: 20_000 }).catch(async (error) => { throw new Error(`${error.message} Status: ${(await page.locator('[role=status]').allTextContents()).join('; ')}`); });
    await page.getByRole('button', { name: 'PDF with embedded fonts', exact: true }).click();
    const download = await pending;
    const bytes = await readFile((await download.path())!);
    await writeFile(testInfo.outputPath(grayscale ? 'pilot-gray.pdf' : 'pilot-colour.pdf'), bytes);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(3);
    for (const sheet of pdf.getPages()) {
      expect(sheet.getWidth()).toBeCloseTo(paper === 'letter' ? 612 : 210 / 25.4 * 72, 1);
      expect(sheet.getHeight()).toBeCloseTo(paper === 'letter' ? 792 : 297 / 25.4 * 72, 1);
      const resources = sheet.node.Resources()!;
      const fontDictionary = resources.lookup(PDFName.of('Font'), PDFDict);
      expect(fontDictionary.entries().length).toBeGreaterThan(0);
      for (const [, fontRef] of fontDictionary.entries()) {
        const font = pdf.context.lookup(fontRef, PDFDict);
        const descendants = font.lookup(PDFName.of('DescendantFonts'), PDFArray);
        const descendant = pdf.context.lookup(descendants.get(0), PDFDict);
        const descriptor = descendant.lookup(PDFName.of('FontDescriptor'), PDFDict);
        expect(descriptor.lookup(PDFName.of('FontFile2'))).toBeInstanceOf(PDFRawStream);
        expect(font.lookup(PDFName.of('ToUnicode'))).toBeInstanceOf(PDFRawStream);
      }
    }
    const inspected = await page.evaluate(async ({ base64, grayscale }) => {
      const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
      const data = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const document = await pdfjs.getDocument({ data }).promise;
      const first = await document.getPage(1);
      const text = await first.getTextContent();
      const canvas = window.document.createElement('canvas');
      const viewport = first.getViewport({ scale: 1 });
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d')!;
      await first.render({ canvasContext: context, viewport }).promise;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let colouredPixels = 0; let inkPixels = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const [red, green, blue] = pixels.slice(offset, offset + 3);
        if (Math.max(red, green, blue) - Math.min(red, green, blue) > 2) colouredPixels += 1;
        if (Math.min(red, green, blue) < 240) inkPixels += 1;
      }
      const worksheet = await document.getPage(3);
      const worksheetCanvas = window.document.createElement('canvas');
      const worksheetViewport = worksheet.getViewport({ scale: 1 });
      worksheetCanvas.width = Math.ceil(worksheetViewport.width);
      worksheetCanvas.height = Math.ceil(worksheetViewport.height);
      const worksheetContext = worksheetCanvas.getContext('2d')!;
      await worksheet.render({ canvasContext: worksheetContext, viewport: worksheetViewport }).promise;
      const worksheetPixels = worksheetContext.getImageData(0, 0, worksheetCanvas.width, worksheetCanvas.height).data;
      let rulePixels = 0;
      for (let offset = 0; offset < worksheetPixels.length; offset += 4) {
        const [red, green, blue] = worksheetPixels.slice(offset, offset + 3);
        if (Math.max(red, green, blue) < 96 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 3) rulePixels += 1;
      }
      const result = { text: text.items.map((item: { str?: string }) => item.str || '').join(''), colouredPixels, inkPixels, rulePixels, preview: canvas.toDataURL('image/png'), grayscale };
      await document.destroy();
      return result;
    }, { base64: bytes.toString('base64'), grayscale });
    expect(inspected.text.replace(/\s/g, '')).toContain('TheThingsWeCarry');
    expect(inspected.inkPixels).toBeGreaterThan(3000);
    expect(inspected.rulePixels).toBeGreaterThan(5000);
    if (grayscale) expect(inspected.colouredPixels).toBe(0);
    else expect(inspected.colouredPixels).toBeGreaterThan(1000);
    await writeFile(testInfo.outputPath(grayscale ? 'pdf-gray-preview.png' : 'pdf-colour-preview.png'), Buffer.from(inspected.preview.split(',')[1], 'base64'));
    await page.getByText('Export', { exact: true }).click();
    return bytes;
  };
  await exportPdf(false);
  await exportPdf(true);
  await page.getByTestId('document-page-preset').selectOption('a4');
  await page.getByRole('tab', { name: 'Document' }).click();
  await page.getByRole('button', { name: 'Apply current page setup to all pages' }).click();
  expect(await page.getByTestId('document-page').evaluate((element) => parseFloat(getComputedStyle(element).width))).toBeCloseTo(210 / 25.4 * 96, 1);
  await exportPdf(false, 'a4');
});


test('unsupported typography fails explicitly rather than downloading a raster substitute', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('dashboard-new-document').click();
  await page.locator('.document-title-prosemirror').fill('A font handling check');
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  await page.getByText('Export', { exact: true }).click();
  await page.getByRole('button', { name: 'PDF with embedded fonts', exact: true }).click();
  await expect(page.getByText(/Embedded-font PDF requires Cinzel or Cormorant Garamond throughout/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'PDF with embedded fonts', exact: true })).toBeEnabled();
  expect(downloads).toBe(0);
});
