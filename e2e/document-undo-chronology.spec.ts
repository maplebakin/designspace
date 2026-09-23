import { expect, test, type Page } from './test-fixtures';

const PHOTO_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAYAAAChS3wfAAAABmJLR0QA/wD/AP+gvaeTAAABa0lEQVRogeWZS5LDIAxEJXyK3GauNadnNuPQzceQbN8KVeJuBNJTlZN8/fzWkhEla7T1LL6+0q2/v77UrZ69jp7NiMwa9/ps6rHqPA7x63XrPVQ3xlX85vn0vrvcMiNKiRolIu41IyKj/q8a13fcNKu4il/tPMY9ZrrVHrN8+vg0txLSAadVX9+s3/KuOvrZrur5QW5lkU8fv3VjOz+19nkL7hJYH2y+xz637mAb7FrhidxbBwC513wKknvzBXJvuCK5t3yA3E9mAI37YQawuJ/MABr36gvkXn2HDmBwr75A7hvCXQdwuG/dWZDcq47IvemQ3JsXkHu7ECT36kXk3jsAyf1yBjC4f5gBEO7XM4DB/cMMoHBvM4DHvRURyb34FST3mgOReysWknvX8bi330CR3FsM5H4yA3Dc9zOAxb2dk8m9+gK5t9yg3OsePO7b/6Dhr8Mc7u9OlxlA4t4uCsp90yC5Vy8i9+r1B7Q45ELbjS61AAAAAElFTkSuQmCC';

const REFERENCE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAABmJLR0QA/wD/AP+gvaeTAAAAFklEQVQYlWP8z/D/PwMewIRPcvgoAAAWZQMNX90OAQAAAABJRU5ErkJggg==';

const file = (name: string, base64: string) => ({
  name,
  mimeType: 'image/png',
  buffer: Buffer.from(base64, 'base64'),
});

const openDocument = async (page: Page, name: string) => {
  await page.goto('/');
  await page.getByTestId('dashboard-new-document').click();
  void name;
  await expect(page.getByTestId('document-editor-shell')).toBeVisible();
};

const historyState = async (page: Page) => {
  const shell = page.getByTestId('document-editor-shell');
  return {
    length: Number(await shell.getAttribute('data-document-history-length')),
    index: Number(await shell.getAttribute('data-document-history-index')),
    canUndo: await shell.getAttribute('data-document-history-can-undo') === 'true',
    canRedo: await shell.getAttribute('data-document-history-can-redo') === 'true',
  };
};

const waitForHistoryGrowth = async (page: Page, minimum: number) => {
  await expect.poll(async () => (await historyState(page)).length)
    .toBeGreaterThanOrEqual(minimum);
};

const addOverlay = async (page: Page) => {
  await page.getByTestId('document-image-file-input').setInputFiles(
    file('chronology-photo.png', PHOTO_BASE64)
  );
  const image = page.locator('[data-document-image="true"]');
  await expect(image).toHaveCount(1);
  await image.click();
  await page.getByLabel('Image layout mode').selectOption('front');
  const overlay = page.locator('[data-document-overlay-id]').first();
  await expect(overlay).toBeVisible();
  await waitForHistoryGrowth(page, 1);
  return overlay;
};

const readOverlayLeft = async (overlay: ReturnType<Page['locator']>) => (
  Number.parseFloat(await overlay.evaluate((element) => getComputedStyle(element).left))
);

const readReferenceTransform = async (page: Page) => page.getByTestId(
  'document-reference-layer'
).locator('img').getAttribute('style');

const blurActiveElement = async (page: Page) => {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
};

const undo = (page: Page) => page.keyboard.press('Control+z');
const redo = (page: Page) => page.keyboard.press('Control+Shift+z');

test.describe('document authored undo chronology', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('Workflow A: body typing and overlay movement undo/redo chronologically', async ({ page }) => {
    await openDocument(page, 'Undo chronology body and overlay');
    const overlay = await addOverlay(page);
    const initialLeft = await readOverlayLeft(overlay);

    const body = page.locator('.document-flow-prosemirror');
    await body.fill('Body action comes before the overlay move.');
    await overlay.click();
    await blurActiveElement(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => readOverlayLeft(overlay)).toBeGreaterThan(initialLeft);
    await waitForHistoryGrowth(page, 2);

    await undo(page);
    await expect.poll(() => readOverlayLeft(overlay)).toBe(initialLeft);
    await undo(page);
    await expect(body).toHaveText('');

    await redo(page);
    await expect(body).toHaveText('Body action comes before the overlay move.');
    await redo(page);
    await expect.poll(() => readOverlayLeft(overlay)).toBeGreaterThan(initialLeft);
  });

  test('Workflow B: title, photo movement, and page layout reverse exactly', async ({ page }) => {
    await openDocument(page, 'Undo chronology title and layout');
    const overlay = await addOverlay(page);
    const initialLeft = await readOverlayLeft(overlay);

    await page.getByTestId('document-title-placeholder').click();
    const title = page.locator('.document-title-prosemirror');
    await title.fill('Chronological title');
    await waitForHistoryGrowth(page, 2);
    await overlay.click();
    await blurActiveElement(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => readOverlayLeft(overlay)).toBeGreaterThan(initialLeft);
    await page.getByTestId('document-page-preset').selectOption('a4');
    await expect(page.getByTestId('document-page-preset')).toHaveValue('a4');

    await undo(page);
    await expect(page.getByTestId('document-page-preset')).toHaveValue('letter');
    await undo(page);
    await expect.poll(() => readOverlayLeft(overlay)).toBe(initialLeft);
    await undo(page);
    await expect(title).toHaveText('');

    await redo(page);
    await expect(title).toHaveText('Chronological title');
    await redo(page);
    await expect.poll(() => readOverlayLeft(overlay)).toBeGreaterThan(initialLeft);
    await redo(page);
    await expect(page.getByTestId('document-page-preset')).toHaveValue('a4');
  });

  test('Workflow C: page switching does not erase project-wide authored history', async ({ page }) => {
    await openDocument(page, 'Undo chronology pages');
    const body = page.locator('.document-flow-prosemirror');
    await body.fill('First page action');
    await waitForHistoryGrowth(page, 1);
    await page.getByTestId('document-add-page').click();
    await expect(page.getByTestId('document-page-tab-1')).toHaveAttribute('aria-selected', 'true');
    await body.fill('Second page action');
    await waitForHistoryGrowth(page, 3);

    await undo(page);
    await expect(body).toHaveText('');
    await page.getByTestId('document-page-tab-0').click();
    await undo(page);
    await expect(page.getByTestId('document-page-tab-1')).toHaveCount(0);
    await undo(page);
    await expect(body).toHaveText('');
    expect((await historyState(page)).canUndo).toBe(false);
  });

  test('Workflow D: reference, image, and text edits share one chronology', async ({ page }) => {
    await openDocument(page, 'Undo chronology reference');
    await page.getByTestId('document-reference-file-input').setInputFiles(
      file('chronology-reference.png', REFERENCE_BASE64)
    );
    await expect(page.getByTestId('document-reference-controls')).toBeVisible();
    const overlay = await addOverlay(page);
    const initialLeft = await readOverlayLeft(overlay);

    await page.getByRole('button', { name: 'Adjust reference', exact: true }).click();
    const referenceX = page.getByLabel('Adjusting X position');
    await referenceX.fill('24');
    await referenceX.press('Tab');
    await expect(referenceX).toHaveValue('24');
    await page.getByTestId('document-reference-controls')
      .getByRole('button', { name: 'Finish adjusting', exact: true })
      .click();
    await expect.poll(() => readReferenceTransform(page))
      .toContain('translate(24px, 0px)');

    await overlay.click();
    await blurActiveElement(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => readOverlayLeft(overlay)).toBeGreaterThan(initialLeft);
    const body = page.locator('.document-flow-prosemirror');
    await body.fill('Reference, image, and text actions.');
    await waitForHistoryGrowth(page, 4);

    await undo(page);
    await expect(body).toHaveText('');
    await undo(page);
    await expect.poll(() => readOverlayLeft(overlay)).toBe(initialLeft);
    await undo(page);
    await expect.poll(() => readReferenceTransform(page))
      .toContain('translate(0px, 0px)');
  });

  test('Workflow E: grouped document images undo and redo atomically', async ({ page }) => {
    await openDocument(page, 'Undo chronology image group');
    const imageInput = page.getByTestId('document-image-file-input');
    await imageInput.setInputFiles([
      file('group-a.png', PHOTO_BASE64),
      file('group-b.png', PHOTO_BASE64),
    ]);
    const images = page.locator('[data-document-image="true"]');
    await expect(images).toHaveCount(2);
    await images.nth(0).click();
    await images.nth(1).click({ modifiers: ['Shift'] });
    await expect(page.getByTestId('document-image-group-selection'))
      .toHaveAttribute('data-image-count', '2');
    await page.getByTestId('document-image-group-row').click();
    await expect(page.locator('[data-document-span-layout]'))
      .toHaveAttribute('data-image-group-count', '1');
    const historyBeforeGroup = await historyState(page);

    await undo(page);
    await expect(page.locator('[data-image-group-id]')).toHaveCount(0);
    await redo(page);
    await expect(page.locator('[data-document-span-layout]'))
      .toHaveAttribute('data-image-group-count', '1');
    expect((await historyState(page)).length).toBe(historyBeforeGroup.length);
  });

  test('redo branching discards stale editor-native redo', async ({ page }) => {
    await openDocument(page, 'Undo chronology branching');
    const body = page.locator('.document-flow-prosemirror');
    await body.fill('First branch');
    await waitForHistoryGrowth(page, 1);
    await undo(page);
    await expect(body).toHaveText('');
    await body.fill('Divergent branch');
    await expect.poll(async () => {
      const state = await historyState(page);
      return state.index === state.length && state.length > 0;
    }).toBe(true);
    expect((await historyState(page)).canRedo).toBe(false);
    await redo(page);
    await expect(body).toHaveText('Divergent branch');
  });

  test('Undo flushes a live text draft inside the debounce window', async ({ page }) => {
    await openDocument(page, 'Undo chronology immediate draft');
    const body = page.locator('.document-flow-prosemirror');
    await body.fill('Undo before the draft timer fires.');
    await page.keyboard.press('Control+z');
    await expect(body).toHaveText('');
    await expect.poll(async () => (await historyState(page)).canUndo).toBe(false);
    expect((await historyState(page)).canRedo).toBe(true);
  });

  test('save after undo persists the current state and redo makes it dirty again', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await openDocument(page, 'Undo chronology persistence');
      const body = page.locator('.document-flow-prosemirror');
      await body.fill('Initial durable body');
      await waitForHistoryGrowth(page, 1);

      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);

      await body.fill('Newer durable body');
      await waitForHistoryGrowth(page, 2);
      await undo(page);
      await expect(body).toHaveText('Initial durable body');
      await expect(page.getByTestId('document-save-status'))
        .toHaveText(/unsaved changes/i);

      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);

      await redo(page);
      await expect(body).toHaveText('Newer durable body');
      await expect(page.getByTestId('document-save-status'))
        .toHaveText(/unsaved changes/i);

      // Save the undone state again so the fresh session assertion proves the
      // durable scene, rather than an in-memory history entry.
      await undo(page);
      await expect(body).toHaveText('Initial durable body');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);

      await page.getByRole('button', { name: 'Back to projects' }).click();
      const savedCard = page.getByTestId('dashboard-project-card').filter({
        hasText: 'Untitled Document',
      });
      await expect(savedCard).toBeVisible();
      await savedCard.getByRole('button').first().click();
      await expect(page.getByTestId('document-editor-shell')).toBeVisible();
      await expect(page.locator('.document-flow-prosemirror'))
        .toHaveText('Initial durable body');
      await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);
    } finally {
      await context.close();
    }
  });
});
