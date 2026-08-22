import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createScannedReferenceFixture } from './fixtures/scanned-reference-page';

const PHOTO_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAYAAAChS3wfAAAABmJLR0QA/wD/AP+gvaeTAAABa0lEQVRogeWZS5LDIAxEJXyK3GauNadnNuPQzceQbN8KVeJuBNJTlZN8/fzWkhEla7T1LL6+0q2/v77UrZ69jp7NiMwa9/ps6rHqPA7x63XrPVQ3xlX85vn0vrvcMiNKiRolIu41IyKj/q8a13fcNKu4il/tPMY9ZrrVHrN8+vg0txLSAadVX9+s3/KuOvrZrur5QW5lkU8fv3VjOz+19nkL7hJYH2y+xz637mAb7FrhidxbBwC513wKknvzBXJvuCK5t3yA3E9mAI37YQawuJ/MABr36gvkXn2HDmBwr75A7hvCXQdwuG/dWZDcq47IvemQ3JsXkHu7ECT36kXk3jsAyf1yBjC4f5gBEO7XM4DB/cMMoHBvM4DHvRURyb34FST3mgOReysWknvX8bi330CR3FsM5H4yA3Dc9zOAxb2dk8m9+gK5t9yg3OsePO7b/6Dhr8Mc7u9OlxlA4t4uCsp90yC5Vy8i9+r1B7Q45ELbjS61AAAAAElFTkSuQmCC';

const REFERENCE_PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8ID4+IC9Db250ZW50cyA0IDAgUiA+PgplbmRvYmoKNCAwIG9iago8PCAvTGVuZ3RoIDM1ID4+CnN0cmVhbQowLjgyIDAuMDggMC4xNCByZwowIDAgNjEyIDc5MiByZQpmCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDUKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyMTkgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA1IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgozMDMKJSVFT0YK';

const bodyCopy = [
  'The reconstructed article follows the old river road and the family homestead.',
  'Photographs sit below the upper text columns with independent captions.',
].join(' ').repeat(32);

const openReconstruction = async (page: Page, name: string) => {
  await page.goto('/');
  await page.getByTestId('dashboard-new-document').click();
  await page.getByTestId('document-project-name').fill(name);
  await page.getByRole('button', { name: '3 columns' }).click();
  await page.locator('.document-flow-prosemirror').fill(bodyCopy);
};

const addPhoto = async (page: Page, fileName: string, select = true) => {
  await page.getByTestId('document-image-file-input').setInputFiles({
    name: fileName,
    mimeType: 'image/png',
    buffer: Buffer.from(PHOTO_PNG_BASE64, 'base64'),
  });
  const image = page.locator('.document-image-node').last();
  await expect(image).toBeAttached();
  if (select) await expect(image).toBeVisible();
  if (select) await image.click();
  return image.getAttribute('data-image-id');
};

const configureSpanWithoutPinning = async (page: Page, span: 'span-2' | 'span-3') => {
  await page.getByTestId('document-image-wrap').selectOption(span);
  await expect(page.getByTestId('document-image-wrap')).toHaveValue(span);
  await expect(page.getByTestId('document-image-vertical-anchor'))
    .toHaveValue('flow');
};

const getSpanFrame = (page: Page, imageId: string) => page.locator(
  `[data-layout-role="occupied-columns"][data-image-id="${imageId}"] .document-image__frame`
);

const readSpanGeometry = async (page: Page, imageId: string) => {
  const slot = page.locator(
    `[data-layout-role="occupied-columns"][data-image-id="${imageId}"]`
  );
  await expect(slot).toBeVisible();
  const frameLocator = getSpanFrame(page, imageId);
  await expect(frameLocator).toBeVisible();
  const frame = await frameLocator.boundingBox();
  return {
    left: Number(await slot.getAttribute('data-image-left-px')),
    top: Number(await slot.getAttribute('data-image-top-px')),
    width: frame?.width ?? 0,
  };
};

const readDragDiagnostics = async (page: Page) => page.locator(
  '[data-document-span-layout]'
).evaluate((element) => ({
  renderCount: Number(element.getAttribute('data-layout-render-count')),
  modelBuildCount: Number(element.getAttribute('data-layout-model-build-count')),
  revision: Number(element.getAttribute('data-layout-revision')),
  pointerMoveCount: Number(element.getAttribute('data-drag-pointermove-count')),
  previewFrameCount: Number(element.getAttribute('data-drag-preview-frame-count')),
  commitCount: Number(element.getAttribute('data-drag-commit-count')),
}));

const readPageSpaceGeometry = async (page: Page, imageId: string) => {
  const frame = getSpanFrame(page, imageId);
  await expect(frame).toBeVisible();
  const frameBox = await frame.boundingBox();
  const sheetBox = await page.getByTestId('document-page').boundingBox();
  expect(frameBox).not.toBeNull();
  expect(sheetBox).not.toBeNull();
  return {
    left: frameBox!.x - sheetBox!.x,
    top: frameBox!.y - sheetBox!.y,
    width: frameBox!.width,
  };
};

const dragSpanWithoutChangingTheDropdown = async (
  page: Page,
  imageId: string,
  deltaX: number,
  deltaY: number
) => {
  const frame = getSpanFrame(page, imageId);
  const before = await frame.boundingBox();
  expect(before).not.toBeNull();
  const point = {
    x: before!.x + before!.width / 2,
    y: before!.y + before!.height / 2,
  };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  const afterDown = await frame.boundingBox();
  expect(afterDown).not.toBeNull();
  expect(afterDown!.x).toBeCloseTo(before!.x, 1);
  expect(afterDown!.y).toBeCloseTo(before!.y, 1);
  await page.mouse.move(point.x + deltaX, point.y + deltaY, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('document-image-vertical-anchor'))
    .toHaveValue('page-position');
  return { before, after: await frame.boundingBox() };
};

const inspectScreenshotPixel = async (page: Page, point: { x: number; y: number }) => {
  const sheet = page.getByTestId('document-page');
  const box = await sheet.boundingBox();
  expect(box).not.toBeNull();
  const screenshot = await page.screenshot({
    clip: {
      x: box!.x,
      y: box!.y,
      width: box!.width,
      height: box!.height,
    },
  });
  return page.evaluate(async ({ base64, x, y }) => {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not inspect the page screenshot.');
    context.drawImage(bitmap, 0, 0);
    const pixel = Array.from(context.getImageData(
      Math.max(0, Math.min(bitmap.width - 1, Math.round(x))),
      Math.max(0, Math.min(bitmap.height - 1, Math.round(y))),
      1,
      1
    ).data);
    bitmap.close();
    return pixel;
  }, {
    base64: screenshot.toString('base64'),
    x: point.x,
    y: point.y,
  });
};

const scanSampleRatios = [
  { x: 0.18, y: 0.18 },
  { x: 0.26, y: 0.48 },
  { x: 0.76, y: 0.58 },
];

const inspectScanPixels = async (page: Page) => {
  const sheet = await page.getByTestId('document-page').boundingBox();
  expect(sheet).not.toBeNull();
  return Promise.all(scanSampleRatios.map((ratio) => inspectScreenshotPixel(page, {
    x: sheet!.width * ratio.x,
    y: sheet!.height * ratio.y,
  })));
};

const waitForDarkScanPixel = async (page: Page) => {
  await expect.poll(async () => {
    const sheet = await page.getByTestId('document-page').boundingBox();
    expect(sheet).not.toBeNull();
    const pixel = await inspectScreenshotPixel(page, {
      x: sheet!.width * 0.26,
      y: sheet!.height * 0.48,
    });
    return pixel[0] + pixel[1] + pixel[2];
  }, { timeout: 20_000 }).toBeLessThan(620);
};

const inspectDownloadedPixel = async (
  page: Page,
  bytes: Buffer,
  ratio: { x: number; y: number },
) => page.evaluate(async ({ base64, ratio: sampleRatio }) => {
  const binary = atob(base64);
  const imageBytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([imageBytes], { type: 'image/png' }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not inspect the exported page.');
  context.drawImage(bitmap, 0, 0);
  const pixel = Array.from(context.getImageData(
    Math.round(bitmap.width * sampleRatio.x),
    Math.round(bitmap.height * sampleRatio.y),
    1,
    1,
  ).data);
  bitmap.close();
  return pixel;
}, {
  base64: bytes.toString('base64'),
  ratio,
});

test.describe('reconstruction page-space interactions', () => {
  test.describe.configure({ timeout: 120_000 });
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('pins a span flow photo only after a real drag', async ({ page }) => {
    await openReconstruction(page, 'Flow Drag To Pin Regression');
    const imageId = await addPhoto(page, 'flow-drag-photo.png');
    expect(imageId).toBeTruthy();
    await configureSpanWithoutPinning(page, 'span-2');

    const layout = page.locator('[data-document-span-layout]');
    await expect(layout).toHaveAttribute('data-vertical-anchor', 'flow');
    const frame = getSpanFrame(page, imageId!);
    const before = await frame.boundingBox();
    expect(before).not.toBeNull();

    await page.mouse.click(
      before!.x + before!.width / 2,
      before!.y + before!.height / 2
    );
    await expect(page.getByTestId('document-image-vertical-anchor'))
      .toHaveValue('flow');

    const dragStart = {
      x: before!.x + before!.width / 2,
      y: before!.y + before!.height / 2,
    };
    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down();
    await page.mouse.move(dragStart.x + 48, dragStart.y + 36, { steps: 6 });
    await page.mouse.up();

    await expect(page.getByTestId('document-image-vertical-anchor'))
      .toHaveValue('page-position');
    await expect(layout).toHaveAttribute('data-vertical-anchor', 'page-position');
    const after = await frame.boundingBox();
    expect(after).not.toBeNull();
    expect(Math.abs(after!.x - before!.x) + Math.abs(after!.y - before!.y))
      .toBeGreaterThan(8);
  });

  test('keeps a multi-photo drag preview on the compositor path until one commit', async ({ page }) => {
    await openReconstruction(page, 'Fluid Photo Drag Preview Regression');
    const firstImageId = await addPhoto(page, 'fluid-photo-a.png');
    expect(firstImageId).toBeTruthy();
    await configureSpanWithoutPinning(page, 'span-2');
    await dragSpanWithoutChangingTheDropdown(page, firstImageId!, 42, -28);
    await page.getByTestId('document-image-caption').fill('Photo A');

    const secondImageId = await addPhoto(page, 'fluid-photo-b.png', false);
    expect(secondImageId).toBeTruthy();
    await page.locator(
      `[data-layout-role="flow-image-hit-target"][data-image-id="${secondImageId}"]`
    ).click();
    await configureSpanWithoutPinning(page, 'span-2');
    const secondFrame = getSpanFrame(page, secondImageId!);
    await expect(secondFrame).toBeVisible();
    await secondFrame.click();

    const layout = page.locator('[data-document-span-layout]');
    await page.waitForTimeout(100);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect.poll(async () => Number(
      await layout.getAttribute('data-layout-zoom')
    )).toBeGreaterThan(0.6);
    await expect.poll(async () => Number(
      await layout.getAttribute('data-layout-zoom')
    )).toBeLessThan(0.7);
    const secondSlot = layout.locator(
      `[data-layout-role="occupied-columns"][data-image-id="${secondImageId}"]`
    );
    const firstBefore = await readPageSpaceGeometry(page, firstImageId!);
    const before = await secondFrame.boundingBox();
    expect(before).not.toBeNull();
    const point = {
      x: before!.x + before!.width / 2,
      y: before!.y + before!.height / 2,
    };
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await expect(secondSlot).toHaveAttribute('data-image-selected', 'true');
    await page.waitForTimeout(250);
    const baseline = await readDragDiagnostics(page);
    const afterDown = await secondFrame.boundingBox();
    expect(afterDown).not.toBeNull();
    expect(afterDown!.x).toBeCloseTo(before!.x, 1);
    expect(afterDown!.y).toBeCloseTo(before!.y, 1);

    const intermediate: Array<{ x: number; y: number }> = [];
    for (let step = 1; step <= 24; step += 1) {
      await page.mouse.move(point.x - step * 2, point.y - step * 2, { steps: 1 });
      await page.waitForTimeout(12);
      const box = await secondFrame.boundingBox();
      expect(box).not.toBeNull();
      intermediate.push({ x: box!.x, y: box!.y });
    }
    const lastBeforeUp = intermediate[intermediate.length - 1];
    const during = await readDragDiagnostics(page);
    expect(during.pointerMoveCount).toBeGreaterThan(10);
    expect(during.previewFrameCount).toBeGreaterThan(0);
    // Save/selection lifecycle updates may render the shell once or twice;
    // the layout model itself must remain completely stable during movement.
    expect(during.renderCount - baseline.renderCount).toBeLessThan(3);
    expect(during.modelBuildCount).toBe(baseline.modelBuildCount);
    expect(during.revision).toBe(baseline.revision);
    for (let index = 1; index < intermediate.length; index += 1) {
      expect(intermediate[index].y)
        .toBeLessThanOrEqual(intermediate[index - 1].y + 1);
    }
    expect(
      Math.abs(lastBeforeUp.x - before!.x) + Math.abs(lastBeforeUp.y - before!.y)
    ).toBeGreaterThan(4);
    await expect(secondSlot).toHaveAttribute('data-image-dragging', 'true');

    const chrome = secondSlot.locator('[data-document-image-frame-chrome="true"]');
    const frameDuring = await secondFrame.boundingBox();
    const chromeDuring = await chrome.boundingBox();
    expect(frameDuring).not.toBeNull();
    expect(chromeDuring).not.toBeNull();
    expect(Math.abs(frameDuring!.x - chromeDuring!.x)).toBeLessThan(1);
    expect(Math.abs(frameDuring!.y - chromeDuring!.y)).toBeLessThan(1);

    await page.mouse.up();
    await expect(page.getByTestId('document-image-vertical-anchor'))
      .toHaveValue('page-position');
    await expect.poll(async () => (
      await secondSlot.evaluate((element) => (element as HTMLElement).style.transform)
    )).toBe('');
    const after = await secondFrame.boundingBox();
    expect(after).not.toBeNull();
    expect(Math.abs(after!.x - lastBeforeUp.x)).toBeLessThan(1);
    expect(Math.abs(after!.y - lastBeforeUp.y)).toBeLessThan(1);
    await expect(secondSlot).toHaveAttribute('data-image-dragging', 'false');
    const committed = await readDragDiagnostics(page);
    expect(committed.commitCount).toBe(1);
    expect(committed.revision).toBeGreaterThan(baseline.revision);

    const firstAfter = await readPageSpaceGeometry(page, firstImageId!);
    expect(firstAfter.left).toBeCloseTo(firstBefore.left, 1);
    expect(firstAfter.top).toBeCloseTo(firstBefore.top, 1);

    const secondBeforeFirstDrag = await readPageSpaceGeometry(page, secondImageId!);
    const firstSlot = layout.locator(
      `[data-layout-role="occupied-columns"][data-image-id="${firstImageId}"]`
    );
    const firstFrame = getSpanFrame(page, firstImageId!);
    await expect(firstFrame).toBeVisible();
    await firstFrame.click();
    await expect(firstFrame).toBeVisible();
    const firstPointBox = await firstFrame.boundingBox();
    expect(firstPointBox).not.toBeNull();
    await page.mouse.move(
      firstPointBox!.x + firstPointBox!.width / 2,
      firstPointBox!.y + firstPointBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      firstPointBox!.x + firstPointBox!.width / 2 + 18,
      firstPointBox!.y + firstPointBox!.height / 2 + 10,
      { steps: 6 },
    );
    await page.mouse.up();
    await expect(firstSlot).toHaveAttribute('data-image-selected', 'true');
    const secondAfterFirstDrag = await readPageSpaceGeometry(page, secondImageId!);
    expect(secondAfterFirstDrag.left).toBeCloseTo(secondBeforeFirstDrag.left, 1);
    expect(secondAfterFirstDrag.top).toBeCloseTo(secondBeforeFirstDrag.top, 1);
  });

  test('reproduces scanned PDF reference visibility at the imported defaults', async ({ page }) => {
    await openReconstruction(page, 'Scanned PDF Reference Baseline');
    const fixture = await createScannedReferenceFixture();
    const rasterDiagnostics: Array<Record<string, unknown>> = [];
    page.on('console', (message) => {
      if (!message.text().startsWith('[document-reference] PDF raster diagnostics')) return;
      const diagnosticArgument = message.args()[1];
      if (!diagnosticArgument) return;
      void diagnosticArgument.jsonValue().then((value) => {
        if (value && typeof value === 'object') {
          rasterDiagnostics.push(value as Record<string, unknown>);
        }
      });
    });
    await page.getByTestId('document-reference-file-input').setInputFiles({
      name: 'historical-scanned-page.pdf',
      mimeType: 'application/pdf',
      buffer: fixture.pdf,
    });

    await expect(page.getByTestId('document-reference-controls')).toBeVisible();
    await expect(page.getByTestId('document-reference-layer')).toBeVisible();
    await expect(page.getByTestId('document-page'))
      .toHaveAttribute('data-document-reference-diagnostic', 'REFERENCE_SOURCE_PRESENT');
    await expect(page.getByLabel('Reference fit')).toHaveValue('contain');
    await expect(page.getByLabel('Reference opacity')).toHaveValue('0.35');
    await expect(page.getByLabel('Reference scale')).toHaveValue('1');
    await expect(page.getByLabel('Reference X offset')).toHaveValue('0');
    await expect(page.getByLabel('Reference Y offset')).toHaveValue('0');
    await expect(page.getByTestId('document-reference-layer').locator('img'))
      .toHaveAttribute('src', /^data:image\/png;base64,/);
    await expect(page.getByTestId('document-reference-layer'))
      .toHaveAttribute('data-reference-image-state', 'loaded');
    await expect.poll(() => rasterDiagnostics.length).toBe(1);
    expect(rasterDiagnostics[0]).toMatchObject({
      hasMeaningfulPaint: true,
    });
    expect(Number(rasterDiagnostics[0].width)).toBeGreaterThan(0);
    expect(Number(rasterDiagnostics[0].height)).toBeGreaterThan(0);
    expect(Number(rasterDiagnostics[0].nonTransparentPixelCount)).toBeGreaterThan(0);
    expect(Number(rasterDiagnostics[0].luminanceVariance)).toBeGreaterThan(0);
    console.log('scanned PDF raster diagnostics', rasterDiagnostics[0]);
    const dimensions = await page.getByTestId('document-reference-layer').locator('img')
      .evaluate((element) => ({
        width: (element as HTMLImageElement).naturalWidth,
        height: (element as HTMLImageElement).naturalHeight,
      }));
    expect(dimensions.width).toBeGreaterThan(0);
    expect(dimensions.height).toBeGreaterThan(0);
    await expect(page.getByTestId('document-reference-layer')).toHaveCSS('opacity', '0.35');
    await expect(page.getByTestId('document-reference-layer').locator('img'))
      .toHaveCSS('object-fit', 'contain');
    await expect(page.getByTestId('document-export-root'))
      .toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

    const visiblePixels = await inspectScanPixels(page);

    await page.getByTestId('document-reference-visibility').click();
    await expect(page.getByTestId('document-reference-layer')).toHaveCount(0);
    const hiddenPixels = await inspectScanPixels(page);

    const differences = visiblePixels.map((visible, index) => visible.reduce(
      (total, channel, channelIndex) => total + Math.abs(channel - hiddenPixels[index][channelIndex]),
      0,
    ));
    expect(Math.max(...differences)).toBeGreaterThan(8);
  });

  test('keeps a scanned page visually equivalent when imported as PNG or PDF', async ({ page }) => {
    test.slow();
    const fixture = await createScannedReferenceFixture();
    await openReconstruction(page, 'Scanned PNG Reference Control');
    await page.locator('.document-flow-prosemirror').fill('');
    await page.getByTestId('document-reference-file-input').setInputFiles({
      name: 'historical-scanned-page.png',
      mimeType: 'image/png',
      buffer: fixture.png,
    });
    await expect(page.getByTestId('document-reference-layer'))
      .toHaveAttribute('data-reference-image-state', 'loaded', { timeout: 20_000 });
    await waitForDarkScanPixel(page);
    const pngPixels = await inspectScanPixels(page);

    await openReconstruction(page, 'Scanned PDF Reference Control');
    await page.locator('.document-flow-prosemirror').fill('');
    await page.getByTestId('document-reference-file-input').setInputFiles({
      name: 'historical-scanned-page.pdf',
      mimeType: 'application/pdf',
      buffer: fixture.pdf,
    });
    await expect(page.getByTestId('document-reference-layer'))
      .toHaveAttribute('data-reference-image-state', 'loaded', { timeout: 20_000 });
    await waitForDarkScanPixel(page);
    const pdfPixels = await inspectScanPixels(page);
    const differences = pngPixels.map((pngPixel, index) => pngPixel.reduce(
      (total, channel, channelIndex) => total + Math.abs(channel - pdfPixels[index][channelIndex]),
      0,
    ));
    expect(Math.max(...differences)).toBeLessThan(160);
    expect(Math.min(...differences)).toBeLessThan(45);
  });

  test('persists a scanned PDF reference through page switching and reopen', async ({ page }) => {
    const fixture = await createScannedReferenceFixture();
    await openReconstruction(page, 'Scanned PDF Persistence Regression');
    await page.locator('.document-flow-prosemirror').fill('');
    await page.getByTestId('document-reference-file-input').setInputFiles({
      name: 'historical-scanned-page.pdf',
      mimeType: 'application/pdf',
      buffer: fixture.pdf,
    });
    await expect(page.getByTestId('document-reference-layer'))
      .toHaveAttribute('data-reference-image-state', 'loaded');
    const before = await inspectScanPixels(page);

    await page.getByTestId('document-add-page').click();
    await page.getByTestId('document-page-tab-0').click();
    await expect(page.getByTestId('document-reference-layer')).toBeVisible();
    await expect(page.getByLabel('Reference fit')).toHaveValue('contain');
    await expect(page.getByLabel('Reference opacity')).toHaveValue('0.35');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);

    await page.getByRole('button', { name: 'Back to projects' }).click();
    await page.getByTestId('dashboard-project-card')
      .filter({ hasText: 'Scanned PDF Persistence Regression' })
      .getByRole('button')
      .first()
      .click();
    await expect(page.getByTestId('document-reference-layer'))
      .toHaveAttribute('data-reference-image-state', 'loaded');
    await expect(page.getByLabel('Reference fit')).toHaveValue('contain');
    await expect(page.getByLabel('Reference opacity')).toHaveValue('0.35');
    const after = await inspectScanPixels(page);
    const differences = before.map((pixel, index) => pixel.reduce(
      (total, channel, channelIndex) => total + Math.abs(channel - after[index][channelIndex]),
      0,
    ));
    expect(Math.max(...differences)).toBeLessThan(12);

    const pngDownloadPromise = page.waitForEvent('download');
    const exportButton = page.getByRole('button', { name: 'PNG', exact: true });
    if (!await exportButton.isVisible()) {
      await page.getByText('Export', { exact: true }).click();
    }
    await exportButton.click();
    const pngDownload = await pngDownloadPromise;
    const pngPath = await pngDownload.path();
    expect(pngPath).not.toBeNull();
    const exportedPixel = await inspectDownloadedPixel(
      page,
      await readFile(pngPath!),
      { x: 0.26, y: 0.48 },
    );
    expect(exportedPixel).toEqual([250, 248, 245, 255]);
  });

  test('renders a first-page PDF reference above the transparent editor root', async ({ page }) => {
    await openReconstruction(page, 'PDF Reference Layer Regression');
    const pdf = Buffer.from(REFERENCE_PDF_BASE64, 'base64');
    await page.getByTestId('document-reference-file-input').setInputFiles({
      name: 'historical-reference.pdf',
      mimeType: 'application/pdf',
      buffer: pdf,
    });
    await expect(page.getByTestId('document-reference-controls')).toBeVisible();
    await expect(page.getByTestId('document-reference-layer')).toBeVisible();
    await expect(page.getByTestId('document-reference-layer'))
      .toHaveAttribute('data-reference-source-type', 'pdf');
    await page.getByLabel('Reference fit').selectOption('stretch');
    await page.getByLabel('Reference opacity').fill('1');
    await expect(page.getByTestId('document-reference-layer').locator('img'))
      .toHaveAttribute('src', /^data:image\/png;base64,/);

    const rootStyles = await page.getByTestId('document-export-root').evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        zIndex: style.zIndex,
      };
    });
    expect(rootStyles.backgroundColor).toBe('rgba(0, 0, 0, 0)');

    const pixel = await inspectScreenshotPixel(page, { x: 10, y: 10 });
    const paperDistance = Math.abs(pixel[0] - 250)
      + Math.abs(pixel[1] - 248)
      + Math.abs(pixel[2] - 245);
    expect(paperDistance).toBeGreaterThan(12);
  });

  test('keeps reference visibility, adjustment, locking, opacity, fit, and zoom deterministic', async ({ page }) => {
    await openReconstruction(page, 'Reference Interaction Controls Regression');
    await page.getByTestId('document-reference-file-input').setInputFiles({
      name: 'historical-reference.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(REFERENCE_PDF_BASE64, 'base64'),
    });
    const layer = page.getByTestId('document-reference-layer');
    await expect(layer).toBeVisible();
    await expect(layer).toHaveCSS('pointer-events', 'none');

    const visibility = page.getByTestId('document-reference-visibility');
    await visibility.click();
    await expect(layer).toHaveCount(0);
    await visibility.click();
    await expect(layer).toBeVisible();

    await page.getByLabel('Reference opacity').fill('0.5');
    await expect(layer).toHaveCSS('opacity', '0.5');
    await page.getByLabel('Reference fit').selectOption('stretch');
    await expect(page.getByLabel('Reference fit')).toHaveValue('stretch');
    await page.getByLabel('Reference scale').fill('1.4');
    await page.getByLabel('Reference X offset').fill('24');
    await page.getByLabel('Reference X offset').press('Tab');
    await page.getByTestId('document-reference-fit-page').click();
    await expect(page.getByLabel('Reference fit')).toHaveValue('contain');
    await expect(page.getByLabel('Reference scale')).toHaveValue('1');
    await expect(page.getByLabel('Reference X offset')).toHaveValue('0');
    await expect(page.getByLabel('Reference Y offset')).toHaveValue('0');

    const lock = page.getByTestId('document-reference-lock');
    await lock.click();
    await expect(lock).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Adjust reference', exact: true }).click();
    await expect(page.getByTestId('document-toast'))
      .toHaveText('Unlock the reference before adjusting it.');
    await expect(layer).toHaveCSS('pointer-events', 'none');

    await lock.click();
    await page.getByRole('button', { name: 'Adjust reference', exact: true }).click();
    await expect(page.getByTestId('document-context-toolbar')).toBeVisible();
    await expect(layer).toHaveCSS('pointer-events', 'auto');
    await expect(page.getByTestId('document-export-root'))
      .toHaveCSS('pointer-events', 'none');

    const layerBox = await layer.boundingBox();
    expect(layerBox).not.toBeNull();
    const dragPoint = {
      x: layerBox!.x + layerBox!.width / 2,
      y: layerBox!.y + layerBox!.height / 2,
    };
    await page.mouse.move(dragPoint.x, dragPoint.y);
    await page.mouse.down();
    await page.mouse.move(dragPoint.x + 28, dragPoint.y + 16, { steps: 4 });
    await page.mouse.up();
    expect(Number(await page.getByLabel('Adjusting X position').inputValue()))
      .toBeGreaterThan(0);
    expect(Number(await page.getByLabel('Adjusting Y position').inputValue()))
      .toBeGreaterThan(0);

    await page.getByTestId('document-context-toolbar')
      .getByRole('button', { name: 'Finish adjusting', exact: true })
      .click();
    await expect(layer).toHaveCSS('pointer-events', 'none');
    await expect(page.getByTestId('document-export-root'))
      .toHaveCSS('pointer-events', 'auto');

    const pageBeforeZoom = await page.getByTestId('document-page').boundingBox();
    const layerBeforeZoom = await layer.boundingBox();
    expect(pageBeforeZoom).not.toBeNull();
    expect(layerBeforeZoom).not.toBeNull();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(async () => {
      const pageAfterZoom = await page.getByTestId('document-page').boundingBox();
      return pageAfterZoom?.width || 0;
    }).toBeGreaterThan(pageBeforeZoom!.width);
    const pageAfterZoom = await page.getByTestId('document-page').boundingBox();
    const layerAfterZoom = await layer.boundingBox();
    expect(pageAfterZoom).not.toBeNull();
    expect(layerAfterZoom).not.toBeNull();
    expect(layerAfterZoom!.width / pageAfterZoom!.width)
      .toBeCloseTo(layerBeforeZoom!.width / pageBeforeZoom!.width, 2);
  });

  test('reconstructs independent page-position photos by dragging from article flow', async ({ page }) => {
    await openReconstruction(page, 'Page Space Drag Reconstruction');
    await page.getByTestId('document-reference-file-input').setInputFiles({
      name: 'historical-reference.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(REFERENCE_PDF_BASE64, 'base64'),
    });
    await expect(page.getByTestId('document-reference-layer')).toBeVisible();

    const firstImageId = await addPhoto(page, 'reconstruction-photo-a.png');
    expect(firstImageId).toBeTruthy();
    await configureSpanWithoutPinning(page, 'span-2');
    const firstBeforeDrag = await readSpanGeometry(page, firstImageId!);
    await dragSpanWithoutChangingTheDropdown(page, firstImageId!, 42, -32);
    await page.getByTestId('document-image-caption').fill('Photo A caption');
    const firstAfterDrag = await readSpanGeometry(page, firstImageId!);

    expect(firstAfterDrag.left).not.toBe(firstBeforeDrag.left);
    expect(firstAfterDrag.top).not.toBe(firstBeforeDrag.top);
    await expect(page.getByTestId('document-image-caption'))
      .toHaveValue('Photo A caption');

    const secondImageId = await addPhoto(
      page,
      'reconstruction-photo-b.png',
      false
    );
    expect(secondImageId).toBeTruthy();
    await expect(page.locator(
      `.document-image-node[data-image-id="${secondImageId}"]`
    )).toHaveAttribute('data-wrap', 'float-left');
    await page.locator(
      `[data-layout-role="flow-image-hit-target"][data-image-id="${secondImageId}"]`
    ).click();
    await expect(page.getByTestId('document-image-wrap')).toHaveValue('float-left');
    await configureSpanWithoutPinning(page, 'span-3');
    await expect(page.locator(
      '[data-document-span-layout] [data-layout-role="occupied-columns"]'
    )).toHaveCount(2);
    await expect(page.locator(
      '[data-document-span-layout] .document-image__frame'
    )).toHaveCount(2);
    const firstStableGeometry = await readSpanGeometry(page, firstImageId!);
    await dragSpanWithoutChangingTheDropdown(page, secondImageId!, 56, 40);
    await page.getByTestId('document-image-caption').fill('Photo B caption');
    const firstAfterSecondDrag = await readSpanGeometry(page, firstImageId!);
    expect(firstAfterSecondDrag).toEqual(firstStableGeometry);
    const secondAfterDrag = await readSpanGeometry(page, secondImageId!);

    await page.getByTestId('document-add-page').click();
    await page.getByTestId('document-page-tab-0').click();
    await expect(page.getByTestId('document-reference-layer')).toBeVisible();

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);
    await page.getByRole('button', { name: 'Back to projects' }).click();
    await page.getByTestId('dashboard-project-card')
      .filter({ hasText: 'Page Space Drag Reconstruction' })
      .getByRole('button')
      .first()
      .click();
    await expect(page.getByTestId('document-reference-layer')).toBeVisible();
    await expect(page.getByTestId('document-reference-layer'))
      .toHaveAttribute('data-reference-source-type', 'pdf');

    const firstAfterReopen = await readSpanGeometry(page, firstImageId!);
    const secondAfterReopen = await readSpanGeometry(page, secondImageId!);
    expect(firstAfterReopen.left).toBeCloseTo(firstStableGeometry.left, 2);
    expect(firstAfterReopen.top).toBeCloseTo(firstStableGeometry.top, 2);
    expect(firstAfterReopen.width).toBeCloseTo(firstStableGeometry.width, 2);
    expect(secondAfterReopen.left).toBeCloseTo(secondAfterDrag.left, 2);
    expect(secondAfterReopen.top).toBeCloseTo(secondAfterDrag.top, 2);
    expect(secondAfterReopen.width).toBeCloseTo(secondAfterDrag.width, 2);

    await getSpanFrame(page, firstImageId!).click();
    await expect(page.getByTestId('document-editor-shell'))
      .toHaveAttribute('data-selected-flow-image-id', firstImageId!);
    await getSpanFrame(page, secondImageId!).click();
    await expect(page.getByTestId('document-editor-shell'))
      .toHaveAttribute('data-selected-flow-image-id', secondImageId!);
    await expect(page.getByTestId('document-image-caption'))
      .toHaveValue('Photo B caption');

    const pngDownloadPromise = page.waitForEvent('download');
    const exportButton = page.getByRole('button', { name: 'PNG', exact: true });
    if (!await exportButton.isVisible()) {
      await page.getByText('Export', { exact: true }).click();
    }
    await exportButton.click();
    const pngDownload = await pngDownloadPromise;
    const pngPath = await pngDownload.path();
    expect(pngPath).not.toBeNull();
    const pngBytes = await readFile(pngPath!);
    const exportedCorner = await page.evaluate(async (base64: string) => {
      const binary = atob(base64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const pixel = Array.from(context.getImageData(2, 2, 1, 1).data);
      bitmap.close();
      return pixel;
    }, pngBytes.toString('base64'));
    expect(exportedCorner).toEqual([250, 248, 245, 255]);
  });

  test('does not reserve authored title space when the title is empty', async ({ page }) => {
    await openReconstruction(page, 'Empty Title Layout Regression');

    const placeholder = page.getByTestId('document-title-placeholder');
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toHaveText('Add a title');

    const readTitleGeometry = () => page.evaluate(() => {
      const content = document.querySelector<HTMLElement>('[data-testid="document-page"] .document-page-content');
      const body = document.querySelector<HTMLElement>('[data-testid="document-body-region"]');
      const title = document.querySelector<HTMLElement>('[data-testid="document-title-region"]');
      if (!content || !body) throw new Error('Document page geometry is unavailable.');
      const contentRect = content.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const contentStyle = getComputedStyle(content);
      return {
        bodyOffset: bodyRect.top - contentRect.top,
        contentPaddingTop: Number.parseFloat(contentStyle.paddingTop),
        titleHeight: title?.getBoundingClientRect().height || 0,
        titleMarginBottom: title
          ? Number.parseFloat(getComputedStyle(title).marginBottom)
          : 0,
      };
    });

    const emptyGeometry = await readTitleGeometry();
    expect(emptyGeometry.bodyOffset - emptyGeometry.contentPaddingTop).toBeLessThan(2);
    expect(emptyGeometry.titleMarginBottom).toBe(0);

    await placeholder.click();
    const title = page.locator('.document-title-prosemirror');
    await expect(title).toBeFocused();
    await title.type('Intentional page title');
    await expect(title).toHaveText('Intentional page title');
    await expect(page.getByTestId('document-title-region'))
      .toHaveAttribute('data-document-title-state', 'authored');

    const authoredGeometry = await readTitleGeometry();
    expect(authoredGeometry.bodyOffset - authoredGeometry.contentPaddingTop)
      .toBeGreaterThan(emptyGeometry.bodyOffset - emptyGeometry.contentPaddingTop + 10);
    expect(authoredGeometry.titleMarginBottom).toBe(14);

    await title.press('ControlOrMeta+A');
    await title.press('Backspace');
    await expect(page.getByTestId('document-title-placeholder')).toBeVisible();
    await expect(page.getByTestId('document-title-region'))
      .toHaveAttribute('data-document-title-state', 'empty');
    const collapsedGeometry = await readTitleGeometry();
    expect(collapsedGeometry.bodyOffset - collapsedGeometry.contentPaddingTop)
      .toBeLessThan(2);
    expect(collapsedGeometry.titleMarginBottom).toBe(0);
  });

  test('preserves fixed photo geometry through title changes, page switching, and reopen', async ({ page }) => {
    await openReconstruction(page, 'Empty Title Photo Geometry Regression');
    const imageId = await addPhoto(page, 'fixed-photo-title-regression.png');
    expect(imageId).toBeTruthy();
    await configureSpanWithoutPinning(page, 'span-2');
    await dragSpanWithoutChangingTheDropdown(page, imageId!, 44, 30);
    const fixedBeforeTitle = await readPageSpaceGeometry(page, imageId!);

    const placeholder = page.getByTestId('document-title-placeholder');
    await placeholder.click();
    const title = page.locator('.document-title-prosemirror');
    await title.type('A deliberate title');
    await expect(page.getByTestId('document-title-region'))
      .toHaveAttribute('data-document-title-state', 'authored');
    const fixedWithTitle = await readPageSpaceGeometry(page, imageId!);
    expect(fixedWithTitle).toEqual(fixedBeforeTitle);

    await title.press('ControlOrMeta+A');
    await title.press('Backspace');
    await expect(page.getByTestId('document-title-placeholder')).toBeVisible();
    const fixedAfterDelete = await readPageSpaceGeometry(page, imageId!);
    expect(fixedAfterDelete).toEqual(fixedBeforeTitle);

    await page.getByTestId('document-add-page').click();
    await page.getByTestId('document-page-tab-0').click();
    await expect(page.getByTestId('document-title-placeholder')).toBeVisible();
    expect(await readPageSpaceGeometry(page, imageId!)).toEqual(fixedBeforeTitle);

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);
    await page.getByRole('button', { name: 'Back to projects' }).click();
    await page.getByTestId('dashboard-project-card')
      .filter({ hasText: 'Empty Title Photo Geometry Regression' })
      .getByRole('button')
      .first()
      .click();
    await expect(page.getByTestId('document-title-placeholder')).toBeVisible();
    expect(await readPageSpaceGeometry(page, imageId!)).toEqual(fixedBeforeTitle);
  });
});
