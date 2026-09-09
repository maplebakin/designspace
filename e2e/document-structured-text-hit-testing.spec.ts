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
  fragmentId: string;
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
        const fragmentId = sourceElement.dataset.documentFragmentId;
        if (!fragmentId) {
          node = walker.nextNode();
          continue;
        }
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
            fragmentId,
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
  const fragmentId = sourceElement.dataset.documentFragmentId;
  if (!fragmentId) throw new Error('Text node has no fragment identity');
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
      fragmentId,
    },
    end: {
      x: endRect.right + 1,
      y: endRect.top + endRect.height / 2,
      expectedPosition: sourceFrom + sourceTextOffset + length,
      text,
      fragmentId,
    },
    expectedText: text.slice(0, length),
    regionCount: usable.length,
  };
}, region);

const getVisibleTextCharacterPoint = async (
  page: Page,
  column: number,
  characterOffset: number
): Promise<VisibleTextPoint> => page.locator(
  `[data-document-span-layout] [data-document-region-id][data-column="${column}"]`
).evaluateAll((regions, requestedOffset) => {
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
        const fragmentId = sourceElement.dataset.documentFragmentId;
        if (!fragmentId) {
          node = walker.nextNode();
          continue;
        }
        const offset = Math.max(
          0,
          Math.min(text.length - 1, requestedOffset)
        );
        const sourceOffsetRange = document.createRange();
        sourceOffsetRange.selectNodeContents(sourceElement);
        sourceOffsetRange.setEnd(node, 0);
        const sourceTextOffset = sourceOffsetRange.toString().length;
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const rect = range.getClientRects()[0] || range.getBoundingClientRect();
        if (rect.width || rect.height) {
          return {
            x: rect.left + 1,
            y: rect.top + rect.height / 2,
            expectedPosition: sourceFrom + sourceTextOffset + offset,
            text,
            fragmentId,
          };
        }
      }
      node = walker.nextNode();
    }
  }
  throw new Error('No visible text character in requested column');
}, characterOffset);

const getActiveLiveTextPoint = async (
  page: Page,
  characterOffset: number
): Promise<{ x: number; y: number }> => page.evaluate((requestedOffset) => {
  const layout = document.querySelector<HTMLElement>('[data-document-span-layout]');
  const viewport = document.querySelector<HTMLElement>(
    '.document-flow-editor__active-fragment-viewport'
  );
  const block = document.querySelector<HTMLElement>(
    '.document-flow-prosemirror > .document-active-fragment-block'
  );
  const activeFragmentId = layout?.dataset.activeEditFragmentId;
  const activeFragment = activeFragmentId
    ? Array.from(document.querySelectorAll<HTMLElement>(
      '[data-document-span-layout] [data-document-fragment-id]'
    )).find((candidate) => candidate.dataset.documentFragmentId === activeFragmentId)
    : null;
  if (!viewport || !block || !activeFragment) {
    throw new Error('Active live viewport is unavailable');
  }
  const viewportRect = viewport.getBoundingClientRect();
  const activeFrom = Number(activeFragment.dataset.documentFrom);
  const blockFrom = Number(activeFragment.dataset.documentBlockFrom);
  const targetOffset = Math.max(0, activeFrom - blockFrom + requestedOffset);
  const targetEndOffset = targetOffset + Math.max(
    1,
    Number(activeFragment.dataset.documentTo) - activeFrom
  );
  let textOffset = 0;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent || '';
    const nodeStart = textOffset;
    const nodeEnd = nodeStart + text.length;
    const visibleStart = Math.max(nodeStart, targetOffset);
    const visibleEnd = Math.min(nodeEnd, targetEndOffset);
    for (let offset = visibleStart; offset < visibleEnd; offset += 1) {
      const localOffset = offset - nodeStart;
      const range = document.createRange();
      range.setStart(node, localOffset);
      range.setEnd(node, localOffset + 1);
      const rect = range.getClientRects()[0] || range.getBoundingClientRect();
      if (
        rect.width > 0
        && rect.height > 0
        && rect.right > viewportRect.left
        && rect.left < viewportRect.right
        && rect.bottom > viewportRect.top
        && rect.top < viewportRect.bottom
      ) {
        const x = Math.max(viewportRect.left + 1, rect.left + rect.width / 2);
        const y = Math.max(viewportRect.top + 1, rect.top + rect.height / 2);
        if (document.elementFromPoint(x, y)?.closest('.document-flow-prosemirror')) {
          return { x, y };
        }
      }
    }
    textOffset = nodeEnd;
    node = walker.nextNode();
  }
  throw new Error('Requested active-fragment text is not visible inside the viewport');
}, characterOffset);

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

const readLocalEditingPresentation = async (page: Page) => page.locator(
  '[data-document-span-layout]'
).evaluate((layout) => {
  const round = (value: number) => Math.round(value * 100) / 100;
  const layoutRect = layout.getBoundingClientRect();
  const rect = (element: Element) => {
    const bounds = element.getBoundingClientRect();
    return {
      left: round(bounds.left - layoutRect.left),
      top: round(bounds.top - layoutRect.top),
      width: round(bounds.width),
      height: round(bounds.height),
    };
  };
  const source = layout.closest<HTMLElement>('[data-testid="document-flow-editor"]')
    ?.querySelector<HTMLElement>('.document-flow-prosemirror');
  const viewport = layout.closest<HTMLElement>('[data-testid="document-flow-editor"]')
    ?.querySelector<HTMLElement>('.document-flow-editor__active-fragment-viewport');
  const activeIndexes = (layout.getAttribute('data-active-edit-block-indexes') || '')
    .split(',')
    .filter(Boolean)
    .map(Number);
  const sourceChildren = source
    ? Array.from(source.children).map((child, index) => ({
        index,
        visibility: getComputedStyle(child).visibility,
        position: getComputedStyle(child).position,
        rect: rect(child),
      }))
    : [];
  const activeCanonical = Array.from(layout.querySelectorAll<HTMLElement>(
    '[data-document-fragment-id][data-document-active-edit-fragment="true"]'
  ));
  const canonicalFragments = Array.from(layout.querySelectorAll<HTMLElement>(
    '[data-document-fragment-id]'
  ));
  return {
    columnCount: layout.getAttribute('data-column-count'),
    columns: Array.from(layout.querySelectorAll<HTMLElement>(
      '[data-layout-role="physical-column"]'
    )).map(rect),
    photos: Array.from(layout.querySelectorAll<HTMLElement>(
      '[data-document-visible-image-id] .document-image__frame'
    )).map(rect),
    activeIndexes,
    activeCanonicalCount: activeCanonical.length,
    visibleNonActiveCanonicalCount: canonicalFragments.filter((fragment) => (
      !fragment.matches('[data-document-active-edit-fragment="true"]')
      && getComputedStyle(fragment).visibility === 'visible'
    )).length,
    activeCanonicalRect: activeCanonical.length > 0
      ? rect(activeCanonical[activeCanonical.length - 1])
      : null,
    viewportDiagnostics: (() => {
      const raw = layout.getAttribute('data-active-edit-viewport-diagnostics');
      if (!raw) return null;
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return null;
      }
    })(),
    sourceColumnCount: source ? getComputedStyle(source).columnCount : null,
    viewport: viewport
      ? {
          overflow: getComputedStyle(viewport).overflow,
          rect: rect(viewport),
        }
      : null,
    sourceVisibleChildren: sourceChildren.filter(
      (child) => child.visibility === 'visible'
    ),
    sourceHiddenChildren: sourceChildren.filter(
      (child) => child.visibility === 'hidden'
    ),
    sourceChildren,
  };
});

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
      await expect(layout).toHaveAttribute(
        'data-active-edit-fragment-id',
        point.fragmentId
      );
    }
  });

  test('keeps canonical columns visible while a fragment-level ProseMirror edit surface is active', async ({ page }) => {
    test.slow();
    await loadHistoricalFixture(page);
    const layout = page.locator('[data-document-span-layout]');
    const body = page.locator('.document-flow-prosemirror');
    const before = await readLocalEditingPresentation(page);
    expect(before.columnCount).toBe('3');
    expect(before.columns).toHaveLength(3);

    const firstColumnPoint = await getVisibleTextPoint(page, 1);
    await page.mouse.click(firstColumnPoint.x, firstColumnPoint.y);
    await expect(layout).toHaveAttribute('data-text-editing', 'true');
    const editing = await readLocalEditingPresentation(page);
    expect(editing.sourceColumnCount).toBe('1');
    expect(editing.activeIndexes.length).toBeGreaterThan(0);
    expect(editing.activeCanonicalCount).toBeGreaterThan(0);
    expect(editing.visibleNonActiveCanonicalCount).toBeGreaterThan(0);
    expect(editing.sourceVisibleChildren).toHaveLength(editing.activeIndexes.length);
    expect(editing.sourceHiddenChildren.length).toBeGreaterThan(0);
    expect(editing.viewport?.overflow).toBe('hidden');
    expect(editing.viewport?.rect.width).toBeGreaterThan(0);
    expect(await layout.getAttribute('data-document-drop-cap')).toBe('true');
    const liveRangeRect = editing.viewportDiagnostics?.finalLiveRangeClientRect as {
      left: number;
      top: number;
      right: number;
      bottom: number;
    } | null | undefined;
    const canonicalRangeRect = editing.viewportDiagnostics?.canonicalFragmentClientRect as {
      left: number;
      top: number;
      right: number;
      bottom: number;
    } | null | undefined;
    expect(liveRangeRect).not.toBeNull();
    expect(canonicalRangeRect).not.toBeNull();
    expect(Math.abs((liveRangeRect?.left || 0) - (canonicalRangeRect?.left || 0)))
      .toBeLessThan(3);
    expect(Math.abs((liveRangeRect?.top || 0) - (canonicalRangeRect?.top || 0)))
      .toBeLessThan(3);
    expect(Math.abs((liveRangeRect?.right || 0) - (canonicalRangeRect?.right || 0)))
      .toBeLessThan(3);
    expect(editing.activeCanonicalRect).not.toBeNull();
    const activeSourceRect = editing.sourceVisibleChildren[0]?.rect;
    expect(activeSourceRect).not.toBeUndefined();
    expect(Math.abs(
      (activeSourceRect?.left || 0) - (editing.activeCanonicalRect?.left || 0)
    )).toBeLessThan(3);
    expect(Math.abs(
      (activeSourceRect?.top || 0) - (editing.activeCanonicalRect?.top || 0)
    )).toBeLessThan(3);
    expect(Math.abs(
      (activeSourceRect?.width || 0) - (editing.activeCanonicalRect?.width || 0)
    )).toBeLessThan(3);
    await expect(page.locator(
      '.document-flow-editor__active-fragment-viewport'
    )).toHaveScreenshot('active-fragment-viewport.png', {
      animations: 'disabled',
      caret: 'hide',
    });

    await body.type(' local editing remains responsive', { delay: 10 });
    await expect(body).toContainText('local editing remains responsive');
    const duringTyping = await readLocalEditingPresentation(page);
    expect(duringTyping.columnCount).toBe('3');
    expect(duringTyping.sourceColumnCount).toBe('1');
    expect(duringTyping.columns).toEqual(before.columns);
    expect(duringTyping.photos).toEqual(before.photos);
    expect(duringTyping.sourceVisibleChildren).toHaveLength(
      duringTyping.activeIndexes.length
    );
    expect(duringTyping.viewport?.overflow).toBe('hidden');

    const thirdColumnPoint = await getVisibleTextPoint(page, 3);
    await page.mouse.click(thirdColumnPoint.x, thirdColumnPoint.y);
    await expect.poll(async () => Number(
      await layout.getAttribute('data-document-selection-from')
    )).toBe(thirdColumnPoint.expectedPosition);
    const switched = await readLocalEditingPresentation(page);
    expect(switched.activeIndexes.length).toBeGreaterThan(0);
    expect(switched.sourceVisibleChildren).toHaveLength(switched.activeIndexes.length);
    expect(switched.columns).toEqual(before.columns);
    expect(switched.photos).toEqual(before.photos);

    await body.press('End');
    await body.press('Enter');
    await body.type('new local paragraph', { delay: 10 });
    await expect(body).toContainText('new local paragraph');
    const afterEnter = await readLocalEditingPresentation(page);
    expect(afterEnter.sourceColumnCount).toBe('1');
    expect(afterEnter.columns).toEqual(before.columns);
    expect(afterEnter.photos).toEqual(before.photos);
    expect(afterEnter.sourceVisibleChildren.length).toBeGreaterThan(0);
  });

  test('hands active-fragment clicks and native selection to ProseMirror', async ({ page }) => {
    test.slow();
    await loadHistoricalFixture(page);
    const layout = page.locator('[data-document-span-layout]');
    const body = page.locator('.document-flow-prosemirror');
    const firstClick = await getVisibleTextCharacterPoint(page, 1, 0);
    const secondClick = await getVisibleTextCharacterPoint(page, 1, 8);

    await page.mouse.click(firstClick.x, firstClick.y);
    await expect(layout).toHaveAttribute('data-text-editing', 'true');
    await expect.poll(async () => Number(
      await layout.getAttribute('data-document-selection-from')
    )).toBe(firstClick.expectedPosition);

    // The active viewport is now the native event target. No canonical
    // fragment resolver should rewrite this second caret position.
    expect(await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return {
        live: target?.closest('.document-flow-prosemirror') !== null,
        canonical: target?.closest('[data-document-span-layout]') !== null,
      };
    }, secondClick)).toEqual({ live: true, canonical: false });
    await page.mouse.click(secondClick.x, secondClick.y);
    await expect.poll(async () => Number(
      await layout.getAttribute('data-document-selection-from')
    )).toBe(secondClick.expectedPosition);
    await expect(layout).toHaveAttribute('data-document-selection-kind', 'text');
    expect(await page.evaluate(() => {
      const selection = window.getSelection();
      return {
        collapsed: Boolean(selection?.isCollapsed),
        text: selection?.toString() || '',
      };
    })).toEqual({ collapsed: true, text: '' });
    const directCaretRect = await page.evaluate(() => {
      const selection = window.getSelection();
      const range = selection && selection.rangeCount > 0
        ? selection.getRangeAt(0).getBoundingClientRect()
        : null;
      return range && { left: range.left, top: range.top };
    });
    expect(directCaretRect).not.toBeNull();
    expect(Math.abs(directCaretRect!.left - secondClick.x)).toBeLessThan(16);
    expect(Math.abs(directCaretRect!.top - secondClick.y)).toBeLessThan(16);

    // A frozen continuation is still routed by the canonical compositor.
    const frozenContinuation = await getVisibleTextCharacterPoint(page, 3, 4);
    const viewportBeforeSwitch = await page.locator(
      '.document-flow-editor__active-fragment-viewport'
    ).boundingBox();
    expect(viewportBeforeSwitch).not.toBeNull();
    expect(await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return {
        live: target?.closest('.document-flow-prosemirror') !== null,
        canonical: target?.closest('[data-document-span-layout]') !== null,
      };
    }, frozenContinuation)).toEqual({ live: false, canonical: true });
    await page.mouse.click(frozenContinuation.x, frozenContinuation.y);
    await expect.poll(async () => layout.getAttribute(
      'data-active-edit-fragment-id'
    )).toBe(frozenContinuation.fragmentId);
    await expect.poll(async () => Number(
      await layout.getAttribute('data-document-selection-from')
    )).toBe(frozenContinuation.expectedPosition);

    await expect.poll(async () => {
      const viewport = await page.locator(
        '.document-flow-editor__active-fragment-viewport'
      ).boundingBox();
      if (!viewport || !viewportBeforeSwitch) return 0;
      return Math.max(
        Math.abs(viewport.x - viewportBeforeSwitch.x),
        Math.abs(viewport.y - viewportBeforeSwitch.y),
        Math.abs(viewport.width - viewportBeforeSwitch.width),
        Math.abs(viewport.height - viewportBeforeSwitch.height)
      );
    }).toBeGreaterThan(20);
    await expect.poll(async () => {
      const viewport = await page.locator(
        '.document-flow-editor__active-fragment-viewport'
      ).boundingBox();
      const canonical = await layout.evaluate((root, fragmentId) => {
        const element = Array.from(root.querySelectorAll<HTMLElement>(
          '[data-document-fragment-id]'
        )).find((candidate) => (
          candidate.dataset.documentFragmentId === fragmentId
        ));
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        };
      }, frozenContinuation.fragmentId);
      if (!viewport || !canonical) return Number.POSITIVE_INFINITY;
      return Math.max(
        Math.abs(viewport.x - canonical.x),
        Math.abs(viewport.y - canonical.y),
        Math.abs(viewport.width - canonical.width),
        Math.abs(viewport.height - canonical.height)
      );
    }).toBeLessThan(10);
    const nativeContinuationClick = await getActiveLiveTextPoint(page, 8);
    await page.mouse.click(nativeContinuationClick.x, nativeContinuationClick.y);
    await expect.poll(async () => Number(
      await layout.getAttribute('data-document-selection-from')
    )).not.toBe(frozenContinuation.expectedPosition);
    const continuationCaretRect = await page.evaluate(() => {
      const selection = window.getSelection();
      const range = selection && selection.rangeCount > 0
        ? selection.getRangeAt(0).getBoundingClientRect()
        : null;
      return range && { left: range.left, top: range.top };
    });
    expect(continuationCaretRect).not.toBeNull();
    expect(Math.abs(continuationCaretRect!.left - nativeContinuationClick.x))
      .toBeLessThan(20);
    expect(Math.abs(continuationCaretRect!.top - nativeContinuationClick.y))
      .toBeLessThan(20);

    await page.keyboard.type('abc');
    await expect(body).toContainText('abc');
    const earlierContinuation = await getActiveLiveTextPoint(page, 0);
    const afterTypingPosition = Number(
      await layout.getAttribute('data-document-selection-from')
    );
    await page.mouse.click(earlierContinuation.x, earlierContinuation.y);
    await expect.poll(async () => Number(
      await layout.getAttribute('data-document-selection-from')
    )).not.toBe(afterTypingPosition);
    await page.keyboard.type('XYZ');
    await expect(body).toContainText('XYZ');

    const doubleClickPoint = await getActiveLiveTextPoint(page, 1);
    await page.mouse.dblclick(doubleClickPoint.x, doubleClickPoint.y);
    await expect.poll(async () => Number(
      await layout.getAttribute('data-document-selection-to')
    )).toBeGreaterThan(Number(
      await layout.getAttribute('data-document-selection-from')
    ));
    expect(await layout.getAttribute('data-document-selection-text')).not.toBe('');

    const dragStart = await getActiveLiveTextPoint(page, 0);
    const dragEnd = await getActiveLiveTextPoint(page, 8);
    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down();
    await page.mouse.move(dragEnd.x, dragEnd.y);
    await page.mouse.up();
    await expect.poll(async () => Number(
      await layout.getAttribute('data-document-selection-to')
    )).toBeGreaterThan(Number(
      await layout.getAttribute('data-document-selection-from')
    ));
    expect(await layout.getAttribute('data-document-selection-text')).not.toBe('');
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
        '.document-flow-editor__active-fragment-viewport'
      )).toHaveCSS('pointer-events', 'auto');
      await expect(page.locator(
        '.document-flow-editor__content--structured-text-editing'
      )).toHaveCSS('pointer-events', 'auto');
      await expect(page.locator(
        '.document-flow-editor__content--structured-text-editing '
        + '.document-flow-prosemirror'
      )).toHaveCSS('pointer-events', 'auto');
      expect(Number(await layout.getAttribute('data-document-selection-from')))
        .toBe(columnThreeSpan.start.expectedPosition);
      expect(Number(await layout.getAttribute('data-document-selection-to')))
        .toBe(columnThreeSpan.end.expectedPosition);
      expect(await readStructuredLayoutContract(page)).toEqual(idleLayout);
      const nativeSelectionText = await page.evaluate(
        () => window.getSelection()?.toString() || ''
      );
      expect(nativeSelectionText).toContain(
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
      const nativeCaret = await page.evaluate(() => {
        const selection = window.getSelection();
        const range = selection && selection.rangeCount > 0
          ? selection.getRangeAt(0).getBoundingClientRect()
          : null;
        return {
          collapsed: Boolean(selection?.isCollapsed),
          text: selection?.toString() || '',
          rect: range && {
            left: range.left,
            top: range.top,
            right: range.right,
            bottom: range.bottom,
          },
        };
      });
      expect(nativeCaret.collapsed).toBe(true);
      expect(nativeCaret.text).toBe('');
      const viewportBox = await page.locator(
        '.document-flow-editor__active-fragment-viewport'
      ).boundingBox();
      expect(viewportBox).not.toBeNull();
      expect(nativeCaret.rect).not.toBeNull();
      const caretTolerance = 8;
      expect(nativeCaret.rect!.left).toBeGreaterThanOrEqual(viewportBox!.x - caretTolerance);
      expect(nativeCaret.rect!.right).toBeLessThanOrEqual(
        viewportBox!.x + viewportBox!.width + caretTolerance
      );
      expect(nativeCaret.rect!.top).toBeGreaterThanOrEqual(viewportBox!.y - caretTolerance);
      expect(nativeCaret.rect!.bottom).toBeLessThanOrEqual(
        viewportBox!.y + viewportBox!.height + caretTolerance
      );

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
      await expect(layout).toHaveAttribute('data-document-selection-kind', 'text');
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
