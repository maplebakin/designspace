import { expect, test, type Page } from './test-fixtures';

const PHOTO_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAYAAAChS3wfAAAABmJLR0QA/wD/AP+gvaeTAAABa0lEQVRogeWZS5LDIAxEJXyK3GauNadnNuPQzceQbN8KVeJuBNJTlZN8/fzWkhEla7T1LL6+0q2/v77UrZ69jp7NiMwa9/ps6rHqPA7x63XrPVQ3xlX85vn0vrvcMiNKiRolIu41IyKj/q8a13fcNKu4il/tPMY9ZrrVHrN8+vg0txLSAadVX9+s3/KuOvrZrur5QW5lkU8fv3VjOz+19nkL7hJYH2y+xz637mAb7FrhidxbBwC513wKknvzBXJvuCK5t3yA3E9mAI37YQawuJ/MABr36gvkXn2HDmBwr75A7hvCXQdwuG/dWZDcq47IvemQ3JsXkHu7ECT36kXk3jsAyf1yBjC4f5gBEO7XM4DB/cMMoHBvM4DHvRURyb34FST3mgOReysWknvX8bi330CR3FsM5H4yA3Dc9zOAxb2dk8m9+gK5t9yg3OsePO7b/6Dhr8Mc7u9OlxlA4t4uCsp90yC5Vy8i9+r1B7Q45ELbjS61AAAAAElFTkSuQmCC';

const readBlockOrder = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const prosemirror = document.querySelector(
      '[data-document-region="body"] .ProseMirror'
    );
    if (!prosemirror) return [];
    return Array.from(prosemirror.children).map((child) =>
      child.querySelector('[data-document-image]')
        ? 'IMG'
        : (child.textContent || '').trim().slice(0, 32)
    );
  });

const readImageCenter = (page: Page) =>
  page.evaluate(() => {
    const figure = document.querySelector(
      '[data-document-region="body"] [data-document-image="true"]'
    );
    if (!figure) return null;
    const rect = figure.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });

const readLastParagraphBottom = (page: Page) =>
  page.evaluate(() => {
    const prosemirror = document.querySelector(
      '[data-document-region="body"] .ProseMirror'
    );
    if (!prosemirror) return null;
    const blocks = Array.from(prosemirror.children).filter(
      (child) => !child.querySelector('[data-document-image]')
        && (child.textContent || '').trim().length > 0
    );
    const last = blocks[blocks.length - 1];
    if (!last) return null;
    const rect = last.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.bottom + 24 };
  });

test('dragging a floated photo repositions it in the body text', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await page.getByTestId('dashboard-new-document').click();

  const bodyRegion = page.getByTestId('document-body-region');
  const regionBox = await bodyRegion.boundingBox();
  expect(regionBox).not.toBeNull();
  // Clicking empty body area must focus the editor (click-focus fix).
  await page.mouse.click(regionBox!.x + 40, regionBox!.y + 20);
  for (const paragraph of ['Alpha Absatz.', 'Beta Absatz.', 'Gamma Absatz.']) {
    await page.keyboard.type(paragraph);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
  }
  await page.keyboard.press('ControlOrMeta+Home');
  await page.getByTestId('document-image-file-input').setInputFiles({
    name: 'photo-a.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PHOTO_PNG_BASE64, 'base64'),
  });
  await expect
    .poll(() => readBlockOrder(page))
    .toEqual(expect.arrayContaining(['IMG']));

  const orderBefore = await readBlockOrder(page);
  expect(orderBefore[0]).toBe('IMG');

  const imageCenter = await readImageCenter(page);
  expect(imageCenter).not.toBeNull();
  const dropTarget = await readLastParagraphBottom(page);
  expect(dropTarget).not.toBeNull();

  await page.mouse.move(imageCenter!.x, imageCenter!.y);
  await page.mouse.down();
  await page.mouse.move(dropTarget!.x, dropTarget!.y, { steps: 15 });
  // A drop indicator line tracks the pending anchor while dragging.
  await expect(page.locator('.document-image-drop-indicator')).toBeVisible();
  await page.mouse.up();

  // The photo lands after the last paragraph of text.
  await expect.poll(async () => {
    const order = await readBlockOrder(page);
    const imageIndex = order.indexOf('IMG');
    const textBlocks = order.filter((block) => block !== 'IMG' && block !== '');
    return { imageIndex, textBlocks, imageIsLast: imageIndex === order.length - 2 || imageIndex === order.length - 1 };
  }).toEqual({
    imageIndex: expect.any(Number),
    textBlocks: ['Alpha Absatz.', 'Beta Absatz.', 'Gamma Absatz.'],
    imageIsLast: true,
  });

  // The drag is a normal document transaction: undo restores the photo.
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => readBlockOrder(page)).toEqual(orderBefore);

  // No stray drag artifacts remain in the DOM.
  await expect(
    page.locator('.document-image-drop-indicator')
  ).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
