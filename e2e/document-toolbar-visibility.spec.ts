import { expect, test } from './test-fixtures';

test('keeps text formatting available through page changes, workspace scrolling, sidebars, and reload', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await page.getByTestId('dashboard-new-document').click();

  const toolbar = page.getByTestId('document-context-toolbar');
  const workspace = page.getByTestId('document-workspace');
  const expectFormattingControls = async () => {
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByTestId('document-font-size')).toBeVisible();
    await expect(toolbar.getByLabel('Text style')).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Bold' })).toBeVisible();
    const box = await toolbar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBe(58);
    return box!.y;
  };

  await page.getByTestId('document-project-name').fill('Toolbar visibility regression');
  const firstToolbarY = await expectFormattingControls();
  const body = page.locator('.document-flow-prosemirror').first();
  await body.fill('A guide paragraph that remains editable after changing focus.');
  await expectFormattingControls();

  await page.getByRole('tab', { name: 'Pages' }).click();
  await page.getByRole('button', { name: 'Add guide design' }).click();
  await expect(page.getByTestId('document-page-navigation').getByRole('tab'))
    .toHaveCount(2);
  await page.getByTestId('document-page-tab-1').click();
  const secondPageBody = page.locator('.document-flow-prosemirror').first();
  await secondPageBody.locator('p').first().fill('A second page with a saved guide paragraph.');
  await expectFormattingControls();
  await page.getByTestId('document-page-tab-0').click();
  await page.getByTestId('document-page-tab-1').click();
  await expectFormattingControls();

  await page.getByRole('button', { name: 'Collapse properties sidebar' }).click();
  await page.getByRole('button', { name: 'Collapse publishing tools' }).click();
  const collapsedToolbarY = await expectFormattingControls();
  expect(collapsedToolbarY).toBe(firstToolbarY);

  await page.setViewportSize({ width: 1697, height: 863 });
  const resizedToolbarY = await expectFormattingControls();
  expect(resizedToolbarY).toBe(firstToolbarY);
  await page.getByTestId('document-zoom-controls')
    .getByRole('button', { name: 'Zoom in' }).click();
  await page.getByTestId('document-zoom-controls')
    .getByRole('button', { name: 'Zoom in' }).click();
  await workspace.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => workspace.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  const scrolledToolbarY = await expectFormattingControls();
  expect(scrolledToolbarY).toBe(firstToolbarY);

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('document-save-status')).toHaveText('Saved');
  await page.getByRole('button', { name: 'Back to projects' }).click();
  const projectCard = page.getByTestId('dashboard-project-card')
    .filter({ hasText: 'Toolbar visibility regression' });
  await projectCard.getByRole('button', { name: /open/i }).click();
  await page.reload();

  const editorStillOpen = await page.getByTestId('document-editor-shell')
    .isVisible().catch(() => false);
  if (!editorStillOpen) {
    await page.getByTestId('dashboard-project-card')
      .filter({ hasText: 'Toolbar visibility regression' })
      .getByRole('button', { name: /open/i }).click();
  }
  await expect(page.getByTestId('document-editor-shell')).toBeVisible();
  await page.getByTestId('document-page-tab-1').click();
  await expect(page.locator('.document-flow-prosemirror').first())
    .toContainText('A second page with a saved guide paragraph.');
  await expectFormattingControls();
});
