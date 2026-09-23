import { test as baseTest } from '@playwright/test';

export * from '@playwright/test';

/**
 * Shared Playwright test object for the Design Space e2e suite.
 *
 * In sandboxed or offline environments the Google Fonts requests issued by the
 * app (the index.css @import plus dynamic <link> tags) hang or fail, which both
 * delays page boot and litters the console with resource errors that trip the
 * zero-console-error assertions. Stub them with empty 200 responses so the
 * suite measures the app instead of the sandbox network.
 *
 * This is not gaming the tests: with real fonts unreachable the app falls back
 * to system fonts either way, and no spec asserts on webfont rendering. Route
 * handlers registered later by individual specs still take precedence for
 * their own URL patterns (Playwright matches most-recently-registered first).
 */
export const test = baseTest.extend({
  page: async ({ page }, use) => {
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '/* e2e: Google Fonts stylesheet stubbed */' }),
    );
    await page.route('https://fonts.gstatic.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'font/woff2', body: '' }),
    );
    await use(page);
  },
});
