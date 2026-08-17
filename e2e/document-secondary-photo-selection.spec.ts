import { expect, test, type Page } from '@playwright/test';

const PHOTO_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAYAAAChS3wfAAAABmJLR0QA/wD/AP+gvaeTAAABa0lEQVRogeWZS5LDIAxEJXyK3GauNadnNuPQzceQbN8KVeJuBNJTlZN8/fzWkhEla7T1LL6+0q2/v77UrZ69jp7NiMwa9/ps6rHqPA7x63XrPVQ3xlX85vn0vrvcMiNKiRolIu41IyKj/q8a13fcNKu4il/tPMY9ZrrVHrN8+vg0txLSAadVX9+s3/KuOvrZrur5QW5lkU8fv3VjOz+19nkL7hJYH2y+xz637mAb7FrhidxbBwC513wKknvzBXJvuCK5t3yA3E9mAI37YQawuJ/MABr36gvkXn2HDmBwr75A7hvCXQdwuG/dWZDcq47IvemQ3JsXkHu7ECT36kXk3jsAyf1yBjC4f5gBEO7XM4DB/cMMoHBvM4DHvRURyb34FST3mgOReysWknvX8bi330CR3FsM5H4yA3Dc9zOAxb2dk8m9+gK5t9yg3OsePO7b/6Dhr8Mc7u9OlxlA4t4uCsp90yC5Vy8i9+r1B7Q45ELbjS61AAAAAElFTkSuQmCC';

type FrameGeometry = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

const openDocumentWithFirstPhoto = async (page: Page, name: string) => {
  await page.goto('/');
  await page.getByTestId('dashboard-new-document').click();
  await page.getByTestId('document-project-name').fill(name);
  await page.getByRole('button', { name: '3 columns' }).click();
  await page.locator('.document-flow-prosemirror').fill(
    'Text before, between, and after the photographs. '.repeat(30)
  );
  await page.getByTestId('document-image-file-input').setInputFiles({
    name: 'photo-a.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PHOTO_PNG_BASE64, 'base64'),
  });
  await expect(page.locator('.document-image-node')).toHaveCount(1);
  await page.locator('.document-image-node').click();
};

const configureSelectedSpan = async (
  page: Page,
  {
    xOffset,
    y,
    width = 200,
    caption,
    cropMode = 'fit',
  }: {
    xOffset: number;
    y: number;
    width?: number;
    caption?: string;
    cropMode?: 'fit' | 'fill';
  }
) => {
  await page.getByTestId('document-image-wrap').selectOption('span-3');
  await page.getByTestId('document-image-vertical-anchor')
    .selectOption('page-position');
  await page.getByTestId('document-image-horizontal-placement')
    .selectOption('custom');
  await page.getByTestId('document-image-x-offset').fill(String(xOffset));
  await page.getByTestId('document-image-y-position').fill(String(y));
  await page.getByLabel('Image width').fill(String(width));
  await page.getByTestId('document-image-crop-mode').selectOption(cropMode);
  if (cropMode === 'fill') {
    await page.getByLabel('Image height').fill('190');
  }
  if (caption !== undefined) {
    await page.getByLabel('Image caption').fill(caption);
  }
};

const addSecondPhoto = async (page: Page) => {
  await page.getByTestId('document-image-file-input').setInputFiles({
    name: 'photo-b.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PHOTO_PNG_BASE64, 'base64'),
  });
  await expect(page.locator('.document-image-node')).toHaveCount(2);
};

const readFrameGeometry = async (
  page: Page,
  imageId: string
): Promise<FrameGeometry> => {
  const frame = page.locator(
    `[data-document-span-layout] [data-document-visible-image-id="${imageId}"][data-document-image-hit-target="true"]`
  );
  await expect(frame).toBeVisible();
  return frame.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  });
};

const clickFrame = async (page: Page, imageId: string, point?: { x: number; y: number }) => {
  const frame = page.locator(
    `[data-document-span-layout] [data-document-visible-image-id="${imageId}"][data-document-image-hit-target="true"]`
  );
  const box = await frame.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(
    point?.x ?? box!.x + box!.width / 2,
    point?.y ?? box!.y + box!.height / 2
  );
};

const assertSelected = async (page: Page, imageId: string) => {
  const layout = page.locator('[data-document-span-layout]');
  const shell = page.getByTestId('document-editor-shell');
  await expect.poll(async () => shell.getAttribute(
    'data-selected-flow-image-id'
  )).toBe(imageId);
  await expect(layout).toHaveAttribute(
    'data-document-selected-image-id',
    imageId
  );
  await expect(page.getByTestId('document-image-inspector'))
    .toHaveAttribute('data-selected-image-id', imageId);
  await expect(layout.locator(
    `[data-layout-role="occupied-columns"][data-image-id="${imageId}"]`
  )).toHaveAttribute('data-image-selected', 'true');
  await expect(layout.locator(
    `[data-layout-role="occupied-columns"][data-image-id="${imageId}"] [data-document-image-frame-chrome="true"]`
  )).toHaveClass(/selected/);
  await expect(layout.locator(
    `[data-layout-role="occupied-columns"][data-image-id="${imageId}"]`
  ).getByRole('button', { name: 'Resize image' })).toBeVisible();
};

const readVisibleHitTarget = async (
  page: Page,
  point: { x: number; y: number }
) => page.evaluate(({ x, y }) => {
  const target = document.elementFromPoint(x, y);
  return target
    ?.closest<HTMLElement>('[data-document-image-hit-target="true"]')
    ?.dataset.documentVisibleImageId || null;
}, point);

const setupTwoPhotos = async (
  page: Page,
  name: string,
  positions: {
    a: { xOffset: number; y: number; caption?: string; cropMode?: 'fit' | 'fill' };
    b: { xOffset: number; y: number; caption?: string; cropMode?: 'fit' | 'fill' };
  }
) => {
  await openDocumentWithFirstPhoto(page, name);
  const firstImageId = await page.locator('.document-image-node')
    .getAttribute('data-image-id');
  expect(firstImageId).not.toBeNull();
  await configureSelectedSpan(page, positions.a);

  await addSecondPhoto(page);
  const secondImageId = await page.locator('.document-image-node')
    .nth(1)
    .getAttribute('data-image-id');
  expect(secondImageId).not.toBeNull();
  await configureSelectedSpan(page, positions.b);
  await expect(page.locator('[data-document-span-layout]'))
    .toHaveAttribute('data-structured-image-count', '2');
  return {
    firstImageId: firstImageId!,
    secondImageId: secondImageId!,
  };
};

test.describe('secondary structured photo selection', () => {
  test.describe.configure({ timeout: 120_000 });
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('selects B, resizes and moves only B, and switches A/B through text mode', async ({ page }) => {
    const { firstImageId, secondImageId } = await setupTwoPhotos(
      page,
      'Secondary Photo Selection Transform Flow',
      {
        a: { xOffset: 32, y: 160, caption: 'Caption A' },
        b: { xOffset: 300, y: 360 },
      }
    );
    const beforeA = await readFrameGeometry(page, firstImageId);

    await clickFrame(page, secondImageId);
    await assertSelected(page, secondImageId);

    const fitBeforeResize = await readFrameGeometry(page, secondImageId);
    const resizeHandle = page.locator(
      `[data-layout-role="occupied-columns"][data-image-id="${secondImageId}"]`
    ).getByRole('button', { name: 'Resize image' });
    const resizeBox = await resizeHandle.boundingBox();
    expect(resizeBox).not.toBeNull();
    await page.mouse.move(
      resizeBox!.x + resizeBox!.width / 2,
      resizeBox!.y + resizeBox!.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      resizeBox!.x + resizeBox!.width / 2 - 32,
      resizeBox!.y + resizeBox!.height / 2
    );
    await page.mouse.up();
    await expect.poll(async () => (await readFrameGeometry(page, secondImageId)).width)
      .toBeLessThan(fitBeforeResize.width);
    expect(await readFrameGeometry(page, firstImageId)).toEqual(beforeA);

    await page.getByTestId('document-image-crop-mode').selectOption('fill');
    await page.getByLabel('Image height').fill('190');
    await clickFrame(page, secondImageId);
    await assertSelected(page, secondImageId);
    const fillBeforeResize = await readFrameGeometry(page, secondImageId);
    const fillHandle = page.locator(
      `[data-layout-role="occupied-columns"][data-image-id="${secondImageId}"]`
    ).getByRole('button', { name: 'Resize image' });
    const fillBox = await fillHandle.boundingBox();
    expect(fillBox).not.toBeNull();
    await page.mouse.move(fillBox!.x + fillBox!.width / 2, fillBox!.y + fillBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(fillBox!.x + fillBox!.width / 2 - 24, fillBox!.y + fillBox!.height / 2);
    await page.mouse.up();
    await expect.poll(async () => (await readFrameGeometry(page, secondImageId)).width)
      .toBeLessThan(fillBeforeResize.width);
    expect(await readFrameGeometry(page, firstImageId)).toEqual(beforeA);

    const beforeMove = await readFrameGeometry(page, secondImageId);
    await clickFrame(page, secondImageId);
    const movePoint = {
      x: beforeMove.left + beforeMove.width / 2,
      y: beforeMove.top + beforeMove.height / 2,
    };
    await page.mouse.move(movePoint.x, movePoint.y);
    await page.mouse.down();
    await page.mouse.move(movePoint.x + 24, movePoint.y + 28);
    await page.mouse.up();
    await expect.poll(async () => (await readFrameGeometry(page, secondImageId)).top)
      .not.toBe(beforeMove.top);
    expect(await readFrameGeometry(page, firstImageId)).toEqual(beforeA);
    await assertSelected(page, secondImageId);

    await clickFrame(page, firstImageId);
    await assertSelected(page, firstImageId);
    await clickFrame(page, secondImageId);
    await assertSelected(page, secondImageId);
    await clickFrame(page, firstImageId);
    await assertSelected(page, firstImageId);
    await clickFrame(page, secondImageId);
    await assertSelected(page, secondImageId);

    const textBand = page.locator(
      '[data-document-span-layout] [data-layout-role="explicit-text-column"]'
    ).first();
    const textBox = await textBand.boundingBox();
    expect(textBox).not.toBeNull();
    await page.mouse.click(textBox!.x + 5, textBox!.y + 5);
    await expect(page.locator('[data-document-span-layout]'))
      .toHaveAttribute('data-text-editing', 'true');
    await page.keyboard.type('x');
    await clickFrame(page, secondImageId);
    await assertSelected(page, secondImageId);
  });

  test('uses the top visible frame for partial overlap and does not hit-test caption flow', async ({ page }) => {
    const { firstImageId, secondImageId } = await setupTwoPhotos(
      page,
      'Secondary Photo Overlap Hit Testing',
      {
        a: { xOffset: 36, y: 150, caption: 'Caption A' },
        b: { xOffset: 190, y: 220 },
      }
    );
    const a = await readFrameGeometry(page, firstImageId);
    const b = await readFrameGeometry(page, secondImageId);
    const overlap = {
      x: Math.max(a.left, b.left) + 12,
      y: Math.max(a.top, b.top) + 12,
    };
    const aOnly = { x: a.left + 12, y: a.top + a.height / 2 };
    const bOnly = { x: b.right - 12, y: b.top + b.height / 2 };
    expect(overlap.x).toBeLessThan(Math.min(a.right, b.right));
    expect(overlap.y).toBeLessThan(Math.min(a.bottom, b.bottom));
    expect(await readVisibleHitTarget(page, bOnly)).toBe(secondImageId);

    await clickFrame(page, secondImageId, bOnly);
    await assertSelected(page, secondImageId);
    await clickFrame(page, secondImageId, overlap);
    await assertSelected(page, secondImageId);
    expect(await readVisibleHitTarget(page, overlap)).toBe(secondImageId);

    await clickFrame(page, firstImageId, aOnly);
    await assertSelected(page, firstImageId);
    await clickFrame(page, firstImageId, overlap);
    await assertSelected(page, firstImageId);
    expect(await readVisibleHitTarget(page, overlap)).toBe(firstImageId);

    await clickFrame(page, secondImageId, bOnly);
    await assertSelected(page, secondImageId);
    await clickFrame(page, firstImageId, aOnly);
    await assertSelected(page, firstImageId);
  });

  test('resolves B by ID after text insertion changes its document position', async ({ page }) => {
    const { secondImageId } = await setupTwoPhotos(
      page,
      'Secondary Photo Stable Position Selection',
      {
        a: { xOffset: 32, y: 160 },
        b: { xOffset: 300, y: 360 },
      }
    );
    const layout = page.locator('[data-document-span-layout]');
    const secondSlot = layout.locator(
      `[data-layout-role="occupied-columns"][data-image-id="${secondImageId}"]`
    );
    const originalPosition = Number(
      await secondSlot.getAttribute('data-document-image-position')
    );
    expect(Number.isFinite(originalPosition)).toBe(true);

    const textBand = layout.locator(
      '[data-layout-role="explicit-text-column"]'
    ).first();
    const textBox = await textBand.boundingBox();
    expect(textBox).not.toBeNull();
    await page.mouse.click(textBox!.x + 5, textBox!.y + 5);
    await expect(layout).toHaveAttribute('data-text-editing', 'true');
    await page.keyboard.type('Inserted text before the second photo. ');
    await expect.poll(async () => Number(
      await secondSlot.getAttribute('data-document-image-position')
    )).not.toBe(originalPosition);

    await clickFrame(page, secondImageId);
    await assertSelected(page, secondImageId);
  });

  test('keeps B selectable after page switching and save/reopen', async ({ page }) => {
    const projectName = 'Secondary Photo Page Reopen Selection';
    const { firstImageId, secondImageId } = await setupTwoPhotos(
      page,
      projectName,
      {
        a: { xOffset: 32, y: 160 },
        b: { xOffset: 300, y: 360 },
      }
    );
    await clickFrame(page, secondImageId);
    await assertSelected(page, secondImageId);

    await page.getByTestId('document-add-page').click();
    await page.getByTestId('document-page-tab-0').click();
    await expect(page.locator('[data-document-span-layout]')).toBeVisible();
    await clickFrame(page, secondImageId);
    await assertSelected(page, secondImageId);

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);
    await page.getByRole('button', { name: 'Back to projects' }).click();
    await page.getByTestId('dashboard-project-card')
      .filter({ hasText: projectName })
      .getByRole('button')
      .first()
      .click();
    await expect(page.locator('[data-document-span-layout]')).toBeVisible();
    await clickFrame(page, secondImageId);
    await assertSelected(page, secondImageId);
    await expect(page.locator(
      `[data-layout-role="occupied-columns"][data-image-id="${firstImageId}"]`
    )).toHaveAttribute('data-image-selected', 'false');
  });
});
