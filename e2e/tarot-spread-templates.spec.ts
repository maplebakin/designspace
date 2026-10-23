import { expect, test } from './test-fixtures';

const snapshot = (page: any) =>
  page.evaluate(() => (window as any).__DESIGN_SPACE_QA__.snapshot());

test('tarot spread templates cover 1–12 cards and insert editable positions', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('dashboard-new-project').click();
  await page.getByTestId('project-preset-us-letter').click();
  await expect(page.getByTestId('editor-shell')).toBeVisible();
  await page.waitForFunction(() =>
    (window as any).__DESIGN_SPACE_QA__?.snapshot().canvasReady === true
  );

  await page.getByTestId('nav-insert').click();
  const panel = page.locator('.design-space-left-content');
  await panel.getByRole('button', { name: 'Tarot Spreads' }).click();
  const cardCount = panel.getByTestId('tarot-card-count');
  const template = panel.getByTestId('tarot-spread-preset');

  await cardCount.selectOption('1');
  await expect(template).toHaveValue('template-1');
  await expect(panel.getByTestId('tarot-spread-preview').locator('span')).toHaveCount(1);

  await cardCount.selectOption('12');
  await expect(template).toHaveValue('template-12');
  await expect(panel.getByTestId('tarot-spread-preview').locator('span')).toHaveCount(12);
  await expect(panel.locator('details')).toHaveCount(12);
  await expect(panel.getByText('January', { exact: true })).toBeVisible();

  await panel.getByTestId('insert-tarot-spread').click();
  await expect.poll(async () => {
    const state = await snapshot(page);
    return state.objects.filter((object: any) => object.type === 'group').length;
  }).toBe(12);

  // The cards are separate Fabric groups, not a flattened raster.
  const state = await snapshot(page);
  const cards = state.objects.filter((object: any) => object.type === 'group');
  expect(new Set(cards.map((card: any) => card.id)).size).toBe(12);
  expect(cards.every((card: any) => card.selectable !== false)).toBe(true);
});
