import { expect, test } from '@playwright/test';

test.describe('startup crash recovery', () => {
  test('opens responsively without touching an abnormally large IndexedDB library', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: {
          estimate: async () => ({
            usage: 2 * 1024 ** 3,
            quota: 4 * 1024 ** 3,
          }),
        },
      });
      const originalOpen = indexedDB.open.bind(indexedDB);
      (window as any).__indexedDbOpenCount = 0;
      indexedDB.open = ((...args: Parameters<IDBFactory['open']>) => {
        (window as any).__indexedDbOpenCount += 1;
        return originalOpen(...args);
      }) as IDBFactory['open'];
    });

    await page.goto('/');

    await expect(page.getByTestId('dashboard-root')).toBeVisible();
    await expect(page.getByTestId('dashboard-library-recovery')).toContainText('Library recovery mode');
    await expect(page.getByTestId('dashboard-library-recovery')).toContainText('2.0 GB');
    expect(await page.evaluate(() => (window as any).__indexedDbOpenCount)).toBe(0);

    const frames = await page.evaluate(() => new Promise<number>((resolve) => {
      let count = 0;
      const started = performance.now();
      const tick = () => {
        count += 1;
        if (performance.now() - started >= 250) resolve(count);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));
    expect(frames).toBeGreaterThan(5);
  });

  test('quarantines corrupt localStorage before Zustand modules hydrate', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: { estimate: async () => ({ usage: 1024, quota: 4 * 1024 ** 3 }) },
      });
      localStorage.setItem('designspace-theme', '{invalid-json');
      localStorage.setItem('designspace-template-migration-v1', 'done');
    });

    await page.goto('/');
    await expect(page.getByTestId('dashboard-root')).toBeVisible();

    const recovery = await page.evaluate(() => ({
      active: localStorage.getItem('designspace-theme'),
      keys: Object.keys(localStorage).filter((key) =>
        key.startsWith('designspace-recovery:designspace-theme:')),
    }));
    expect(recovery.active).toBeNull();
    expect(recovery.keys).toHaveLength(1);
  });
});

test('StrictMode creates one Fabric canvas per editor mount and disposes it', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('dashboard-new-project').click();
  await page.getByTestId('project-preset-us-letter').click();
  await page.waitForFunction(() => (window as any).__DESIGN_SPACE_QA__?.snapshot().canvasReady === true);

  const mounted = await page.evaluate(() => (window as any).__DESIGN_SPACE_CANVAS_DIAGNOSTICS__);
  expect(mounted.active).toBe(1);
  expect(mounted.created - mounted.disposed).toBe(1);

  await page.getByTestId('nav-shapes').click();
  await page.getByTestId('shape-rectangle').click();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByTestId('unsaved-navigation-dialog').getByRole('button', { name: 'Discard Changes' }).click();
  await expect(page.getByTestId('dashboard-root')).toBeVisible();
  await page.waitForFunction(() => (window as any).__DESIGN_SPACE_CANVAS_DIAGNOSTICS__?.active === 0);

  const unmounted = await page.evaluate(() => (window as any).__DESIGN_SPACE_CANVAS_DIAGNOSTICS__);
  expect(unmounted.active).toBe(0);
  expect(unmounted.created).toBe(unmounted.disposed);
});
