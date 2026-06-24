import { expect, test, type Page } from '@playwright/test';

type QaSnapshot = {
  canvasReady: boolean;
  documentSize?: { width: number; height: number };
  viewportTransform: number[] | null;
};

type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
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

const rectFor = async (page: Page, selector: string): Promise<Rect> =>
  page.evaluate((targetSelector) => {
    const element = document.querySelector(targetSelector);
    if (!element) throw new Error(`Missing element for selector: ${targetSelector}`);
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }, selector);

const paperScreenBounds = async (page: Page) => {
  const state = await snapshot(page);
  const dom = await page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.domLayers());
  const canvasRect = dom?.upperCanvasRect ?? dom?.lowerCanvasRect;
  const documentSize = state.documentSize;
  const vpt = state.viewportTransform;
  if (!canvasRect || !documentSize || !vpt) {
    throw new Error('Canvas paper bounds were not available from QA helpers');
  }

  const left = canvasRect.left + vpt[4];
  const top = canvasRect.top + vpt[5];
  const width = documentSize.width * vpt[0];
  const height = documentSize.height * vpt[3];
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
};

const expectPaperFitsWorkbench = async (page: Page) => {
  const stage = await rectFor(page, '[data-testid="canvas-stage"]');
  const pageStrip = await rectFor(page, '[data-testid="page-strip"]');
  const status = await rectFor(page, '[data-testid="status-bar"]');
  const paper = await paperScreenBounds(page);

  expect(stage.width).toBeGreaterThan(500);
  expect(stage.height).toBeGreaterThan(500);
  expect(paper.width).toBeGreaterThan(250);
  expect(paper.height).toBeGreaterThan(350);
  expect(paper.left).toBeGreaterThanOrEqual(stage.left);
  expect(paper.top).toBeGreaterThanOrEqual(stage.top);
  expect(paper.right).toBeLessThanOrEqual(stage.left + stage.width);
  expect(paper.bottom).toBeLessThanOrEqual(stage.top + stage.height);
  expect(paper.bottom).toBeLessThan(pageStrip.top);
  expect(pageStrip.top).toBeLessThanOrEqual(status.top);

  const visibleCenterX = stage.left + stage.width / 2;
  const visibleCenterY = stage.top + stage.height / 2;
  expect(Math.abs(paper.centerX - visibleCenterX)).toBeLessThan(90);
  expect(Math.abs(paper.centerY - visibleCenterY)).toBeLessThan(90);
};

test.describe('Design Space printable product studio browser smoke', () => {
  test('critical product studio flow stays readable and unclipped in browser', async ({ page }) => {
    const fatalConsole = installFatalConsoleCollector(page);
    page.on('dialog', (dialog) => void dialog.accept());
    await page.setViewportSize({ width: 1440, height: 950 });

    await page.goto('/');

    await expect(page.getByText('Printable Product Studio')).toBeVisible();
    await expect(page.getByTestId('dashboard-new-project')).toBeVisible();
    await expect(page.getByTestId('dashboard-open-project')).toBeVisible();
    await expect(page.getByText('Recent Product Projects')).toBeVisible();

    const dashboardPanel = await page.getByTestId('dashboard-panel').boundingBox();
    const createCard = await page.getByTestId('dashboard-new-project').boundingBox();
    const openCard = await page.getByTestId('dashboard-open-project').boundingBox();
    expect(dashboardPanel?.width).toBeGreaterThan(900);
    expect(dashboardPanel?.height).toBeGreaterThan(450);
    expect(createCard?.width).toBeGreaterThan(350);
    expect(createCard?.height).toBeGreaterThan(130);
    expect(openCard?.width).toBeGreaterThan(350);
    expect(openCard?.height).toBeGreaterThan(130);
    expect(Math.abs((createCard?.y ?? 0) - (openCard?.y ?? 0))).toBeLessThan(8);
    expect(createCard?.x).toBeLessThan(openCard?.x ?? 0);

    await page.getByTestId('dashboard-new-project').click();
    await expect(page.getByTestId('editor-shell')).toBeVisible();
    await expect(page.getByText('New Canvas')).toBeVisible();
    await expect(page.getByText('Choose a size to get started')).toBeVisible();
    const usLetterPreset = page.getByTestId('project-preset-us-letter');
    await expect(usLetterPreset).toBeVisible();
    const modalPanel = page.locator('.canvas-size-picker-panel');
    const modalBox = await modalPanel.boundingBox();
    expect(modalBox?.width).toBeGreaterThan(560);
    expect(modalBox?.height).toBeGreaterThan(440);

    await usLetterPreset.click();
    await page.waitForFunction(() => (window as any).__DESIGN_SPACE_QA__?.snapshot().canvasReady === true);

    await expect(page.getByTestId('editor-toolbar')).toBeVisible();
    await expect(page.getByTestId('left-panel')).toBeVisible();
    await expect(page.getByTestId('right-panel')).toBeVisible();
    await expect(page.getByTestId('canvas-stage')).toBeVisible();
    await expect(page.getByTestId('page-strip')).toBeVisible();
    await expect(page.getByTestId('status-bar')).toBeVisible();
    await expect(page.getByText('Product Workflow')).toBeVisible();
    await expect(page.getByTestId('right-tab-product')).toBeVisible();
    await expect(page.getByTestId('right-tab-page')).toBeVisible();
    await expect(page.getByTestId('right-tab-object')).toBeVisible();

    await expectPaperFitsWorkbench(page);

    await page.getByRole('button', { name: 'Starter' }).click();
    const productStarter = page.getByTestId('product-starter');
    const recipeCard = page.getByTestId('recipe-chaos-craft-planner');
    await expect(productStarter).toBeVisible();
    await expect(recipeCard).toBeVisible();
    await expect(recipeCard).toContainText('Chaos Craft Planner');
    await expect(recipeCard).toContainText('Generate a 10-page printable craft planner');
    const recipeBox = await recipeCard.boundingBox();
    expect(recipeBox?.width).toBeGreaterThan(180);
    expect(recipeBox?.height).toBeGreaterThan(140);

    await recipeCard.click();
    await expect(page.getByTestId('product-page-navigator')).toBeVisible();
    await expect(page.getByText('10 total')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Go to page 1 Cover' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Go to page 10 Blank Notes' })).toBeVisible();
    await expect(page.getByTestId('product-context-summary')).toContainText('10 pages');
    await expectPaperFitsWorkbench(page);

    await page.getByTestId('editor-toolbar').getByRole('button', { name: 'Export' }).click();
    await expect(page.getByText('Product Bundle / Product Forge ZIP')).toBeVisible();
    await expect(page.getByTestId('download-product-zip')).toBeVisible();
    await expect(page.getByText('Quick Exports')).toBeVisible();
    await expect(page.getByText('Advanced Exports')).toBeVisible();

    expect(fatalConsole).toEqual([]);
  });
});
