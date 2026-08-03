import { expect, test, type Page } from '@playwright/test';
import { createHistoricalBookFixtureProject } from '../src/document/fixtures/historicalBookFixtures';

const loadHistoricalFixture = async (page: Page) => {
  const fixture = createHistoricalBookFixtureProject();
  const page49Body = fixture.pages[0].bodyContent as {
    type: string;
    content?: Array<Record<string, unknown>>;
  };
  const wrappedImage = page49Body.content?.find(
    (node) => node.type === 'documentFlowImage'
  );
  page49Body.content = [
    ...Array.from({ length: 18 }, (_, index) => ({
      type: 'paragraph',
      attrs: { documentStyleId: 'body' },
      content: [{
        type: 'text',
        text: `Satzspalte ${index + 1}. ${'Der Beispieltext fliesst durch die drei sichtbaren Spalten und bleibt editierbar. '.repeat(5)}`,
      }],
    })),
    ...(wrappedImage ? [wrappedImage] : []),
    ...Array.from({ length: 8 }, (_, index) => ({
      type: 'paragraph',
      attrs: { documentStyleId: 'body' },
      content: [{
        type: 'text',
        text: `Fortsetzung ${index + 1}. ${'Der Text steht unterhalb der Abbildung und prüft die Rückkehr in die Dokumentreihenfolge. '.repeat(4)}`,
      }],
    })),
  ];
  await page.goto('/');
  await page.getByTestId('dashboard-open-file-input').setInputFiles({
    name: 'historical-book-pages-49-52-hit-testing.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(page.getByTestId('document-editor-shell')).toBeVisible();
  await page.getByTestId('document-page-tab-0').click();
  await expect(page.locator('[data-document-span-layout]')).toBeVisible();
};

type VisibleTextPoint = {
  x: number;
  y: number;
  expectedPosition: number;
  text: string;
};

type VisibleTextSpan = {
  start: VisibleTextPoint;
  end: VisibleTextPoint;
  expectedText: string;
  regionCount: number;
};

const getVisibleTextPoint = async (
  page: Page,
  column: number,
  edge: 'start' | 'end' = 'start'
): Promise<VisibleTextPoint> => page.locator(
  `[data-document-span-layout] [data-document-region-id][data-column="${column}"]`
).evaluateAll((regions, requestedEdge) => {
  for (const region of regions) {
    const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent || '';
      if (text.trim().length > 0) {
        const sourceElement = (node.parentElement || region).closest<HTMLElement>(
          '[data-document-from][data-document-to]'
        );
        if (!sourceElement) {
          node = walker.nextNode();
          continue;
        }
        const sourceFrom = Number(sourceElement.dataset.documentFrom);
        const sourceOffsetRange = document.createRange();
        sourceOffsetRange.selectNodeContents(sourceElement);
        sourceOffsetRange.setEnd(node, 0);
        const sourceTextOffset = sourceOffsetRange.toString().length;
        const range = document.createRange();
        const offset = requestedEdge === 'end' ? text.length : 0;
        if (requestedEdge === 'end' && text.length > 0) {
          range.setStart(node, text.length - 1);
          range.setEnd(node, text.length);
        } else {
          range.setStart(node, offset);
          range.collapse(true);
        }
        const rects = range.getClientRects();
        const rect = requestedEdge === 'end'
          ? rects[rects.length - 1] || range.getBoundingClientRect()
          : rects[0] || range.getBoundingClientRect();
        if (rect.width || rect.height) {
          return {
            x: requestedEdge === 'end'
              ? rect.right + 1
              : rect.left + 2,
            y: rect.top + rect.height / 2,
            expectedPosition: sourceFrom + sourceTextOffset + offset,
            text,
          };
        }
      }
      node = walker.nextNode();
    }
  }
  throw new Error('No visible text in requested column');
}, edge);

const getVisibleTextSpan = async (
  page: Page,
  column: number,
  region: 'first' | 'last' = 'first'
): Promise<VisibleTextSpan> => page.locator(
  `[data-document-span-layout] [data-document-region-id][data-column="${column}"]`
).evaluateAll((regions, requestedRegion) => {
  const usable = regions.filter((candidate) => (candidate.textContent || '').trim());
  const selectedRegion = requestedRegion === 'last'
    ? usable[usable.length - 1]
    : usable[0];
  if (!selectedRegion) throw new Error('No usable text region');
  const walker = document.createTreeWalker(selectedRegion, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();
  if (!node) throw new Error('No text node in region');
  const text = node.textContent || '';
  const sourceElement = (node.parentElement || selectedRegion).closest<HTMLElement>(
    '[data-document-from][data-document-to]'
  );
  if (!sourceElement) throw new Error('Text node has no source range');
  const sourceFrom = Number(sourceElement.dataset.documentFrom);
  const sourceOffsetRange = document.createRange();
  sourceOffsetRange.selectNodeContents(sourceElement);
  sourceOffsetRange.setEnd(node, 0);
  const sourceTextOffset = sourceOffsetRange.toString().length;
  const length = Math.min(24, text.length);
  const startRange = document.createRange();
  if (length > 0) {
    startRange.setStart(node, 0);
    startRange.setEnd(node, 1);
  } else {
    startRange.setStart(node, 0);
    startRange.collapse(true);
  }
  const endRange = document.createRange();
  if (length > 0) {
    endRange.setStart(node, length - 1);
    endRange.setEnd(node, length);
  } else {
    endRange.setStart(node, 0);
    endRange.collapse(true);
  }
  const startRects = startRange.getClientRects();
  const endRects = endRange.getClientRects();
  const startRect = startRects[0] || startRange.getBoundingClientRect();
  const endRect = endRects[endRects.length - 1] || endRange.getBoundingClientRect();
  if ((!startRect.width && !startRect.height) || (!endRect.width && !endRect.height)) {
    throw new Error('Text range has no visible rectangle');
  }
  return {
    start: {
      x: startRect.left + 2,
      y: startRect.top + startRect.height / 2,
      expectedPosition: sourceFrom + sourceTextOffset,
      text,
    },
    end: {
      x: endRect.right + 1,
      y: endRect.top + endRect.height / 2,
      expectedPosition: sourceFrom + sourceTextOffset + length,
      text,
    },
    expectedText: text.slice(0, length),
    regionCount: usable.length,
  };
}, region);

const setZoomNear = async (page: Page, targetPercent: number) => {
  const controls = page.getByTestId('document-zoom-controls');
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const current = Number.parseInt(
      await page.getByTestId('document-zoom-indicator').textContent() || '100',
      10
    );
    if (Math.abs(current - targetPercent) <= 5) return current;
    await controls.getByRole('button', {
      name: current < targetPercent ? 'Zoom in' : 'Zoom out',
    }).click();
  }
  return Number.parseInt(
    await page.getByTestId('document-zoom-indicator').textContent() || '100',
    10
  );
};

const readStructuredLayoutContract = async (page: Page) => page.locator(
  '[data-document-span-layout]'
).evaluate((root) => ({
  renderedBands: (() => {
    const rootRect = root.getBoundingClientRect();
    const round = (value: number) => Math.round(value * 100) / 100;
    return Array.from(root.querySelectorAll<HTMLElement>(
      '[data-layout-role="explicit-text-column"]'
    )).map((band) => {
      const rect = band.getBoundingClientRect();
      return {
        left: round(rect.left - rootRect.left),
        top: round(rect.top - rootRect.top),
        width: round(rect.width),
        height: round(rect.height),
        lines: Array.from(band.querySelectorAll<HTMLElement>('p')).map((p) => {
          const lineRect = p.getBoundingClientRect();
          return {
            top: round(lineRect.top - rootRect.top),
            height: round(lineRect.height),
          };
        }),
      };
    });
  })(),
  width: root.getAttribute('data-layout-available-width-px'),
  height: root.getAttribute('data-layout-available-height-px'),
  columnWidth: root.getAttribute('data-column-width-px'),
  columnCount: root.getAttribute('data-column-count'),
  exclusions: root.getAttribute('data-layout-exclusions'),
  textBands: root.getAttribute('data-layout-text-bands'),
  contentHeight: root.getAttribute('data-layout-content-height-px'),
  overflowing: root.getAttribute('data-layout-overflowing'),
  text: Array.from(root.querySelectorAll(
    '[data-layout-role="explicit-text-column"]'
  )).map((region) => region.textContent || ''),
}));

test.describe('structured text hit testing', () => {
  test.describe.configure({ timeout: 120_000 });
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('maps visible columns to ProseMirror positions and selection text', async ({ page }) => {
    await loadHistoricalFixture(page);
    const layout = page.locator('[data-document-span-layout]');

    const columnPoints = await Promise.all([
      getVisibleTextPoint(page, 1),
      getVisibleTextPoint(page, 2),
      getVisibleTextPoint(page, 3),
    ]);
    for (const point of columnPoints) {
      await page.mouse.click(point.x, point.y);
      await expect.poll(async () => Number(
        await layout.getAttribute('data-document-selection-from')
      )).toBe(point.expectedPosition);
    }
  });

  test('maps drags, copy, caret, and highlights across wrapped columns at zoom levels', async ({ page }) => {
    test.slow();
    test.setTimeout(180_000);
    await loadHistoricalFixture(page);
    const layout = page.locator('[data-document-span-layout]');

    for (const targetZoom of [66, 100, 150]) {
      const actualZoom = await setZoomNear(page, targetZoom);
      expect(Math.abs(actualZoom - targetZoom)).toBeLessThanOrEqual(5);
      const idleLayout = await readStructuredLayoutContract(page);

      const columnThreeSpan = await getVisibleTextSpan(page, 3, 'first');
      const columnThreeRegions = await layout.locator(
        '[data-document-region-id][data-column="3"]'
      ).count();
      expect(columnThreeSpan.regionCount).toBeGreaterThan(0);
      expect(columnThreeRegions).toBeGreaterThan(0);

      await page.mouse.move(columnThreeSpan.start.x, columnThreeSpan.start.y);
      await page.mouse.down();
      await page.mouse.move(columnThreeSpan.end.x, columnThreeSpan.end.y);
      await page.mouse.up();
      await expect.poll(async () => layout.getAttribute(
        'data-document-selection-text'
      )).toBe(columnThreeSpan.expectedText);
      await expect(page.locator(
        '.document-flow-editor__content--structured-text-editing'
      )).toHaveCSS('pointer-events', 'none');
      expect(Number(await layout.getAttribute('data-document-selection-from')))
        .toBe(columnThreeSpan.start.expectedPosition);
      expect(Number(await layout.getAttribute('data-document-selection-to')))
        .toBe(columnThreeSpan.end.expectedPosition);
      expect(await readStructuredLayoutContract(page)).toEqual(idleLayout);
      await expect(layout.locator('.document-structured-selection-highlight'))
        .not.toHaveCount(0);
      const highlightedText = await layout.locator(
        '.document-structured-selection-highlight'
      ).allTextContents();
      expect(highlightedText.join('')).toContain(
        columnThreeSpan.expectedText.slice(0, 12)
      );

      let copiedText = '';
      await page.evaluate(() => {
        document.addEventListener('copy', (event) => {
          (window as Window & { __structuredCopiedText?: string }).__structuredCopiedText =
            event.clipboardData?.getData('text/plain') || '';
        }, { once: true });
      });
      await page.keyboard.press('Control+c');
      copiedText = await page.evaluate(() => (
        (window as Window & { __structuredCopiedText?: string }).__structuredCopiedText || ''
      ));
      expect(copiedText).toBe(columnThreeSpan.expectedText);

      const caretPoint = await getVisibleTextPoint(page, 3, 'start');
      await page.mouse.click(caretPoint.x, caretPoint.y);
      await expect(layout.locator('.document-structured-caret')).not.toHaveCount(0);
      expect(Number(await layout.getAttribute('data-document-selection-from')))
        .toBe(caretPoint.expectedPosition);

      const exclusionsBeforeImageClick = await layout.getAttribute(
        'data-layout-exclusions'
      );
      const imageSlot = layout.locator(
        '[data-layout-role="occupied-columns"]'
      ).first();
      await imageSlot.click();
      await expect(layout).toHaveAttribute('data-image-selected', 'true');
      expect(await layout.getAttribute('data-layout-exclusions'))
        .toBe(exclusionsBeforeImageClick);
      await layout.locator(
        '[data-document-region-id][data-column="3"] p'
      ).first().scrollIntoViewIfNeeded();
      const textAfterImageClick = await getVisibleTextPoint(page, 3, 'start');
      await page.mouse.click(textAfterImageClick.x, textAfterImageClick.y);
      await expect(layout).toHaveAttribute('data-text-editing', 'true');
      expect(Number(await layout.getAttribute('data-document-selection-from')))
        .toBe(textAfterImageClick.expectedPosition);
      expect(await readStructuredLayoutContract(page)).toEqual(idleLayout);

      const columnOneEnd = await getVisibleTextPoint(page, 1, 'end');
      const columnTwoStart = await getVisibleTextPoint(page, 2, 'start');
      await page.mouse.move(columnOneEnd.x, columnOneEnd.y);
      await page.mouse.down();
      await page.mouse.move(columnTwoStart.x, columnTwoStart.y);
      await page.mouse.up();
      await expect.poll(async () => Number(
        await layout.getAttribute('data-document-selection-from')
      )).toBeLessThan(Number(await layout.getAttribute('data-document-selection-to')));
      expect(await layout.getAttribute('data-document-selection-text'))
        .toContain('Satzspalte');
      expect(await readStructuredLayoutContract(page)).toEqual(idleLayout);

      const columnTwoEnd = await getVisibleTextPoint(page, 2, 'end');
      const columnThreeStart = await getVisibleTextPoint(page, 3, 'start');
      await page.mouse.move(columnTwoEnd.x, columnTwoEnd.y);
      await page.mouse.down();
      await page.mouse.move(columnThreeStart.x, columnThreeStart.y);
      await page.mouse.up();
      await expect.poll(async () => Number(
        await layout.getAttribute('data-document-selection-from')
      )).toBeLessThan(Number(await layout.getAttribute('data-document-selection-to')));
      expect(await layout.getAttribute('data-document-selection-text'))
        .toContain('Satzspalte');
      expect(await readStructuredLayoutContract(page)).toEqual(idleLayout);
    }
  });
});
