import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const tinyPng = (name = 'p1-clipboard.png') => ({
  name,
  mimeType: 'image/png',
  buffer: Buffer.from(
    readFileSync(resolve(process.cwd(), 'e2e/fixtures/tiny-red-pixel.png.base64'), 'utf8').trim(),
    'base64',
  ),
});

const openBlankEditor = async (page: Page) => {
  await page.goto('/');
  await page.getByTestId('dashboard-new-project').click();
  await page.getByTestId('project-preset-instagram-square').click();
  await expect(page.getByTestId('editor-shell')).toBeVisible();
  await page.waitForFunction(() => (window as any).__DESIGN_SPACE_QA__?.snapshot().canvasReady === true);
};

const readLatestLibraryPayload = async (page: Page) => page.evaluate(() => new Promise<Record<string, any>>((resolvePayload, reject) => {
  const request = indexedDB.open('DesignSpaceDB');
  request.onerror = () => reject(request.error || new Error('Could not open Design Space library'));
  request.onsuccess = () => {
    const database = request.result;
    const transaction = database.transaction(['projects', 'canvasData'], 'readonly');
    const projectsRequest = transaction.objectStore('projects').getAll();
    const canvasRequest = transaction.objectStore('canvasData').getAll();
    transaction.oncomplete = () => {
      try {
        const project = projectsRequest.result.at(-1);
        const canvasData = canvasRequest.result.find((row: { id: string }) => row.id === project?.canvasDataId);
        if (!project || !canvasData) throw new Error('No durable project payload found');
        resolvePayload(JSON.parse((canvasData as { jsonPayload: string }).jsonPayload));
      } catch (error) {
        reject(error);
      } finally {
        database.close();
      }
    };
    transaction.onerror = () => reject(transaction.error || new Error('Could not read durable project payload'));
  };
}));

test('real image clipboard round-trip preserves page geometry, appearance and durable asset identity', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  let reopenedContext: BrowserContext | null = null;
  try {
    await openBlankEditor(page);
    await page.getByTestId('nav-insert').click();
    await page.getByTestId('insert-upload-image-input').setInputFiles(tinyPng());
    await expect.poll(async () => page.evaluate(() => (
      (window as any).__DESIGN_SPACE_QA__.snapshot().objects
        .filter((object: { type: string }) => object.type === 'image').length
    ))).toBe(1);
    await page.getByTestId('nav-shapes').click();
    await page.getByTestId('shape-rectangle').click();
    await expect.poll(async () => page.evaluate(() => (
      (window as any).__DESIGN_SPACE_QA__.snapshot().objects
        .filter((object: { type: string }) => object.type === 'rect').length
    ))).toBe(1);

    const source = await page.evaluate(() => (
      (window as any).__DESIGN_SPACE_QA__.prepareP1ClipboardScene()
    ));
    expect(source.activeObjectType).toMatch(/activeSelection/i);
    expect(source.objects).toHaveLength(2);
    const sourceImage = source.objects.find((object: { type: string }) => object.type === 'image');
    expect(sourceImage).toBeTruthy();

    expect(await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.copyP1Selection())).toBe(true);
    expect(await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.pasteP1Selection())).toBe(true);
    const pastedScene = await page.evaluate(() => (
      (window as any).__DESIGN_SPACE_QA__.auditP1ClipboardObjects()
    ));
    expect(pastedScene.activeObjectType).toMatch(/activeSelection/i);
    expect(pastedScene.objects).toHaveLength(4);

    const sourceIds = new Set(source.objects.map((object: { id: string }) => object.id));
    const pastedObjects = pastedScene.objects.filter((object: { id: string }) => !sourceIds.has(object.id));
    expect(pastedObjects).toHaveLength(2);
    pastedObjects.forEach((object: any, index: number) => {
      const expected = source.objects[index];
      expect(object.id).not.toBe(expected.id);
      expect(object.type).toBe(expected.type);
      expect(object.left).toBeCloseTo(expected.left + 20, 2);
      expect(object.top).toBeCloseTo(expected.top + 20, 2);
      expect(object.scaleX).toBeCloseTo(expected.scaleX, 3);
      expect(object.scaleY).toBeCloseTo(expected.scaleY, 3);
      expect(object.angle).toBeCloseTo(expected.angle, 2);
      expect(object.opacity).toBeCloseTo(expected.opacity, 3);
      expect(object.corners).toHaveLength(expected.corners.length);
      object.corners.forEach((point: { x: number; y: number }, cornerIndex: number) => {
        expect(point.x).toBeCloseTo(expected.corners[cornerIndex].x + 20, 1);
        expect(point.y).toBeCloseTo(expected.corners[cornerIndex].y + 20, 1);
      });
    });
    const pastedImage = pastedObjects.find((object: { type: string }) => object.type === 'image');
    expect(pastedImage?.imageSource).toMatch(/^(blob:|data:image\/png;base64,)/i);
    expect(pastedImage?.filters).toContain('Brightness');
    expect(pastedImage?.filtersAreFabric).toBe(true);
    expect(pastedImage?.clipPathType).toMatch(/circle/i);
    expect(pastedImage?.clipPathIsFabric).toBe(true);

    const imageSources = [sourceImage.imageSource, pastedImage.imageSource];
    const imageBytes = await page.evaluate(async (sources: string[]) => Promise.all(
      sources.map(async (source) => Array.from(new Uint8Array(await (await fetch(source)).arrayBuffer()))),
    ), imageSources);
    expect(imageBytes[0]).toEqual(imageBytes[1]);

    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByText('Save to Library', { exact: true }).click();
    await expect(page.getByTestId('unified-save-status')).toHaveText(/saved/i);
    const durable = await readLatestLibraryPayload(page);
    const durableObjects = (durable.pages?.[0]?.canvasData?.objects
      || durable.canvasData?.objects
      || []) as Array<any>;
    const durableImages = durableObjects.filter((object) => object.type === 'Image' || object.type === 'image');
    expect(durableImages).toHaveLength(2);
    const durableAssetIds = new Set(durableImages.map((object) => object.assetId || object.id));
    expect(durableAssetIds.size).toBe(1);
    const assetId = [...durableAssetIds][0];
    expect(durable.assets?.[assetId]).toMatch(/^data:image\/png;base64,/);
    durableImages.forEach((object) => expect(object.src).not.toMatch(/^blob:/));

    const storageState = await context.storageState({ indexedDB: true });
    await page.close();
    await context.close();
    reopenedContext = await browser.newContext({ storageState });
    const reopened = await reopenedContext.newPage();
    await reopened.goto('/');
    const card = reopened.getByTestId('dashboard-project-card').filter({ hasText: 'Untitled Project' });
    await expect(card).toBeVisible();
    await card.locator('button.project-dashboard-project-open').click();
    await expect(reopened.getByTestId('editor-shell')).toBeVisible();
    await reopened.waitForFunction(() => (window as any).__DESIGN_SPACE_QA__?.snapshot().canvasReady === true);
    const reopenedScene = await reopened.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot());
    const reopenedAudit = await reopened.evaluate(() => (window as any).__DESIGN_SPACE_QA__.auditP1ClipboardObjects());
    const reopenedImages = reopenedScene.objects.filter((object: { type: string }) => object.type === 'image');
    expect(reopenedImages).toHaveLength(2);
    expect(reopenedAudit.objects.map((object: { id: string }) => object.id))
      .toEqual(pastedScene.objects.map((object: { id: string }) => object.id));
    reopenedAudit.objects.forEach((object: any, index: number) => {
      const expected = pastedScene.objects[index];
      expect(object.type).toBe(expected.type);
      expect(object.left).toBeCloseTo(expected.left, 1);
      expect(object.top).toBeCloseTo(expected.top, 1);
      expect(object.scaleX).toBeCloseTo(expected.scaleX, 2);
      expect(object.scaleY).toBeCloseTo(expected.scaleY, 2);
      expect(object.angle).toBeCloseTo(expected.angle, 1);
      expect(object.opacity).toBeCloseTo(expected.opacity, 2);
      object.corners.forEach((point: { x: number; y: number }, cornerIndex: number) => {
        expect(point.x).toBeCloseTo(expected.corners[cornerIndex].x, 1);
        expect(point.y).toBeCloseTo(expected.corners[cornerIndex].y, 1);
      });
    });
    const reopenedAuditImage = reopenedAudit.objects.find((object: { type: string }) => object.type === 'image');
    expect(reopenedAuditImage?.filters).toContain('Brightness');
    expect(reopenedAuditImage?.filtersAreFabric).toBe(true);
    expect(reopenedAuditImage?.clipPathType).toMatch(/circle/i);
    expect(reopenedAuditImage?.clipPathIsFabric).toBe(true);
    const reopenedBytes = await reopened.evaluate(async (sources: string[]) => Promise.all(
      sources.map(async (source) => Array.from(new Uint8Array(await (await fetch(source)).arrayBuffer()))),
    ), reopenedImages.map((object: any) => object.imageSource));
    reopenedBytes.forEach((bytes) => {
      expect(bytes.slice(0, 8)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(bytes.length).toBeGreaterThan(32);
    });
    expect(reopenedImages.map((object: any) => object.assetId || object.id)).toHaveLength(2);
    reopenedImages.forEach((object: any) => expect(object.imageSource).toMatch(/^(blob:|data:image\/png;base64,)/i));
  } finally {
    await reopenedContext?.close();
    await context.close().catch(() => undefined);
  }
});

test('clipboard duplication keeps grouped child identity recursively unique', async ({ page }) => {
  await openBlankEditor(page);
  await page.getByTestId('nav-insert').click();
  await page.getByTestId('insert-upload-image-input').setInputFiles(tinyPng('p1-group.png'));
  await expect.poll(async () => page.evaluate(() => (
    (window as any).__DESIGN_SPACE_QA__.snapshot().objects
      .filter((object: { type: string }) => object.type === 'image').length
  ))).toBe(1);
  await page.getByTestId('nav-shapes').click();
  await page.getByTestId('shape-rectangle').click();
  await expect.poll(async () => page.evaluate(() => (
    (window as any).__DESIGN_SPACE_QA__.snapshot().objects
      .filter((object: { type: string }) => object.type === 'rect').length
  ))).toBe(1);
  const grouped = await page.evaluate(() => (
    (window as any).__DESIGN_SPACE_QA__.groupP1ClipboardObjects?.()
  ));
  expect(grouped).toBeTruthy();
  expect(grouped.type).toBe('group');
  expect(await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.copyP1Selection())).toBe(true);
  expect(await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.pasteP1Selection())).toBe(true);
  const scene = await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.auditP1ClipboardObjects());
  const groups = scene.objects.filter((object: { type: string }) => object.type === 'group');
  expect(groups).toHaveLength(2);
  const collectIds = (object: any, ids = new Set<string>()) => {
    expect(ids.has(object.id)).toBe(false);
    ids.add(object.id);
    (object.objects ?? []).forEach((child: any) => collectIds(child, ids));
    return ids;
  };
  const sourceIds = collectIds(groups[0]);
  const duplicateIds = collectIds(groups[1]);
  sourceIds.forEach((id) => expect(duplicateIds.has(id)).toBe(false));
});

test('page dimensions participate in undo/redo and durable reopen', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  let reopenedContext: BrowserContext | null = null;
  try {
    await openBlankEditor(page);
    await page.getByTestId('nav-shapes').click();
    await page.getByTestId('shape-rectangle').click();
    await expect.poll(async () => page.evaluate(() => (
      (window as any).__DESIGN_SPACE_QA__.snapshot().objects
        .filter((object: { type: string }) => object.type === 'rect').length
    ))).toBe(1);
    await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.flushP1History());
    const initial = await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot());
    const resized = await page.evaluate(() => (
      (window as any).__DESIGN_SPACE_QA__.resizeP1Canvas(1200, 900, false)
    ));
    expect(resized.documentSize).toEqual({ width: 1200, height: 900 });
    expect(resized.objects[0].left).toBeCloseTo(initial.objects[0].left, 3);
    const resizedLayout = await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.documentLayout());
    expect(resizedLayout.paperInCanvas).toMatchObject({ width: 1200, height: 900 });
    const undone = await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.undoP1());
    expect(undone.documentSize).toEqual(initial.documentSize);
    expect(undone.objects[0].left).toBeCloseTo(initial.objects[0].left, 3);
    const undoneLayout = await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.documentLayout());
    expect(undoneLayout.paperInCanvas).toMatchObject({
      width: initial.documentSize.width,
      height: initial.documentSize.height,
    });
    const redone = await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.redoP1());
    expect(redone.documentSize).toEqual({ width: 1200, height: 900 });

    const scaled = await page.evaluate(() => (
      (window as any).__DESIGN_SPACE_QA__.resizeP1Canvas(1600, 1000, true)
    ));
    expect(scaled.documentSize).toEqual({ width: 1600, height: 1000 });
    expect(scaled.objects[0].scaleX).not.toBeCloseTo(redone.objects[0].scaleX, 3);
    const scaledUndo = await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.undoP1());
    expect(scaledUndo.documentSize).toEqual({ width: 1200, height: 900 });
    const scaledRedo = await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.redoP1());
    expect(scaledRedo.documentSize).toEqual({ width: 1600, height: 1000 });
    const scaledLayout = await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.documentLayout());
    expect(scaledLayout.paperInCanvas).toMatchObject({ width: 1600, height: 1000 });

    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByText('Save to Library', { exact: true }).click();
    await expect(page.getByTestId('unified-save-status')).toHaveText(/saved/i);
    const storageState = await context.storageState({ indexedDB: true });
    await page.close();
    await context.close();
    reopenedContext = await browser.newContext({ storageState });
    const reopened = await reopenedContext.newPage();
    await reopened.goto('/');
    const card = reopened.getByTestId('dashboard-project-card').filter({ hasText: 'Untitled Project' });
    await expect(card).toBeVisible();
    await card.locator('button.project-dashboard-project-open').click();
    await expect(reopened.getByTestId('editor-shell')).toBeVisible();
    await reopened.waitForFunction(() => (window as any).__DESIGN_SPACE_QA__?.snapshot().canvasReady === true);
    const reopenedScene = await reopened.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot());
    const reopenedLayout = await reopened.evaluate(() => (window as any).__DESIGN_SPACE_QA__.documentLayout());
    expect(reopenedScene.documentSize).toEqual({ width: 1600, height: 1000 });
    expect(reopenedLayout.paperInCanvas).toMatchObject({ width: 1600, height: 1000 });
    expect(reopenedScene.objects[0].left).toBeCloseTo(scaledRedo.objects[0].left, 2);
    expect(reopenedScene.objects[0].scaleX).toBeCloseTo(scaledRedo.objects[0].scaleX, 3);
  } finally {
    await reopenedContext?.close();
    await context.close().catch(() => undefined);
  }
});
