import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const tinyPng = (name = 'p0-round-trip.png') => ({
  name,
  mimeType: 'image/png',
  buffer: Buffer.from(
    readFileSync(resolve(process.cwd(), 'e2e/fixtures/tiny-red-pixel.png.base64'), 'utf8').trim(),
    'base64'
  ),
});

const openBlankEditor = async (page: Page) => {
  await page.goto('/');
  await page.getByTestId('dashboard-new-project').click();
  await page.getByTestId('project-preset-instagram-square').click();
  await expect(page.getByTestId('editor-shell')).toBeVisible();
  await page.waitForFunction(() => (window as any).__DESIGN_SPACE_QA__?.snapshot().canvasReady === true);
};

const readLibraryPayload = async (page: Page) => page.evaluate(() => new Promise<{
  projectId: string;
  revision: number;
  payload: Record<string, any>;
}>( (resolvePayload, reject) => {
  const request = indexedDB.open('DesignSpaceDB');
  request.onerror = () => reject(request.error || new Error('Could not open the browser library'));
  request.onsuccess = () => {
    const database = request.result;
    const transaction = database.transaction(['projects', 'canvasData'], 'readonly');
    const projectsRequest = transaction.objectStore('projects').getAll();
    projectsRequest.onerror = () => reject(projectsRequest.error || new Error('Could not read projects'));
    projectsRequest.onsuccess = () => {
      const projects = projectsRequest.result as Array<{ id: string; canvasDataId: string }>;
      const project = projects.at(-1);
      if (!project) {
        reject(new Error('No saved project was found'));
        return;
      }
      const canvasRequest = transaction.objectStore('canvasData').get(project.canvasDataId);
      canvasRequest.onerror = () => reject(canvasRequest.error || new Error('Could not read canvas data'));
      canvasRequest.onsuccess = () => {
        try {
          resolvePayload({
            projectId: project.id,
            revision: Number((project as { revision?: number }).revision ?? 1),
            payload: JSON.parse((canvasRequest.result as { jsonPayload: string }).jsonPayload),
          });
        } catch (error) {
          reject(error);
        } finally {
          database.close();
        }
      };
    };
  };
}));

const readLibraryIndexes = async (page: Page) => page.evaluate(() => new Promise<{
  projects: string[];
  canvasData: string[];
}>((resolveIndexes, reject) => {
  const request = indexedDB.open('DesignSpaceDB');
  request.onerror = () => reject(request.error || new Error('Could not open the browser library'));
  request.onsuccess = () => {
    const database = request.result;
    const transaction = database.transaction(['projects', 'canvasData'], 'readonly');
    resolveIndexes({
      projects: Array.from(transaction.objectStore('projects').indexNames),
      canvasData: Array.from(transaction.objectStore('canvasData').indexNames),
    });
    database.close();
  };
}));

const readLibraryRows = async (page: Page) => page.evaluate(() => new Promise<{
  projects: Array<{ id: string; canvasDataId: string; revision?: number; name: string }>;
  canvasData: Array<{ id: string; projectId: string; revision?: number; payload: Record<string, any> }>;
}>((resolveRows, reject) => {
  const request = indexedDB.open('DesignSpaceDB');
  request.onerror = () => reject(request.error || new Error('Could not open the browser library'));
  request.onsuccess = () => {
    const database = request.result;
    const transaction = database.transaction(['projects', 'canvasData'], 'readonly');
    const projectsRequest = transaction.objectStore('projects').getAll();
    const canvasRequest = transaction.objectStore('canvasData').getAll();
    projectsRequest.onerror = () => reject(projectsRequest.error || new Error('Could not read projects'));
    canvasRequest.onerror = () => reject(canvasRequest.error || new Error('Could not read canvas data'));
    transaction.oncomplete = () => {
      try {
        resolveRows({
          projects: projectsRequest.result,
          canvasData: canvasRequest.result.map((row: { id: string; projectId: string; revision?: number; jsonPayload: string }) => ({
            id: row.id,
            projectId: row.projectId,
            revision: row.revision,
            payload: JSON.parse(row.jsonPayload),
          })),
        });
      } catch (error) {
        reject(error);
      } finally {
        database.close();
      }
    };
    transaction.onerror = () => reject(transaction.error || new Error('Could not inspect browser library rows'));
  };
}));

test('uploaded image bytes and page-space geometry survive a fresh browsing session', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await openBlankEditor(page);
    await page.getByTestId('nav-insert').click();
    await page.getByTestId('insert-upload-image-input').setInputFiles(tinyPng());
    await expect.poll(async () => (
      await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects
        .filter((object: { type: string }) => object.type === 'image').length)
    )).toBe(1);

    const beforeSave = await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot());
    const imageBeforeSave = beforeSave.objects.find((object: { type: string }) => object.type === 'image');
    expect(imageBeforeSave).toBeTruthy();

    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByText('Save to Library', { exact: true }).click();
    await expect(page.getByTestId('unified-save-status')).toHaveText(/saved/i);

    const durable = await readLibraryPayload(page);
    const indexes = await readLibraryIndexes(page);
    expect(indexes.projects).not.toContain('thumbnail');
    expect(indexes.canvasData).not.toContain('jsonPayload');
    const assets = durable.payload.assets as Record<string, string>;
    const durableObjects = (durable.payload.pages?.[0]?.canvasData?.objects
      || durable.payload.canvasData?.objects
      || []) as Array<{ id?: string; src?: string; type?: string }>;
    const durableImage = durableObjects.find((object) => (
      object.type === 'Image' || object.type === 'image'
    ));
    expect(durableImage?.id).toBeTruthy();
    expect(durableImage?.src).not.toMatch(/^blob:/);
    expect(typeof assets[durableImage!.id!]).toBe('string');
    expect(assets[durableImage!.id!]).toMatch(/^data:image\/png;base64,/);
    const serializedPayload = JSON.stringify(durable.payload);
    expect(serializedPayload).not.toMatch(/blob:http/i);

    // Closing the page destroys the original Fabric canvas and its session
    // blob URLs while the IndexedDB record remains in the browser context.
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto('/');
    const card = reopened.getByTestId('dashboard-project-card').filter({ hasText: 'Untitled Project' });
    await expect(card).toBeVisible();
    await card.locator('button.project-dashboard-project-open').click();
    await expect(reopened.getByTestId('editor-shell')).toBeVisible();
    await reopened.waitForFunction(() => (window as any).__DESIGN_SPACE_QA__?.snapshot().canvasReady === true);
    await expect.poll(async () => (
      await reopened.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects
        .filter((object: { type: string }) => object.type === 'image').length)
    )).toBe(1);

    const afterReopen = await reopened.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot());
    const imageAfterReopen = afterReopen.objects.find((object: { type: string }) => object.type === 'image');
    expect(imageAfterReopen).toMatchObject({
      left: imageBeforeSave.left,
      top: imageBeforeSave.top,
      width: imageBeforeSave.width,
      height: imageBeforeSave.height,
      scaleX: imageBeforeSave.scaleX,
      scaleY: imageBeforeSave.scaleY,
    });
  } finally {
    await context.close();
  }
});

test('composite real-image selection/group scene survives durable round-trip and history replay', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  let reopenedContext: BrowserContext | null = null;
  try {
    await openBlankEditor(page);
    await page.getByTestId('nav-insert').click();
    await page.getByTestId('insert-upload-image-input').setInputFiles(tinyPng('p0-composite-a.png'));
    await expect.poll(async () => (
      await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects
        .filter((object: { type: string }) => object.type === 'image').length)
    )).toBe(1);
    await page.getByTestId('insert-upload-image-input').setInputFiles(tinyPng('p0-composite-b.png'));
    await expect.poll(async () => (
      await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects
        .filter((object: { type: string }) => object.type === 'image').length)
    )).toBe(2);

    const selection = await page.evaluate(() => (
      (window as any).__DESIGN_SPACE_QA__.prepareP0ActiveSelection()
    ));
    const sceneBeforeSave = await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot());
    expect(selection.selectionSaveActiveObjectType).toMatch(/activeSelection/i);
    expect(selection.selectionAudit).toHaveLength(2);

    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByText('Save to Library', { exact: true }).click();
    await expect(page.getByTestId('unified-save-status')).toHaveText(/saved/i);
    await expect.poll(async () => (
      await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().activeObjectType)
    )).toMatch(/activeSelection/i);

    const durable = await readLibraryPayload(page);
    const assets = durable.payload.assets as Record<string, string>;
    const durableObjects = (durable.payload.pages?.[0]?.canvasData?.objects
      || durable.payload.canvasData?.objects
      || []) as Array<{ id?: string; src?: string; type?: string }>;
    const durableImages = durableObjects.filter((object) => object.type === 'Image' || object.type === 'image');
    expect(durableImages).toHaveLength(2);
    durableImages.forEach((object) => {
      expect(object.id).toBeTruthy();
      expect(object.src).not.toMatch(/^blob:/);
      expect(assets[object.id!]).toMatch(/^data:image\/png;base64,/);
    });
    expect(JSON.stringify(durable.payload)).not.toMatch(/blob:http/i);
    selection.selectionAudit.forEach((expected: any, index: number) => {
      const durableObject = durableImages[index] as any;
      expect(durableObject.id).toBe(expected.id);
      expect(durableObject.left).toBeCloseTo(expected.left, 3);
      expect(durableObject.top).toBeCloseTo(expected.top, 3);
      expect(durableObject.scaleX).toBeCloseTo(expected.scaleX, 3);
      expect(durableObject.scaleY).toBeCloseTo(expected.scaleY, 3);
      expect(durableObject.angle).toBeCloseTo(expected.angle, 3);
    });

    // Closing the page destroys the original Fabric canvas and all session
    // blob URLs. Reopen from the durable library in a fresh page/session.
    // Carry the real IndexedDB contents into a new browser context so this
    // gate does not accidentally rely on the original renderer/session.
    const durableStorageState = await context.storageState({ indexedDB: true });
    await page.close();
    await context.close();
    reopenedContext = await browser.newContext({ storageState: durableStorageState });
    const reopened = await reopenedContext.newPage();
    await reopened.goto('/');
    const card = reopened.getByTestId('dashboard-project-card').filter({ hasText: 'Untitled Project' });
    await expect(card).toBeVisible();
    await card.locator('button.project-dashboard-project-open').click();
    await expect(reopened.getByTestId('editor-shell')).toBeVisible();
    await reopened.waitForFunction(() => (window as any).__DESIGN_SPACE_QA__?.snapshot().canvasReady === true);
    const reopenedDurable = await readLibraryPayload(reopened);
    expect(JSON.stringify(reopenedDurable.payload)).not.toMatch(/blob:http/i);
    expect(Object.values(reopenedDurable.payload.assets ?? {})).toEqual(
      expect.arrayContaining([expect.stringMatching(/^data:image\/png;base64,/)]),
    );
    const afterReopen = await reopened.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot());
    expect(afterReopen.documentSize).toEqual(sceneBeforeSave.documentSize);
    const durableBackground = durable.payload.pages?.[0]?.canvasData?.background
      ?? durable.payload.canvasData?.background;
    expect(afterReopen.pageBackgroundColor).toBe(durableBackground);
    const reopenedImages = afterReopen.objects.filter((object: { type: string }) => object.type === 'image');
    expect(reopenedImages).toHaveLength(2);
    expect(reopenedImages.map((object: { id: string }) => object.id)).toEqual(
      selection.selectionAudit.map((object: { id: string }) => object.id),
    );
    const restoredImageBytes = await reopened.evaluate(async (sources: string[]) => (
      Promise.all(sources.map(async (source) => {
        const response = await fetch(source);
        const bytes = new Uint8Array(await response.arrayBuffer());
        return {
          contentType: response.headers.get('content-type'),
          bytes: Array.from(bytes),
        };
      }))
    ), reopenedImages.map((object: any) => object.imageSource));
    restoredImageBytes.forEach(({ contentType, bytes }) => {
      expect(contentType).toMatch(/^image\/png/i);
      expect(bytes.length).toBeGreaterThan(32);
      expect(bytes.slice(0, 8)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    });
    reopenedImages.forEach((object: any, objectIndex: number) => {
      const expected = selection.selectionAudit[objectIndex];
      // Hydration may intentionally mint a fresh session blob URL from the
      // durable data URL. The durable payload above, not this live renderer
      // URL, is the persistence contract; fetching it proves the bytes made
      // the round trip without requiring blob URLs to remain durable.
      expect(object.imageSource).toMatch(/^(data:image\/png;base64,|blob:)/i);
      expect(object.left).toBeCloseTo(expected.left, 3);
      expect(object.top).toBeCloseTo(expected.top, 3);
      expect(object.scaleX).toBeCloseTo(expected.scaleX, 3);
      expect(object.scaleY).toBeCloseTo(expected.scaleY, 3);
      expect(object.angle).toBeCloseTo(expected.angle, 3);
      expect(object.corners).toHaveLength(expected.corners.length);
      object.corners.forEach((point: { x: number; y: number }, cornerIndex: number) => {
        expect(point.x).toBeCloseTo(expected.corners[cornerIndex].x, 2);
        expect(point.y).toBeCloseTo(expected.corners[cornerIndex].y, 2);
      });
    });

    // Continue in the fresh session so grouping, transformed ungrouping and
    // history replay are covered against the restored image bytes.
    const groupedScene = await reopened.evaluate(() => (
      (window as any).__DESIGN_SPACE_QA__.prepareP0GroupHistory()
    ));
    expect(groupedScene.grouped).toBe(true);
    expect(groupedScene.ungrouped).toBe(true);
    expect(groupedScene.undo).toBe(true);
    expect(groupedScene.redo).toBe(true);
    expect(groupedScene.groupAudit).toHaveLength(2);
    expect(groupedScene.finalAudit).toHaveLength(2);
    groupedScene.finalAudit.forEach((object: any, objectIndex: number) => {
      const grouped = groupedScene.groupAudit[objectIndex];
      object.corners.forEach((point: { x: number; y: number }, cornerIndex: number) => {
        expect(point.x).toBeCloseTo(grouped.corners[cornerIndex].x, 2);
        expect(point.y).toBeCloseTo(grouped.corners[cornerIndex].y, 2);
      });
    });

    await reopened.getByRole('button', { name: 'File', exact: true }).click();
    await reopened.getByText('Save to Library', { exact: true }).click();
    await expect(reopened.getByTestId('unified-save-status')).toHaveText(/saved/i);
  } finally {
    await reopenedContext?.close();
    await context.close();
  }
});

test('image-bearing templates restore bytes and geometry in a fresh context', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  let reopenedContext: BrowserContext | null = null;
  try {
    await openBlankEditor(page);
    await page.getByTestId('nav-insert').click();
    await page.getByTestId('insert-upload-image-input').setInputFiles(tinyPng('p0-template.png'));
    await expect.poll(async () => (
      await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects
        .filter((object: { type: string }) => object.type === 'image').length)
    )).toBe(1);
    const before = await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot());
    const sourceBefore = before.objects.find((object: { type: string }) => object.type === 'image');
    await page.getByTestId('insert-tab-templates').click();
    await page.getByRole('button', { name: 'Save as Template', exact: true }).click();
    await expect(page.locator('[data-testid^="template-my-"]').first()).toBeVisible();
    const template = await page.evaluate(() => new Promise<{
      name: string;
      canvasData: any;
      canvasSize: { width: number; height: number };
    }>((resolveTemplate, reject) => {
      const request = indexedDB.open('DesignSpaceDB');
      request.onerror = () => reject(request.error || new Error('Could not read saved template'));
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('templates', 'readonly');
        const records = transaction.objectStore('templates').getAll();
        transaction.oncomplete = () => {
          const record = records.result.at(-1);
          if (!record) {
            reject(new Error('No saved template was found'));
            return;
          }
          resolveTemplate(record);
          database.close();
        };
        transaction.onerror = () => reject(transaction.error || new Error('Could not read templates'));
      };
    }));
    const savedData = typeof template.canvasData === 'string'
      ? JSON.parse(template.canvasData)
      : template.canvasData;
    const savedImage = (savedData.objects as Array<any>).find((object) => (
      object.type === 'Image' || object.type === 'image'
    ));
    expect(savedImage?.src).not.toMatch(/^blob:/);
    expect(savedData.assets?.[savedImage.id]).toMatch(/^data:image\/png;base64,/);

    const durableStorageState = await context.storageState({ indexedDB: true });
    await page.close();
    await context.close();
    reopenedContext = await browser.newContext({ storageState: durableStorageState });
    const reopened = await reopenedContext.newPage();
    await openBlankEditor(reopened);
    await reopened.getByTestId('nav-insert').click();
    await reopened.getByTestId('insert-tab-templates').click();
    await reopened.getByTestId(`template-my-${template.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`).click();
    await expect.poll(async () => (
      await reopened.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects
        .filter((object: { type: string }) => object.type === 'image').length)
    )).toBe(1);
    const restored = await reopened.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot());
    const restoredImage = restored.objects.find((object: { type: string }) => object.type === 'image');
    expect(restoredImage).toMatchObject({
      width: sourceBefore.width,
      height: sourceBefore.height,
      scaleX: sourceBefore.scaleX,
      scaleY: sourceBefore.scaleY,
      angle: sourceBefore.angle,
    });
    expect(restoredImage.imageSource).not.toMatch(/^blob:/);
    const bytes = await reopened.evaluate(async (source: string) => (
      new Uint8Array(await (await fetch(source)).arrayBuffer())
    ), restoredImage.imageSource);
    expect(bytes.length).toBeGreaterThan(32);
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  } finally {
    await reopenedContext?.close();
    if (context) await context.close().catch(() => undefined);
  }
});

test('export uses the authored scene captured before asynchronous font readiness', async ({ page }) => {
  await openBlankEditor(page);
  await page.getByTestId('nav-shapes').click();
  await page.getByTestId('shape-rectangle').click();
  await expect.poll(async () => (
    await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects
      .filter((object: { type: string }) => object.type === 'rect').length)
  )).toBe(1);
  await page.evaluate(() => (
    (window as any).__DESIGN_SPACE_QA__.mutateP0FirstObject({ fill: '#123456' })
  ));

  await page.getByTestId('editor-toolbar').getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const fontGateReady = await page.evaluate(() => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    Object.defineProperty(document.fonts, 'ready', {
      configurable: true,
      value: pending,
    });
    (window as any).__DESIGN_SPACE_QA_RELEASE_FONTS__ = release;
    return true;
  });
  expect(fontGateReady).toBe(true);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download SVG', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => (
    (window as any).__DESIGN_SPACE_QA__.mutateP0FirstObject({ fill: '#654321' })
  ));
  await page.evaluate(() => (window as any).__DESIGN_SPACE_QA_RELEASE_FONTS__());
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const svg = await readFile(downloadPath!, 'utf8');
  expect(svg).toContain('rgb(18,52,86)');
  expect(svg).not.toContain('rgb(101,67,33)');
});

test('export owns one in-flight job while dismissal does not corrupt the snapshot', async ({ page }) => {
  await openBlankEditor(page);
  await page.getByTestId('nav-shapes').click();
  await page.getByTestId('shape-rectangle').click();
  await expect.poll(async () => (
    await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects
      .filter((object: { type: string }) => object.type === 'rect').length)
  )).toBe(1);

  await page.getByTestId('editor-toolbar').getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    Object.defineProperty(document.fonts, 'ready', {
      configurable: true,
      value: pending,
    });
    (window as any).__DESIGN_SPACE_QA_RELEASE_FONTS__ = release;
  });

  let downloadCount = 0;
  page.on('download', () => { downloadCount += 1; });
  const downloadPromise = page.waitForEvent('download');
  const svgButton = dialog.getByRole('button', { name: 'Download SVG', exact: true });
  await svgButton.click();
  await expect(dialog).toHaveAttribute('aria-busy', 'true');
  // A second command is delivered before the first job resolves.  The
  // in-flight ref, not a stale React state read, must reject it.
  await svgButton.dispatchEvent('click');
  await expect(svgButton).toBeDisabled();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => (window as any).__DESIGN_SPACE_QA_RELEASE_FONTS__());
  await downloadPromise;
  expect(downloadCount).toBe(1);
  await expect(dialog).toHaveCount(0);
});

test('image-bearing Vision Board snapshots restore from durable local storage', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  let reopenedContext: BrowserContext | null = null;
  try {
    await openBlankEditor(page);
    await page.getByTestId('nav-insert').click();
    await page.getByTestId('insert-upload-image-input').setInputFiles(tinyPng('p0-vision.png'));
    await expect.poll(async () => (
      await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects
        .filter((object: { type: string }) => object.type === 'image').length)
    )).toBe(1);
    const before = await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot());
    const beforeImage = before.objects.find((object: { type: string }) => object.type === 'image');
    const pinned = await page.evaluate(() => (
      (window as any).__DESIGN_SPACE_QA__.pinP0VisionBoardSnapshot()
    ));
    const persisted = await page.evaluate(() => {
      const raw = window.localStorage.getItem('designspace-vision-board');
      return raw ? JSON.parse(raw) : null;
    });
    const item = persisted?.state?.items?.find((candidate: { id: string }) => candidate.id === pinned.id);
    expect(item).toBeTruthy();
    const persistedData = JSON.parse(item.canvasData);
    const persistedImage = persistedData.objects.find((object: any) => (
      object.type === 'Image' || object.type === 'image'
    ));
    expect(persistedImage?.src).not.toMatch(/^blob:/);
    expect(persistedData.assets?.[persistedImage.id]).toMatch(/^data:image\/png;base64,/);

    const durableStorageState = await context.storageState({ indexedDB: true });
    await page.close();
    await context.close();
    reopenedContext = await browser.newContext({ storageState: durableStorageState });
    const reopened = await reopenedContext.newPage();
    await openBlankEditor(reopened);
    await reopened.evaluate((id: string) => (
      (window as any).__DESIGN_SPACE_QA__.restoreP0VisionBoardSnapshot(id)
    ), pinned.id);
    await expect.poll(async () => (
      await reopened.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects
        .filter((object: { type: string }) => object.type === 'image').length)
    )).toBe(1);
    const restored = await reopened.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot());
    const restoredImage = restored.objects.find((object: { type: string }) => object.type === 'image');
    expect(restoredImage).toMatchObject({
      width: beforeImage.width,
      height: beforeImage.height,
      scaleX: beforeImage.scaleX,
      scaleY: beforeImage.scaleY,
      angle: beforeImage.angle,
    });
    const bytes = await reopened.evaluate(async (source: string) => (
      new Uint8Array(await (await fetch(source)).arrayBuffer())
    ), restoredImage.imageSource);
    expect(bytes.length).toBeGreaterThan(32);
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  } finally {
    await reopenedContext?.close();
    await context.close().catch(() => undefined);
  }
});

test('first save adopts its durable target at a held Dexie commit while newer edits remain dirty', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  let reopenedContext: BrowserContext | null = null;
  try {
    await openBlankEditor(page);
    await page.getByTestId('nav-insert').click();
    await page.getByTestId('insert-upload-image-input').setInputFiles(tinyPng('p0-first-save.png'));
    await expect.poll(async () => (
      await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects
        .filter((object: { type: string }) => object.type === 'image').length)
    )).toBe(1);

    // This barrier is installed at the end of the real rw Dexie transaction,
    // after both project rows have been written but before the transaction is
    // allowed to commit. No fake table or mocked persistence path is involved.
    await page.evaluate(() => (
      (window as any).__DESIGN_SPACE_QA__.holdP0DurableWrite('create-project')
    ));
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByText('Save to Library', { exact: true }).click();
    await page.waitForFunction(() => (window as any).__P0_DURABLE_WRITE__?.calls() === 1);

    await page.evaluate(() => (
      (window as any).__DESIGN_SPACE_QA__.mutateP0FirstObject({ left: 222 })
    ));
    await expect.poll(async () => (
      await page.evaluate(() => {
        const snapshot = (window as any).__DESIGN_SPACE_QA__.snapshot();
        return {
          dirty: snapshot.isDirty,
          left: snapshot.objects.find((object: { type: string }) => object.type === 'image')?.left,
        };
      })
    )).toEqual({ dirty: true, left: 222 });

    await page.evaluate(() => (window as any).__P0_DURABLE_WRITE__.release());
    await page.evaluate(() => (window as any).__P0_DURABLE_WRITE__.clear());
    await expect(page.getByTestId('unified-save-status')).toHaveText(/unsaved changes/i);

    const afterFirstSave = await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot());
    expect(afterFirstSave.currentLibraryProjectId).toBeTruthy();
    expect(afterFirstSave.currentLibraryProjectRevision).toBe(1);
    expect(afterFirstSave.isDirty).toBe(true);
    expect(afterFirstSave.objects.find((object: { type: string }) => object.type === 'image')?.left)
      .toBeCloseTo(222, 3);

    // The follow-up save must update the adopted row rather than allocating a
    // second first-save target.
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await expect(page.getByText('Save to Library', { exact: true })).toBeVisible();
    await page.getByText('Save to Library', { exact: true }).click();
    await expect(page.getByTestId('unified-save-status')).toHaveText(/saved/i);

    const rows = await readLibraryRows(page);
    expect(rows.projects).toHaveLength(1);
    expect(rows.canvasData).toHaveLength(1);
    expect(rows.projects[0].revision).toBe(2);
    expect(rows.canvasData[0].revision).toBe(2);
    const durableObjects = (rows.canvasData[0].payload.pages?.[0]?.canvasData?.objects
      || rows.canvasData[0].payload.canvasData?.objects
      || []) as Array<{ type?: string; left?: number }>;
    expect(durableObjects.find((object) => object.type?.toLowerCase() === 'image')?.left)
      .toBeCloseTo(222, 3);

    const durableStorageState = await context.storageState({ indexedDB: true });
    await page.close();
    await context.close();
    reopenedContext = await browser.newContext({ storageState: durableStorageState });
    const reopened = await reopenedContext.newPage();
    await reopened.goto('/');
    const card = reopened.getByTestId('dashboard-project-card').filter({ hasText: 'Untitled Project' });
    await expect(card).toBeVisible();
    await card.locator('button.project-dashboard-project-open').click();
    await expect(reopened.getByTestId('editor-shell')).toBeVisible();
    await reopened.waitForFunction(() => (window as any).__DESIGN_SPACE_QA__?.snapshot().canvasReady === true);
    const reopenedSnapshot = await reopened.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot());
    expect(reopenedSnapshot.currentLibraryProjectRevision).toBe(2);
    expect(reopenedSnapshot.isDirty).toBe(false);
    expect(reopenedSnapshot.objects.find((object: { type: string }) => object.type === 'image')?.left)
      .toBeCloseTo(222, 3);
    expect((await readLibraryRows(reopened)).projects).toHaveLength(1);
  } finally {
    await reopenedContext?.close();
    await context.close().catch(() => undefined);
  }
});

test('held real save does not claim the post-Undo scene', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  let reopenedContext: BrowserContext | null = null;
  try {
    await openBlankEditor(page);
    await page.getByTestId('nav-shapes').click();
    await page.getByTestId('shape-rectangle').click();
    await expect.poll(async () => (
      (await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects))
        .filter((object: { type: string }) => object.type === 'rect').length
    )).toBe(1);

    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByText('Save to Library', { exact: true }).click();
    await expect(page.getByTestId('unified-save-status')).toHaveText(/saved/i);

    const baseline = await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot());
    const baselineLeft = baseline.objects.find((object: { type: string }) => object.type === 'rect')?.left;
    expect(typeof baselineLeft).toBe('number');
    await page.evaluate(() => (
      (window as any).__DESIGN_SPACE_QA__.mutateP0FirstObject({ left: 222 })
    ));
    await expect(page.getByTestId('unified-save-status')).toHaveText(/unsaved changes/i);

    await page.evaluate(() => (
      (window as any).__DESIGN_SPACE_QA__.holdP0DurableWrite('update-project')
    ));
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByText('Save to Library', { exact: true }).click();
    await page.waitForFunction(() => (window as any).__P0_DURABLE_WRITE__?.calls() === 1);
    const capturedRevision = await page.evaluate(() => (
      (window as any).__DESIGN_SPACE_QA__.snapshot().changeRevision
    ));

    await page.getByLabel('Undo').click();
    await expect.poll(async () => (
      await page.evaluate(() => {
        const snapshot = (window as any).__DESIGN_SPACE_QA__.snapshot();
        return {
          left: snapshot.objects.find((object: { type: string }) => object.type === 'rect')?.left,
          dirty: snapshot.isDirty,
          changeRevision: snapshot.changeRevision,
        };
      })
    )).toEqual(expect.objectContaining({
      left: baselineLeft,
      dirty: true,
    }));
    const afterUndoRevision = await page.evaluate(() => (
      (window as any).__DESIGN_SPACE_QA__.snapshot().changeRevision
    ));
    expect(afterUndoRevision).toBeGreaterThan(capturedRevision);

    await page.evaluate(() => (window as any).__P0_DURABLE_WRITE__.release());
    await page.evaluate(() => (window as any).__P0_DURABLE_WRITE__.clear());
    await expect(page.getByTestId('unified-save-status')).toHaveText(/unsaved changes/i);
    const afterStaleCompletion = await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot());
    expect(afterStaleCompletion.isDirty).toBe(true);
    expect(afterStaleCompletion.objects.find((object: { type: string }) => object.type === 'rect')?.left)
      .toBe(baselineLeft);

    // The stale transaction may have acknowledged its own durable revision,
    // but it must not be treated as the post-Undo state. The next save fences
    // against that revision and updates the same record with the visible scene.
    const staleRows = await readLibraryRows(page);
    expect(staleRows.projects).toHaveLength(1);
    expect(staleRows.projects[0].revision).toBe(2);
    const staleObjects = (staleRows.canvasData[0].payload.canvasData?.objects
      || staleRows.canvasData[0].payload.pages?.[0]?.canvasData?.objects
      || []) as Array<{ type?: string; left?: number }>;
    expect(staleObjects.find((object) => object.type?.toLowerCase() === 'rect')?.left)
      .toBe(222);

    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByText('Save to Library', { exact: true }).click();
    await expect(page.getByTestId('unified-save-status')).toHaveText(/saved/i);
    const currentRows = await readLibraryRows(page);
    expect(currentRows.projects).toHaveLength(1);
    expect(currentRows.projects[0].revision).toBe(3);
    const currentObjects = (currentRows.canvasData[0].payload.canvasData?.objects
      || currentRows.canvasData[0].payload.pages?.[0]?.canvasData?.objects
      || []) as Array<{ type?: string; left?: number }>;
    expect(currentObjects.find((object) => object.type?.toLowerCase() === 'rect')?.left)
      .toBe(baselineLeft);

    const durableStorageState = await context.storageState({ indexedDB: true });
    await page.close();
    await context.close();
    reopenedContext = await browser.newContext({ storageState: durableStorageState });
    const reopened = await reopenedContext.newPage();
    await reopened.goto('/');
    await reopened.getByTestId('dashboard-project-card').filter({ hasText: 'Untitled Project' })
      .locator('button.project-dashboard-project-open').click();
    await expect(reopened.getByTestId('editor-shell')).toBeVisible();
    await reopened.waitForFunction(() => (window as any).__DESIGN_SPACE_QA__?.snapshot().canvasReady === true);
    const reopenedSnapshot = await reopened.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot());
    expect(reopenedSnapshot.isDirty).toBe(false);
    expect(reopenedSnapshot.currentLibraryProjectRevision).toBe(3);
    expect(reopenedSnapshot.objects.find((object: { type: string }) => object.type === 'rect')?.left)
      .toBe(baselineLeft);
  } finally {
    await reopenedContext?.close();
    await context.close().catch(() => undefined);
  }
});

test('held real save does not claim the post-Redo scene', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  let reopenedContext: BrowserContext | null = null;
  try {
    await openBlankEditor(page);
    await page.getByTestId('nav-shapes').click();
    await page.getByTestId('shape-rectangle').click();
    await expect.poll(async () => (
      (await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects))
        .filter((object: { type: string }) => object.type === 'rect').length
    )).toBe(1);
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByText('Save to Library', { exact: true }).click();
    await expect(page.getByTestId('unified-save-status')).toHaveText(/saved/i);

    const baseline = await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot());
    const baselineLeft = baseline.objects.find((object: { type: string }) => object.type === 'rect')?.left;
    await page.evaluate(() => (
      (window as any).__DESIGN_SPACE_QA__.mutateP0FirstObject({ left: 222 })
    ));
    await expect(page.getByTestId('unified-save-status')).toHaveText(/unsaved changes/i);
    // Rewind to the durable baseline.  The save below captures this baseline,
    // then Redo runs while its real Dexie transaction is held.
    await page.getByLabel('Undo').click();
    await expect.poll(async () => (
      await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects
        .find((object: { type: string }) => object.type === 'rect')?.left)
    )).toBe(baselineLeft);
    await page.evaluate(() => (
      (window as any).__DESIGN_SPACE_QA__.holdP0DurableWrite('update-project')
    ));
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByText('Save to Library', { exact: true }).click();
    await page.waitForFunction(() => (window as any).__P0_DURABLE_WRITE__?.calls() === 1);
    const capturedRevision = await page.evaluate(() => (
      (window as any).__DESIGN_SPACE_QA__.snapshot().changeRevision
    ));
    await page.getByLabel('Redo').click();
    await expect.poll(async () => (
      await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects
        .find((object: { type: string }) => object.type === 'rect')?.left)
    )).toBe(222);
    const afterRedoRevision = await page.evaluate(() => (
      (window as any).__DESIGN_SPACE_QA__.snapshot().changeRevision
    ));
    expect(afterRedoRevision).toBeGreaterThan(capturedRevision);
    await page.evaluate(() => (window as any).__P0_DURABLE_WRITE__.release());
    await page.evaluate(() => (window as any).__P0_DURABLE_WRITE__.clear());
    await expect(page.getByTestId('unified-save-status')).toHaveText(/unsaved changes/i);
    const afterStaleCompletion = await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot());
    expect(afterStaleCompletion.isDirty).toBe(true);
    expect(afterStaleCompletion.objects.find((object: { type: string }) => object.type === 'rect')?.left)
      .toBe(222);

    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByText('Save to Library', { exact: true }).click();
    await expect(page.getByTestId('unified-save-status')).toHaveText(/saved/i);
    const rows = await readLibraryRows(page);
    expect(rows.projects).toHaveLength(1);
    expect(rows.projects[0].revision).toBe(3);
    const durableObjects = (rows.canvasData[0].payload.canvasData?.objects
      || rows.canvasData[0].payload.pages?.[0]?.canvasData?.objects
      || []) as Array<{ type?: string; left?: number }>;
    expect(durableObjects.find((object) => object.type?.toLowerCase() === 'rect')?.left)
      .toBe(222);

    const durableStorageState = await context.storageState({ indexedDB: true });
    await page.close();
    await context.close();
    reopenedContext = await browser.newContext({ storageState: durableStorageState });
    const reopened = await reopenedContext.newPage();
    await reopened.goto('/');
    await reopened.getByTestId('dashboard-project-card').filter({ hasText: 'Untitled Project' })
      .locator('button.project-dashboard-project-open').click();
    await expect(reopened.getByTestId('editor-shell')).toBeVisible();
    await reopened.waitForFunction(() => (window as any).__DESIGN_SPACE_QA__?.snapshot().canvasReady === true);
    const reopenedSnapshot = await reopened.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot());
    expect(reopenedSnapshot.isDirty).toBe(false);
    expect(reopenedSnapshot.currentLibraryProjectRevision).toBe(3);
    expect(reopenedSnapshot.objects.find((object: { type: string }) => object.type === 'rect')?.left)
      .toBe(222);
  } finally {
    await reopenedContext?.close();
    await context.close().catch(() => undefined);
  }
});

test('upgrades the legacy payload schema without rewriting forensic rows', async ({ page }) => {
  // Load a same-origin static asset without booting the application so the
  // legacy schema can be seeded before Dexie opens the database.
  await page.goto('/manifest.json');
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const deleteRequest = indexedDB.deleteDatabase('DesignSpaceDB');
    deleteRequest.onerror = () => reject(deleteRequest.error || new Error('Could not reset the test database'));
    deleteRequest.onsuccess = () => {
      const request = indexedDB.open('DesignSpaceDB', 5);
      request.onerror = () => reject(request.error || new Error('Could not create legacy database'));
      request.onupgradeneeded = () => {
        const database = request.result;
        const projects = database.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
        projects.createIndex('name', 'name');
        projects.createIndex('lastModified', 'lastModified');
        projects.createIndex('thumbnail', 'thumbnail');
        projects.createIndex('canvasDataId', 'canvasDataId');
        const canvasData = database.createObjectStore('canvasData', { keyPath: 'id' });
        canvasData.createIndex('jsonPayload', 'jsonPayload');
        canvasData.createIndex('projectId', 'projectId');
        canvasData.createIndex('lastModified', 'lastModified');
        database.createObjectStore('brandKit', { keyPath: 'id', autoIncrement: true });
        database.createObjectStore('templates', { keyPath: 'id', autoIncrement: true });
        database.createObjectStore('projectRecovery', { keyPath: 'projectId' });
        const payload = JSON.stringify({
          schemaVersion: 'design-space-project-v1',
          projectName: 'Legacy forensic row',
          canvasData: { objects: [] },
        });
        const transaction = request.transaction!;
        transaction.objectStore('canvasData').add({
          id: 'legacy-canvas-data',
          jsonPayload: payload,
          projectId: 1,
        });
        transaction.objectStore('projects').add({
          id: 1,
          name: 'Legacy forensic row',
          lastModified: new Date(),
          thumbnail: 'data:image/png;base64,legacy',
          canvasDataId: 'legacy-canvas-data',
        });
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    };
  }));

  await page.goto('/');
  await expect(page.getByTestId('dashboard-root')).toBeVisible();
  const migrated = await page.evaluate(() => new Promise<{
    project: { name: string; canvasDataId: string; thumbnail: string };
    canvasData: { jsonPayload: string };
    projectIndexes: string[];
    canvasIndexes: string[];
  }>((resolvePayload, reject) => {
    const request = indexedDB.open('DesignSpaceDB');
    request.onerror = () => reject(request.error || new Error('Could not inspect migrated database'));
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(['projects', 'canvasData'], 'readonly');
      const projectRequest = transaction.objectStore('projects').get(1);
      const payloadRequest = transaction.objectStore('canvasData').get('legacy-canvas-data');
      transaction.oncomplete = () => {
        resolvePayload({
          project: projectRequest.result,
          canvasData: payloadRequest.result,
          projectIndexes: Array.from(database.objectStoreNames).includes('projects')
            ? Array.from(database.transaction('projects', 'readonly').objectStore('projects').indexNames)
            : [],
          canvasIndexes: Array.from(database.transaction('canvasData', 'readonly').objectStore('canvasData').indexNames),
        });
        database.close();
      };
      transaction.onerror = () => reject(transaction.error || new Error('Could not read migrated database'));
    };
  }));

  expect(migrated.project.name).toBe('Legacy forensic row');
  expect(migrated.project.thumbnail).toBe('data:image/png;base64,legacy');
  expect(migrated.canvasData.jsonPayload).toContain('Legacy forensic row');
  expect(migrated.projectIndexes).not.toContain('thumbnail');
  expect(migrated.canvasIndexes).not.toContain('jsonPayload');
});

test('surfaces a failed production index migration while preserving legacy rows', async ({ page }) => {
  // Seed the actual pre-migration schema, including a forensic duplicate row,
  // before the application imports its Dexie instance.
  await page.goto('/manifest.json');
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const deleteRequest = indexedDB.deleteDatabase('DesignSpaceDB');
    deleteRequest.onerror = () => reject(deleteRequest.error || new Error('Could not reset the test database'));
    deleteRequest.onsuccess = () => {
      const request = indexedDB.open('DesignSpaceDB', 5);
      request.onerror = () => reject(request.error || new Error('Could not create legacy database'));
      request.onupgradeneeded = () => {
        const database = request.result;
        const projects = database.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
        projects.createIndex('name', 'name');
        projects.createIndex('lastModified', 'lastModified');
        projects.createIndex('thumbnail', 'thumbnail');
        projects.createIndex('canvasDataId', 'canvasDataId');
        const canvasData = database.createObjectStore('canvasData', { keyPath: 'id' });
        canvasData.createIndex('jsonPayload', 'jsonPayload');
        canvasData.createIndex('projectId', 'projectId');
        canvasData.createIndex('lastModified', 'lastModified');
        database.createObjectStore('brandKit', { keyPath: 'id', autoIncrement: true });
        database.createObjectStore('templates', { keyPath: 'id', autoIncrement: true });
        database.createObjectStore('projectRecovery', { keyPath: 'projectId' });
        const payload = JSON.stringify({
          schemaVersion: 'design-space-project-v1',
          projectName: 'Migration failure project',
          canvasData: { objects: [{ id: 'survivor', type: 'rect', left: 17, top: 19, width: 20, height: 20 }] },
        });
        const transaction = request.transaction!;
        transaction.objectStore('canvasData').add({
          id: 'migration-current-canvas',
          jsonPayload: payload,
          projectId: 1,
        });
        transaction.objectStore('canvasData').add({
          id: 'migration-forensic-duplicate',
          jsonPayload: JSON.stringify({ schemaVersion: 'design-space-project-v1', canvasData: { objects: [] } }),
          projectId: 1,
        });
        transaction.objectStore('projects').add({
          id: 1,
          name: 'Migration failure project',
          lastModified: new Date(),
          thumbnail: 'data:image/png;base64,forensic-thumbnail',
          canvasDataId: 'migration-current-canvas',
        });
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    };
  }));

  // Dexie v6 removes the two giant value indexes. Throw on the second
  // targeted deletion so the upgrade has demonstrably begun but the browser's
  // versionchange transaction must roll back atomically.
  await page.addInitScript(() => {
    const originalDeleteIndex = IDBObjectStore.prototype.deleteIndex;
    let targetedDeletes = 0;
    IDBObjectStore.prototype.deleteIndex = function injectedMigrationFailure(name: string) {
      const targeted = (this.name === 'projects' && name === 'thumbnail')
        || (this.name === 'canvasData' && name === 'jsonPayload');
      if (targeted) {
        targetedDeletes += 1;
        if (targetedDeletes === 2) {
          throw new DOMException('Injected production index migration failure', 'QuotaExceededError');
        }
      }
      return originalDeleteIndex.call(this, name);
    };
    (window as any).__P0_MIGRATION_TARGETED_DELETES__ = () => targetedDeletes;
  });
  await page.evaluate(() => {
    window.localStorage.setItem('designspace-editor', JSON.stringify({
      state: { userTemplates: [{ name: 'Migration source', canvasData: { objects: [] } }] },
    }));
    window.localStorage.removeItem('designspace-template-migration-v1');
  });

  await page.goto('/');
  await expect(page.getByTestId('dashboard-root')).toBeVisible();
  await expect(page.getByTestId('dashboard-migration-recovery')).toBeVisible();
  await expect(page.getByText('No product projects yet.')).not.toBeVisible();
  expect(await page.evaluate(() => (window as any).__P0_MIGRATION_TARGETED_DELETES__()))
    .toBeGreaterThanOrEqual(2);

  const preserved = await page.evaluate(() => new Promise<{
    version: number;
    project: { name: string; canvasDataId: string; thumbnail: string } | undefined;
    canvasRows: Array<{ id: string; projectId: number; jsonPayload: string }>;
    projectIndexes: string[];
    canvasIndexes: string[];
  }>((resolveState, reject) => {
    const request = indexedDB.open('DesignSpaceDB');
    request.onerror = () => reject(request.error || new Error('Could not inspect rolled-back database'));
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(['projects', 'canvasData'], 'readonly');
      const projectStore = transaction.objectStore('projects');
      const canvasStore = transaction.objectStore('canvasData');
      const projectRequest = projectStore.get(1);
      const canvasRequest = canvasStore.getAll();
      const projectIndexes = Array.from(projectStore.indexNames);
      const canvasIndexes = Array.from(canvasStore.indexNames);
      transaction.oncomplete = () => {
        resolveState({
          version: database.version,
          project: projectRequest.result,
          canvasRows: canvasRequest.result,
          projectIndexes,
          canvasIndexes,
        });
        database.close();
      };
      transaction.onerror = () => reject(transaction.error || new Error('Could not read rolled-back rows'));
    };
  }));

  expect(preserved.version).toBe(5);
  expect(preserved.project).toMatchObject({
    name: 'Migration failure project',
    canvasDataId: 'migration-current-canvas',
    thumbnail: 'data:image/png;base64,forensic-thumbnail',
  });
  expect(preserved.canvasRows).toHaveLength(2);
  expect(preserved.canvasRows.map((row) => row.id)).toEqual(expect.arrayContaining([
    'migration-current-canvas',
    'migration-forensic-duplicate',
  ]));
  expect(preserved.projectIndexes).toContain('thumbnail');
  expect(preserved.canvasIndexes).toContain('jsonPayload');
  expect(preserved.canvasRows.find((row) => row.id === 'migration-current-canvas')?.jsonPayload)
    .toContain('survivor');
});

test('rolls back a failed legacy template migration without hiding the source', async ({ page }) => {
  const legacy = JSON.stringify({
    state: {
      userTemplates: [
        { name: 'Migration one', canvasData: { objects: [] } },
        { name: 'Migration two', canvasData: { objects: [] } },
        { name: 'Migration three', canvasData: { objects: [] } },
      ],
    },
  });
  await page.addInitScript(({ legacyPayload }) => {
    window.localStorage.setItem('designspace-editor', legacyPayload);
    window.localStorage.removeItem('designspace-template-migration-v1');
    const originalAdd = IDBObjectStore.prototype.add;
    let templateAdds = 0;
    IDBObjectStore.prototype.add = function patchedAdd(value, key) {
      if (this.name === 'templates') {
        templateAdds += 1;
        if (templateAdds === 2) {
          throw new DOMException('Injected migration write failure', 'QuotaExceededError');
        }
      }
      return originalAdd.call(this, value, key);
    };
  }, { legacyPayload: legacy });

  await page.goto('/');
  await expect(page.getByTestId('dashboard-root')).toBeVisible();
  await expect(page.getByTestId('dashboard-migration-recovery')).toBeVisible();

  const result = await page.evaluate(() => new Promise<{
    source: string | null;
    migrationFlag: string | null;
    templateCount: number;
  }>((resolveResult, reject) => {
    const request = indexedDB.open('DesignSpaceDB');
    request.onerror = () => reject(request.error || new Error('Could not inspect failed migration'));
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('templates', 'readonly');
      const records = transaction.objectStore('templates').getAll();
      transaction.oncomplete = () => {
        resolveResult({
          source: window.localStorage.getItem('designspace-editor'),
          migrationFlag: window.localStorage.getItem('designspace-template-migration-v1'),
          templateCount: records.result.length,
        });
        database.close();
      };
      transaction.onerror = () => reject(transaction.error || new Error('Could not inspect templates'));
    };
  }));

  expect(result.source).toBe(legacy);
  expect(result.migrationFlag).toBeNull();
  expect(result.templateCount).toBe(0);
});

test('rejects a stale second tab save instead of silently replacing the newer revision', async ({ browser }) => {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  try {
    await openBlankEditor(pageA);
    await pageA.getByRole('button', { name: 'File', exact: true }).click();
    await pageA.getByText('Save to Library', { exact: true }).click();
    await expect(pageA.getByTestId('unified-save-status')).toHaveText(/saved/i);

    // Both tabs load the same durable revision before either tab edits it.
    await pageB.goto('/');
    const card = pageB.getByTestId('dashboard-project-card').filter({ hasText: 'Untitled Project' });
    await expect(card).toBeVisible();
    await card.locator('button.project-dashboard-project-open').click();
    await expect(pageB.getByTestId('editor-shell')).toBeVisible();
    await pageB.waitForFunction(() => (window as any).__DESIGN_SPACE_QA__?.snapshot().canvasReady === true);

    // Tab A advances the durable project revision.
    await pageA.getByTestId('nav-shapes').click();
    await pageA.getByTestId('shape-rectangle').click();
    await expect.poll(async () => (
      (await pageA.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects))
        .filter((object: { type: string }) => object.type === 'rect').length
    )).toBe(1);
    await pageA.getByRole('button', { name: 'File', exact: true }).click();
    await pageA.getByText('Save to Library', { exact: true }).click();
    await expect(pageA.getByTestId('unified-save-status')).toHaveText(/saved/i);

    // Tab B still owns revision 1. Its stale write must be rejected and the
    // durable record must retain A's one-object revision.
    await pageB.getByTestId('nav-shapes').click();
    await pageB.getByTestId('shape-rectangle').click();
    await expect.poll(async () => (
      (await pageB.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects))
        .filter((object: { type: string }) => object.type === 'rect').length
    )).toBe(1);
    await pageB.getByRole('button', { name: 'File', exact: true }).click();
    await pageB.getByText('Save to Library', { exact: true }).click();
    await expect(pageB.getByTestId('unified-save-status')).toHaveText(/save failed/i);

    const durable = await readLibraryPayload(pageA);
    expect(durable.revision).toBe(2);
    const durableObjects = (durable.payload.pages?.[0]?.canvasData?.objects
      || durable.payload.canvasData?.objects
      || []) as Array<{ type?: string }>;
    expect(durableObjects.filter((object) => object.type?.toLowerCase() === 'rect')).toHaveLength(1);
  } finally {
    await context.close();
  }
});

test('Quick Open uses the shared replacement guard while live work is dirty', async ({ page }) => {
  await openBlankEditor(page);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByText('Save to Library', { exact: true }).click();
  await expect(page.getByTestId('unified-save-status')).toHaveText(/saved/i);

  await page.getByTestId('nav-shapes').click();
  await page.getByTestId('shape-rectangle').click();
  await expect.poll(async () => (
    (await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects))
      .filter((object: { type: string }) => object.type === 'rect').length
  )).toBe(1);
  await expect(page.getByTestId('unified-save-status')).toHaveText(/unsaved changes/i);

  await page.keyboard.press('Control+k');
  const quickOpenInput = page.getByPlaceholder('Quick Open projects...');
  await expect(quickOpenInput).toBeVisible();
  const quickOpen = page.locator('div.fixed.inset-0.z-50');
  const projectButton = quickOpen.getByRole('button').first();
  await expect(projectButton).toContainText('Untitled Project');

  const confirmationCalls = await page.evaluate(() => {
    let calls = 0;
    window.confirm = () => {
      calls += 1;
      return false;
    };
    (window as any).__P0_CONFIRMATION_CALLS__ = () => calls;
    return true;
  });
  expect(confirmationCalls).toBe(true);
  await projectButton.click();

  // Both save and discard were declined. The project replacement is still
  // blocked and the live scene remains mounted and dirty.
  expect(await page.evaluate(() => (window as any).__P0_CONFIRMATION_CALLS__())).toBe(2);
  await expect(page.getByTestId('editor-shell')).toBeVisible();
  await expect(quickOpenInput).toBeVisible();
  await expect(page.getByTestId('unified-save-status')).toHaveText(/unsaved changes/i);
  await expect.poll(async () => (
    (await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects))
      .filter((object: { type: string }) => object.type === 'rect').length
  )).toBe(1);
  await page.keyboard.press('Escape');
});

test('a failed guarded save keeps Quick Open and the dirty scene in place', async ({ page }) => {
  await openBlankEditor(page);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByText('Save to Library', { exact: true }).click();
  await expect(page.getByTestId('unified-save-status')).toHaveText(/saved/i);

  await page.getByTestId('nav-shapes').click();
  await page.getByTestId('shape-rectangle').click();
  await expect.poll(async () => (
    (await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects))
      .filter((object: { type: string }) => object.type === 'rect').length
  )).toBe(1);

  await page.evaluate(() => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function failingCanvasWrite(value, key) {
      if (this.name === 'canvasData') {
        throw new DOMException('Injected save failure', 'QuotaExceededError');
      }
      return originalPut.call(this, value, key);
    };
    let calls = 0;
    (window as any).__P0_CONFIRMATION_CALLS__ = () => calls;
    window.confirm = () => {
      calls += 1;
      return true;
    };
  });

  await page.keyboard.press('Control+KeyK');
  const quickOpenInput = page.getByPlaceholder('Quick Open projects...');
  await expect(quickOpenInput).toBeVisible();
  const quickOpen = page.locator('div.fixed.inset-0.z-50');
  const projectButton = quickOpen.getByRole('button').first();
  await expect(projectButton).toContainText('Untitled Project');
  await projectButton.click();
  await expect(page.getByPlaceholder('Quick Open projects...')).toBeVisible();
  await expect(page.getByTestId('unified-save-status')).toHaveText(/save failed|unsaved changes/i);
  expect(await page.evaluate(() => (window as any).__P0_CONFIRMATION_CALLS__())).toBe(1);
  expect(await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects
    .filter((object: { type: string }) => object.type === 'rect').length)).toBe(1);
});

test('live Fabric typing is dirty before blur and blocks a close attempt', async ({ page }) => {
  await openBlankEditor(page);
  const canvasBox = await page.locator('canvas.upper-canvas').boundingBox()
    ?? await page.getByTestId('design-canvas').boundingBox();
  if (!canvasBox) throw new Error('Canvas bounding box was unavailable');

  await page.getByTestId('tool-textbox').click();
  await page.mouse.move(canvasBox.x + 180, canvasBox.y + 160);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 360, canvasBox.y + 260, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (
    (await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects))
      .find((object: { type: string }) => object.type === 'textbox')?.isEditing
  )).toBe(true);

  await page.keyboard.type('typed before blur');
  await expect(page.getByTestId('unified-save-status')).toHaveText(/unsaved changes/i);
  const closeResult = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    const dispatched = window.dispatchEvent(event);
    return { dispatched, defaultPrevented: event.defaultPrevented };
  });
  expect(closeResult).toEqual({ dispatched: false, defaultPrevented: true });

  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByTestId('unsaved-navigation-dialog')).toBeVisible();
  await page.getByTestId('unsaved-navigation-dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('editor-shell')).toBeVisible();
  await expect(page.getByTestId('unified-save-status')).toHaveText(/unsaved changes/i);
});

test('cancelled browser close leaves live image resources, history, and pages usable', async ({ page }) => {
  await openBlankEditor(page);
  await page.getByTestId('nav-insert').click();
  await page.getByTestId('insert-upload-image-input').setInputFiles(tinyPng('cancel-close-a.png'));
  await expect.poll(async () => (
    await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects
      .filter((object: { type: string }) => object.type === 'image').length)
  )).toBe(1);
  await page.getByTestId('insert-upload-image-input').setInputFiles(tinyPng('cancel-close-b.png'));
  await expect.poll(async () => (
    await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects
      .filter((object: { type: string }) => object.type === 'image').length)
  )).toBe(2);
  const prepared = await page.evaluate(() => (
    (window as any).__DESIGN_SPACE_QA__.prepareP0ActiveSelection()
  ));
  const closeResult = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    const dispatched = window.dispatchEvent(event);
    return { dispatched, defaultPrevented: event.defaultPrevented };
  });
  expect(closeResult).toEqual({ dispatched: false, defaultPrevented: true });

  // The cancelled close must not have disposed the running Fabric/session
  // resources. Verify bytes and immediate history replay before navigation.
  const liveSources = await page.evaluate(() => (
    (window as any).__DESIGN_SPACE_QA__.snapshot().objects
      .filter((object: { type: string }) => object.type === 'image')
      .map((object: { imageSource: string }) => object.imageSource)
  ));
  expect(liveSources).toHaveLength(prepared.selectionAudit.length);
  const bytes = await page.evaluate(async (sources: string[]) => (
    Promise.all(sources.map(async (source) => {
      const response = await fetch(source);
      return new Uint8Array(await response.arrayBuffer());
    }))
  ), liveSources);
  bytes.forEach((value) => {
    expect(value.length).toBeGreaterThan(32);
    expect(Array.from(value.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  const historyResult = await page.evaluate(() => (
    (window as any).__DESIGN_SPACE_QA__.prepareP0GroupHistory()
  ));
  expect(historyResult.undo).toBe(true);
  expect(historyResult.redo).toBe(true);
  await expect.poll(async () => (
    await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects
      .filter((object: { type: string }) => object.type === 'image').length)
  )).toBe(2);
  await page.getByLabel('Add page').click();
  await expect(page.getByLabel('Open page 2: Page 2')).toBeVisible();
  await expect(page.getByLabel('Open page 2: Page 2')).toHaveAttribute('aria-current', 'page');
  await expect.poll(async () => (
    await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects
      .filter((object: { type: string }) => object.type === 'image').length)
  )).toBe(0);
  await expect(page.getByTestId('insert-upload-image-input')).toBeAttached();
  await page.getByTestId('insert-upload-image-input').setInputFiles(tinyPng('cancel-close-page-2.png'));
  await expect.poll(async () => (
    await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects
      .filter((object: { type: string }) => object.type === 'image').length)
  )).toBe(1);
  await page.getByLabel('Open page 1: Page 1').click();
  await expect.poll(async () => (
    await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().objects
      .filter((object: { type: string }) => object.type === 'image').length)
  )).toBe(2);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByLabel('Delete page 2: Page 2').click();
  await expect(page.getByLabel('Open page 2: Page 2')).toHaveCount(0);
  await expect.poll(async () => (
    await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot().imageAssetIds.length)
  )).toBe(2);
  await expect(page.getByTestId('unified-save-status')).toHaveText(/unsaved|saving/i);
});
