import { expect, test } from './test-fixtures';

const snapshot = (page: any) => page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot());

test('tarot page styling keeps editable cards and semantic data while updating decorations', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('dashboard-new-project').click();
  await page.getByTestId('project-preset-us-letter').click();
  await expect(page.getByTestId('editor-shell')).toBeVisible();
  await page.waitForFunction(() => (window as any).__DESIGN_SPACE_QA__?.snapshot().canvasReady === true);

  await page.getByTestId('nav-insert').click();
  const insertPanel = page.locator('.design-space-left-content');
  await insertPanel.getByRole('button', { name: 'Tarot Spreads' }).click();
  await insertPanel.getByTestId('insert-tarot-spread').click();
  await expect.poll(async () => (await snapshot(page)).objects.filter((object: any) => object.semanticRole === 'tarot-card').length).toBe(3);

  const before = await snapshot(page);
  const cardsBefore = before.objects.filter((object: any) => object.semanticRole === 'tarot-card');
  expect(cardsBefore.every((card: any) => card.tarotPosition?.prompt)).toBe(true);

  await page.getByTestId('right-tab-page').click();
  const stylePanel = page.getByTestId('tarot-page-style-panel');
  await expect(stylePanel).toBeVisible();
  await stylePanel.locator('summary').filter({ hasText: 'Border' }).click();
  await stylePanel.getByLabel('Border type').selectOption('double');
  await stylePanel.locator('summary').filter({ hasText: 'Header' }).click();
  await stylePanel.getByLabel('Title', { exact: true }).fill('A living spread page');
  await stylePanel.locator('summary').filter({ hasText: 'Tarot Cards' }).click();
  await stylePanel.getByLabel('Card fill mode').selectOption('outline');
  await stylePanel.getByLabel('Position label placement').selectOption('below');
  await stylePanel.locator('summary').filter({ hasText: 'Footer / Notes' }).click();
  await stylePanel.getByLabel('Show footer').check();
  await stylePanel.getByLabel('Date', { exact: true }).check();
  await stylePanel.getByTestId('tarot-style-apply').click();

  await expect.poll(async () => {
    const state = await snapshot(page);
    return {
      borders: state.objects.filter((object: any) => object.semanticRole === 'tarot-page-border').length,
      marker: state.objects.find((object: any) => object.isTarotPageStyle)?.tarotPageStyle?.border?.type,
      title: state.objects.find((object: any) => object.semanticRole === 'tarot-page-title')?.text,
      footer: state.objects.filter((object: any) => object.semanticRole === 'tarot-footer-date').length,
    };
  }).toEqual({ borders: 1, marker: 'double', title: 'A living spread page', footer: 1 });

  const after = await snapshot(page);
  const cardsAfter = after.objects.filter((object: any) => object.semanticRole === 'tarot-card');
  expect(cardsAfter).toHaveLength(3);
  expect(cardsAfter.map((card: any) => card.tarotPosition.prompt)).toEqual(cardsBefore.map((card: any) => card.tarotPosition.prompt));
  expect(after.objects.some((object: any) => object.semanticRole === 'tarot-ornament')).toBe(false);

  await page.getByTestId('toolbar-undo').click();
  await expect.poll(async () => (await snapshot(page)).objects.filter((object: any) => object.semanticRole === 'tarot-page-border').length).toBe(0);
  await page.getByTestId('toolbar-redo').click();
  await expect.poll(async () => (await snapshot(page)).objects.filter((object: any) => object.semanticRole === 'tarot-page-border').length).toBe(1);
});
