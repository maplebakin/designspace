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
    await expect(page.getByTestId('document-paper-color')).toHaveValue('#faf8f5');
    await expect(page.getByTestId('document-export-root')).toHaveAttribute(
      'data-paper-color',
      '#FAF8F5'
    );
    expect(await page.getByTestId('document-page').evaluate(
      (element) => window.getComputedStyle(element).backgroundColor
    )).toBe('rgb(250, 248, 245)');

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

  test('authors a page-50-style composition from a blank document through visible controls', async ({ page }) => {
    test.slow();
    test.setTimeout(180_000);
    await page.goto('/');
    await page.getByTestId('dashboard-new-document').click();
    await page.getByTestId('document-project-name').fill(
      'Blank Authoring Acceptance'
    );
    await page.getByRole('button', { name: '3 columns' }).click();
    await page.getByTestId('document-starting-folio').fill('49');
    await page.getByTestId('document-show-folios').click();

    const body = page.locator('.document-flow-prosemirror');
    await body.fill('Opening translated body text for the article.');
    await body.press('End');
    await body.press('Enter');
    await body.type('The family and the old river road');
    await page.getByTestId('document-block-style').selectOption(
      'subsection-heading'
    );
    await expect(body.locator('[data-document-style-id="subsection-heading"]'))
      .toContainText('The family and the old river road');
    await body.press('End');
    await body.press('Enter');
    await body.type('The next paragraph begins in a deliberate column.');
    await page.getByRole('button', { name: 'Insert column break' }).click();
    await expect(body.locator(
      '[data-document-column-break-before="true"]'
    )).toHaveCount(1);

    const firstImage = {
      name: 'family-photo-a.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PHOTO_PNG_BASE64, 'base64'),
    };
    const secondImage = {
      name: 'family-photo-b.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PHOTO_PNG_BASE64, 'base64'),
    };
    await page.getByTestId('document-image-file-input').setInputFiles([
      firstImage,
      secondImage,
    ]);
    await expect(page.locator('.document-image-node')).toHaveCount(2);

    const sourceImages = page.locator('.document-image-node');
    await sourceImages.nth(0).click();
    await sourceImages.nth(1).click({ modifiers: ['Shift'] });
    await expect(page.getByTestId('document-image-group-selection'))
      .toHaveAttribute('data-image-count', '2');
    await expect(sourceImages.nth(0)).toHaveAttribute(
      'data-image-selected',
      'true'
    );
    await expect(sourceImages.nth(1)).toHaveAttribute(
      'data-image-selected',
      'true'
    );

    await page.getByTestId('document-image-group-row').click();
    const layout = page.locator('[data-document-span-layout]');
    await expect(layout).toHaveAttribute('data-image-group-count', '1');
    await expect(layout.locator(
      '[data-layout-role="occupied-columns"]'
    )).toHaveCount(2);

    const firstSlot = layout.locator(
      '[data-layout-role="occupied-columns"]'
    ).nth(0);
    const secondSlot = layout.locator(
      '[data-layout-role="occupied-columns"]'
    ).nth(1);
    const groupId = await firstSlot.getAttribute('data-image-group-id');
    expect(groupId).toBeTruthy();
    await firstSlot.click();
    await expect(page.getByTestId('document-image-group-selection')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('document-image-group-selection'))
      .toHaveAttribute('data-group-id', groupId!);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('document-image-group-selection')).toHaveCount(0);
    await firstSlot.click();
    await firstSlot.click();
    await page.getByLabel('Image width').fill('180');
    await page.getByLabel('Image caption').fill('First family photograph');
    await page.getByTestId('document-image-crop-mode').selectOption('fill');
    await page.getByLabel('Image height').fill('160');
    await page.getByTestId('document-image-crop-focal-x').fill('0.2');
    await page.getByTestId('document-image-crop-focal-y').fill('0.8');
    await expect(layout).toContainText(
      'First family photograph'
    );

    await secondSlot.click();
    await page.getByLabel('Image width').fill('260');
    await page.getByLabel('Image caption').fill('Second family photograph');
    await expect(layout).toContainText(
      'Second family photograph'
    );

    await page.getByTestId('document-image-group-gap').fill('28');
    await page.getByTestId('document-image-align-left').click();
    await expect(page.getByTestId('document-image-group-gap')).toHaveValue('28');
    const positions = await layout.locator(
      '[data-layout-role="occupied-columns"]'
    ).evaluateAll((slots) => slots.map((slot) => Number(
      (slot as HTMLElement).dataset.imageLeftPx
    )));
    const renderedWidths = await layout.locator(
      '[data-layout-role="occupied-columns"]'
    ).evaluateAll((slots) => slots.map((slot) => (
      (slot as HTMLElement).getBoundingClientRect().width
    )));
    expect(positions).toHaveLength(2);
    expect(renderedWidths[0]).not.toBe(renderedWidths[1]);

    await page.getByTestId('document-add-page').click();
    await expect(page.getByTestId('document-page-tab-1')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await page.getByTestId('document-suppress-title').click();
    await expect(page.getByTestId('document-title-placeholder')).toHaveCount(0);
    await page.locator('.document-flow-prosemirror').fill(
      'Continuation text without a title region.'
    );
    await expect(page.getByTestId('document-folio')).toHaveText('50');

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);
    await page.getByRole('button', { name: 'Back to projects' }).click();
    const savedCard = page.getByTestId('dashboard-project-card').filter({
      hasText: 'Blank Authoring Acceptance',
    });
    await expect(savedCard).toBeVisible();
    await savedCard.getByRole('button').first().click();

    await expect(page.getByTestId('document-page-tab-1')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.getByTestId('document-title-placeholder')).toHaveCount(0);
    await expect(page.getByTestId('document-folio')).toHaveText('50');
    await page.getByTestId('document-page-tab-0').click();
    await expect(page.locator('[data-document-span-layout]'))
      .toHaveAttribute('data-image-group-count', '1');
    await expect(page.locator(
      '[data-document-span-layout] [data-image-group-id] .document-image__frame'
    ).first()).toHaveAttribute('data-crop-mode', 'fill');
    await expect(page.locator(
      '[data-document-span-layout] [data-image-group-id] .document-image__frame'
    ).first()).toHaveAttribute('data-crop-focal-y', '0.8');
    await expect(page.locator('[data-document-span-layout]')).toContainText(
      'First family photograph'
    );
    await expect(page.locator('[data-document-span-layout]')).toContainText(
      'Second family photograph'
    );
    await expect(page.locator('[data-document-span-layout]')).toContainText(
      'The family and the old river road'
    );
    await expect(page.getByTestId('document-folio')).toHaveText('49');
    const reopenedSlots = page.locator(
      '[data-document-span-layout] [data-layout-role="occupied-columns"]'
    );
    const reopenedWidths = await reopenedSlots.evaluateAll((slots) => slots.map(
      (slot) => (slot as HTMLElement).getBoundingClientRect().width
    ));
    expect(reopenedWidths).toHaveLength(2);
    expect(reopenedWidths[0]).not.toBe(reopenedWidths[1]);

    const exportRoot = page.getByTestId('document-export-root');
    await expect(exportRoot).toHaveAttribute('data-folio-number', '49');
    await expect(exportRoot.locator(
      '[data-document-span-layout] [data-document-image="true"]'
    ))
      .toHaveCount(2);
    await expect(exportRoot.locator(
      '[data-document-span-layout] figcaption'
    )).toHaveCount(2);
    await expect(exportRoot).toContainText('First family photograph');
    await expect(exportRoot).toContainText('Second family photograph');

    const pdfDownloadPromise = page.waitForEvent('download');
    await (await openExportFormat(page, 'PDF')).click();
    const pdfDownload = await pdfDownloadPromise;
    const pdfPath = await pdfDownload.path();
    expect(pdfPath).not.toBeNull();
    const pdf = await PDFDocument.load(await readFile(pdfPath!));
    expect(pdf.getPages()).toHaveLength(2);
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

  test('edits, reorders, persists, and exports four independently numbered pages', async ({ page }) => {
    test.slow();
    test.setTimeout(180_000);

    await page.goto('/');
    await page.getByTestId('dashboard-new-document').click();
    await page.getByTestId('document-project-name').fill(
      'Historical Four Page Article'
    );
    await page.getByTestId('document-starting-folio').fill('49');
    await expect(page.getByTestId('document-show-folios')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    await page.getByTestId('document-show-folios').click();
    await expect(page.getByTestId('document-show-folios')).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    const title = page.locator('.document-title-prosemirror');
    const body = page.locator('.document-flow-prosemirror');
    const editActivePage = async (folio: number) => {
      await title.fill(`Historical title ${folio}`);
      await body.fill(`Independent story for source page ${folio}.`);
      await expect(title).toContainText(`Historical title ${folio}`);
      await expect(body).toContainText(
        `Independent story for source page ${folio}.`
      );
    };

    await editActivePage(49);
    for (const folio of [50, 51, 52]) {
      await page.getByTestId('document-add-page').click();
      const pageIndex = folio - 49;
      await expect(page.getByTestId(
        `document-page-tab-${pageIndex}`
      )).toHaveAttribute('aria-selected', 'true');
      await editActivePage(folio);
    }
    await expect(page.getByTestId('document-page-navigation').getByRole(
      'tab'
    )).toHaveCount(4);

    const sourceStoryByIndex = [49, 50, 51, 52];
    const verifyPage = async (
      pageIndex: number,
      folio: number,
      sourceStory: number,
      side: 'left' | 'right'
    ) => {
      await page.getByTestId(`document-page-tab-${pageIndex}`).click();
      await expect(page.getByTestId(
        `document-page-tab-${pageIndex}`
      )).toHaveAttribute('aria-selected', 'true');
      await expect(title).toContainText(`Historical title ${sourceStory}`);
      await expect(body).toContainText(
        `Independent story for source page ${sourceStory}.`
      );
      await expect(page.getByTestId('document-export-root')).toHaveAttribute(
        'data-folio-number',
        String(folio)
      );
      await expect(page.getByTestId('document-export-root')).toHaveAttribute(
        'data-page-parity',
        folio % 2 === 0 ? 'verso' : 'recto'
      );
      await expect(page.getByTestId('document-export-root')).toHaveAttribute(
        'data-folio-side',
        side
      );
      await expect(page.getByTestId('document-folio')).toHaveText(
        String(folio)
      );
      await expect(page.getByTestId('document-folio')).toHaveAttribute(
        'data-folio-side',
        side
      );
    };

    for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
      const folio = 49 + pageIndex;
      await verifyPage(
        pageIndex,
        folio,
        sourceStoryByIndex[pageIndex],
        folio % 2 === 0 ? 'left' : 'right'
      );
    }

    await page.getByTestId('document-page-tab-2').click();
    await page.getByTestId('document-suppress-folio').click();
    await expect(page.getByTestId('document-folio')).toHaveCount(0);
    await expect(page.getByTestId('document-export-root')).toHaveAttribute(
      'data-folio-number',
      '51'
    );
    await page.getByTestId('document-suppress-folio').click();
    await expect(page.getByTestId('document-folio')).toHaveText('51');

    // Move source page 51 one slot left. Its story follows the page, while
    // folios are derived from the new order.
    await page.getByTestId('document-move-page-left').click();
    await verifyPage(1, 50, 51, 'left');
    await verifyPage(2, 51, 50, 'right');
    const reorderedSourceStories = [49, 51, 50, 52];

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);
    await page.getByRole('button', { name: 'Back to projects' }).click();
    const savedCard = page.getByTestId('dashboard-project-card').filter({
      hasText: 'Historical Four Page Article',
    });
    await expect(savedCard).toBeVisible();
    await savedCard.getByRole('button').first().click();

    await expect(page.getByTestId('document-editor-shell')).toBeVisible();
    await expect(page.getByTestId('document-page-navigation').getByRole(
      'tab'
    )).toHaveCount(4);
    for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
      const folio = 49 + pageIndex;
      await verifyPage(
        pageIndex,
        folio,
        reorderedSourceStories[pageIndex],
        folio % 2 === 0 ? 'left' : 'right'
      );
    }

    const pdfDownloadPromise = page.waitForEvent('download');
    await (await openExportFormat(page, 'PDF')).click();
    const pdfDownload = await pdfDownloadPromise;
    const pdfPath = await pdfDownload.path();
    expect(pdfPath).not.toBeNull();
    const pdf = await PDFDocument.load(await readFile(pdfPath!));
    const pdfPages = pdf.getPages();
    expect(pdfPages).toHaveLength(4);
    for (const pdfPage of pdfPages) {
      expect(pdfPage.getWidth()).toBeCloseTo(8.5 * 72, 1);
      expect(pdfPage.getHeight()).toBeCloseTo(11 * 72, 1);
    }
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
      '[data-layout-role="physical-column"]'
    )).toHaveCount(3);
    await expect(layout.locator(
      '[data-layout-role="physical-column"][data-column="3"]'
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
      '[data-layout-role="explicit-text-column"]'
    )).not.toHaveCount(0);
    const bodyPhraseCounts = await layout.evaluate((root) => {
      const text = Array.from(root.querySelectorAll<HTMLElement>(
        '[data-layout-role="explicit-text-column"]'
      )).map((region) => region.textContent || '').join('');
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
        '[data-layout-role="physical-column"]'
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
        wordBreaks: Array.from(root.querySelectorAll<HTMLElement>(
          '[data-layout-role="explicit-text-column"]'
        )).map((column) => getComputedStyle(column).wordBreak),
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
      '[data-layout-role="physical-column"][data-column="1"]'
    );
    const columnTwoAbove = layout.locator(
      '[data-layout-role="physical-column"][data-column="2"]'
    );
    const columnThreeAbove = layout.locator(
      '[data-layout-role="physical-column"][data-column="3"]'
    );
    const columnTwoBelow = layout.locator(
      '[data-layout-role="explicit-text-column"][data-column="2"]'
    ).last();
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
    // Structured text regions own hit-testing; the transparent ProseMirror
    // source remains a keyboard/input layer and must not intercept clicks.
    await expect(page.locator(
      '.document-flow-editor__content--structured-text-editing'
    )).toHaveCSS('pointer-events', 'none');
    await columnOne.locator('p').first().click();
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
    await page.getByTestId('document-image-horizontal-placement')
      .selectOption('right');
    await expect(sourceImage).toHaveAttribute(
      'data-horizontal-placement',
      'right'
    );
    await expect.poll(async () => imageSlot.evaluate((slot) => {
      const root = slot.closest<HTMLElement>('[data-document-span-layout]')!;
      return Math.abs(
        root.getBoundingClientRect().right
        - slot.getBoundingClientRect().right
      );
    })).toBeLessThan(1);
    const resizeHandle = imageSlot.getByRole('button', {
      name: 'Resize image',
    });
    await expect(resizeHandle).toBeVisible();
    await expect(page.locator(
      '.document-image__resize-handle:visible'
    )).toHaveCount(1);
    const widthBeforeResize = Number(
      await sourceImage.getAttribute('data-width-px')
    );
    const heightBeforeResize = Number(
      await sourceImage.getAttribute('data-height-px')
    );
    const yBeforeResize = Number(
      await sourceImage.getAttribute('data-y-px')
    );
    const resizeBox = await resizeHandle.boundingBox();
    expect(resizeBox).not.toBeNull();
    await page.mouse.move(
      resizeBox!.x + resizeBox!.width / 2,
      resizeBox!.y + resizeBox!.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      resizeBox!.x + resizeBox!.width / 2 - 40,
      resizeBox!.y + resizeBox!.height / 2
    );
    await expect.poll(async () =>
      Number(await layout.getAttribute('data-rendered-image-width-px'))
    ).toBeLessThan(widthBeforeResize);
    expect(Number(
      await sourceImage.getAttribute('data-width-px')
    )).toBe(widthBeforeResize);
    expect(Number(
      await sourceImage.getAttribute('data-y-px')
    )).toBe(yBeforeResize);
    await expect.poll(async () => imageSlot.evaluate((slot) => {
      const root = slot.closest<HTMLElement>('[data-document-span-layout]')!;
      return Math.abs(
        root.getBoundingClientRect().right
        - slot.getBoundingClientRect().right
      );
    })).toBeLessThan(1);
    await page.mouse.up();
    await expect.poll(async () =>
      Number(await sourceImage.getAttribute('data-width-px'))
    ).toBeLessThan(widthBeforeResize);
    const committedWidth = Number(
      await sourceImage.getAttribute('data-width-px')
    );
    const committedHeight = Number(
      await sourceImage.getAttribute('data-height-px')
    );
    expect(committedHeight).toBe(Math.round(committedWidth * 48 / 64));
    expect(committedHeight).toBeLessThan(heightBeforeResize);
    expect(Number(
      await sourceImage.getAttribute('data-y-px')
    )).toBe(yBeforeResize);

    const clickOnlyState = {
      width: committedWidth,
      height: committedHeight,
      y: yBeforeResize,
    };
    await imageSlot.getByRole('button', { name: 'Resize image' }).click();
    expect({
      width: Number(await sourceImage.getAttribute('data-width-px')),
      height: Number(await sourceImage.getAttribute('data-height-px')),
      y: Number(await sourceImage.getAttribute('data-y-px')),
    }).toEqual(clickOnlyState);

    const slotBox = await imageSlot.boundingBox();
    expect(slotBox).not.toBeNull();
    const imageYBeforeDrag = Number(
      await layout.getAttribute('data-image-top-px')
    );
    const imageXBeforeDrag = Number(
      await layout.getAttribute('data-image-left-px')
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
      slotBox!.x + slotBox!.width / 2 - 30,
      slotBox!.y + Math.min(40, slotBox!.height / 2) + 40
    );
    const snapXGuidePosition = await layout.locator(
      '[data-snap-axis="x"]'
    ).evaluate((guide) => Number.parseFloat(
      (guide as HTMLElement).style.left
    ));
    const previewImageWidth = Number(
      await imageSlot.locator('[data-layout-role="spanning-image"]')
        .getAttribute('data-rendered-width-px')
    );
    const previewImageLeft = Number(
      await layout.getAttribute('data-image-left-px')
    );
    expect(Math.min(
      Math.abs(previewImageLeft - snapXGuidePosition),
      Math.abs(previewImageLeft + previewImageWidth / 2 - snapXGuidePosition),
      Math.abs(previewImageLeft + previewImageWidth - snapXGuidePosition)
    )).toBeLessThan(0.5);
    await page.mouse.up();
    await expect.poll(async () =>
      Number(await layout.getAttribute('data-image-top-px'))
    ).toBeGreaterThan(imageYBeforeDrag);
    const committedImageY = Number(
      await layout.getAttribute('data-image-top-px')
    );
    const committedImageX = Number(
      await layout.getAttribute('data-image-left-px')
    );
    const committedImageWidth = Number(
      await imageSlot.locator('[data-layout-role="spanning-image"]')
        .getAttribute('data-rendered-width-px')
    );
    expect(committedImageY - imageYBeforeDrag)
      .toBeCloseTo(40 / (zoomPercent / 100), 0);
    expect(Math.min(
      Math.abs(committedImageX - snapXGuidePosition),
      Math.abs(committedImageX + committedImageWidth / 2 - snapXGuidePosition),
      Math.abs(committedImageX + committedImageWidth - snapXGuidePosition)
    )).toBeLessThan(0.5);
    await expect(sourceImage).toHaveAttribute(
      'data-horizontal-placement',
      'custom'
    );
    const columnsTwoThreeGeometry = await layout.evaluate((root) => {
      const rootRect = root.getBoundingClientRect();
      const occupiedRect = root.querySelector<HTMLElement>(
        '[data-layout-role="occupied-columns"]'
      )!.getBoundingClientRect();
      const imageRect = root.querySelector<HTMLElement>(
        '[data-layout-role="spanning-image"]'
      )!.getBoundingClientRect();
      const sideRect = root.querySelector<HTMLElement>(
        '[data-layout-role="physical-column"][data-column="1"]'
      )!.getBoundingClientRect();
      const lowerColumns = Array.from(root.querySelectorAll<HTMLElement>(
        '[data-layout-role="explicit-text-column"]'
      )).filter((column) =>
        Number(column.dataset.bandTopPx) > Number(
          root.getAttribute('data-image-top-px')
        )
      );
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
    expect(columnsTwoThreeGeometry.lowerColumnTextLengths.length)
      .toBeGreaterThan(0);
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
    await expect.poll(async () =>
      Number(await reloadedLayout.getAttribute('data-image-left-px'))
    ).toBeCloseTo(committedImageX, 0);
    await expect(reloadedLayout.locator(
      '[data-layout-role="physical-column"][data-column="1"]'
    ))
      .not.toContainText(
        'The article continues beneath the photograph with later memories.'
      );
    await expect(reloadedLayout.locator('figcaption')).toHaveText(
      'The Harwood family outside the farmhouse'
    );
    await expect(reloadedLayout.locator(
      '[data-layout-role="explicit-text-column"][data-column="2"]'
    ).last()).not.toBeEmpty();

    const pngDownloadPromise = page.waitForEvent('download');
    await (await openExportFormat(page, 'PNG')).click();
    const pngDownload = await pngDownloadPromise;
    expect(await pngDownload.path()).not.toBeNull();
    await expect(page.locator('[data-document-reference-layer]')).toHaveCount(0);
    await expect(page.locator('canvas.upper-canvas')).toHaveCount(0);
  });

  test('creates and reloads two independently positioned spanning images', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/');
    await page.getByTestId('dashboard-new-document').click();
    await page.getByTestId('document-project-name').fill(
      'Two Positioned Photographs'
    );
    await page.getByRole('button', { name: '3 columns' }).click();
    await page.locator('.document-flow-prosemirror').fill(
      `${'Historical article text flows around both photographs. '.repeat(40)}`
    );

    const insertPhoto = async (name: string, yPx: string) => {
      await page.getByTestId('document-image-file-input').setInputFiles({
        name,
        mimeType: 'image/png',
        buffer: Buffer.from(PHOTO_PNG_BASE64, 'base64'),
      });
      // Import selects the new stable-ID node even when an existing structured
      // image visually covers the source Tiptap figure.
      await expect(page.getByTestId('document-image-wrap')).toHaveValue(
        'float-left'
      );
      await page.getByTestId('document-image-wrap').selectOption('span-2');
      await page.getByTestId('document-image-vertical-anchor')
        .selectOption('page-position');
      await page.getByTestId('document-image-y-position').fill(yPx);
    };

    await insertPhoto('first-family-photo.png', '120');
    const layout = page.locator('[data-document-span-layout]');
    await expect(layout).toHaveAttribute('data-structured-image-count', '1');

    await layout.locator(
      '[data-layout-role="explicit-text-column"]'
    ).first().click();
    await expect(layout).toHaveAttribute('data-text-editing', 'true');
    await insertPhoto('second-family-photo.png', '390');

    await expect(layout).toHaveAttribute('data-structured-image-count', '2');
    await expect(layout.locator(
      '[data-layout-role="occupied-columns"]'
    )).toHaveCount(2);
    const committedIds = await layout.locator(
      '[data-layout-role="occupied-columns"]'
    ).evaluateAll((slots) => slots.map(
      (slot) => slot.getAttribute('data-image-id')
    ));
    expect(new Set(committedIds).size).toBe(2);

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);
    await page.getByRole('button', { name: 'Back to projects' }).click();
    const card = page.getByTestId('dashboard-project-card')
      .filter({ hasText: 'Two Positioned Photographs' });
    await card.getByRole('button').first().click();

    const reloaded = page.locator('[data-document-span-layout]');
    await expect(reloaded).toHaveAttribute('data-structured-image-count', '2');
    await expect(reloaded.locator(
      '[data-layout-role="occupied-columns"]'
    )).toHaveCount(2);
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
    await page.getByTestId('document-paper-color').fill('#e7dcc8');
    await expect(page.getByTestId('document-export-root')).toHaveAttribute(
      'data-paper-color',
      '#E7DCC8'
    );
    expect(await page.getByTestId('document-page').evaluate(
      (element) => window.getComputedStyle(element).backgroundColor
    )).toBe('rgb(231, 220, 200)');
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
    await page.getByTestId('document-image-wrap-padding-right').fill('14');
    await page.getByTestId('document-image-wrap-padding-bottom').fill('14');
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
    await expect(page.getByTestId('document-paper-color')).toHaveValue('#e7dcc8');
    await expect(page.getByTestId('document-export-root')).toHaveAttribute(
      'data-paper-color',
      '#E7DCC8'
    );
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
      corner: [231, 220, 200, 255],
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
