import { expect, test, type Page } from '@playwright/test';
import { createScannedReferenceFixture } from './fixtures/scanned-reference-page';

const PHOTO_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAYAAAChS3wfAAAABmJLR0QA/wD/AP+gvaeTAAABa0lEQVRogeWZS5LDIAxEJXyK3GauNadnNuPQzceQbN8KVeJuBNJTlZN8/fzWkhEla7T1LL6+0q2/v77UrZ69jp7NiMwa9/ps6rHqPA7x63XrPVQ3xlX85vn0vrvcMiNKiRolIu41IyKj/q8a13fcNKu4il/tPMY9ZrrVHrN8+vg0txLSAadVX9+s3/KuOvrZrur5QW5lkU8fv3VjOz+19nkL7hJYH2y+xz637mAb7FrhidxbBwC513wKknvzBXJvuCK5t3yA3E9mAI37YQawuJ/MABr36gvkXn2HDmBwr75A7hvCXQdwuG/dWZDcq47IvemQ3JsXkHu7ECT36kXk3jsAyf1yBjC4f5gBEO7XM4DB/cMMoHBvM4DHvRURyb34FST3mgOReysWknvX8bi330CR3FsM5H4yA3Dc9zOAxb2dk8m9+gK5t9yg3OsePO7b/6Dhr8Mc7u9OlxlA4t4uCsp90yC5Vy8i9+r1B7Q45ELbjS61AAAAAElFTkSuQmCC';

type FrameGeometry = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

const openDocumentWithFirstPhoto = async (
  page: Page,
  name: string,
  textRepeat = 30
) => {
  await page.goto('/');
  await page.getByTestId('dashboard-new-document').click();
  await page.getByTestId('document-project-name').fill(name);
  await page.getByRole('button', { name: '3 columns' }).click();
  await page.locator('.document-flow-prosemirror').fill(
    'Text before, between, and after the photographs. '.repeat(textRepeat)
  );
  await page.getByTestId('document-image-file-input').setInputFiles({
    name: 'photo-a.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PHOTO_PNG_BASE64, 'base64'),
  });
  await expect(page.locator('.document-image-node')).toHaveCount(1);
  await page.locator('.document-image-node').click();
};

const configureSelectedSpan = async (
  page: Page,
  {
    xOffset,
    y,
    width = 200,
    caption,
    cropMode = 'fit',
  }: {
    xOffset: number;
    y: number;
    width?: number;
    caption?: string;
    cropMode?: 'fit' | 'fill';
  },
  span: 'span-2' | 'span-3' = 'span-3'
) => {
  await page.getByTestId('document-image-wrap').selectOption(span);
  await page.getByTestId('document-image-vertical-anchor')
    .selectOption('page-position');
  await page.getByTestId('document-image-horizontal-placement')
    .selectOption('custom');
  await page.getByTestId('document-image-x-offset').fill(String(xOffset));
  await page.getByTestId('document-image-y-position').fill(String(y));
  await page.getByLabel('Image width').fill(String(width));
  await page.getByTestId('document-image-crop-mode').selectOption(cropMode);
  if (cropMode === 'fill') {
    await page.getByLabel('Image height').fill('190');
  }
  if (caption !== undefined) {
    await page.getByLabel('Image caption').fill(caption);
  }
};

const addSecondPhoto = async (page: Page) => {
  await page.getByTestId('document-image-file-input').setInputFiles({
    name: 'photo-b.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PHOTO_PNG_BASE64, 'base64'),
  });
  await expect(page.locator('.document-image-node')).toHaveCount(2);
};

const readFrameGeometry = async (
  page: Page,
  imageId: string
): Promise<FrameGeometry> => {
  const frame = page.locator(
    `[data-document-span-layout] [data-document-visible-image-id="${imageId}"][data-document-image-hit-target="true"]`
  );
  await expect(frame).toBeVisible();
  return frame.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  });
};

const clickFrame = async (page: Page, imageId: string, point?: { x: number; y: number }) => {
  const frame = page.locator(
    `[data-document-span-layout] [data-document-visible-image-id="${imageId}"][data-document-image-hit-target="true"]`
  );
  const box = await frame.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(
    point?.x ?? box!.x + box!.width / 2,
    point?.y ?? box!.y + box!.height / 2
  );
};

const assertSelected = async (page: Page, imageId: string) => {
  const layout = page.locator('[data-document-span-layout]');
  const shell = page.getByTestId('document-editor-shell');
  await expect.poll(async () => shell.getAttribute(
    'data-selected-flow-image-id'
  )).toBe(imageId);
  await expect(shell).toHaveAttribute(
    'data-selected-structured-image-ids',
    imageId
  );
  expect(await shell.getAttribute('data-selected-image-group-id')).toBeNull();
  await expect(layout).toHaveAttribute(
    'data-document-selected-image-id',
    imageId
  );
  await expect(page.getByTestId('document-image-inspector'))
    .toHaveAttribute('data-selected-image-id', imageId);
  const spanSlot = layout.locator(
    `[data-layout-role="occupied-columns"][data-image-id="${imageId}"]`
  );
  if (await spanSlot.count() > 0) {
    await expect(spanSlot).toHaveAttribute('data-image-selected', 'true');
    await expect(spanSlot.locator('[data-document-image-frame-chrome="true"]'))
      .toHaveClass(/selected/);
    await expect(spanSlot.getByRole('button', { name: 'Resize image' }))
      .toBeVisible();
    return;
  }
  const flowHitTarget = layout.locator(
    `[data-layout-role="flow-image-hit-target"][data-image-id="${imageId}"]`
  );
  await expect(flowHitTarget).toHaveAttribute('data-image-selected', 'true');
  await expect(flowHitTarget.locator('[data-document-image-frame-chrome="true"]'))
    .toHaveClass(/selected/);
  await expect(flowHitTarget.getByRole('button', { name: 'Resize image' }))
    .toBeVisible();
};

const readVisibleHitTarget = async (
  page: Page,
  point: { x: number; y: number }
) => page.evaluate(({ x, y }) => {
  const target = document.elementFromPoint(x, y);
  return target
    ?.closest<HTMLElement>('[data-document-image-hit-target="true"]')
    ?.dataset.documentVisibleImageId || null;
}, point);

const auditVisibleImageOwner = async (page: Page, imageId: string) =>
  page.evaluate((requestedImageId) => {
    const toRect = (element: Element | null) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('[data-image-id]')
    )
      .filter((element) => element.dataset.imageId === requestedImageId)
      .map((element) => {
        const style = getComputedStyle(element);
        const rect = toRect(element);
        const frame = element.matches('[data-document-image-frame="true"]')
          ? element
          : element.querySelector<HTMLElement>('[data-document-image-frame="true"]');
        const frameRect = toRect(frame);
        return {
          tagName: element.tagName,
          className: element.className,
          rect,
          frameTagName: frame?.tagName || null,
          frameClassName: frame?.className || null,
          frameRect,
          framePointerEvents: frame
            ? getComputedStyle(frame).pointerEvents
            : null,
          display: style.display,
          visibility: style.visibility,
          pointerEvents: style.pointerEvents,
          hitTargetId: element.dataset.documentVisibleImageId || null,
          hitTarget: element.dataset.documentImageHitTarget || null,
          closestTextBand: Boolean(
            element.closest('[data-layout-role="explicit-text-column"]')
          ),
          closestStructuredLayout: Boolean(
            element.closest('[data-document-span-layout]')
          ),
        };
      });
    const visibleCandidates = candidates.filter((candidate) => {
      const rect = candidate.frameRect || candidate.rect;
      return Boolean(
        rect
        && rect.width > 0
        && rect.height > 0
        && candidate.display !== 'none'
        && candidate.visibility !== 'hidden'
      );
    });
    const visibleOwner = visibleCandidates.find((candidate) => candidate.frameRect)
      || visibleCandidates[0]
      || null;
    const visibleRect = visibleOwner?.frameRect || visibleOwner?.rect || null;
    const center = visibleRect
      ? {
        x: visibleRect.left + visibleRect.width / 2,
        y: visibleRect.top + visibleRect.height / 2,
      }
      : null;
    const target = center ? document.elementFromPoint(center.x, center.y) : null;
    const targetImage = target?.closest<HTMLElement>('[data-image-id]');
    const targetHit = target?.closest<HTMLElement>(
      '[data-document-image-hit-target="true"]'
    );
    return {
      candidates,
      visibleCandidates,
      center,
      elementFromPoint: target
        ? {
          tagName: target.tagName,
          className: target.className,
          pointerEvents: getComputedStyle(target).pointerEvents,
        }
        : null,
      elementFromPointImageId: targetImage?.dataset.imageId || null,
      elementFromPointHitTargetId:
        targetHit?.dataset.documentVisibleImageId || null,
      elementFromPointClosestTextBand: Boolean(
        target?.closest('[data-layout-role="explicit-text-column"]')
      ),
    };
  }, imageId);

const readVisiblePhotoFrameIds = async (page: Page) => page.evaluate(() => (
  Array.from(document.querySelectorAll<HTMLElement>(
    '[data-document-span-layout] .document-image__frame'
  ))
    .filter((frame) => {
      const rect = frame.getBoundingClientRect();
      const style = getComputedStyle(frame);
      return (
        rect.width > 0
        && rect.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden'
      );
    })
    .map((frame) => frame.closest<HTMLElement>('[data-image-id]')?.dataset.imageId)
    .filter((imageId): imageId is string => Boolean(imageId))
));

const getVisibleTextStart = async (page: Page, column: number) => page.locator(
  `[data-document-span-layout] [data-document-region-id][data-column="${column}"]`
).evaluateAll((regions) => {
  for (const region of regions) {
    const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent || '';
      if (text.trim()) {
        const sourceElement = (node.parentElement || region).closest<HTMLElement>(
          '[data-document-from][data-document-to]'
        );
        if (!sourceElement) {
          node = walker.nextNode();
          continue;
        }
        const range = document.createRange();
        range.setStart(node, 0);
        range.collapse(true);
        const rect = range.getClientRects()[0] || range.getBoundingClientRect();
        if (rect.width || rect.height) {
          return {
            x: rect.left + 2,
            y: rect.top + rect.height / 2,
            expectedPosition: Number(sourceElement.dataset.documentFrom),
          };
        }
      }
      node = walker.nextNode();
    }
  }
  throw new Error('No visible text in requested column');
});

const assertTextHandoff = async (page: Page, expectedPosition?: number) => {
  const layout = page.locator('[data-document-span-layout]');
  const shell = page.getByTestId('document-editor-shell');
  await expect(layout).toHaveAttribute('data-document-selection-kind', 'text');
  await expect(layout).toHaveAttribute('data-text-editing', 'true');
  if (expectedPosition !== undefined) {
    await expect(layout).toHaveAttribute(
      'data-document-selection-from',
      String(expectedPosition)
    );
  }
  await expect(shell).toHaveAttribute('data-active-text-region', 'body');
  await expect(shell).toHaveAttribute('data-focused-text-region', 'body');
  expect(await shell.getAttribute('data-selected-flow-image-id')).toBeNull();
  expect(await shell.getAttribute('data-selected-flow-image-store-id')).toBeNull();
  expect(await shell.getAttribute('data-selected-structured-image-ids')).toBe('');
  expect(await shell.getAttribute('data-selected-image-group-id')).toBeNull();
  expect(await shell.getAttribute('data-selected-overlay-id')).toBeNull();
  await expect(page.getByTestId('document-image-inspector')).toHaveCount(0);
};

const setupAAsSpanAndAddDefaultB = async (
  page: Page,
  name: string,
  position: {
    xOffset: number;
    y: number;
    width?: number;
    caption?: string;
    cropMode?: 'fit' | 'fill';
  } = { xOffset: 32, y: 160, caption: 'Caption A' },
  textRepeat = 30
) => {
  await openDocumentWithFirstPhoto(page, name, textRepeat);
  const firstImageId = await page.locator('.document-image-node')
    .getAttribute('data-image-id');
  expect(firstImageId).not.toBeNull();
  await configureSelectedSpan(page, position);

  await addSecondPhoto(page);
  const secondImageId = await page.locator('.document-image-node')
    .nth(1)
    .getAttribute('data-image-id');
  expect(secondImageId).not.toBeNull();
  await expect(page.locator('.document-image-node').nth(1))
    .toHaveAttribute('data-wrap', 'float-left');
  await expect(page.locator('[data-document-span-layout]'))
    .toHaveAttribute('data-structured-image-count', '1');
  return {
    firstImageId: firstImageId!,
    secondImageId: secondImageId!,
  };
};

const configureDefaultBAsSpan = async (
  page: Page,
  position: {
    xOffset: number;
    y: number;
    width?: number;
    caption?: string;
    cropMode?: 'fit' | 'fill';
  }
) => {
  await configureSelectedSpan(page, position);
  await expect(page.locator('[data-document-span-layout]'))
    .toHaveAttribute('data-structured-image-count', '2');
};

test.describe('secondary structured photo selection', () => {
  test.describe.configure({ timeout: 120_000 });
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('selects a newly added default photo while another photo spans columns', async ({ page }) => {
    const { firstImageId, secondImageId } = await setupAAsSpanAndAddDefaultB(
      page,
      'Default Photo In Structured Mode'
    );
    expect((await readVisiblePhotoFrameIds(page)).sort()).toEqual(
      [firstImageId, secondImageId].sort()
    );

    await clickFrame(page, firstImageId);
    await assertSelected(page, firstImageId);

    const ownerEvidence = await auditVisibleImageOwner(page, secondImageId);
    console.log('default B owner after fix', JSON.stringify(ownerEvidence));
    expect(ownerEvidence.visibleCandidates.length).toBeGreaterThan(0);
    expect(ownerEvidence.center).not.toBeNull();
    expect(ownerEvidence.elementFromPointImageId).toBe(secondImageId);
    expect(ownerEvidence.elementFromPointHitTargetId).toBe(secondImageId);

    const point = ownerEvidence.center!;
    await page.mouse.click(point.x, point.y);
    await assertSelected(page, secondImageId);
    await expect(page.getByTestId('document-image-inspector'))
      .toHaveAttribute('data-selected-image-id', secondImageId);
    await expect(page.getByTestId('document-image-wrap')).toHaveValue('float-left');
    await expect(page.getByTestId('document-image-crop-mode')).toHaveValue('fit');
    await expect(page.getByTestId('document-image-caption')).toHaveValue('');

    const beforeA = await readFrameGeometry(page, firstImageId);
    const beforeB = await readFrameGeometry(page, secondImageId);
    const defaultBResize = page.locator(
      `[data-layout-role="flow-image-hit-target"][data-image-id="${secondImageId}"]`
    ).getByRole('button', { name: 'Resize image' });
    const resizeBox = await defaultBResize.boundingBox();
    expect(resizeBox).not.toBeNull();
    await page.mouse.move(
      resizeBox!.x + resizeBox!.width / 2,
      resizeBox!.y + resizeBox!.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      resizeBox!.x + resizeBox!.width / 2 - 24,
      resizeBox!.y + resizeBox!.height / 2
    );
    await page.mouse.up();
    await expect.poll(async () => (await readFrameGeometry(page, secondImageId)).width)
      .toBeLessThan(beforeB.width);
    expect(await readFrameGeometry(page, firstImageId)).toEqual(beforeA);

    const textBand = page.locator(
      '[data-document-span-layout] [data-layout-role="explicit-text-column"]'
    ).first();
    const textBox = await textBand.boundingBox();
    expect(textBox).not.toBeNull();
    await page.mouse.click(textBox!.x + 5, textBox!.y + 5);
    await expect(page.locator('[data-document-span-layout]'))
      .toHaveAttribute('data-text-editing', 'true');
    await page.keyboard.type('default B text-mode regression');
    const textModeB = await auditVisibleImageOwner(page, secondImageId);
    console.log('default B owner in text mode', JSON.stringify(textModeB));
    expect(textModeB.center).not.toBeNull();
    await page.mouse.click(textModeB.center!.x, textModeB.center!.y);
    await assertSelected(page, secondImageId);
  });

  test('hands photo selection to far-away text and back with one click', async ({ page }) => {
    const { firstImageId, secondImageId } = await setupAAsSpanAndAddDefaultB(
      page,
      'Photo Text Interaction Handoff',
      { xOffset: 32, y: 160, caption: 'Caption A' },
      120
    );
    const reference = await createScannedReferenceFixture();
    await page.getByTestId('document-reference-file-input').setInputFiles({
      name: 'handoff-reference.pdf',
      mimeType: 'application/pdf',
      buffer: reference.pdf,
    });
    await expect(page.getByTestId('document-reference-layer'))
      .toHaveAttribute('data-reference-image-state', 'loaded');

    // First prove the ordinary newly-added photo is selectable before changing
    // its layout mode, then convert it for the repeated independent switching.
    await clickFrame(page, secondImageId);
    await assertSelected(page, secondImageId);
    await expect(page.getByTestId('document-image-wrap')).toHaveValue('float-left');
    await clickFrame(page, secondImageId);
    await configureSelectedSpan(page, {
      xOffset: 300,
      y: 380,
      width: 180,
      caption: 'Caption B',
    }, 'span-2');
    await clickFrame(page, firstImageId);
    await assertSelected(page, firstImageId);

    const layout = page.locator('[data-document-span-layout]');
    const beforeA = await readFrameGeometry(page, firstImageId);
    const beforeB = await readFrameGeometry(page, secondImageId);
    const selectionOnlyRevision = await layout.getAttribute('data-layout-revision');
    const textPoint = await getVisibleTextStart(page, 1);
    const frameOwner = await page.evaluate((point) => (
      document.elementFromPoint(point.x, point.y)
        ?.closest<HTMLElement>('[data-image-id]')
        ?.dataset.imageId || null
    ), {
      x: beforeA.left + 2,
      y: beforeA.top + 2,
    });
    expect(frameOwner).toBe(firstImageId);
    const textOwner = await page.evaluate((point) => (
      document.elementFromPoint(point.x, point.y)
        ?.closest<HTMLElement>('[data-layout-role="explicit-text-column"]')
        ?.dataset.documentRegionId || null
    ), textPoint);
    expect(textOwner).not.toBeNull();

    await page.mouse.click(textPoint.x, textPoint.y);
    await assertTextHandoff(page, textPoint.expectedPosition);
    expect(await layout.getAttribute('data-layout-revision'))
      .toBe(selectionOnlyRevision);
    expect(await readFrameGeometry(page, firstImageId)).toEqual(beforeA);
    expect(await readFrameGeometry(page, secondImageId)).toEqual(beforeB);

    await page.keyboard.type('XYZ');
    await expect(page.locator('.document-flow-prosemirror'))
      .toContainText('XYZ');
    await assertTextHandoff(page);
    expect(await readFrameGeometry(page, firstImageId)).toEqual(beforeA);
    expect(await readFrameGeometry(page, secondImageId)).toEqual(beforeB);

    const transitions: Array<
      | { kind: 'image'; imageId: string }
      | { kind: 'text'; column: number }
    > = [
      { kind: 'image', imageId: secondImageId },
      { kind: 'text', column: 3 },
      { kind: 'image', imageId: firstImageId },
      { kind: 'text', column: 2 },
      { kind: 'image', imageId: secondImageId },
      { kind: 'text', column: 3 },
      { kind: 'image', imageId: firstImageId },
      { kind: 'text', column: 1 },
    ];
    for (const transition of transitions) {
      const revisionBefore = await layout.getAttribute('data-layout-revision');
      if (transition.kind === 'image') {
        await clickFrame(page, transition.imageId);
        await assertSelected(page, transition.imageId);
      } else {
        const point = await getVisibleTextStart(page, transition.column);
        const textOwner = await page.evaluate((target) => (
          document.elementFromPoint(target.x, target.y)
            ?.closest<HTMLElement>('[data-layout-role="explicit-text-column"]')
            ?.dataset.documentRegionId || null
        ), point);
        expect(textOwner).not.toBeNull();
        await page.mouse.click(point.x, point.y);
        await assertTextHandoff(page, point.expectedPosition);
      }
      const revisionAfter = Number(
        await layout.getAttribute('data-layout-revision')
      );
      // A text-to-photo transition may flush the deferred live-typing
      // composition once. Selection-only transitions themselves do not cause
      // another rebuild.
      expect(revisionAfter - Number(revisionBefore)).toBeGreaterThanOrEqual(0);
      expect(revisionAfter - Number(revisionBefore)).toBeLessThanOrEqual(1);
    }
  });

  test('selects B, resizes and moves only B, and switches A/B through text mode', async ({ page }) => {
    const { firstImageId, secondImageId } = await setupAAsSpanAndAddDefaultB(
      page,
      'Secondary Photo Selection Transform Flow'
    );
    await clickFrame(page, firstImageId);
    await assertSelected(page, firstImageId);
    await clickFrame(page, secondImageId);
    await assertSelected(page, secondImageId);
    await clickFrame(page, firstImageId);
    await assertSelected(page, firstImageId);
    await clickFrame(page, secondImageId);
    await assertSelected(page, secondImageId);
    await configureDefaultBAsSpan(page, { xOffset: 300, y: 360 });
    await assertSelected(page, secondImageId);
    const beforeA = await readFrameGeometry(page, firstImageId);

    await clickFrame(page, secondImageId);
    await assertSelected(page, secondImageId);

    const fitBeforeResize = await readFrameGeometry(page, secondImageId);
    const resizeHandle = page.locator(
      `[data-layout-role="occupied-columns"][data-image-id="${secondImageId}"]`
    ).getByRole('button', { name: 'Resize image' });
    const resizeBox = await resizeHandle.boundingBox();
    expect(resizeBox).not.toBeNull();
    await page.mouse.move(
      resizeBox!.x + resizeBox!.width / 2,
      resizeBox!.y + resizeBox!.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      resizeBox!.x + resizeBox!.width / 2 - 32,
      resizeBox!.y + resizeBox!.height / 2
    );
    await page.mouse.up();
    await expect.poll(async () => (await readFrameGeometry(page, secondImageId)).width)
      .toBeLessThan(fitBeforeResize.width);
    expect(await readFrameGeometry(page, firstImageId)).toEqual(beforeA);

    await page.getByTestId('document-image-crop-mode').selectOption('fill');
    await page.getByLabel('Image height').fill('190');
    await clickFrame(page, secondImageId);
    await assertSelected(page, secondImageId);
    const fillBeforeResize = await readFrameGeometry(page, secondImageId);
    const fillHandle = page.locator(
      `[data-layout-role="occupied-columns"][data-image-id="${secondImageId}"]`
    ).getByRole('button', { name: 'Resize image' });
    const fillBox = await fillHandle.boundingBox();
    expect(fillBox).not.toBeNull();
    await page.mouse.move(fillBox!.x + fillBox!.width / 2, fillBox!.y + fillBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(fillBox!.x + fillBox!.width / 2 - 24, fillBox!.y + fillBox!.height / 2);
    await page.mouse.up();
    await expect.poll(async () => (await readFrameGeometry(page, secondImageId)).width)
      .toBeLessThan(fillBeforeResize.width);
    expect(await readFrameGeometry(page, firstImageId)).toEqual(beforeA);

    const beforeMove = await readFrameGeometry(page, secondImageId);
    await clickFrame(page, secondImageId);
    const movePoint = {
      x: beforeMove.left + beforeMove.width / 2,
      y: beforeMove.top + beforeMove.height / 2,
    };
    await page.mouse.move(movePoint.x, movePoint.y);
    await page.mouse.down();
    await page.mouse.move(movePoint.x + 24, movePoint.y + 28);
    await page.mouse.up();
    await expect.poll(async () => (await readFrameGeometry(page, secondImageId)).top)
      .not.toBe(beforeMove.top);
    expect(await readFrameGeometry(page, firstImageId)).toEqual(beforeA);
    await assertSelected(page, secondImageId);

    await clickFrame(page, firstImageId);
    await assertSelected(page, firstImageId);
    await clickFrame(page, secondImageId);
    await assertSelected(page, secondImageId);
    await clickFrame(page, firstImageId);
    await assertSelected(page, firstImageId);
    await clickFrame(page, secondImageId);
    await assertSelected(page, secondImageId);

    const textBand = page.locator(
      '[data-document-span-layout] [data-layout-role="explicit-text-column"]'
    ).first();
    const textBox = await textBand.boundingBox();
    expect(textBox).not.toBeNull();
    await page.mouse.click(textBox!.x + 5, textBox!.y + 5);
    await expect(page.locator('[data-document-span-layout]'))
      .toHaveAttribute('data-text-editing', 'true');
    await page.keyboard.type('x');
    await clickFrame(page, secondImageId);
    await assertSelected(page, secondImageId);
  });

  test('selects ordinary flow photos in float-left, float-right, and top-bottom modes', async ({ page }) => {
    const { firstImageId, secondImageId } = await setupAAsSpanAndAddDefaultB(
      page,
      'Secondary Photo Ordinary Flow Modes'
    );
    for (const mode of ['float-left', 'float-right', 'top-bottom'] as const) {
      await clickFrame(page, secondImageId);
      await assertSelected(page, secondImageId);
      await page.getByTestId('document-image-wrap').selectOption(mode);
      await expect(page.getByTestId('document-image-wrap')).toHaveValue(mode);
      const evidence = await auditVisibleImageOwner(page, secondImageId);
      expect(evidence.center).not.toBeNull();
      expect(evidence.elementFromPointImageId).toBe(secondImageId);
      expect(evidence.elementFromPointHitTargetId).toBe(secondImageId);
      await page.mouse.click(evidence.center!.x, evidence.center!.y);
      await assertSelected(page, secondImageId);
      await clickFrame(page, firstImageId);
      await assertSelected(page, firstImageId);
      await clickFrame(page, secondImageId);
      await assertSelected(page, secondImageId);
    }
  });

  test('uses the top visible frame for partial overlap and does not hit-test caption flow', async ({ page }) => {
    const { firstImageId, secondImageId } = await setupAAsSpanAndAddDefaultB(
      page,
      'Secondary Photo Overlap Hit Testing',
      { xOffset: 36, y: 150, caption: 'Caption A' }
    );
    await clickFrame(page, firstImageId);
    await assertSelected(page, firstImageId);
    await clickFrame(page, secondImageId);
    await assertSelected(page, secondImageId);
    await configureDefaultBAsSpan(page, { xOffset: 190, y: 220 });
    await assertSelected(page, secondImageId);
    const a = await readFrameGeometry(page, firstImageId);
    const b = await readFrameGeometry(page, secondImageId);
    const overlap = {
      x: Math.max(a.left, b.left) + 12,
      y: Math.max(a.top, b.top) + 12,
    };
    const aOnly = { x: a.left + 12, y: a.top + a.height / 2 };
    const bOnly = { x: b.right - 12, y: b.top + b.height / 2 };
    expect(overlap.x).toBeLessThan(Math.min(a.right, b.right));
    expect(overlap.y).toBeLessThan(Math.min(a.bottom, b.bottom));
    expect(await readVisibleHitTarget(page, bOnly)).toBe(secondImageId);

    await clickFrame(page, secondImageId, bOnly);
    await assertSelected(page, secondImageId);
    await clickFrame(page, secondImageId, overlap);
    await assertSelected(page, secondImageId);
    expect(await readVisibleHitTarget(page, overlap)).toBe(secondImageId);

    await clickFrame(page, firstImageId, aOnly);
    await assertSelected(page, firstImageId);
    await clickFrame(page, firstImageId, overlap);
    await assertSelected(page, firstImageId);
    expect(await readVisibleHitTarget(page, overlap)).toBe(firstImageId);

    await clickFrame(page, secondImageId, bOnly);
    await assertSelected(page, secondImageId);
    await clickFrame(page, firstImageId, aOnly);
    await assertSelected(page, firstImageId);
  });

  test('resolves default B by ID after text insertion changes its document position', async ({ page }) => {
    const { firstImageId, secondImageId } = await setupAAsSpanAndAddDefaultB(
      page,
      'Default Photo Stable Position Selection'
    );
    await clickFrame(page, firstImageId);
    await assertSelected(page, firstImageId);
    const flowTarget = page.locator(
      `[data-layout-role="flow-image-hit-target"][data-image-id="${secondImageId}"]`
    );
    const originalPosition = Number(
      await flowTarget.getAttribute('data-document-image-position')
    );
    expect(Number.isFinite(originalPosition)).toBe(true);

    const textBand = page.locator(
      '[data-document-span-layout] [data-layout-role="explicit-text-column"]'
    ).first();
    const textBox = await textBand.boundingBox();
    expect(textBox).not.toBeNull();
    await page.mouse.click(textBox!.x + 5, textBox!.y + 5);
    await expect(page.locator('[data-document-span-layout]'))
      .toHaveAttribute('data-text-editing', 'true');
    await page.keyboard.type('Inserted text before default B. ');
    const evidence = await auditVisibleImageOwner(page, secondImageId);
    expect(evidence.elementFromPointHitTargetId).toBe(secondImageId);
    await page.mouse.click(evidence.center!.x, evidence.center!.y);
    await assertSelected(page, secondImageId);
    await expect.poll(async () => Number(
      await flowTarget.getAttribute('data-document-image-position')
    )).not.toBe(originalPosition);
  });

  test('resolves B by ID after text insertion changes its document position', async ({ page }) => {
    const { firstImageId, secondImageId } = await setupAAsSpanAndAddDefaultB(
      page,
      'Secondary Photo Stable Position Selection'
    );
    await clickFrame(page, firstImageId);
    await assertSelected(page, firstImageId);
    await clickFrame(page, secondImageId);
    await assertSelected(page, secondImageId);
    await configureDefaultBAsSpan(page, { xOffset: 300, y: 360 });
    await assertSelected(page, secondImageId);
    const layout = page.locator('[data-document-span-layout]');
    const secondSlot = layout.locator(
      `[data-layout-role="occupied-columns"][data-image-id="${secondImageId}"]`
    );
    const originalPosition = Number(
      await secondSlot.getAttribute('data-document-image-position')
    );
    expect(Number.isFinite(originalPosition)).toBe(true);

    const textBand = layout.locator(
      '[data-layout-role="explicit-text-column"]'
    ).first();
    const textBox = await textBand.boundingBox();
    expect(textBox).not.toBeNull();
    await page.mouse.click(textBox!.x + 5, textBox!.y + 5);
    await expect(layout).toHaveAttribute('data-text-editing', 'true');
    await page.keyboard.type('Inserted text before the second photo. ');
    const evidence = await auditVisibleImageOwner(page, secondImageId);
    expect(evidence.elementFromPointHitTargetId).toBe(secondImageId);
    await page.mouse.click(evidence.center!.x, evidence.center!.y);
    await assertSelected(page, secondImageId);
    await expect.poll(async () => Number(
      await secondSlot.getAttribute('data-document-image-position')
    )).not.toBe(originalPosition);
  });

  test('keeps B selectable after page switching and save/reopen', async ({ page }) => {
    const projectName = 'Secondary Photo Page Reopen Selection';
    const { firstImageId, secondImageId } = await setupAAsSpanAndAddDefaultB(
      page,
      projectName
    );
    await clickFrame(page, firstImageId);
    await assertSelected(page, firstImageId);
    await clickFrame(page, secondImageId);
    await assertSelected(page, secondImageId);

    await page.getByTestId('document-add-page').click();
    await page.getByTestId('document-page-tab-0').click();
    await expect(page.locator('[data-document-span-layout]')).toBeVisible();
    await clickFrame(page, secondImageId);
    await assertSelected(page, secondImageId);

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);
    await page.getByRole('button', { name: 'Back to projects' }).click();
    await page.getByTestId('dashboard-project-card')
      .filter({ hasText: projectName })
      .getByRole('button')
      .first()
      .click();
    await expect(page.locator('[data-document-span-layout]')).toBeVisible();
    await clickFrame(page, secondImageId);
    await assertSelected(page, secondImageId);
    await expect(page.locator(
      `[data-layout-role="occupied-columns"][data-image-id="${firstImageId}"]`
    )).toHaveAttribute('data-image-selected', 'false');
  });
});
