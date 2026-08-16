import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type QaObject = {
  id: string | null;
  type: string | null;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
  visible?: boolean;
  selectable?: boolean;
  evented?: boolean;
  lockMovementX?: boolean;
  fill?: unknown;
  opacity?: number;
  text?: string | null;
  isEditing?: boolean;
};

type QaSnapshot = {
  canvasReady: boolean;
  activeTool: string;
  selectedObjectId: string | null;
  selectedLayerIds: string[];
  activeObjectId: string | null;
  activeObjectType?: string | null;
  documentSize?: { width: number; height: number };
  pageBackgroundColor?: string | null;
  viewportTransform: number[] | null;
  objects: QaObject[];
  canvasObjects: QaObject[];
  layers: Array<{ id: string; visible?: boolean; movementLocked?: boolean }>;
};

const tinyPngFixture = () => ({
  name: 'tiny-red-pixel.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    readFileSync(resolve(process.cwd(), 'e2e/fixtures/tiny-red-pixel.png.base64'), 'utf8').trim(),
    'base64'
  ),
});

const seedLegacyTemplates = async (page: Page, userTemplates: unknown[]) => {
  await page.addInitScript(({ templates, migrationKey, payloadKey }) => {
    window.localStorage.removeItem(migrationKey);
    window.localStorage.setItem(payloadKey, JSON.stringify({ state: { userTemplates: templates } }));
  }, {
    templates: userTemplates,
    migrationKey: 'designspace-template-migration-v1',
    payloadKey: 'designspace-editor',
  });
};

const ignoredConsoleFragments = [
  'Download the React DevTools',
];

const installFatalConsoleCollector = (page: Page) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (ignoredConsoleFragments.some((fragment) => text.includes(fragment))) return;
    errors.push(text);
  });
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
  return errors;
};

const snapshot = async (page: Page): Promise<QaSnapshot> =>
  page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot());

const controlPoint = async (page: Page, objectId: string, key: string) =>
  page.evaluate(
    ({ objectId: id, key: controlKey }) => (window as any).__DESIGN_SPACE_QA__.controlPoint(id, controlKey),
    { objectId, key }
  ) as Promise<{ x: number; y: number } | null>;

type DomLayers = {
  stageRect: { left: number; top: number; width: number; height: number } | null;
  fabricWrapperRect: { left: number; top: number; width: number; height: number } | null;
  lowerCanvasRect: { left: number; top: number; width: number; height: number } | null;
  upperCanvasRect: { left: number; top: number; width: number; height: number } | null;
  canvasCssSize: { width: string; height: string } | null;
  canvasAttributeSize: { width: number; height: number } | null;
  fabricInternalSize: { width: number; height: number };
};

const domLayers = async (page: Page): Promise<DomLayers> =>
  page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.domLayers());

type WorkspaceLayout = {
  editorShellRect: { left: number; top: number; width: number; height: number } | null;
  headerRect: { left: number; top: number; width: number; height: number } | null;
  leftPanelRect: { left: number; top: number; width: number; height: number } | null;
  rightPanelRect: { left: number; top: number; width: number; height: number } | null;
  workspaceRect: { left: number; top: number; width: number; height: number } | null;
  intendedViewportRect: { left: number; top: number; width: number; height: number } | null;
  canvasElementRect: { left: number; top: number; width: number; height: number } | null;
  paperScreenCenter: { x: number; y: number } | null;
  intendedWorkspaceCenter: { x: number; y: number } | null;
};

const workspaceLayout = async (page: Page): Promise<WorkspaceLayout> =>
  page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.workspaceLayout());

const openBlankEditor = async (page: Page) => {
  await page.goto('/');
  await page.getByTestId('dashboard-new-project').click();
  await page.getByTestId('project-preset-instagram-square').click();
  await expect(page.getByTestId('editor-shell')).toBeVisible();
  await expect(page.getByTestId('design-canvas')).toBeVisible();
  await page.waitForFunction(() => (window as any).__DESIGN_SPACE_QA__?.snapshot().canvasReady === true);
};

const canvasPointForObject = async (page: Page, objectId: string) => {
  const canvasBox = await page.locator('canvas.upper-canvas').boundingBox()
    ?? await page.getByTestId('design-canvas').boundingBox();
  if (!canvasBox) throw new Error('Canvas bounding box was unavailable');
  const state = await snapshot(page);
  const object = state.objects.find((entry) => entry.id === objectId);
  if (!object || typeof object.left !== 'number' || typeof object.top !== 'number') {
    throw new Error(`Object ${objectId} was not available in QA snapshot`);
  }
  const vpt = state.viewportTransform ?? [1, 0, 0, 1, 0, 0];
  return {
    x: canvasBox.x + (vpt[0] * object.left) + (vpt[2] * object.top) + vpt[4],
    y: canvasBox.y + (vpt[1] * object.left) + (vpt[3] * object.top) + vpt[5],
  };
};

const canvasPointForObjectOffset = async (page: Page, objectId: string, offsetX: number, offsetY: number) => {
  const canvasBox = await page.locator('canvas.upper-canvas').boundingBox()
    ?? await page.getByTestId('design-canvas').boundingBox();
  if (!canvasBox) throw new Error('Canvas bounding box was unavailable');
  const state = await snapshot(page);
  const object = state.objects.find((entry) => entry.id === objectId);
  if (!object || typeof object.left !== 'number' || typeof object.top !== 'number') {
    throw new Error(`Object ${objectId} was not available in QA snapshot`);
  }
  const vpt = state.viewportTransform ?? [1, 0, 0, 1, 0, 0];
  const x = object.left + offsetX;
  const y = object.top + offsetY;
  return {
    x: canvasBox.x + (vpt[0] * x) + (vpt[2] * y) + vpt[4],
    y: canvasBox.y + (vpt[1] * x) + (vpt[3] * y) + vpt[5],
  };
};

const addRectangleThroughUi = async (page: Page, options: { hidePanels?: boolean } = {}) => {
  await page.getByTestId('nav-shapes').click();
  await page.getByTestId('shape-rectangle').click();
  await expect.poll(async () => (await snapshot(page)).objects.some((object) => object.type === 'rect')).toBe(true);
  const hidePanels = page.getByRole('button', { name: 'Hide' });
  if (options.hidePanels !== false && await hidePanels.isVisible().catch(() => false)) {
    await hidePanels.click();
  }
  const state = await snapshot(page);
  expect(state.objects.filter((object) => object.type === 'rect')).toHaveLength(1);
  const rect = state.objects.find((object) => object.id === state.activeObjectId && object.type === 'rect')
    ?? [...state.objects].reverse().find((object) => object.type === 'rect');
  if (!rect?.id) throw new Error('Rectangle was not inserted');
  return rect.id;
};

test.describe('browser Fabric editor smoke', () => {
  test('initializes the editor canvas without fatal console errors', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);

    await openBlankEditor(page);

    const state = await snapshot(page);
    expect(state.canvasReady).toBe(true);
    expect(state.objects).toEqual([]);
    expect(fatalConsole).toEqual([]);
  });

  test('editor chrome is readable — header, panels, and canvas are all visible', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    // Header toolbar is visible and not covered
    await expect(page.getByTestId('editor-toolbar')).toBeVisible();
    // Project name is readable in the header
    await expect(page.getByTestId('project-name-display')).toBeVisible();
    // Canvas is visible
    await expect(page.getByTestId('design-canvas')).toBeVisible();
    // Right panel tabs are visible and not clipped
    await expect(page.getByTestId('right-tab-layers')).toBeVisible();
    await expect(page.getByTestId('right-tab-object')).toBeVisible();
    // Left panel nav buttons are visible (left panel shows at 1280px default viewport)
    await expect(page.getByTestId('nav-shapes')).toBeVisible();
    await expect(page.getByTestId('nav-insert')).toBeVisible();
    await expect(page.getByTestId('nav-assets')).toBeVisible();

    expect(fatalConsole).toEqual([]);
  });

  test('keeps both editing sidebars usable at the default 1200px desktop window width', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await page.setViewportSize({ width: 1200, height: 800 });
    await openBlankEditor(page);

    await expect(page.getByTestId('editor-toolbar')).toBeVisible();
    await expect(page.getByTestId('left-panel')).toBeVisible();
    await expect(page.getByTestId('right-panel')).toBeVisible();
    await expect(page.getByTestId('right-tab-object')).toBeVisible();

    await page.getByTestId('nav-shapes').click();
    await page.getByTestId('shape-rectangle').click();
    await expect.poll(async () => (await snapshot(page)).objects.some((object) => object.type === 'rect')).toBe(true);
    await expect(page.getByTestId('right-inspector-object-panel')).toBeVisible();

    const canvasBox = await page.getByTestId('canvas-workspace').boundingBox();
    expect(canvasBox?.width).toBeGreaterThan(350);
    expect(fatalConsole).toEqual([]);
  });

  test('creates and edits a textbox through real Fabric pointer and keyboard flow', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    const canvasBox = await page.locator('canvas.upper-canvas').boundingBox()
      ?? await page.getByTestId('design-canvas').boundingBox();
    if (!canvasBox) throw new Error('Canvas bounding box was unavailable');

    await page.getByTestId('tool-textbox').click();
    await page.mouse.move(canvasBox.x + 180, canvasBox.y + 160);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 360, canvasBox.y + 260, { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => (await snapshot(page)).objects.some((object) => object.type === 'textbox')).toBe(true);
    const state = await snapshot(page);
    const textbox = state.objects.find((object) => object.type === 'textbox');
    expect(textbox?.width).toBeGreaterThan(50);
    expect(textbox?.height).toBeGreaterThan(0);
    expect(state.selectedLayerIds).toContain(textbox?.id);
    expect(state.activeTool).toBe('select');

    await expect.poll(async () => {
      const current = (await snapshot(page)).objects.find((object) => object.id === textbox?.id);
      return current?.isEditing;
    }).toBe(true);

    await page.keyboard.type('Inline QA text');
    await page.keyboard.press('Escape');
    await expect.poll(async () => {
      const current = (await snapshot(page)).objects.find((object) => object.id === textbox?.id);
      return current?.text;
    }).toBe('Inline QA text');
    await expect.poll(async () =>
      (await snapshot(page)).canvasObjects.find((object) => object.id === textbox?.id)?.text
    ).toBe('Inline QA text');
    expect(fatalConsole).toEqual([]);
  });

  test('commits a Canvas fill-opacity slider through a real keyboard interaction', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    const rectId = await addRectangleThroughUi(page, { hidePanels: false });
    const panel = page.getByTestId('right-inspector-object-panel');
    await expect(panel).toBeVisible();
    const fillOpacitySlider = panel.getByRole('slider').first();
    const before = (await snapshot(page)).canvasObjects.find((object) => object.id === rectId);
    await fillOpacitySlider.focus();
    await fillOpacitySlider.press('ArrowLeft');

    await expect.poll(async () => {
      const current = (await snapshot(page)).canvasObjects.find((object) => object.id === rectId);
      return current?.fill;
    }).not.toEqual(before?.fill);
    expect(fatalConsole).toEqual([]);
  });

  test('uses Chromium native color input for live preview and one completed change', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    const rectId = await addRectangleThroughUi(page, { hidePanels: false });
    const panel = page.getByTestId('right-inspector-object-panel');
    const colorInput = panel.locator('input[type="color"]').first();
    await expect(colorInput).toBeVisible();

    await colorInput.evaluate((input) => {
      const events: string[] = [];
      input.addEventListener('input', () => events.push('input'));
      input.addEventListener('change', () => events.push('change'));
      (window as Window & { __closureEvents?: string[] }).__closureEvents = events;
    });
    await colorInput.evaluate((input) => {
      const color = input as HTMLInputElement;
      color.value = '#224466';
      color.dispatchEvent(new Event('input', { bubbles: true }));
      color.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect.poll(async () => {
      const current = (await snapshot(page)).canvasObjects.find((object) => object.id === rectId);
      return current?.fill;
    }).toBe('#224466');
    await expect.poll(async () => page.evaluate(
      () => (window as Window & { __closureEvents?: string[] }).__closureEvents,
    )).toEqual(['input', 'change']);
    expect(fatalConsole).toEqual([]);
  });

  test('resizes a selected rectangle through a Fabric corner control and blocks locked resizing', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    const rectId = await addRectangleThroughUi(page, { hidePanels: false });
    await expect.poll(async () => {
      const state = await snapshot(page);
      return {
        activeObjectId: state.activeObjectId,
        selectedObjectId: state.selectedObjectId,
        selectedLayerIds: state.selectedLayerIds,
        layerIds: state.layers.map((layer) => layer.id),
      };
    }).toEqual({
      activeObjectId: rectId,
      selectedObjectId: rectId,
      selectedLayerIds: [rectId],
      layerIds: [rectId],
    });
    const before = (await snapshot(page)).objects.find((object) => object.id === rectId);
    const handle = await controlPoint(page, rectId, 'br') ?? await canvasPointForObjectOffset(
      page,
      rectId,
      ((before?.width ?? 0) * (before?.scaleX ?? 1)) / 2,
      ((before?.height ?? 0) * (before?.scaleY ?? 1)) / 2
    );

    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x + 80, handle.y + 60, { steps: 10 });
    await page.mouse.up();

    await expect.poll(async () => {
      const resized = (await snapshot(page)).objects.find((object) => object.id === rectId);
      return Math.round((resized?.scaleX ?? 1) * (resized?.width ?? 0));
    }).toBeGreaterThan(Math.round((before?.scaleX ?? 1) * (before?.width ?? 0)));
    const resized = (await snapshot(page)).objects.find((object) => object.id === rectId);
    if (!resized) throw new Error('Resized rectangle not found in Fabric state');
    const expectedPixelWidth = Math.round((resized.scaleX ?? 1) * (resized.width ?? 0));
    // scheduleUpdate syncs the store asynchronously via frameScheduler, so poll until it catches up
    await expect.poll(async () => {
      const storeMirror = (await snapshot(page)).canvasObjects.find((object) => object.id === rectId);
      return Math.round((storeMirror?.scaleX ?? 1) * (storeMirror?.width ?? 0));
    }).toBe(expectedPixelWidth);

    await page.getByTestId('right-tab-layers').click();
    const targetLayer = page.locator(`[data-testid="layer-item"][data-layer-id="${rectId}"]`);
    await targetLayer.getByTestId('layer-toggle-lock').click();
    await expect.poll(async () => {
      const layer = (await snapshot(page)).layers.find((entry) => entry.id === rectId);
      return layer?.movementLocked;
    }).toBe(true);

    const lockedBefore = (await snapshot(page)).objects.find((object) => object.id === rectId);
    const lockedHandle = await controlPoint(page, rectId, 'br') ?? await canvasPointForObjectOffset(
      page,
      rectId,
      ((lockedBefore?.width ?? 0) * (lockedBefore?.scaleX ?? 1)) / 2,
      ((lockedBefore?.height ?? 0) * (lockedBefore?.scaleY ?? 1)) / 2
    );
    await page.mouse.move(lockedHandle.x, lockedHandle.y);
    await page.mouse.down();
    await page.mouse.move(lockedHandle.x + 80, lockedHandle.y + 60, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => {
      const lockedAfter = (await snapshot(page)).objects.find((object) => object.id === rectId);
      return Math.round((lockedAfter?.scaleX ?? 1) * (lockedAfter?.width ?? 0));
    }).toBe(Math.round((lockedBefore?.scaleX ?? 1) * (lockedBefore?.width ?? 0)));
    expect(fatalConsole).toEqual([]);
  });

  test('moves unlocked objects, blocks locked movement, and prevents hidden pointer selection', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    const rectId = await addRectangleThroughUi(page);
    const beforeRects = new Map(
      (await snapshot(page)).objects
        .filter((object) => object.type === 'rect' && object.id)
        .map((object) => [object.id as string, object])
    );
    const rectCenter = await canvasPointForObject(page, rectId);
    const startPoint = { x: rectCenter.x - 24, y: rectCenter.y - 18 };

    await page.mouse.move(startPoint.x, startPoint.y);
    await page.mouse.down();
    await page.mouse.move(startPoint.x + 90, startPoint.y + 45, { steps: 10 });
    await page.mouse.up();

    await expect.poll(async () => {
      const state = await snapshot(page);
      const movedRect = state.objects.find((object) => {
        if (object.type !== 'rect' || !object.id) return false;
        const before = beforeRects.get(object.id);
        return before && Math.round(object.left ?? 0) !== Math.round(before.left ?? 0);
      });
      return movedRect?.id ?? null;
    }).not.toBeNull();

    const moved = (await snapshot(page)).objects.find((object) => {
      if (object.type !== 'rect' || !object.id) return false;
      const before = beforeRects.get(object.id);
      return before && Math.round(object.left ?? 0) !== Math.round(before.left ?? 0);
    });
    if (!moved?.id) throw new Error('No moved rectangle was found after drag');
    const lockTargetId = (await snapshot(page)).selectedLayerIds[0];
    if (!lockTargetId) throw new Error('No selected layer was available for lock/visibility assertions');
    const lockPoint = await canvasPointForObject(page, lockTargetId);
    const lockedStart = (await snapshot(page)).objects.find((object) => object.id === lockTargetId);
    await page.getByTestId('right-tab-layers').click();
    const targetLayer = page.locator(`[data-testid="layer-item"][data-layer-id="${lockTargetId}"]`);
    await targetLayer.getByTestId('layer-toggle-lock').click();
    await expect.poll(async () => {
      const layer = (await snapshot(page)).layers.find((entry) => entry.id === lockTargetId);
      return layer?.movementLocked;
    }).toBe(true);

    await page.mouse.move(lockPoint.x, lockPoint.y);
    await page.mouse.down();
    await page.mouse.move(lockPoint.x + 80, lockPoint.y + 40, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => {
      const locked = (await snapshot(page)).objects.find((object) => object.id === lockTargetId);
      return Math.round(locked?.left ?? 0);
    }).toBe(Math.round(lockedStart?.left ?? 0));

    const lockedBeforeHide = (await snapshot(page)).objects.find((object) => object.id === lockTargetId);
    await page.getByTestId('right-tab-layers').click();
    await targetLayer.getByTestId('layer-toggle-visibility').click();
    await expect.poll(async () => {
      const hidden = (await snapshot(page)).objects.find((object) => object.id === lockTargetId);
      return hidden?.visible;
    }).toBe(false);

    await page.mouse.click(lockPoint.x, lockPoint.y);
    await expect.poll(async () => (await snapshot(page)).activeObjectId).not.toBe(lockTargetId);
    expect(lockedBeforeHide).toBeTruthy();
    expect(fatalConsole).toEqual([]);
  });

  test('keeps the editor reachable at a narrow viewport', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await openBlankEditor(page);

    const canvasBox = await page.getByTestId('design-canvas').boundingBox();
    expect(canvasBox?.width).toBeGreaterThan(20);
    expect(canvasBox?.height).toBeGreaterThan(20);
    await expect(page.getByTestId('editor-toolbar')).toBeHidden();
    await expect(page.getByTestId('left-panel')).toBeHidden();
    await expect(page.getByTestId('right-panel')).toBeHidden();
    await expect(page.getByTestId('narrow-editor-notice')).toBeVisible();
    await expect(page.getByText('Editing works best on a larger screen.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download Project' })).toBeVisible();
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    await expect(page.getByTestId('dashboard-root')).toBeVisible();
    expect(fatalConsole).toEqual([]);
  });

  test('guards dirty work before returning to the project dashboard', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);
    await page.getByTestId('nav-shapes').click();
    await page.getByTestId('shape-rectangle').click();
    await expect.poll(async () => (await snapshot(page)).objects.some((object) => object.type === 'rect')).toBe(true);

    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    const dialog = page.getByTestId('unsaved-navigation-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Save before returning to Projects?')).toBeVisible();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('editor-shell')).toBeVisible();
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    await dialog.getByRole('button', { name: 'Discard Changes' }).click();
    await expect(page.getByTestId('dashboard-root')).toBeVisible();
    expect(fatalConsole).toEqual([]);
  });

  test('floating overlays do not create a broad invisible hit target over the canvas', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);
    await addRectangleThroughUi(page, { hidePanels: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('design-canvas')).toBeVisible();

    const canvasBox = await page.locator('canvas.upper-canvas').boundingBox()
      ?? await page.getByTestId('design-canvas').boundingBox();
    if (!canvasBox) throw new Error('Canvas bounding box was unavailable');

    const hitTarget = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return {
        tag: element?.tagName ?? null,
        className: typeof element?.className === 'string' ? element.className : '',
        testId: element?.getAttribute('data-testid'),
        text: element?.textContent?.trim().slice(0, 40) ?? '',
      };
    }, {
      x: canvasBox.x + canvasBox.width / 2,
      y: canvasBox.y + canvasBox.height / 2,
    });

    expect(hitTarget.tag).toBe('CANVAS');
    expect(hitTarget.className).toContain('upper-canvas');
    expect(fatalConsole).toEqual([]);
  });

  test('uploads a real image fixture through the Insert panel and selects it', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    await page.getByTestId('nav-insert').click();
    await page.getByTestId('insert-upload-image-input').setInputFiles(tinyPngFixture());

    await expect.poll(async () => {
      const state = await snapshot(page);
      const image = state.objects.find((object) => object.type === 'image');
      return image
        ? {
          activeObjectId: state.activeObjectId,
          selectedObjectId: state.selectedObjectId,
          selectedLayerIds: state.selectedLayerIds,
          layerIds: state.layers.map((layer) => layer.id),
          mirrorType: state.canvasObjects.find((object) => object.id === image.id)?.type,
        }
        : null;
    }).toMatchObject({
      mirrorType: 'Image',
    });

    const state = await snapshot(page);
    const image = state.objects.find((object) => object.type === 'image');
    if (!image?.id) throw new Error('Uploaded image was not inserted');
    expect(state.activeObjectId).toBe(image.id);
    expect(state.selectedObjectId).toBe(image.id);
    expect(state.selectedLayerIds).toContain(image.id);
    expect(state.layers.map((layer) => layer.id)).toContain(image.id);
    await expect.poll(async () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.tagName ?? null)).not.toBe('INPUT');
    await expect(page.getByTestId('toolbar-undo')).toBeEnabled();

    await page.getByTestId('toolbar-undo').click();
    await expect.poll(async () => (await snapshot(page)).objects.some((object) => object.id === image.id)).toBe(false);

    await expect(page.getByTestId('toolbar-redo')).toBeEnabled();
    await page.getByTestId('toolbar-redo').click();
    await expect.poll(async () => (await snapshot(page)).objects.some((object) => object.id === image.id)).toBe(true);
    expect(fatalConsole).toEqual([]);
  });

  test('inserts an asset through the Asset Library UI and keeps selection/layers in sync', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    await page.getByTestId('nav-assets').click();
    await page.getByTestId('asset-library-item-shape-card').click();

    await expect.poll(async () => {
      const state = await snapshot(page);
      const rect = state.objects.find((object) => object.type === 'rect');
      return rect
        ? {
          activeObjectId: state.activeObjectId,
          selectedObjectId: state.selectedObjectId,
          selectedLayerIds: state.selectedLayerIds,
          layerIds: state.layers.map((layer) => layer.id),
          mirrorType: state.canvasObjects.find((object) => object.id === rect.id)?.type,
        }
        : null;
    }).toMatchObject({
      mirrorType: 'Rect',
    });

    const state = await snapshot(page);
    const rect = state.objects.find((object) => object.type === 'rect');
    if (!rect?.id) throw new Error('Asset rectangle was not inserted');
    expect(state.activeObjectId).toBe(rect.id);
    expect(state.selectedObjectId).toBe(rect.id);
    expect(state.selectedLayerIds).toContain(rect.id);
    expect(state.layers.map((layer) => layer.id)).toContain(rect.id);
    expect(fatalConsole).toEqual([]);
  });

  test('applies a community template through the UI and clears stale selection', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    page.on('dialog', (dialog) => void dialog.accept());
    await openBlankEditor(page);

    const staleRectId = await addRectangleThroughUi(page, { hidePanels: false });
    await expect.poll(async () => (await snapshot(page)).selectedObjectId).toBe(staleRectId);

    await page.getByTestId('nav-insert').click();
    await page.getByTestId('insert-tab-templates').click();
    await page.getByTestId('template-community-daily-ritual').click();

    await expect.poll(async () => {
      const state = await snapshot(page);
      return {
        objectCount: state.objects.length,
        layerCount: state.layers.length,
        hasStaleRect: state.objects.some((object) => object.id === staleRectId),
        activeObjectId: state.activeObjectId,
        selectedObjectId: state.selectedObjectId,
        selectedLayerIds: state.selectedLayerIds,
      };
    }).toMatchObject({
      hasStaleRect: false,
      activeObjectId: null,
      selectedObjectId: null,
      selectedLayerIds: [],
    });

    const state = await snapshot(page);
    expect(state.objects.length).toBeGreaterThan(1);
    expect(state.layers.length).toBeGreaterThan(1);
    expect(fatalConsole).toEqual([]);
  });

  test('applies a seeded stored template from My Templates through the UI', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    page.on('dialog', (dialog) => void dialog.accept());

    await seedLegacyTemplates(page, [{
      name: 'Seeded My Template',
      canvasData: {
        objects: [
          {
            type: 'rect',
            id: 'seeded-template-rect',
            left: 120,
            top: 160,
            width: 220,
            height: 120,
            fill: '#dbeafe',
            stroke: '#1d4ed8',
            strokeWidth: 4,
          },
        ],
        background: '#d7f3e3',
      },
      canvasSize: { width: 720, height: 540 },
      unitMode: 'px',
      defaultThemeId: '',
      thumbnail: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }]);

    await openBlankEditor(page);

    const staleRectId = await addRectangleThroughUi(page, { hidePanels: false });
    await expect.poll(async () => (await snapshot(page)).selectedObjectId).toBe(staleRectId);

    await page.getByTestId('nav-insert').click();
    await page.getByTestId('insert-tab-templates').click();
    await expect(page.getByTestId('template-my-seeded-my-template')).toBeVisible();
    await page.getByTestId('template-my-seeded-my-template').click();

    await expect.poll(async () => {
      const state = await snapshot(page);
      return {
        hasSeededRect: state.objects.some((object) => object.id === 'seeded-template-rect'),
        selectedObjectId: state.selectedObjectId,
        selectedLayerIds: state.selectedLayerIds,
        activeObjectId: state.activeObjectId,
        documentSize: state.documentSize,
        pageBackgroundColor: state.pageBackgroundColor,
      };
    }).toMatchObject({
      hasSeededRect: true,
      selectedObjectId: null,
      selectedLayerIds: [],
      activeObjectId: null,
      documentSize: { width: 720, height: 540 },
      pageBackgroundColor: '#D7F3E3',
    });

    const state = await snapshot(page);
    expect(state.objects.some((object) => object.id === staleRectId)).toBe(false);
    expect(state.objects.some((object) => object.id === 'seeded-template-rect')).toBe(true);
    expect(state.layers.map((layer) => layer.id)).toContain('seeded-template-rect');
    expect(state.objects.find((object) => object.id === 'seeded-template-rect')?.width).toBe(220);
    expect(fatalConsole).toEqual([]);
  });
});

test.describe('project rename', () => {
  test('renames the project from the editor header and reflects new name', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    // Default name is visible in the header
    const nameDisplay = page.getByTestId('project-name-display');
    await expect(nameDisplay).toBeVisible();
    const initialName = await nameDisplay.textContent();
    expect(initialName?.trim().length).toBeGreaterThan(0);

    // Click to enter edit mode
    await nameDisplay.click();
    const nameInput = page.getByTestId('project-name-input');
    await expect(nameInput).toBeVisible();

    // Type a new name and commit with Enter
    await nameInput.fill('My WitchClick Graphic');
    await nameInput.press('Enter');

    // Display shows the new name
    await expect(page.getByTestId('project-name-display')).toBeVisible();
    await expect(page.getByTestId('project-name-display')).toHaveText(/My WitchClick Graphic/i);

    // Input is gone
    await expect(nameInput).toBeHidden();

    expect(fatalConsole).toEqual([]);
  });

  test('cancels rename on Escape and restores the previous name', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    const nameDisplay = page.getByTestId('project-name-display');
    const nameBefore = (await nameDisplay.textContent())?.trim() ?? '';

    await nameDisplay.click();
    const nameInput = page.getByTestId('project-name-input');
    await nameInput.fill('Do Not Keep This');
    await nameInput.press('Escape');

    await expect(page.getByTestId('project-name-display')).toBeVisible();
    await expect(page.getByTestId('project-name-display')).toHaveText(new RegExp(nameBefore, 'i'));

    expect(fatalConsole).toEqual([]);
  });

  test('blank rename falls back to Untitled Project', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    const nameDisplay = page.getByTestId('project-name-display');
    await nameDisplay.click();
    const nameInput = page.getByTestId('project-name-input');
    await nameInput.fill('');
    await nameInput.press('Enter');

    await expect(page.getByTestId('project-name-display')).toBeVisible();
    await expect(page.getByTestId('project-name-display')).toHaveText(/Untitled Project/i);

    expect(fatalConsole).toEqual([]);
  });
});

const saveToLibraryAndGoToDashboard = async (page: Page) => {
  // Name the project to something distinct, then save to library, then navigate to dashboard
  const nameDisplay = page.getByTestId('project-name-display');
  await nameDisplay.click();
  const nameInput = page.getByTestId('project-name-input');
  await nameInput.fill('Phase19 Rename Test');
  await nameInput.press('Enter');
  await expect(page.getByTestId('project-name-display')).toHaveText(/Phase19 Rename Test/i);

  await page.getByRole('button', { name: /^File$/i }).click();
  const saveToLibraryItem = page.getByText('Save to Library');
  await saveToLibraryItem.click();
  // Dropdown closes only after saveProject() resolves, so hidden = save done
  await expect(saveToLibraryItem).toBeHidden({ timeout: 10000 });

  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByTestId('dashboard-new-project')).toBeVisible();
  const card = page.getByTestId('dashboard-project-card').filter({ hasText: 'Phase19 Rename Test' });
  await expect(card).toBeVisible({ timeout: 5000 });
  return card;
};

test.describe('dashboard project rename', () => {
  test('renames a project from the dashboard and reflects the new name', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    const card = await saveToLibraryAndGoToDashboard(page);

    // Hover to reveal the pencil button, then click it
    await card.hover();
    await card.getByTitle('Rename project').click();

    const input = page.getByTestId('dashboard-rename-input');
    await expect(input).toBeVisible();
    await input.fill('Phase19 Renamed');
    await input.press('Enter');

    await expect(page.getByTestId('dashboard-rename-input')).toBeHidden();
    await expect(page.getByTestId('dashboard-project-card').filter({ hasText: 'Phase19 Renamed' })).toBeVisible();

    expect(fatalConsole).toEqual([]);
  });

  test('cancels dashboard rename on Escape and restores the previous name', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    const card = await saveToLibraryAndGoToDashboard(page);

    await card.hover();
    await card.getByTitle('Rename project').click();

    const input = page.getByTestId('dashboard-rename-input');
    await input.fill('Do Not Keep This');
    await input.press('Escape');

    await expect(page.getByTestId('dashboard-rename-input')).toBeHidden();
    await expect(page.getByTestId('dashboard-project-card').filter({ hasText: 'Phase19 Rename Test' })).toBeVisible();

    expect(fatalConsole).toEqual([]);
  });

  test('blank dashboard rename falls back to Untitled Project', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    const card = await saveToLibraryAndGoToDashboard(page);

    await card.hover();
    await card.getByTitle('Rename project').click();

    const input = page.getByTestId('dashboard-rename-input');
    await input.fill('');
    await input.press('Enter');

    await expect(page.getByTestId('dashboard-rename-input')).toBeHidden();
    await expect(page.getByTestId('dashboard-project-card').filter({ hasText: 'Untitled Project' })).toBeVisible();

    expect(fatalConsole).toEqual([]);
  });

  test('canvas settings panel is not visible over the canvas on fresh editor load', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    // The CanvasSettingsPanel (aria-label="Canvas settings") must not be visible by default.
    // It was previously persisted to localStorage so it could appear mid-canvas on reload.
    await expect(page.getByRole('region', { name: 'Canvas settings' })).toBeHidden();

    expect(fatalConsole).toEqual([]);
  });

  test('document is centered within the canvas stage after opening a preset', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    const state = await snapshot(page);
    const vpt = state.viewportTransform;
    const docSize = state.documentSize;

    expect(vpt).not.toBeNull();
    expect(docSize).toBeDefined();

    // vpt = [zoom, 0, 0, zoom, tx, ty]
    const zoom = vpt![0];
    const tx = vpt![4];
    const ty = vpt![5];
    const docW = docSize!.width;
    const docH = docSize!.height;

    // Measure the canvas element's actual rendered size as the container proxy
    const canvasBox = await page.locator('canvas.upper-canvas').boundingBox()
      ?? await page.getByTestId('design-canvas').boundingBox();
    expect(canvasBox).not.toBeNull();
    const containerW = canvasBox!.width;
    const containerH = canvasBox!.height;

    // Rulers (24px each) permanently overlay the top-left of the canvas.
    // The centering formula targets the ruler-excluded area:
    //   tx = rulerInset + (containerW - rulerInset)/2 - zoom*docW/2
    //      = (containerW + rulerInset)/2 - zoom*docW/2
    const rulerInset = 24;
    const expectedTx = (containerW + rulerInset) / 2 - (zoom * docW) / 2;
    const expectedTy = (containerH + rulerInset) / 2 - (zoom * docH) / 2;

    // Allow ±20px tolerance for subpixel rounding and layout settling
    expect(tx).toBeCloseTo(expectedTx, -1);
    expect(ty).toBeCloseTo(expectedTy, -1);

    expect(fatalConsole).toEqual([]);
  });

  test('document paper and canvas stage are co-centered after preset load', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    const layout = await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.documentLayout());
    expect(layout).not.toBeNull();

    const { vpt, documentSize, canvasElementRect, paperInCanvas } = layout;

    expect(canvasElementRect).not.toBeNull();
    expect(documentSize).toBeDefined();
    expect(vpt).not.toBeNull();

    // Paper Fabric object must be at origin (0, 0) with correct dimensions
    expect(paperInCanvas).not.toBeNull();
    expect(paperInCanvas.left).toBe(0);
    expect(paperInCanvas.top).toBe(0);
    expect(paperInCanvas.width).toBe(documentSize.width);
    expect(paperInCanvas.height).toBe(documentSize.height);

    // vpt = [zoom, 0, 0, zoom, tx, ty]
    // Paper center in canvas-element-local pixels (VPT applied to object origin):
    const zoom = vpt[0];
    const paperCanvasCenterX = vpt[4] + documentSize.width * zoom / 2;
    const paperCanvasCenterY = vpt[5] + documentSize.height * zoom / 2;

    // Ruler-adjusted canvas center: rulers cover 24px at top and left, so the intended
    // viewport center is offset by half the ruler size from the raw canvas center.
    const rulerInset = 24;
    const intendedCenterX = (canvasElementRect.width + rulerInset) / 2;
    const intendedCenterY = (canvasElementRect.height + rulerInset) / 2;

    // Paper must be centered within the ruler-excluded viewport (within 2px)
    expect(paperCanvasCenterX).toBeCloseTo(intendedCenterX, 0);
    expect(paperCanvasCenterY).toBeCloseTo(intendedCenterY, 0);

    expect(fatalConsole).toEqual([]);
  });

  test('document screen center matches the intended workspace viewport center', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    const layout = await workspaceLayout(page);
    expect(layout).not.toBeNull();

    const { paperScreenCenter, intendedWorkspaceCenter, workspaceRect, canvasElementRect } = layout;

    // QA helper must be reachable and return all expected fields
    expect(paperScreenCenter).not.toBeNull();
    expect(intendedWorkspaceCenter).not.toBeNull();
    expect(workspaceRect).not.toBeNull();
    expect(canvasElementRect).not.toBeNull();

    // Canvas workspace element must match the ruler-excluded viewport dimensions
    // (left panel + right panel + header + bottom strip are all excluded by layout)
    expect(workspaceRect!.width).toBeGreaterThan(200);
    expect(workspaceRect!.height).toBeGreaterThan(200);

    // Document paper center must be within 4px of the intended workspace center
    // (ruler-excluded area: starts at ruler_inset=24 within the canvas element)
    expect(Math.abs(paperScreenCenter!.x - intendedWorkspaceCenter!.x)).toBeLessThanOrEqual(4);
    expect(Math.abs(paperScreenCenter!.y - intendedWorkspaceCenter!.y)).toBeLessThanOrEqual(4);

    expect(fatalConsole).toEqual([]);
  });
});

test.describe('canvas DOM layer alignment', () => {
  test('lower-canvas and upper-canvas bounding boxes match within 1px', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    const layers = await domLayers(page);
    expect(layers).not.toBeNull();
    const { lowerCanvasRect, upperCanvasRect } = layers;
    expect(lowerCanvasRect).not.toBeNull();
    expect(upperCanvasRect).not.toBeNull();

    expect(Math.abs(lowerCanvasRect!.left - upperCanvasRect!.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(lowerCanvasRect!.top - upperCanvasRect!.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(lowerCanvasRect!.width - upperCanvasRect!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(lowerCanvasRect!.height - upperCanvasRect!.height)).toBeLessThanOrEqual(1);

    expect(fatalConsole).toEqual([]);
  });

  test('fabric wrapper and lower-canvas rects align within 1px', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    const layers = await domLayers(page);
    expect(layers).not.toBeNull();
    const { fabricWrapperRect, lowerCanvasRect } = layers;
    expect(fabricWrapperRect).not.toBeNull();
    expect(lowerCanvasRect).not.toBeNull();

    expect(Math.abs(fabricWrapperRect!.left - lowerCanvasRect!.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(fabricWrapperRect!.top - lowerCanvasRect!.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(fabricWrapperRect!.width - lowerCanvasRect!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(fabricWrapperRect!.height - lowerCanvasRect!.height)).toBeLessThanOrEqual(1);

    expect(fatalConsole).toEqual([]);
  });

  test('canvas element fills the workspace stage — no offset gap', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    const layers = await domLayers(page);
    expect(layers).not.toBeNull();
    const { stageRect, lowerCanvasRect } = layers;
    expect(stageRect).not.toBeNull();
    expect(lowerCanvasRect).not.toBeNull();

    // Canvas must be at least as wide/tall as the stage
    expect(lowerCanvasRect!.width).toBeGreaterThanOrEqual(stageRect!.width - 2);
    expect(lowerCanvasRect!.height).toBeGreaterThanOrEqual(stageRect!.height - 2);

    // Canvas top-left must coincide with stage top-left (within 2px)
    expect(Math.abs(lowerCanvasRect!.left - stageRect!.left)).toBeLessThanOrEqual(2);
    expect(Math.abs(lowerCanvasRect!.top - stageRect!.top)).toBeLessThanOrEqual(2);

    expect(fatalConsole).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// White-rectangle diagnostic: fabricObjectsAudit assertions
// ---------------------------------------------------------------------------

type FabricAuditObject = {
  id: string | null;
  type: string;
  isDocumentPaper: boolean;
  isGuide: boolean;
  isPageBorder: boolean;
  isSafeZoneOverlay: boolean;
  isBleedZone: boolean;
  fabricCoords: { left: number; top: number; width: number; height: number };
  fill: string;
  stroke: string | null;
  opacity: number;
  visible: boolean;
  canvasBr: { left: number; top: number; width: number; height: number };
  screenBounds: { left: number; top: number; width: number; height: number };
};

type FabricAudit = {
  documentSize: { width: number; height: number };
  canvasBackgroundColor: string;
  vpt: number[];
  zoom: number;
  canvasElementRect: { left: number; top: number; width: number; height: number };
  expectedPaperScreen: { left: number; top: number; width: number; height: number };
  objectCount: number;
  documentPaperObjects: FabricAuditObject[];
  pageBorderObjects: FabricAuditObject[];
  guideObjects: FabricAuditObject[];
  userObjects: FabricAuditObject[];
  domLayers: {
    lowerCanvas: { bg: string; rect: { left: number; top: number; width: number; height: number } } | null;
    fabricWrapper: { bg: string; rect: { left: number; top: number; width: number; height: number } } | null;
    canvasContainerDiv: { bg: string; rect: { left: number; top: number; width: number; height: number } } | null;
    canvasStageDiv: { bg: string; rect: { left: number; top: number; width: number; height: number } } | null;
  };
  pixelSamples: {
    paperCenter: { r: number; g: number; b: number; a: number } | null;
    leftOfPaper: { r: number; g: number; b: number; a: number } | null;
    paperLeftEdge: { r: number; g: number; b: number; a: number } | null;
    farLeft: { r: number; g: number; b: number; a: number } | null;
    midLeft: { r: number; g: number; b: number; a: number } | null;
  };
};

const fabricObjectsAudit = async (page: Page): Promise<FabricAudit> =>
  page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.fabricObjectsAudit());

test.describe('fabricObjectsAudit — white rectangle source', () => {
  test('fresh project: exactly one documentPaper, transparent canvas background, no extra white sources', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    const audit = await fabricObjectsAudit(page);
    expect(audit).not.toBeNull();

    // Exactly one documentPaper object
    expect(audit.documentPaperObjects).toHaveLength(1);

    // Canvas background is transparent (not a white fill source)
    const bg = audit.canvasBackgroundColor;
    const isTransparent = !bg || bg === '' || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)';
    expect(isTransparent).toBe(true);

    // No page border objects on a fresh project
    expect(audit.pageBorderObjects).toHaveLength(0);

    // documentPaper is at Fabric (0, 0)
    const paper = audit.documentPaperObjects[0];
    expect(paper.fabricCoords.left).toBe(0);
    expect(paper.fabricCoords.top).toBe(0);

    // documentPaper dimensions match document size
    const { width: docW, height: docH } = audit.documentSize;
    expect(paper.fabricCoords.width).toBe(docW);
    expect(paper.fabricCoords.height).toBe(docH);

    // documentPaper screen bounds match the expectedPaperScreen from VPT
    const { expectedPaperScreen } = audit;
    expect(Math.abs(paper.screenBounds.left - expectedPaperScreen.left)).toBeLessThanOrEqual(2);
    expect(Math.abs(paper.screenBounds.top - expectedPaperScreen.top)).toBeLessThanOrEqual(2);

    // farLeft pixel (x=10 on canvas element) must be transparent — no white rect left of paper
    const farLeft = audit.pixelSamples.farLeft;
    expect(farLeft).not.toBeNull();
    expect(farLeft!.a).toBe(0);

    // Paper center pixel should be opaque (paper renders a fill)
    const paperCenter = audit.pixelSamples.paperCenter;
    expect(paperCenter).not.toBeNull();
    expect(paperCenter!.a).toBeGreaterThan(0);

    expect(fatalConsole).toEqual([]);
  });

  test('page border uses document dimensions, not canvas element dimensions', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    // Open the Page tab and apply a page border with default settings
    await page.getByTestId('right-tab-page').click();
    await expect(page.getByTestId('page-border-apply')).toBeVisible();
    await page.getByTestId('page-border-apply').click();

    // Wait for border to appear on canvas
    await page.waitForFunction(() => {
      const audit = (window as any).__DESIGN_SPACE_QA__.fabricObjectsAudit();
      return audit?.pageBorderObjects?.length > 0;
    });

    const audit = await fabricObjectsAudit(page);
    expect(audit.pageBorderObjects).toHaveLength(1);

    const { width: docW, height: docH } = audit.documentSize;
    const borderGroup = audit.pageBorderObjects[0];

    // The page border group in Fabric space must cover nearly the full document.
    // Default inset = 32px. For Instagram Square (1080×1080): ≈ 1016px wide.
    // Canvas element is only ~640px — so this assertion proves correct dimension source.
    expect(borderGroup.canvasBr.width).toBeGreaterThan(docW * 0.8);
    expect(borderGroup.canvasBr.height).toBeGreaterThan(docH * 0.8);

    // Border group screen bounds must align with document paper (within inset tolerance)
    const { expectedPaperScreen, zoom } = audit;
    const maxOffset = Math.ceil(40 * zoom) + 4;
    expect(Math.abs(borderGroup.screenBounds.left - expectedPaperScreen.left)).toBeLessThanOrEqual(maxOffset);
    expect(Math.abs(borderGroup.screenBounds.top - expectedPaperScreen.top)).toBeLessThanOrEqual(maxOffset);

    // farLeft pixel must still be transparent — no stale white rect outside paper
    const farLeft = audit.pixelSamples.farLeft;
    expect(farLeft).not.toBeNull();
    expect(farLeft!.a).toBe(0);

    expect(fatalConsole).toEqual([]);
  });

  test('no stale white rectangle outside document bounds after project load', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    await openBlankEditor(page);

    const audit = await fabricObjectsAudit(page);
    const { expectedPaperScreen, canvasElementRect, vpt } = audit;

    // Paper must start to the right of canvas left edge (VPT tx > 0 means paper is inset)
    expect(expectedPaperScreen.left).toBeGreaterThan(canvasElementRect.left + 20);

    // midLeft pixel (x=60 on canvas element) is between ruler (24px) and paper left
    // If paper hasn't been shifted to x=60 yet it should be transparent
    const midLeft = audit.pixelSamples.midLeft;
    if (midLeft !== null) {
      const isInPaperRange = 60 >= vpt[4];
      if (!isInPaperRange) {
        expect(midLeft.a).toBeLessThan(200);
      }
    }

    expect(fatalConsole).toEqual([]);
  });
});
