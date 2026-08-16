import { expect, test, type Page } from '@playwright/test';

const PHOTO_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAYAAAChS3wfAAAABmJLR0QA/wD/AP+gvaeTAAABa0lEQVRogeWZS5LDIAxEJXyK3GauNadnNuPQzceQbN8KVeJuBNJTlZN8/fzWkhEla7T1LL6+0q2/v77UrZ69jp7NiMwa9/ps6rHqPA7x63XrPVQ3xlX85vn0vrvcMiNKiRolIu41IyKj/q8a13fcNKu4il/tPMY9ZrrVHrN8+vg0txLSAadVX9+s3/KuOvrZrur5QW5lkU8fv3VjOz+19nkL7hJYH2y+xz637mAb7FrhidxbBwC513wKknvzBXJvuCK5t3yA3E9mAI37YQawuJ/MABr36gvkXn2HDmBwr75A7hvCXQdwuG/dWZDcq47IvemQ3JsXkHu7ECT36kXk3jsAyf1yBjC4f5gBEO7XM4DB/cMMoHBvM4DHvRURyb34FST3mgOReysWknvX8bi330CR3FsM5H4yA3Dc9zOAxb2dk8m9+gK5t9yg3OsePO7b/6Dhr8Mc7u9OlxlA4t4uCsp90yC5Vy8i9+r1B7Q45ELbjS61AAAAAElFTkSuQmCC';

const openDocumentWithPhoto = async (page: Page) => {
  await page.goto('/');
  await page.getByTestId('dashboard-new-document').click();
  await page.getByTestId('document-project-name').fill(
    'Document Span Transform Preservation'
  );
  await page.getByRole('button', { name: '3 columns' }).click();
  await page.locator('.document-flow-prosemirror').fill(
    'Text before and after the transformed photograph. '.repeat(30)
  );
  await page.getByTestId('document-image-file-input').setInputFiles({
    name: 'span-photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PHOTO_PNG_BASE64, 'base64'),
  });
  await expect(page.locator('.document-image-node')).toHaveCount(1);
  await page.locator('.document-image-node').click();
};

const addPhoto = async (page: Page, fileName: string) => {
  const previousCount = await page.locator('.document-image-node').count();
  await page.getByTestId('document-image-file-input').setInputFiles({
    name: fileName,
    mimeType: 'image/png',
    buffer: Buffer.from(PHOTO_PNG_BASE64, 'base64'),
  });
  await expect(page.locator('.document-image-node')).toHaveCount(
    previousCount + 1
  );
};

const readStructuredPhotoGeometry = async (page: Page, imageId: string) => {
  const slot = page.locator(
    `[data-layout-role="occupied-columns"][data-image-id="${imageId}"]`
  );
  await expect(slot).toBeVisible();
  return slot.evaluate((element) => ({
    left: Number(element.getAttribute('data-image-left-px')),
    top: Number(element.getAttribute('data-image-top-px')),
    xOffset: Number(element.getAttribute('data-image-x-offset-px')),
    width: Number(element.querySelector('[data-rendered-width-px]')
      ?.getAttribute('data-rendered-width-px')),
    height: Number(element.querySelector('[data-rendered-height-px]')
      ?.getAttribute('data-rendered-height-px')),
  }));
};

test('preserves fit and fill transforms across span transitions and reopen', async ({ page }) => {
  await openDocumentWithPhoto(page);

  const widthInput = page.getByLabel('Image width');
  const heightInput = page.getByLabel('Image height');
  await widthInput.fill('220');
  await page.getByLabel('Image caption').fill('A transformed span photograph');

  const layout = page.locator('[data-document-span-layout]');
  const readGeometry = async () => layout.evaluate((root) => {
    const frame = root.querySelector<HTMLElement>(
      '[data-layout-role="occupied-columns"] .document-image__frame'
    );
    const chrome = root.querySelector<HTMLElement>(
      '[data-document-image-frame-chrome="true"]'
    );
    if (!frame || !chrome) throw new Error('Structured image frame is unavailable.');
    const frameRect = frame.getBoundingClientRect();
    const chromeRect = chrome.getBoundingClientRect();
    return {
      spanWidth: Number(root.getAttribute('data-span-width-px')),
      spanStartColumn: Number(root.getAttribute('data-span-start-column')),
      renderedWidth: Number(root.getAttribute('data-rendered-image-width-px')),
      renderedHeight: Number(root.getAttribute('data-rendered-image-height-px')),
      imageTop: Number(root.getAttribute('data-image-top-px')),
      xOffset: Number(root.getAttribute('data-image-x-offset-px')),
      verticalAnchor: root.getAttribute('data-vertical-anchor'),
      frame: {
        left: frameRect.left,
        top: frameRect.top,
        right: frameRect.right,
        bottom: frameRect.bottom,
      },
      chrome: {
        left: chromeRect.left,
        top: chromeRect.top,
        right: chromeRect.right,
        bottom: chromeRect.bottom,
      },
    };
  });
  const expectAligned = async () => {
    const geometry = await readGeometry();
    expect(Math.abs(geometry.frame.left - geometry.chrome.left)).toBeLessThan(1);
    expect(Math.abs(geometry.frame.top - geometry.chrome.top)).toBeLessThan(1);
    expect(Math.abs(geometry.frame.right - geometry.chrome.right)).toBeLessThan(1);
    expect(Math.abs(geometry.frame.bottom - geometry.chrome.bottom)).toBeLessThan(1);
    return geometry;
  };

  await page.getByTestId('document-image-wrap').selectOption('span-2');
  await expect(layout).toHaveAttribute('data-span-count', '2');
  const spanTwoFit = await readGeometry();
  expect(spanTwoFit.renderedWidth).toBeCloseTo(220, 0);
  expect(spanTwoFit.spanWidth).toBeGreaterThan(spanTwoFit.renderedWidth);
  await expectAligned();

  await page.getByTestId('document-image-wrap').selectOption('span-3');
  await expect(layout).toHaveAttribute('data-span-count', '3');
  const spanThreeFit = await readGeometry();
  expect(spanThreeFit.renderedWidth).toBeCloseTo(spanTwoFit.renderedWidth, 0);
  expect(spanThreeFit.renderedHeight).toBeCloseTo(spanTwoFit.renderedHeight, 0);

  await page.getByTestId('document-image-wrap').selectOption('span-2');
  const spanTwoAgain = await readGeometry();
  expect(spanTwoAgain.renderedWidth).toBeCloseTo(spanThreeFit.renderedWidth, 0);

  await page.getByTestId('document-image-wrap').selectOption('span-3');
  const spanThreeWidth = (await readGeometry()).spanWidth;
  const oversizedFitWidth = Math.round(spanThreeWidth - 20);
  await widthInput.fill(String(oversizedFitWidth));
  await expect.poll(async () => (await readGeometry()).renderedWidth)
    .toBeCloseTo(oversizedFitWidth, 0);
  await page.getByTestId('document-image-wrap').selectOption('span-2');
  const clampedFit = await readGeometry();
  expect(clampedFit.renderedWidth).toBeCloseTo(clampedFit.spanWidth, 0);
  expect(clampedFit.renderedHeight).toBeCloseTo(
    clampedFit.renderedWidth * 48 / 64,
    0
  );
  await expectAligned();

  await page.getByTestId('document-image-wrap').selectOption('span-3');
  await page.getByTestId('document-image-crop-mode').selectOption('fill');
  await page.getByTestId('document-image-crop-focal-x').fill('0.2');
  await page.getByTestId('document-image-crop-focal-y').fill('0.8');
  await widthInput.fill(String(oversizedFitWidth));
  await heightInput.fill('190');
  const fillBeforeClamp = await readGeometry();
  expect(fillBeforeClamp.renderedHeight).toBeCloseTo(190, 0);
  await page.getByTestId('document-image-wrap').selectOption('span-2');
  const clampedFill = await readGeometry();
  expect(clampedFill.renderedWidth).toBeCloseTo(clampedFill.spanWidth, 0);
  expect(clampedFill.renderedHeight).toBeCloseTo(190, 0);

  const resizeHandle = layout.getByRole('button', { name: 'Resize image' });
  const resizeBox = await resizeHandle.boundingBox();
  expect(resizeBox).not.toBeNull();
  await page.mouse.move(
    resizeBox!.x + resizeBox!.width / 2,
    resizeBox!.y + resizeBox!.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    resizeBox!.x + resizeBox!.width / 2 - 35,
    resizeBox!.y + resizeBox!.height / 2
  );
  await expect.poll(async () => (await readGeometry()).renderedWidth)
    .toBeLessThan(clampedFill.renderedWidth);
  const resizedPreview = await readGeometry();
  expect(resizedPreview.renderedWidth).toBeLessThan(clampedFill.renderedWidth);
  expect(resizedPreview.renderedHeight).toBeCloseTo(190, 0);
  await expectAligned();
  await page.mouse.up();
  const resizedCommit = await readGeometry();
  expect(resizedCommit.renderedWidth).toBeCloseTo(resizedPreview.renderedWidth, 0);
  expect(resizedCommit.renderedHeight).toBeCloseTo(190, 0);

  await expect(page.getByTestId('document-image-crop-focal-x')).toHaveValue('0.2');
  await expect(page.getByTestId('document-image-crop-focal-y')).toHaveValue('0.8');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await page.getByTestId('dashboard-project-card')
    .filter({ hasText: 'Document Span Transform Preservation' })
    .getByRole('button')
    .first()
    .click();

  const reopenedLayout = page.locator('[data-document-span-layout]');
  await expect(reopenedLayout).toHaveAttribute('data-span-count', '2');
  await expect(reopenedLayout).toHaveAttribute('data-span-start-column', '1');
  await expect.poll(async () => Number(
    await reopenedLayout.getAttribute('data-rendered-image-width-px')
  )).toBeCloseTo(resizedCommit.renderedWidth, 0);
  await expect.poll(async () => Number(
    await reopenedLayout.getAttribute('data-rendered-image-height-px')
  )).toBeCloseTo(190, 0);
  await expect(reopenedLayout.locator(
    '[data-document-image-frame="true"]'
  )).toHaveAttribute('data-crop-mode', 'fill');
  await expect(reopenedLayout.locator(
    '[data-document-image-frame="true"]'
  )).toHaveAttribute('data-crop-focal-x', '0.2');
  await expect(reopenedLayout.locator(
    '[data-document-image-frame="true"]'
  )).toHaveAttribute('data-crop-focal-y', '0.8');
  const reopenedGeometry = await reopenedLayout.evaluate((root) => ({
    imageTop: Number(root.getAttribute('data-image-top-px')),
    xOffset: Number(root.getAttribute('data-image-x-offset-px')),
    verticalAnchor: root.getAttribute('data-vertical-anchor'),
  }));
  expect(reopenedGeometry.imageTop).toBeCloseTo(resizedCommit.imageTop, 0);
  expect(reopenedGeometry.xOffset).toBeCloseTo(resizedCommit.xOffset, 0);
  expect(reopenedGeometry.verticalAnchor).toBe(resizedCommit.verticalAnchor);
  await expectAligned();

  await page.getByTestId('document-add-page').click();
  await page.getByTestId('document-page-tab-0').click();
  await expect(page.locator('[data-document-span-layout]')).toBeVisible();
  await expectAligned();
});

test('converts an overlay to a span without replacing its transformed frame', async ({ page }) => {
  await openDocumentWithPhoto(page);

  const widthInput = page.getByLabel('Image width');
  const heightInput = page.getByLabel('Image height');
  await widthInput.fill('210');
  await page.getByTestId('document-image-crop-mode').selectOption('fill');
  await heightInput.fill('175');
  await page.getByTestId('document-image-crop-focal-x').fill('0.25');
  await page.getByTestId('document-image-crop-focal-y').fill('0.75');
  await page.getByTestId('document-image-wrap').selectOption('front');

  const overlayFrame = page.getByTestId('document-overlay-layer-front')
    .getByTestId('document-overlay-image')
    .locator('.document-overlay-image__frame');
  await expect(overlayFrame).toBeVisible();
  const overlayBox = await overlayFrame.boundingBox();
  expect(overlayBox).not.toBeNull();

  await page.getByTestId('document-image-wrap').selectOption('span-2');
  const layout = page.locator('[data-document-span-layout]');
  await expect(layout).toHaveAttribute('data-span-count', '2');
  await expect.poll(async () => Number(
    await layout.getAttribute('data-rendered-image-width-px')
  )).toBeCloseTo(Math.min(210, Number(
    await layout.getAttribute('data-span-width-px')
  )), 0);
  await expect.poll(async () => Number(
    await layout.getAttribute('data-rendered-image-height-px')
  )).toBeCloseTo(175, 0);
  await expect(layout).toHaveAttribute('data-vertical-anchor', 'page-position');
  await expect(layout.locator(
    '[data-document-image-frame="true"]'
  )).toHaveAttribute('data-crop-focal-x', '0.25');
  await expect(layout.locator(
    '[data-document-image-frame="true"]'
  )).toHaveAttribute('data-crop-focal-y', '0.75');
  const spanFrameBox = await layout.locator(
    '[data-document-image-frame="true"]'
  ).boundingBox();
  const spanChromeBox = await layout.locator(
    '[data-document-image-frame-chrome="true"]'
  ).boundingBox();
  expect(spanFrameBox).not.toBeNull();
  expect(spanChromeBox).not.toBeNull();
  expect(Math.abs(spanFrameBox!.x - spanChromeBox!.x)).toBeLessThan(1);
  expect(Math.abs(spanFrameBox!.y - spanChromeBox!.y)).toBeLessThan(1);
  expect(Math.abs(spanFrameBox!.width - spanChromeBox!.width)).toBeLessThan(1);
  expect(Math.abs(spanFrameBox!.height - spanChromeBox!.height)).toBeLessThan(1);
});

test('keeps existing transformed photos stable as additional photos enter the layout', async ({ page }) => {
  await openDocumentWithPhoto(page);

  const firstImageId = await page.locator('.document-image-node')
    .first()
    .getAttribute('data-image-id');
  expect(firstImageId).not.toBeNull();
  await page.getByTestId('document-image-wrap').selectOption('span-2');
  await page.getByTestId('document-image-vertical-anchor')
    .selectOption('page-position');
  await page.getByTestId('document-image-horizontal-placement')
    .selectOption('custom');
  await page.getByTestId('document-image-x-offset').fill('36');
  await page.getByTestId('document-image-y-position').fill('120');
  await page.getByLabel('Image width').fill('210');
  const photoABefore = await readStructuredPhotoGeometry(page, firstImageId!);

  await addPhoto(page, 'span-photo-b.png');
  const secondImageId = await page.locator('.document-image-node')
    .nth(1)
    .getAttribute('data-image-id');
  expect(secondImageId).not.toBeNull();
  await page.getByTestId('document-image-wrap').selectOption('span-2');
  await page.getByTestId('document-image-vertical-anchor')
    .selectOption('page-position');
  await page.getByTestId('document-image-horizontal-placement')
    .selectOption('custom');
  await page.getByTestId('document-image-x-offset').fill('240');
  await page.getByTestId('document-image-y-position').fill('360');
  await page.getByLabel('Image width').fill('180');
  const photoBBefore = await readStructuredPhotoGeometry(page, secondImageId!);
  expect(await readStructuredPhotoGeometry(page, firstImageId!))
    .toEqual(photoABefore);

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await page.getByTestId('dashboard-project-card')
    .filter({ hasText: 'Document Span Transform Preservation' })
    .getByRole('button')
    .first()
    .click();

  expect(await readStructuredPhotoGeometry(page, firstImageId!))
    .toEqual(photoABefore);
  expect(await readStructuredPhotoGeometry(page, secondImageId!))
    .toEqual(photoBBefore);

  await addPhoto(page, 'span-photo-c.png');
  const thirdImageId = await page.locator('.document-image-node')
    .nth(2)
    .getAttribute('data-image-id');
  expect(thirdImageId).not.toBeNull();
  await page.getByTestId('document-image-wrap').selectOption('span-2');
  await expect(page.locator(
    `[data-layout-role="occupied-columns"][data-image-id="${thirdImageId}"]`
  )).toBeVisible();

  expect(await readStructuredPhotoGeometry(page, firstImageId!))
    .toEqual(photoABefore);
  expect(await readStructuredPhotoGeometry(page, secondImageId!))
    .toEqual(photoBBefore);
});
