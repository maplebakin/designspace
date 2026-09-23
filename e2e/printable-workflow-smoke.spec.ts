import { expect, test } from './test-fixtures';
import { readFile } from 'node:fs/promises';

const snapshot = (page: any) => page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot());

test('printable workflow smoke: US Letter doc, shape, text edit, PNG+PDF export', async ({ page }) => {
  test.setTimeout(120_000);

  // 1. Create a new US Letter document (the printable page size).
  await page.goto('/');
  await page.getByTestId('dashboard-new-project').click();
  await page.getByTestId('project-preset-us-letter').click();
  await expect(page.getByTestId('editor-shell')).toBeVisible();
  await page.waitForFunction(() => (window as any).__DESIGN_SPACE_QA__?.snapshot().canvasReady === true);
  const docSize = (await snapshot(page)).documentSize;
  expect(docSize.width).toBe(2550);
  expect(docSize.height).toBe(3300);
  console.log('STEP 1 OK: US Letter document created', JSON.stringify(docSize));

  // 2. Add a rectangle shape.
  await page.getByTestId('nav-shapes').click();
  await page.getByTestId('shape-rectangle').click();
  await expect
    .poll(async () => (await snapshot(page)).objects.filter((o: any) => o.type === 'rect').length)
    .toBe(1);
  console.log('STEP 2 OK: rectangle added');

  // 3. Add heading text via Insert > Text > Heading.
  await page.getByTestId('nav-insert').click();
  const panel = page.locator('.design-space-left-content');
  await panel.getByRole('button', { name: 'Text', exact: true }).click();
  await panel.getByRole('button', { name: 'Heading', exact: true }).click();
  await expect
    .poll(async () => (await snapshot(page)).objects.filter((o: any) => (o.type || '').includes('text')).length)
    .toBe(1);
  console.log('STEP 3 OK: heading text added');

  // 4. Edit the text: adding a Heading auto-enters editing mode; type directly.
  await expect
    .poll(async () => (await snapshot(page)).objects.find((o: any) => (o.type || '').includes('text'))?.isEditing)
    .toBe(true);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Planner Title', { delay: 15 });
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await snapshot(page)).objects.find((o: any) => (o.type || '').includes('text'))?.text)
    .toBe('Planner Title');
  console.log('STEP 4 OK: text edited (auto-edit on insert + type + commit)');

  // 5a. Export PNG.
  await page.getByTestId('editor-toolbar').getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const pngPromise = page.waitForEvent('download');
  await page.getByTestId('export-png').click();
  const pngDownload = await pngPromise;
  const pngPath = await pngDownload.path();
  const pngBytes = await readFile(pngPath!);
  expect(pngBytes.length).toBeGreaterThan(5000);
  expect([pngBytes[0], pngBytes[1], pngBytes[2], pngBytes[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  console.log(`STEP 5a OK: PNG exported (${pngBytes.length} bytes)`);

  // 5b. Export PDF (the dialog closes after each export, so reopen it).
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15000 });
  await page.getByTestId('editor-toolbar').getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const pdfPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const pdfDownload = await pdfPromise;
  const pdfPath = await pdfDownload.path();
  const pdfBytes = await readFile(pdfPath!);
  expect(pdfBytes.length).toBeGreaterThan(1000);
  expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');
  console.log(`STEP 5b OK: PDF exported (${pdfBytes.length} bytes)`);

  console.log('SMOKE TEST PASSED: create, shape, text edit, PNG+PDF export all work');
});
