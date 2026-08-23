import { expect, test, type Page } from '@playwright/test';
import { createScannedReferenceFixture } from './fixtures/scanned-reference-page';

const PHOTO_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAYAAAChS3wfAAAABmJLR0QA/wD/AP+gvaeTAAABa0lEQVRogeWZS5LDIAxEJXyK3GauNadnNuPQzceQbN8KVeJuBNJTlZN8/fzWkhEla7T1LL6+0q2/v77UrZ69jp7NiMwa9/ps6rHqPA7x63XrPVQ3xlX85vn0vrvcMiNKiRolIu41IyKj/q8a13fcNKu4il/tPMY9ZrrVHrN8+vg0txLSAadVX9+s3/KuOvrZrur5QW5lkU8fv3VjOz+19nkL7hJYH2y+xz637mAb7FrhidxbBwC513wKknvzBXJvuCK5t3yA3E9mAI37YQawuJ/MABr36gvkXn2HDmBwr75A7hvCXQdwuG/dWZDcq47IvemQ3JsXkHu7ECT36kXk3jsAyf1yBjC4f5gBEO7XM4DB/cMMoHBvM4DHvRURyb34FST3mgOReysWknvX8bi330CR3FsM5H4yA3Dc9zOAxb2dk8m9+gK5t9yg3OsePO7b/6Dhr8Mc7u9OlxlA4t4uCsp90yC5Vy8i9+r1B7Q45ELbjS61AAAAAElFTkSuQmCC';

const bodyCopy = [
  'The reconstructed page keeps the upper article readable while photographs remain independently positioned below the columns.',
  'Typing in the body should remain immediate even when the canonical structured compositor has expensive image and reference work to reconcile.',
].join(' ').repeat(12);

const openStructuredReconstruction = async (page: Page) => {
  await page.goto('/');
  await page.getByTestId('dashboard-new-document').click();
  await page.getByTestId('document-project-name').fill('Live structured typing performance');
  await page.getByRole('button', { name: '3 columns' }).click();
  await page.locator('.document-flow-prosemirror').fill(bodyCopy);

  const reference = await createScannedReferenceFixture();
  await page.getByTestId('document-reference-file-input').setInputFiles({
    name: 'typing-reference.pdf',
    mimeType: 'application/pdf',
    buffer: reference.pdf,
  });
  await expect(page.getByTestId('document-reference-layer'))
    .toHaveAttribute('data-reference-image-state', 'loaded', { timeout: 20_000 });
};

const addPhoto = async (page: Page, name: string) => {
  await page.getByTestId('document-image-file-input').setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: Buffer.from(PHOTO_PNG_BASE64, 'base64'),
  });
  const sourceImage = page.locator('.document-image-node').last();
  await expect(sourceImage).toBeAttached();
  const imageId = await sourceImage.getAttribute('data-image-id');
  if (!imageId) throw new Error(`Photo ${name} has no persistent image ID`);
  if (await sourceImage.isVisible()) {
    await sourceImage.click();
  } else {
    await page.locator(
      `[data-layout-role="flow-image-hit-target"][data-image-id="${imageId}"]`
    ).click();
  }
  await expect(page.getByTestId('document-image-wrap')).toBeVisible();
  return imageId;
};

const configureSelectedPhoto = async (page: Page, span: 'span-2' | 'span-3') => {
  await page.getByTestId('document-image-wrap').selectOption(span);
  await page.getByTestId('document-image-vertical-anchor')
    .selectOption('page-position');
  await expect(page.getByTestId('document-image-vertical-anchor'))
    .toHaveValue('page-position');
};

const enterStructuredTextEditing = async (page: Page) => {
  const textBand = page.locator(
    '[data-document-span-layout] [data-document-region-id]'
  ).first();
  await expect(textBand).toBeVisible();
  await textBand.click();
  await expect(page.locator('.document-flow-editor__content--structured-text-editing'))
    .toBeVisible();
  const presentation = await page.locator('.document-flow-prosemirror').evaluate(
    (element) => ({
      color: getComputedStyle(element).color,
      caretColor: getComputedStyle(element).caretColor,
      text: element.textContent || '',
    })
  );
  expect(presentation.color).not.toMatch(/transparent|rgba\(0, 0, 0, 0\)/);
  expect(presentation.caretColor).not.toMatch(/transparent|rgba\(0, 0, 0, 0\)/);
};

const readTypingDiagnostics = async (page: Page) => page.locator(
  '[data-document-span-layout]'
).evaluate((element) => ({
  inputCount: Number(element.closest('[data-testid="document-flow-editor"]')
    ?.getAttribute('data-typing-input-count')),
  visibleUpdateCount: Number(element.closest('[data-testid="document-flow-editor"]')
    ?.getAttribute('data-typing-visible-update-count')),
  lastInputToVisibleMs: Number(element.closest('[data-testid="document-flow-editor"]')
    ?.getAttribute('data-typing-last-input-to-visible-ms')),
  modelBuildCount: Number(element.getAttribute('data-layout-model-build-count')),
  lastModelBuildDurationMs: Number(
    element.getAttribute('data-last-layout-build-duration-ms')
  ),
  totalModelBuildDurationMs: Number(
    element.getAttribute('data-total-layout-build-duration-ms')
  ),
  measurementCount: Number(
    element.getAttribute('data-structured-measurement-count')
  ),
  measurementDurationMs: Number(
    element.getAttribute('data-structured-measurement-duration-ms')
  ),
  totalMeasurementCount: Number(
    element.getAttribute('data-total-structured-measurement-count')
  ),
  totalMeasurementDurationMs: Number(
    element.getAttribute('data-total-structured-measurement-duration-ms')
  ),
}));

const readStateChurnDiagnostics = async (page: Page) => page.getByTestId(
  'document-editor-shell'
).evaluate((element) => {
  const number = (name: string) => Number(element.getAttribute(name) || 0);
  return {
    shellRenders: number('data-state-churn-shell-renders'),
    projectSubscriberUpdates: number('data-state-churn-project-subscriber-updates'),
    projectReplacements: number('data-state-churn-project-replacements'),
    projectChangeNotifications: number('data-state-churn-project-change-notifications'),
    updatePage: number('data-state-churn-update-page-count'),
    updateBodyContent: number('data-state-churn-update-body-count'),
    updateTitleContent: number('data-state-churn-update-title-count'),
    normalize: number('data-state-churn-normalize-count'),
    equivalence: number('data-state-churn-equivalence-count'),
    omitMetadata: number('data-state-churn-omit-count'),
    groupCollect: number('data-state-churn-group-collect-count'),
    groupRepair: number('data-state-churn-group-repair-count'),
    authoredDiff: number('data-state-churn-diff-count'),
    authoredProjection: number('data-state-churn-projection-count'),
    toolbar: number('data-state-churn-toolbar-count'),
    draftFlushes: number('data-state-churn-draft-flushes'),
    fastTextCommits: number('data-state-churn-fast-text-commits'),
    overflowMeasures: number('data-state-churn-overflow-count'),
    overflowMeasureMs: number('data-state-churn-overflow-ms'),
    proseMirrorMs: number('data-state-churn-prosemirror-ms'),
    shellUpdateMs: number('data-state-churn-shell-update-ms'),
    updatePageMs: number('data-state-churn-update-page-ms'),
    normalizeMs: number('data-state-churn-normalize-ms'),
    equivalenceMs: number('data-state-churn-equivalence-ms'),
    omitMetadataMs: number('data-state-churn-omit-ms'),
    groupRepairMs: number('data-state-churn-group-repair-ms'),
    authoredProjectionMs: number('data-state-churn-projection-ms'),
    toolbarMs: number('data-state-churn-toolbar-ms'),
  };
});

test.describe('structured live typing performance', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('keeps live typing immediate and defers structured composition', async ({ page }) => {
    test.slow();
    await openStructuredReconstruction(page);
    await addPhoto(page, 'typing-photo-a.png');
    await configureSelectedPhoto(page, 'span-2');
    await page.getByTestId('document-image-caption').fill('Photo A');
    await addPhoto(page, 'typing-photo-b.png');
    await configureSelectedPhoto(page, 'span-2');
    await page.getByTestId('document-image-caption').fill('Photo B');

    await enterStructuredTextEditing(page);

    const before = await readTypingDiagnostics(page);
    const beforeStateChurn = await readStateChurnDiagnostics(page);
    const sentence = ' Immediate structured typing feedback must stay responsive.';
    await page.locator('.document-flow-prosemirror').type(sentence, { delay: 45 });
    await expect.poll(async () => (await readTypingDiagnostics(page)).inputCount)
      .toBeGreaterThanOrEqual(sentence.length);
    await page.waitForTimeout(250);
    const after = await readTypingDiagnostics(page);
    const afterStateChurn = await readStateChurnDiagnostics(page);
    console.log('structured typing diagnostics', {
      before,
      after,
      beforeStateChurn,
      afterStateChurn,
      inputToVisibleMs: after.lastInputToVisibleMs,
      modelBuildsDuringBurst: after.modelBuildCount - before.modelBuildCount,
    });

    expect(after.inputCount - before.inputCount).toBe(sentence.length);
    expect(after.modelBuildCount - before.modelBuildCount)
      .toBeLessThan(sentence.length / 2);
    expect(after.visibleUpdateCount).toBeGreaterThan(before.visibleUpdateCount);
    expect(afterStateChurn.projectReplacements - beforeStateChurn.projectReplacements)
      .toBeLessThanOrEqual(1);
    expect(afterStateChurn.updatePage - beforeStateChurn.updatePage).toBe(0);
    expect(afterStateChurn.normalize - beforeStateChurn.normalize).toBeLessThanOrEqual(1);
    expect(afterStateChurn.equivalence - beforeStateChurn.equivalence).toBe(0);
    expect(afterStateChurn.groupRepair - beforeStateChurn.groupRepair).toBe(0);

    await page.waitForTimeout(650);
    const reconciled = await readTypingDiagnostics(page);
    expect(reconciled.modelBuildCount).toBeGreaterThan(after.modelBuildCount);
    await expect(page.locator('.document-flow-prosemirror'))
      .toContainText(sentence);
  });

  test('keeps a five-second burst live and postpones both composition and autosave', async ({ page }) => {
    test.slow();
    await openStructuredReconstruction(page);
    await addPhoto(page, 'long-typing-photo-a.png');
    await configureSelectedPhoto(page, 'span-2');
    await page.getByTestId('document-image-caption').fill('Photo A');
    await addPhoto(page, 'long-typing-photo-b.png');
    await configureSelectedPhoto(page, 'span-2');
    await page.getByTestId('document-image-caption').fill('Photo B');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);
    await enterStructuredTextEditing(page);

    const layout = await readTypingDiagnostics(page);
    const beforeStateChurn = await readStateChurnDiagnostics(page);
    const baselineAutosaves = Number(
      await page.getByTestId('unified-project-header')
        .getAttribute('data-autosave-invocations')
    );
    const burst = 'The editor must keep every character visible while the historical page remains composed. ';
    await page.locator('.document-flow-prosemirror').type(burst, { delay: 55 });
    const duringBurst = await readTypingDiagnostics(page);
    const duringBurstStateChurn = await readStateChurnDiagnostics(page);
    expect(duringBurst.inputCount - layout.inputCount).toBe(burst.length);
    expect(duringBurst.modelBuildCount).toBe(layout.modelBuildCount);
    expect(duringBurstStateChurn.projectReplacements)
      .toBe(beforeStateChurn.projectReplacements);
    expect(duringBurstStateChurn.updatePage)
      .toBe(beforeStateChurn.updatePage);
    expect(duringBurstStateChurn.normalize)
      .toBe(beforeStateChurn.normalize);
    expect(duringBurstStateChurn.equivalence)
      .toBe(beforeStateChurn.equivalence);
    expect(duringBurstStateChurn.groupRepair)
      .toBe(beforeStateChurn.groupRepair);
    expect(Number(
      await page.getByTestId('unified-project-header')
        .getAttribute('data-autosave-invocations')
    )).toBe(baselineAutosaves);
    await expect(page.locator('.document-flow-prosemirror'))
      .toContainText(burst);
    console.log('structured five-second typing diagnostics', {
      duringBurst,
      beforeStateChurn,
      duringBurstStateChurn,
      baselineAutosaves,
      typedCharacters: burst.length,
    });

    await expect.poll(async () => (await readTypingDiagnostics(page)).modelBuildCount)
      .toBeGreaterThan(duringBurst.modelBuildCount);
    await expect.poll(async () => Number(
      await page.getByTestId('unified-project-header')
        .getAttribute('data-autosave-invocations')
    ), { timeout: 6_000 }).toBe(baselineAutosaves + 1);
  });
});
