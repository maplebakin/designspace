import { expect, test } from './test-fixtures';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../__tests__/fixtures/design-space-theme-v1.json',
      import.meta.url
    ),
    'utf8'
  )
);

const file = (value: unknown) => ({
  name: 'orchard-designspace-v1.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(value)),
});

test.use({ viewport: { width: 1920, height: 1080 } });

test('Document import, real page preview, cancellation, atomic undo and save/reopen', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByTestId('dashboard-new-document').click();
  await page
    .getByTestId('document-project-name')
    .fill('Theme bridge acceptance');
  await page
    .locator('.document-title-prosemirror')
    .fill('A theme for this story');
  await page
    .locator('.document-flow-prosemirror')
    .fill('Keep my content and fonts.');
  const input = page.getByLabel('Import Apocapalette JSON');
  await input.setInputFiles(file(fixture));
  await expect(
    page.getByLabel('Exact theme colours').locator('span')
  ).toHaveCount(9);
  const before = await page
    .getByTestId('document-page')
    .evaluate((el) => el.getAttribute('style'));
  await page
    .getByRole('button', { name: 'Preview theme', exact: true })
    .click();
  const preview = page.getByRole('dialog', { name: 'Theme preview' });
  await expect(preview).toBeVisible();
  await expect(preview.getByTestId('document-page')).toHaveCSS(
    'background-color',
    'rgb(24, 34, 27)'
  );
  await expect(preview.locator('.document-title-prosemirror p')).toHaveCSS(
    'color',
    'rgb(243, 241, 219)'
  );
  await page.screenshot({
    path: testInfo.outputPath('theme-bridge-document-preview.png'),
  });
  const history = await page
    .getByTestId('document-editor-shell')
    .getAttribute('data-document-history-length');
  await preview.getByRole('button', { name: 'Cancel preview' }).click();
  await expect(page.getByTestId('document-page')).toHaveAttribute(
    'style',
    before!
  );
  await expect(page.getByTestId('selected-bridge-theme')).toHaveCount(0);
  await expect(page.getByTestId('document-editor-shell')).toHaveAttribute(
    'data-document-history-length',
    history!
  );
  await page
    .getByRole('button', { name: 'Preview theme', exact: true })
    .click();
  await preview
    .getByRole('button', { name: 'Apply theme', exact: true })
    .click();
  await expect(page.getByTestId('selected-bridge-theme')).toHaveText(
    'Selected theme: Orchard at dusk'
  );
  await expect(page.getByTestId('document-page')).toHaveCSS(
    'background-color',
    'rgb(24, 34, 27)'
  );
  await expect(page.locator('.document-flow-prosemirror p')).toHaveCSS(
    'color',
    'rgb(225, 230, 214)'
  );
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('selected-bridge-theme')).toHaveCount(0);
  await expect(page.locator('.document-title-prosemirror')).toHaveText(
    'A theme for this story'
  );
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByTestId('selected-bridge-theme')).toHaveText(
    'Selected theme: Orchard at dusk'
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await page
    .getByTestId('dashboard-project-card')
    .filter({ hasText: 'Theme bridge acceptance' })
    .getByRole('button')
    .first()
    .click();
  await expect(page.getByTestId('selected-bridge-theme')).toHaveText(
    'Selected theme: Orchard at dusk'
  );
  await expect(page.getByTestId('document-page')).toHaveCSS(
    '--document-style-article-title-color',
    '#f3F1db'
  );
  await expect(page.locator('.document-flow-prosemirror')).toHaveText(
    'Keep my content and fonts.'
  );
  await page.getByRole('button', { name: 'File', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Download Project', exact: true })
    .click();
  const download = await downloadEvent;
  const saved = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(saved.document.bridgeTheme).toEqual(fixture);
  expect(saved.document.background.value).toBe(fixture.colors.background);
  expect(saved.document.styles['article-title'].color).toBe(
    fixture.colors.heading
  );
  await page.getByText('Export', { exact: true }).click();
  const pdfDownloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Raster PDF', exact: true }).click();
  const pdfDownload = await pdfDownloadEvent;
  const pdfBytes = Array.from(await readFile((await pdfDownload.path())!));
  const paperPixel = await page.evaluate(async (bytes) => {
    const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc =
      '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) })
      .promise;
    const sheet = await pdf.getPage(1);
    const viewport = sheet.getViewport({ scale: 0.5 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d')!;
    await sheet.render({ canvasContext: context, canvas, viewport }).promise;
    const pixel = Array.from(context.getImageData(10, 10, 1, 1).data);
    await pdf.destroy();
    return pixel;
  }, pdfBytes);
  expect(paperPixel).toEqual([24, 34, 27, 255]);
  await input.setInputFiles(file({ ...fixture, version: 2 }));
  await expect(page.getByRole('alert')).toContainText(
    'unsupported format/version'
  );
  await expect(page.getByTestId('selected-bridge-theme')).toHaveText(
    'Selected theme: Orchard at dusk'
  );
  await input.setInputFiles(
    file({ name: 'Old export', mode: 'light', textPrimary: '#123456' })
  );
  await expect(
    page.getByText('Legacy palette imported as swatches.', { exact: false })
  ).toBeVisible();
});

test('Freeform import preview cancels without mutation and keeps legacy swatches', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('dashboard-new-project').click();
  await page.getByTestId('project-preset-instagram-square').click();
  await expect(page.getByTestId('editor-shell')).toBeVisible();
  await page.waitForFunction(
    () => (window as any).__DESIGN_SPACE_QA__?.snapshot().canvasReady === true
  );
  await page.getByTestId('nav-shapes').click();
  await page.getByTestId('shape-rectangle').click();
  await page.evaluate(() =>
    (window as any).__DESIGN_SPACE_QA__.mutateP0FirstObject({
      fill: '#123456',
      tokenRole: 'typography.heading.value',
    })
  );
  await page.getByTestId('right-tab-theme').click();
  const panel = page.getByTestId('right-inspector-theme-panel');
  await panel.locator('input[type=file]').setInputFiles(file(fixture));
  const chrome = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--ui-bg')
  );
  const before = await page.evaluate(() =>
    (window as any).__DESIGN_SPACE_QA__.snapshot()
  );
  await page
    .getByRole('button', { name: 'Preview theme', exact: true })
    .click();
  const preview = page.getByRole('dialog', { name: 'Theme preview' });
  await expect(preview.getByRole('img')).toBeVisible();
  await preview.getByRole('button', { name: 'Cancel preview' }).click();
  const after = await page.evaluate(() =>
    (window as any).__DESIGN_SPACE_QA__.snapshot()
  );
  expect(after.objects).toEqual(before.objects);
  await page
    .getByRole('button', { name: 'Preview theme', exact: true })
    .click();
  await preview
    .getByRole('button', { name: 'Apply theme', exact: true })
    .click();
  await expect(page.getByTestId('selected-bridge-theme')).toContainText(
    'Orchard at dusk'
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__DESIGN_SPACE_QA__.snapshot().canvasObjects[0]?.fill
      )
    )
    .toBe(fixture.colors.heading);
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('selected-bridge-theme')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByTestId('selected-bridge-theme')).toContainText(
    'Orchard at dusk'
  );
  await page.getByTestId('project-name-display').click();
  await page.getByTestId('project-name-input').fill('Canvas theme bridge');
  await page.getByTestId('project-name-input').press('Enter');
  await page.getByRole('button', { name: /^File$/i }).click();
  const save = page.getByText('Save to Library');
  await save.click();
  await expect(save).toBeHidden();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page
    .getByTestId('dashboard-project-card')
    .filter({ hasText: 'Canvas theme bridge' })
    .getByRole('button')
    .first()
    .click();
  await page.getByTestId('right-tab-theme').click();
  await expect(page.getByTestId('selected-bridge-theme')).toContainText(
    'Orchard at dusk'
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__DESIGN_SPACE_QA__.snapshot().canvasObjects[0]?.fill
      )
    )
    .toBe(fixture.colors.heading);
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--ui-bg')
    )
  ).toBe(chrome);
  await panel
    .locator('input[type=file]')
    .setInputFiles(
      file({ name: 'Legacy palette', mode: 'light', brandAccent: '#123456' })
    );
  await expect(
    panel.getByText('Legacy palette', { exact: true })
  ).toBeVisible();
  await expect(panel.getByText('#123456', { exact: true })).toBeVisible();
});
