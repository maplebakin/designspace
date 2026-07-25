import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

const PHOTO_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAYAAAChS3wfAAAABmJLR0QA/wD/AP+gvaeTAAABa0lEQVRogeWZS5LDIAxEJXyK3GauNadnNuPQzceQbN8KVeJuBNJTlZN8/fzWkhEla7T1LL6+0q2/v77UrZ69jp7NiMwa9/ps6rHqPA7x63XrPVQ3xlX85vn0vrvcMiNKiRolIu41IyKj/q8a13fcNKu4il/tPMY9ZrrVHrN8+vg0txLSAadVX9+s3/KuOvrZrur5QW5lkU8fv3VjOz+19nkL7hJYH2y+xz637mAb7FrhidxbBwC513wKknvzBXJvuCK5t3yA3E9mAI37YQawuJ/MABr36gvkXn2HDmBwr75A7hvCXQdwuG/dWZDcq47IvemQ3JsXkHu7ECT36kXk3jsAyf1yBjC4f5gBEO7XM4DB/cMMoHBvM4DHvRURyb34FST3mgOReysWknvX8bi330CR3FsM5H4yA3Dc9zOAxb2dk8m9+gK5t9yg3OsePO7b/6Dhr8Mc7u9OlxlA4t4uCsp90yC5Vy8i9+r1B7Q45ELbjS61AAAAAElFTkSuQmCC';

const MAGENTA_REFERENCE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAABmJLR0QA/wD/AP+gvaeTAAAAFklEQVQYlWP8z/D/PwMewIRPcvgoAAAWZQMNX90OAQAAAABJRU5ErkJggg==';

const bodyCopy = [
  'Among the earliest family records, the Harwoods appear beside the old river road.',
  'The translated article preserves stories of the homestead, neighbours, and the annual harvest gathering.',
  'This reconstruction is prepared as a birthday gift so another generation can read the original history.',
].join(' ').repeat(28);

const pasteImageFile = async (page: Page) => {
  await page.locator('.document-flow-prosemirror').focus();
  await page.locator('.document-flow-prosemirror').evaluate(
    (target: HTMLElement, base64: string) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'family-photo.png', { type: 'image/png' }));
      target.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }));
    },
    PHOTO_PNG_BASE64
  );
};

const openExportFormat = async (page: Page, format: 'PNG' | 'PDF') => {
  const formatButton = page.getByRole('button', { name: format, exact: true });
  if (!await formatButton.isVisible()) {
    await page.getByText('Export', { exact: true }).click();
  }
  await expect(formatButton).toBeVisible();
  return formatButton;
};

test.describe('document reconstruction MVP', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('opens as a readable, discoverable desktop publishing workspace', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('dashboard-new-document').click();

    await expect(page.getByTestId('document-top-bar')).toBeVisible();
    await expect(page.getByTestId('document-properties-sidebar')).toBeVisible();
    await expect(page.getByTestId('document-context-toolbar')).toBeVisible();
    await expect(page.getByTestId('document-workspace')).toBeVisible();
    await expect(page.getByTestId('document-zoom-controls')).toBeVisible();
    await expect(page.getByTestId('document-title-placeholder')).toHaveText('Add a title');
    await expect(page.getByTestId('document-body-placeholder')).toContainText(
      'Start writing or paste translated text'
    );

    await expect.poll(async () => {
      const value = await page.getByTestId('document-zoom-indicator').textContent();
      return Number.parseInt(value || '0', 10);
    }).toBeGreaterThan(75);

    const assertPracticalPageFit = async () => {
      const workspaceBox = await page.getByTestId('document-workspace').boundingBox();
      const pageBox = await page.getByTestId('document-page').boundingBox();
      expect(workspaceBox).not.toBeNull();
      expect(pageBox).not.toBeNull();
      expect(pageBox!.height / workspaceBox!.height).toBeGreaterThan(0.72);
      expect(pageBox!.y).toBeGreaterThanOrEqual(workspaceBox!.y);
      expect(pageBox!.y + pageBox!.height)
        .toBeLessThanOrEqual(workspaceBox!.y + workspaceBox!.height + 1);
      const pageCenter = pageBox!.x + pageBox!.width / 2;
      const workspaceCenter = workspaceBox!.x + workspaceBox!.width / 2;
      expect(Math.abs(pageCenter - workspaceCenter)).toBeLessThan(12);
    };
    await assertPracticalPageFit();

    const sidebarBox = await page.getByTestId('document-properties-sidebar').boundingBox();
    expect(sidebarBox?.width).toBeGreaterThanOrEqual(260);
    expect(sidebarBox?.width).toBeLessThanOrEqual(320);

    await page.getByRole('button', { name: '3 columns' }).click();
    await expect(page.getByTestId('document-column-count')).toHaveAttribute('data-value', '3');
    await page.locator('.document-title-prosemirror').fill('A discoverable title');
    await page.locator('.document-flow-prosemirror').fill('A readable body paragraph.');
    await expect(page.getByTestId('document-title-placeholder')).toHaveCount(0);
    await expect(page.getByTestId('document-body-placeholder')).toHaveCount(0);

    await page.getByTestId('document-image-file-input').setInputFiles({
      name: 'family-photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PHOTO_PNG_BASE64, 'base64'),
    });
    await expect(page.locator('[data-document-image="true"]')).toHaveCount(1);
    await page.locator('[data-document-image="true"]').click();
    await expect(page.getByTestId('document-context-toolbar')).toHaveAttribute(
      'data-context',
      'image'
    );
    await expect(page.getByLabel('Image layout mode')).toBeVisible();

    await page.getByTestId('document-reference-file-input').setInputFiles({
      name: 'source-scan.png',
      mimeType: 'image/png',
      buffer: Buffer.from(MAGENTA_REFERENCE_BASE64, 'base64'),
    });
    await expect(page.getByTestId('document-reference-controls')).toBeVisible();
    await page.getByRole('button', { name: 'Adjust reference', exact: true }).click();
    await expect(page.getByTestId('document-context-toolbar')).toHaveAttribute(
      'data-context',
      'reference'
    );
    await page.getByTestId('document-context-toolbar')
      .getByRole('button', { name: 'Finish adjusting' })
      .click();
    await expect(page.getByTestId('document-context-toolbar')).toHaveAttribute(
      'data-context',
      'body'
    );

    await page.getByTestId('document-zoom-controls')
      .getByRole('button', { name: 'Fit page' })
      .click();
    await assertPracticalPageFit();

    await page.getByRole('button', { name: 'Collapse properties sidebar' }).click();
    await expect(page.getByTestId('document-properties-sidebar')).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    await expect(page.getByTestId('document-page')).toBeVisible();
    await page.getByRole('button', { name: 'Expand properties sidebar' }).click();

    const pngDownloadPromise = page.waitForEvent('download');
    await (await openExportFormat(page, 'PNG')).click();
    const pngDownload = await pngDownloadPromise;
    expect(await pngDownload.path()).not.toBeNull();
  });

  test('applies contextual body and title point sizes without affecting canvas mode', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('dashboard-new-document').click();

    const body = page.locator('.document-flow-prosemirror');
    await body.fill('Body typography');
    await body.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
    await expect(page.getByLabel('Body text font size')).toBeVisible();
    await page.getByLabel('Body text font size').selectOption('16');
    await expect(body.locator('span[data-font-size-px="21.333"]')).toContainText(
      'Body typography'
    );

    const title = page.locator('.document-title-prosemirror');
    await title.fill('Title typography');
    await title.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
    await expect(page.getByLabel('Title text font size')).toBeVisible();
    await page.getByLabel('Title text font size').selectOption('24');
    await expect(title.locator('span[data-font-size-px="32"]')).toContainText(
      'Title typography'
    );
    await expect(page.locator('canvas')).toHaveCount(0);
  });

  test('switches document orientation, refits the page, and reflows columns', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('dashboard-new-document').click();
    await page.getByRole('button', { name: '3 columns' }).click();

    const pageSheet = page.getByTestId('document-page');
    const portraitBox = await pageSheet.boundingBox();
    const portraitZoom = await page.getByTestId('document-zoom-indicator').textContent();
    expect(portraitBox).not.toBeNull();
    expect(portraitBox!.height).toBeGreaterThan(portraitBox!.width);

    await page.getByRole('button', { name: 'Landscape orientation' }).click();
    await expect(page.getByTestId('document-page-orientation')).toHaveAttribute(
      'data-value',
      'landscape'
    );
    await expect(page.getByTestId('document-export-root')).toHaveAttribute(
      'data-page-orientation',
      'landscape'
    );
    await expect.poll(async () => {
      const box = await pageSheet.boundingBox();
      return box ? box.width > box.height : false;
    }).toBe(true);
    await expect.poll(async () =>
      page.getByTestId('document-zoom-indicator').textContent()
    ).not.toBe(portraitZoom);
    await expect(page.locator('.document-flow-prosemirror')).toHaveCSS(
      'column-count',
      '3'
    );

    await page.getByLabel('Page preset').selectOption('a4');
    await expect(page.getByTestId('document-export-root')).toHaveAttribute(
      'data-page-orientation',
      'landscape'
    );
    await page.getByRole('button', { name: 'Portrait orientation' }).click();
    await expect.poll(async () => {
      const box = await pageSheet.boundingBox();
      return box ? box.height > box.width : false;
    }).toBe(true);
  });

  test('builds and persists the family-history span across columns 2–3', async ({ page }) => {
    test.slow();
    test.setTimeout(120_000);
    await page.goto('/');
    await page.getByTestId('dashboard-new-document').click();
    await page.getByTestId('document-project-name').fill(
      'Family History Spanning Layout'
    );
    await page.getByRole('button', { name: '3 columns' }).click();

    const body = page.locator('.document-flow-prosemirror');
    await body.evaluate((target: HTMLElement) => {
      target.innerHTML = [
        `<p>${'The first part of the family history fills the opening columns. '.repeat(12)}</p>`,
        `<p>${'More translated history appears before the photograph. '.repeat(12)}</p>`,
        `<p>${'The image anchor belongs in the lower portion of the article. '.repeat(4)}</p>`,
        `<p>${'Column one continues beside the spanning family photograph. '.repeat(3)}</p>`,
        `<p>${'The article continues beneath the photograph with later memories. '.repeat(3)}</p>`,
      ].join('');
      target.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
      }));
    });
    await expect(body.locator('p')).toHaveCount(5);
    await body.locator('p').nth(2).evaluate((paragraph) => {
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
    });

    await page.getByTestId('document-image-file-input').setInputFiles({
      name: 'family-photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PHOTO_PNG_BASE64, 'base64'),
    });
    await expect(page.locator('[data-document-image="true"]')).toHaveCount(1);
    await page.locator('[data-document-image="true"]').click();
    await page.getByTestId('document-image-wrap').selectOption('span-2');
    await page.getByTestId('document-image-caption').fill(
      'The Harwood family outside the farmhouse'
    );
    await page.getByTestId('document-image-alt').fill(
      'Harwood family gathered outside their farmhouse'
    );

    const layout = page.locator('[data-document-span-layout]');
    await expect(layout).toHaveAttribute('data-span-count', '2');
    await expect(layout).toHaveAttribute('data-span-start-column', '1');
    await expect(layout.locator(
      '[data-layout-region="above"][data-layout-role="explicit-text-column"]'
    )).toHaveCount(3);
    await expect(layout.locator(
      '[data-layout-role="continuing-column"][data-column="3"]'
    )).toBeVisible();
    const initialImageTop = Number(
      await layout.getAttribute('data-image-top-px')
    );
    await page.getByRole('button', { name: 'Move earlier' }).click();
    await page.getByRole('button', { name: 'Move earlier' }).click();
    await expect.poll(async () =>
      Number(await layout.getAttribute('data-image-top-px'))
    ).toBeLessThanOrEqual(initialImageTop);
    const earlierImageTop = Number(
      await layout.getAttribute('data-image-top-px')
    );
    await page.getByRole('button', { name: 'Move later' }).click();
    await expect.poll(async () =>
      Number(await layout.getAttribute('data-image-top-px'))
    ).toBeGreaterThanOrEqual(Number(earlierImageTop));
    const onceLaterImageTop = Number(
      await layout.getAttribute('data-image-top-px')
    );
    await page.getByRole('button', { name: 'Move later' }).click();
    await expect.poll(async () =>
      Number(await layout.getAttribute('data-image-top-px'))
    ).toBeGreaterThanOrEqual(onceLaterImageTop);
    await expect(layout.locator(
      '[data-layout-region="below"][data-layout-role="explicit-text-column"]'
    )).toHaveCount(3);
    const bodyPhraseCounts = await layout.evaluate((root) => {
      const text = [
        ...Array.from(root.querySelectorAll<HTMLElement>(
          '[data-layout-region="above"][data-layout-role="explicit-text-column"]'
        )),
        ...Array.from(root.querySelectorAll<HTMLElement>(
          '[data-layout-region="below"][data-layout-role="explicit-text-column"]'
        )),
      ].map((region) => region.textContent || '').join('');
      const count = (phrase: string) => text.split(phrase).length - 1;
      return {
        first: count('The first part of the family history fills the opening columns.'),
        translated: count('More translated history appears before the photograph.'),
        anchor: count('The image anchor belongs in the lower portion of the article.'),
        beside: count('Column one continues beside the spanning family photograph.'),
        beneath: count('The article continues beneath the photograph with later memories.'),
      };
    });
    expect(bodyPhraseCounts).toEqual({
      first: 12,
      translated: 12,
      anchor: 4,
      beside: 3,
      beneath: 3,
    });
    const columnsOneTwoGeometry = await layout.evaluate((root) => {
      const rootRect = root.getBoundingClientRect();
      const columns = Array.from(root.querySelectorAll<HTMLElement>(
        '[data-layout-region="above"][data-layout-role="explicit-text-column"]'
      ));
      const occupied = root.querySelector<HTMLElement>(
        '[data-layout-role="occupied-columns"]'
      )!;
      const image = occupied.querySelector<HTMLElement>(
        '[data-layout-role="spanning-image"]'
      )!;
      const occupiedRect = occupied.getBoundingClientRect();
      const imageRect = image.getBoundingClientRect();
      return {
        rootLeft: rootRect.left,
        rootRight: rootRect.right,
        columnWidths: columns.map((column) =>
          column.getBoundingClientRect().width
        ),
        columnCounts: [
          getComputedStyle(root).columnCount,
          ...columns.map((column) => getComputedStyle(column).columnCount),
        ],
        wordBreaks: columns.map((column) => getComputedStyle(column).wordBreak),
        occupiedLeft: occupiedRect.left,
        occupiedRight: occupiedRect.right,
        imageLeft: imageRect.left,
        imageRight: imageRect.right,
        imageWidth: imageRect.width,
        occupiedWidth: occupiedRect.width,
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
      };
    });
    expect(columnsOneTwoGeometry.columnWidths).toHaveLength(3);
    columnsOneTwoGeometry.columnWidths.forEach((width) =>
      expect(width).toBeGreaterThan(150)
    );
    expect(columnsOneTwoGeometry.columnCounts.every(
      (columnCount) => columnCount === 'auto'
    )).toBe(true);
    expect(columnsOneTwoGeometry.wordBreaks.every(
      (wordBreak) => wordBreak === 'normal'
    )).toBe(true);
    expect(columnsOneTwoGeometry.occupiedLeft)
      .toBeGreaterThanOrEqual(columnsOneTwoGeometry.rootLeft - 1);
    expect(columnsOneTwoGeometry.occupiedRight)
      .toBeLessThanOrEqual(columnsOneTwoGeometry.rootRight + 1);
    expect(columnsOneTwoGeometry.imageLeft)
      .toBeGreaterThanOrEqual(columnsOneTwoGeometry.occupiedLeft - 1);
    expect(columnsOneTwoGeometry.imageRight)
      .toBeLessThanOrEqual(columnsOneTwoGeometry.occupiedRight + 1);
    expect(columnsOneTwoGeometry.imageWidth)
      .toBeLessThanOrEqual(columnsOneTwoGeometry.occupiedWidth + 1);
    expect(columnsOneTwoGeometry.scrollWidth)
      .toBeLessThanOrEqual(columnsOneTwoGeometry.clientWidth + 1);

    await page.getByTestId('document-image-span-start').selectOption('2');
    await expect(layout).toHaveAttribute('data-span-start-column', '2');
    await page.getByTestId('document-image-vertical-anchor')
      .selectOption('page-position');
    await expect(layout).toHaveAttribute(
      'data-vertical-anchor',
      'page-position'
    );
    const maximumImageY = Number(
      await layout.getAttribute('data-image-y-max-px')
    );
    const requestedImageY = Math.max(
      18,
      Math.min(300, maximumImageY - 90)
    );
    await page.getByTestId('document-image-y-position').fill(
      String(Math.round(requestedImageY))
    );
    await expect.poll(async () =>
      Number(await layout.getAttribute('data-image-top-px'))
    ).toBeCloseTo(requestedImageY, 0);
    await expect(page.getByRole('button', { name: 'Move earlier' }))
      .toHaveCount(0);
    await expect(layout.locator('[data-layout-role="occupied-columns"]'))
      .toHaveAttribute('data-start-column', '2');
    await expect(layout.locator('[data-layout-role="occupied-columns"]'))
      .toHaveAttribute('data-end-column', '3');
    const columnOne = layout.locator(
      '[data-layout-role="continuing-column"][data-column="1"]'
    );
    const columnTwoAbove = layout.locator(
      '[data-layout-region="above"][data-column="2"]'
    );
    const columnThreeAbove = layout.locator(
      '[data-layout-region="above"][data-column="3"]'
    );
    const columnTwoBelow = layout.locator(
      '[data-layout-region="below"][data-column="2"]'
    );
    await expect(columnOne).toContainText(
      'The first part of the family history fills the opening columns.'
    );
    await expect(columnOne).not.toContainText(
      'The article continues beneath the photograph with later memories.'
    );
    await expect(columnTwoAbove).toContainText(
      'anchor belongs in the lower portion of the article.'
    );
    await expect(columnTwoBelow).not.toBeEmpty();
    await expect(columnThreeAbove).toBeAttached();
    await expect(layout.locator('[data-layout-role="occupied-columns"]'))
      .not.toContainText('Column one continues beside');
    await expect(layout.locator('figcaption')).toHaveText(
      'The Harwood family outside the farmhouse'
    );
    const imageSlot = layout.locator(
      '[data-layout-role="occupied-columns"]'
    );
    const sourceImage = page.locator(
      '.document-flow-prosemirror '
      + '.document-image-node[data-wrap="span-columns"]'
    );
    const originalImageState = await sourceImage.evaluate((node) => ({
      attributes: Object.fromEntries(
        Array.from(node.attributes)
          .filter((attribute) => attribute.name.startsWith('data-'))
          .map((attribute) => [attribute.name, attribute.value])
      ),
      caption: node.querySelector('figcaption')?.textContent || '',
    }));
    await columnOne.click();
    await expect(layout).toHaveAttribute('data-text-editing', 'true');
    const sourceBody = page.locator(
      '.document-flow-editor__content--structured-text-editing '
      + '.document-flow-prosemirror'
    );
    await expect(sourceBody).toBeVisible();
    await sourceBody.locator('p').first().click();
    await expect(page.getByTestId('document-image-inspector')).toHaveCount(0);
    await expect(imageSlot).toBeVisible();
    await expect(sourceImage).toBeHidden();
    await expect(page.locator(
      '[data-document-image="true"]:visible'
    )).toHaveCount(1);

    await imageSlot.click();
    await expect(layout).toHaveAttribute('data-text-editing', 'false');
    await expect(page.getByTestId('document-image-inspector')).toBeVisible();
    await expect.poll(async () => sourceImage.evaluate((node) => ({
      attributes: Object.fromEntries(
        Array.from(node.attributes)
          .filter((attribute) => attribute.name.startsWith('data-'))
          .map((attribute) => [attribute.name, attribute.value])
      ),
      caption: node.querySelector('figcaption')?.textContent || '',
    }))).toEqual(originalImageState);
    await expect(page.locator(
      '[data-document-image="true"]:visible'
    )).toHaveCount(1);

    const slotBox = await imageSlot.boundingBox();
    expect(slotBox).not.toBeNull();
    const imageYBeforeDrag = Number(
      await layout.getAttribute('data-image-top-px')
    );
    const zoomPercent = Number.parseInt(
      await page.getByTestId('document-zoom-indicator').textContent() || '100',
      10
    );
    await page.mouse.move(
      slotBox!.x + slotBox!.width / 2,
      slotBox!.y + Math.min(40, slotBox!.height / 2)
    );
    await page.mouse.down();
    await page.mouse.move(
      slotBox!.x + slotBox!.width / 2,
      slotBox!.y + Math.min(40, slotBox!.height / 2) + 40
    );
    await page.mouse.up();
    await expect.poll(async () =>
      Number(await layout.getAttribute('data-image-top-px'))
    ).toBeGreaterThan(imageYBeforeDrag);
    const committedImageY = Number(
      await layout.getAttribute('data-image-top-px')
    );
    expect(committedImageY - imageYBeforeDrag)
      .toBeCloseTo(40 / (zoomPercent / 100), 0);
    const columnsTwoThreeGeometry = await layout.evaluate((root) => {
      const rootRect = root.getBoundingClientRect();
      const occupiedRect = root.querySelector<HTMLElement>(
        '[data-layout-role="occupied-columns"]'
      )!.getBoundingClientRect();
      const imageRect = root.querySelector<HTMLElement>(
        '[data-layout-role="spanning-image"]'
      )!.getBoundingClientRect();
      const sideRect = root.querySelector<HTMLElement>(
        '[data-layout-role="continuing-column"]'
      )!.getBoundingClientRect();
      const lowerColumns = Array.from(root.querySelectorAll<HTMLElement>(
        '[data-layout-region="below"][data-layout-role="explicit-text-column"]'
      ));
      return {
        rootLeft: rootRect.left,
        rootRight: rootRect.right,
        occupiedLeft: occupiedRect.left,
        occupiedRight: occupiedRect.right,
        imageLeft: imageRect.left,
        imageRight: imageRect.right,
        sideHeight: sideRect.height,
        occupiedHeight: occupiedRect.height,
        lowerColumnTextLengths: lowerColumns.map(
          (column) => (column.textContent || '').trim().length
        ),
      };
    });
    expect(columnsTwoThreeGeometry.occupiedLeft)
      .toBeGreaterThanOrEqual(columnsTwoThreeGeometry.rootLeft - 1);
    expect(columnsTwoThreeGeometry.occupiedRight)
      .toBeLessThanOrEqual(columnsTwoThreeGeometry.rootRight + 1);
    expect(columnsTwoThreeGeometry.imageLeft)
      .toBeGreaterThanOrEqual(columnsTwoThreeGeometry.occupiedLeft - 1);
    expect(columnsTwoThreeGeometry.imageRight)
      .toBeLessThanOrEqual(columnsTwoThreeGeometry.occupiedRight + 1);
    expect(columnsTwoThreeGeometry.sideHeight)
      .toBeGreaterThan(columnsTwoThreeGeometry.occupiedHeight);
    expect(columnsTwoThreeGeometry.lowerColumnTextLengths)
      .toHaveLength(3);
    await expect(page.getByTestId('document-overflow-warning')).toHaveCount(0);

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);
    await page.getByRole('button', { name: 'Back to projects' }).click();
    const savedCard = page.getByTestId('dashboard-project-card')
      .filter({ hasText: 'Family History Spanning Layout' });
    await expect(savedCard).toBeVisible();
    await savedCard.getByRole('button').first().click();

    const reloadedLayout = page.locator('[data-document-span-layout]');
    await expect(reloadedLayout).toHaveAttribute('data-span-count', '2');
    await expect(reloadedLayout).toHaveAttribute('data-span-start-column', '2');
    await expect(reloadedLayout).toHaveAttribute(
      'data-vertical-anchor',
      'page-position'
    );
    await expect.poll(async () =>
      Number(await reloadedLayout.getAttribute('data-image-top-px'))
    ).toBeCloseTo(committedImageY, 0);
    await expect(reloadedLayout.locator(
      '[data-layout-role="continuing-column"][data-column="1"]'
    ))
      .not.toContainText(
        'The article continues beneath the photograph with later memories.'
      );
    await expect(reloadedLayout.locator('figcaption')).toHaveText(
      'The Harwood family outside the farmhouse'
    );
    await expect(reloadedLayout.locator(
      '[data-layout-region="below"][data-column="2"]'
    )).not.toBeEmpty();

    const pngDownloadPromise = page.waitForEvent('download');
    await (await openExportFormat(page, 'PNG')).click();
    const pngDownload = await pngDownloadPromise;
    expect(await pngDownload.path()).not.toBeNull();
    await expect(page.locator('[data-document-reference-layer]')).toHaveCount(0);
    await expect(page.locator('canvas.upper-canvas')).toHaveCount(0);
  });

  test('reconstructs, persists, and exports a scanned three-column article', async ({ page }) => {
    test.slow();
    test.setTimeout(120_000);
    const browserErrors: string[] = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });

    await page.goto('/');
    await page.getByTestId('dashboard-new-document').click();
    await expect(page.getByTestId('document-editor-shell')).toBeVisible();
    await expect(page.locator('canvas.upper-canvas')).toHaveCount(0);
    await expect(page.getByTestId('design-canvas')).toHaveCount(0);

    await page.getByTestId('document-project-name').fill('Granddad Reconstruction');
    await page.locator('.document-title-prosemirror').fill('The Harwood Family Chronicle');
    await page.locator('.document-flow-prosemirror').fill(bodyCopy);
    await page.getByRole('button', { name: '3 columns' }).click();
    await page.getByTestId('document-column-gap').fill('28');
    await page.getByTestId('document-drop-cap-toggle').click();

    await pasteImageFile(page);
    await expect(page.locator('[data-document-image="true"]')).toHaveCount(1);
    await page.locator('[data-document-image="true"]').click();
    await page.getByTestId('document-image-wrap').selectOption('float-right');
    await expect(page.locator('[data-document-image="true"]')).toHaveAttribute('data-wrap', 'float-right');
    await page.getByTestId('document-image-wrap').selectOption('top-bottom');
    await expect(page.locator('[data-document-image="true"]')).toHaveAttribute('data-wrap', 'top-bottom');
    await page.getByTestId('document-image-wrap').selectOption('inline');
    await expect(page.locator('[data-document-image="true"]')).toHaveAttribute('data-wrap', 'inline');
    await page.locator('[data-document-image="true"]').click();
    await page.getByTestId('document-image-wrap').selectOption('float-left');
    await page.getByTestId('document-image-padding').fill('14');
    await page.getByTestId('document-image-caption').fill('Granddad beside the family home');
    await page.getByTestId('document-image-alt').fill('Granddad standing beside a farmhouse');
    await expect(page.locator('[data-document-image="true"]')).toHaveAttribute('data-wrap', 'float-left');
    await page.getByTestId('document-image-wrap').selectOption('front');
    await expect(page.getByTestId('document-overlay-layer-front').getByTestId('document-overlay-image')).toHaveCount(1);
    await expect(page.getByTestId('document-image-wrap')).toBeVisible();
    await page.getByTestId('document-image-wrap').selectOption('behind');
    await expect(page.getByTestId('document-overlay-layer-behind').getByTestId('document-overlay-image')).toHaveCount(1);
    await expect(page.getByTestId('document-image-wrap')).toBeVisible();
    await page.getByTestId('document-image-wrap').selectOption('float-left');
    await expect(page.locator('[data-document-image="true"]')).toHaveCount(1);
    await page.locator('[data-document-image="true"]').click();
    await expect(page.getByTestId('document-image-caption')).toHaveValue('Granddad beside the family home');

    await page.getByTestId('document-reference-file-input').setInputFiles({
      name: 'source-scan.png',
      mimeType: 'image/png',
      buffer: Buffer.from(MAGENTA_REFERENCE_BASE64, 'base64'),
    });
    await expect(page.getByTestId('document-reference-layer')).toBeVisible();
    await page.getByLabel('Reference opacity').fill('1');
    await page.getByLabel('Reference fit').selectOption('stretch');
    await page.getByRole('button', { name: 'Adjust reference' }).click();
    await page.getByLabel('Reference scale').fill('1.05');
    await page.getByTestId('document-context-toolbar')
      .getByRole('button', { name: 'Finish adjusting' })
      .click();

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);

    await page.getByRole('button', { name: 'Back to projects' }).click();
    const savedCard = page.getByTestId('dashboard-project-card')
      .filter({ hasText: 'Granddad Reconstruction' });
    await expect(savedCard).toBeVisible();
    await savedCard.getByRole('button').first().click();

    await expect(page.getByTestId('document-editor-shell')).toBeVisible();
    await expect(page.locator('canvas.upper-canvas')).toHaveCount(0);
    await expect(page.locator('.document-title-prosemirror')).toContainText('The Harwood Family Chronicle');
    await expect(page.locator('.document-flow-prosemirror')).toContainText('earliest family records');
    await expect(page.getByTestId('document-column-count')).toHaveAttribute('data-value', '3');
    await expect(page.getByTestId('document-column-gap')).toHaveValue('28');
    await expect(page.getByTestId('document-drop-cap-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-document-image="true"]')).toHaveCount(1);
    await page.locator('[data-document-image="true"]').click();
    await expect(page.getByTestId('document-image-caption')).toHaveValue('Granddad beside the family home');
    await expect(page.getByTestId('document-image-alt')).toHaveValue('Granddad standing beside a farmhouse');
    await expect(page.getByTestId('document-reference-layer')).toBeVisible();
    await expect(page.getByLabel('Reference opacity')).toHaveValue('1');

    const pngDownloadPromise = page.waitForEvent('download');
    await (await openExportFormat(page, 'PNG')).click();
    const pngDownload = await pngDownloadPromise;
    const pngPath = await pngDownload.path();
    expect(pngPath).not.toBeNull();
    const pngBytes = await readFile(pngPath!);
    const pngInspection = await page.evaluate(async (base64: string) => {
      const binary = atob(base64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const corner = Array.from(context.getImageData(2, 2, 1, 1).data);
      bitmap.close();
      return { width: canvas.width, height: canvas.height, corner };
    }, pngBytes.toString('base64'));
    expect(pngInspection).toMatchObject({
      width: 2550,
      height: 3300,
      corner: [255, 255, 255, 255],
    });

    await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);
    await page.getByTestId('document-reference-visibility').dispatchEvent('click');
    await expect(page.getByTestId('document-reference-layer')).toHaveCount(0);

    const pdfDownloadPromise = page.waitForEvent('download');
    await (await openExportFormat(page, 'PDF')).click();
    const pdfDownload = await pdfDownloadPromise;
    const pdfPath = await pdfDownload.path();
    expect(pdfPath).not.toBeNull();
    const pdf = await PDFDocument.load(await readFile(pdfPath!));
    const [pdfPage] = pdf.getPages();
    expect(pdfPage.getWidth()).toBeCloseTo(612, 1);
    expect(pdfPage.getHeight()).toBeCloseTo(792, 1);

    expect(browserErrors).toEqual([]);
  });
});
