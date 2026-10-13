import { expect, test } from './test-fixtures';

const expectPageFitsWorkspace = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Fit page' }).click();
  await expect.poll(async () => page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>('[data-testid="document-workspace"]');
    const sheet = document.querySelector<HTMLElement>('[data-testid="document-page"]');
    const zoom = document.querySelector<HTMLElement>('[data-testid="document-zoom-controls"]');
    if (!workspace || !sheet || !zoom) return 0;
    const viewport = workspace.getBoundingClientRect();
    const pageRect = sheet.getBoundingClientRect();
    const zoomRect = zoom.getBoundingClientRect();
    const usableHeight = workspace.clientHeight - 48;
    const inside = pageRect.top >= viewport.top + 20
      && pageRect.bottom <= viewport.bottom - 20
      && pageRect.left >= viewport.left + 16
      && pageRect.right <= viewport.right - 16
      && zoomRect.top >= viewport.bottom - 1;
    return inside ? pageRect.height / usableHeight : 0;
  })).toBeGreaterThan(0.84);
};

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1697, height: 863 },
]) {
  test(`keeps the document page primary at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.getByTestId('dashboard-new-document').click();
    await expect(page.getByTestId('document-editor-shell')).toBeVisible();

    const layout = page.locator('.document-editor-layout');
    const stage = page.getByTestId('document-editor-stage');
    const workspace = page.getByTestId('document-workspace');
    const inspector = page.getByTestId('document-publishing-inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector).toHaveAttribute('data-collapsed', 'false');
    expect(await inspector.evaluate((element) => element.parentElement === document.querySelector('.document-editor-layout'))).toBe(true);

    const initial = await workspace.boundingBox();
    const stageBox = await stage.boundingBox();
    const inspectorBox = await inspector.boundingBox();
    expect(initial).not.toBeNull();
    expect(stageBox).not.toBeNull();
    expect(inspectorBox).not.toBeNull();
    expect(Math.abs(inspectorBox!.y - stageBox!.y)).toBeLessThan(1);
    expect(Math.abs(inspectorBox!.height - stageBox!.height)).toBeLessThan(2);
    expect(inspectorBox!.x).toBeGreaterThanOrEqual(stageBox!.x + stageBox!.width - 1);

    await expectPageFitsWorkspace(page);
    const workspaceTop = (await workspace.boundingBox())!.y;
    await page.getByRole('tab', { name: 'Document' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Pages' })).toHaveAttribute('aria-selected', 'true');
    expect(Math.abs((await workspace.boundingBox())!.y - workspaceTop)).toBeLessThan(1);
    for (const tab of ['Document', 'Writing', 'Pages']) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.getByRole('tabpanel')).toBeVisible();
      expect(Math.abs((await workspace.boundingBox())!.y - workspaceTop)).toBeLessThan(1);
    }

    // Page settings and publishing controls share the workspace without changing its vertical position.
    await page.getByTestId('document-page-preset').selectOption('a4');
    expect(Math.abs((await workspace.boundingBox())!.y - workspaceTop)).toBeLessThan(1);
    await page.getByTestId('document-image-file-input').setInputFiles('e2e/fixtures/publishing-botanical.png');
    await expect(page.locator('.document-flow-prosemirror img')).toHaveCount(1);
    expect(Math.abs((await workspace.boundingBox())!.y - workspaceTop)).toBeLessThan(1);
    await expectPageFitsWorkspace(page);

    const expandedWidth = (await workspace.boundingBox())!.width;
    await page.getByRole('button', { name: 'Collapse publishing tools' }).click();
    await expect(inspector).toHaveAttribute('data-collapsed', 'true');
    await expect.poll(async () => (await workspace.boundingBox())!.width).toBeGreaterThan(expandedWidth + 250);
    expect(Math.abs((await workspace.boundingBox())!.y - workspaceTop)).toBeLessThan(1);
    await expectPageFitsWorkspace(page);

    await page.getByRole('button', { name: 'Expand publishing tools' }).click();
    await expect(inspector).toHaveAttribute('data-collapsed', 'false');
    await expectPageFitsWorkspace(page);
  });
}
