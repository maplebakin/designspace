import { expect, test } from '@playwright/test';

const PHOTO_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAYAAAChS3wfAAAABmJLR0QA/wD/AP+gvaeTAAABa0lEQVRogeWZS5LDIAxEJXyK3GauNadnNuPQzceQbN8KVeJuBNJTlZN8/fzWkhEla7T1LL6+0q2/v77UrZ69jp7NiMwa9/ps6rHqPA7x63XrPVQ3xlX85vn0vrvcMiNKiRolIu41IyKj/q8a13fcNKu4il/tPMY9ZrrVHrN8+vg0txLSAadVX9+s3/KuOvrZrur5QW5lkU8fv3VjOz+19nkL7hJYH2y+xz637mAb7FrhidxbBwC513wKknvzBXJvuCK5t3yA3E9mAI37YQawuJ/MABr36gvkXn2HDmBwr75A7hvCXQdwuG/dWZDcq47IvemQ3JsXkHu7ECT36kXk3jsAyf1yBjC4f5gBEO7XM4DB/cMMoHBvM4DHvRURyb34FST3mgOReysWknvX8bi330CR3FsM5H4yA3Dc9zOAxb2dk8m9+gK5t9yg3OsePO7b/6Dhr8Mc7u9OlxlA4t4uCsp90yC5Vy8i9+r1B7Q45ELbjS61AAAAAElFTkSuQmCC';

test('keeps structured photo transform chrome aligned through group, crop, zoom, and reopen', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('dashboard-new-document').click();
  await page.getByTestId('document-project-name').fill(
    'Document Photo Transform Alignment'
  );
  await page.getByRole('button', { name: '3 columns' }).click();
  await page.locator('.document-flow-prosemirror').fill(
    'Text around the photographs. '.repeat(20)
  );
  await page.getByTestId('document-image-file-input').setInputFiles([
    {
      name: 'first.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PHOTO_PNG_BASE64, 'base64'),
    },
    {
      name: 'second.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PHOTO_PNG_BASE64, 'base64'),
    },
  ]);
  const sourceImages = page.locator('.document-image-node');
  await expect(sourceImages).toHaveCount(2);
  await sourceImages.nth(0).click();
  await sourceImages.nth(1).click({ modifiers: ['Shift'] });
  await page.getByTestId('document-image-group-row').click();

  const layout = page.locator('[data-document-span-layout]');
  await expect(layout).toHaveAttribute('data-image-group-count', '1');
  const slots = layout.locator('[data-layout-role="occupied-columns"]');
  await expect(slots).toHaveCount(2);
  for (let index = 0; index < 6; index += 1) {
    await page.getByRole('button', { name: 'Zoom in' }).click();
  }
  await expect(page.getByTestId('document-zoom-indicator')).toHaveText('101%');
  await slots.first().click();
  await expect(slots.first()).toHaveAttribute('data-image-selected', 'true');
  await page.getByLabel('Image width').fill('240');
  await page.getByLabel('Image caption').fill('A long caption for the first adjacent photograph');
  await page.getByTestId('document-image-crop-mode').selectOption('fill');
  await page.getByLabel('Image height').fill('160');
  await page.getByTestId('document-image-crop-focal-x').fill('0.2');
  await page.getByTestId('document-image-crop-focal-y').fill('0.8');
  await slots.nth(1).click();
  await page.getByLabel('Image width').fill('210');
  await page.getByLabel('Image caption').fill('A second caption for the adjacent photograph');
  await expect(layout.locator('figcaption')).toHaveCount(2);

  const readGeometry = () => slots.evaluateAll((nodes) => nodes.map((node) => {
    const slot = node as HTMLElement;
    const content = slot.querySelector<HTMLElement>('.document-span-layout__image-content')!;
    const frame = slot.querySelector<HTMLElement>('.document-image__frame')!;
    const chrome = slot.querySelector<HTMLElement>(
      '[data-document-image-frame-chrome="true"]'
    )!;
    const media = slot.querySelector<HTMLElement>('.document-image__media')!;
    const handle = slot.querySelector<HTMLElement>('.document-image__resize-handle');
    const rect = (element: HTMLElement) => {
      const value = element.getBoundingClientRect();
      return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
    };
    return {
      slot: rect(slot),
      content: rect(content),
      frame: rect(frame),
      chrome: rect(chrome),
      media: rect(media),
      handle: handle ? rect(handle) : null,
      selected: slot.dataset.imageSelected,
    };
  }));
  const expectChromeAligned = async () => {
    const geometry = await readGeometry();
    geometry.forEach(({ frame, chrome, handle, slot }) => {
      expect(Math.abs(frame.left - chrome.left)).toBeLessThan(1);
      expect(Math.abs(frame.top - chrome.top)).toBeLessThan(1);
      expect(Math.abs(frame.right - chrome.right)).toBeLessThan(1);
      expect(Math.abs(frame.bottom - chrome.bottom)).toBeLessThan(1);
      expect(Math.abs(frame.left - slot.left)).toBeLessThan(1);
      expect(Math.abs(frame.top - slot.top)).toBeLessThan(1);
      if (handle) {
        expect(Math.abs(frame.right - handle.right)).toBeLessThan(1);
        expect(Math.abs(frame.bottom - handle.bottom)).toBeLessThan(1);
      }
    });
    return geometry;
  };

  const geometry = await expectChromeAligned();
  expect(geometry.some(({ slot, frame }) => slot.height > frame.height + 1))
    .toBe(true);
  await expect(slots.first().locator('[data-document-image-frame="true"]'))
    .toHaveAttribute('data-crop-mode', 'fill');
  await expect(slots.first().locator('[data-document-image-frame="true"]'))
    .toHaveAttribute('data-crop-focal-x', '0.2');
  await expect(slots.first().locator('[data-document-image-frame="true"]'))
    .toHaveAttribute('data-crop-focal-y', '0.8');

  const resizeHandle = slots.nth(1).getByRole('button', {
    name: 'Resize image',
  });
  await expect(resizeHandle).toBeVisible();
  const resizeBox = await resizeHandle.boundingBox();
  expect(resizeBox).not.toBeNull();
  const widthBeforeResize = geometry[1].frame.width;
  await page.mouse.move(
    resizeBox!.x + resizeBox!.width / 2,
    resizeBox!.y + resizeBox!.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    resizeBox!.x + resizeBox!.width / 2 - 35,
    resizeBox!.y + resizeBox!.height / 2
  );
  await expect.poll(async () => (await readGeometry())[1].frame.width)
    .toBeLessThan(widthBeforeResize);
  await expectChromeAligned();
  await page.mouse.up();
  await expectChromeAligned();

  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expectChromeAligned();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);
  await page.getByRole('button', { name: 'Back to projects' }).click();
  const card = page.getByTestId('dashboard-project-card').filter({
    hasText: 'Document Photo Transform Alignment',
  });
  await expect(card).toBeVisible();
  await card.getByRole('button').first().click();

  const reopenedLayout = page.locator('[data-document-span-layout]');
  await expect(reopenedLayout).toHaveAttribute('data-image-group-count', '1');
  const reopenedSlots = reopenedLayout.locator(
    '[data-layout-role="occupied-columns"]'
  );
  await expect(reopenedSlots).toHaveCount(2);
  await reopenedSlots.first().click();
  await expect(reopenedLayout.locator('figcaption')).toHaveCount(2);
  await expect(reopenedSlots.first().locator(
    '[data-document-image-frame="true"]'
  )).toHaveAttribute('data-crop-mode', 'fill');

  const reopenedGeometry = await reopenedSlots.evaluateAll((nodes) => nodes.map((node) => {
    const slot = node as HTMLElement;
    const frame = slot.querySelector<HTMLElement>('.document-image__frame')!;
    const chrome = slot.querySelector<HTMLElement>(
      '[data-document-image-frame-chrome="true"]'
    )!;
    const frameRect = frame.getBoundingClientRect();
    const chromeRect = chrome.getBoundingClientRect();
    return {
      frame: frameRect,
      chrome: chromeRect,
    };
  }));
  reopenedGeometry.forEach(({ frame, chrome }) => {
    expect(Math.abs(frame.left - chrome.left)).toBeLessThan(1);
    expect(Math.abs(frame.top - chrome.top)).toBeLessThan(1);
    expect(Math.abs(frame.right - chrome.right)).toBeLessThan(1);
    expect(Math.abs(frame.bottom - chrome.bottom)).toBeLessThan(1);
  });

  await page.getByTestId('document-add-page').click();
  await page.getByTestId('document-page-tab-0').click();
  await expect(page.locator('[data-document-span-layout]')).toBeVisible();
});
