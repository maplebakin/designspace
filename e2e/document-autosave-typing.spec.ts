import { expect, test, type Locator, type Page } from '@playwright/test';

type LifecycleDiagnostics = {
  authoredRevision: number;
  autosaveInvocations: number;
};

const readLifecycleDiagnostics = async (page: Page): Promise<LifecycleDiagnostics> => {
  const header = page.getByTestId('unified-project-header');
  return {
    authoredRevision: Number(await header.getAttribute('data-authored-revision')),
    autosaveInvocations: Number(await header.getAttribute('data-autosave-invocations')),
  };
};

const readTextStateChurn = async (page: Page) => page.getByTestId(
  'document-editor-shell'
).evaluate((element) => {
  const number = (name: string) => Number(element.getAttribute(name) || 0);
  return {
    projectReplacements: number('data-state-churn-project-replacements'),
    updatePage: number('data-state-churn-update-page-count'),
    normalize: number('data-state-churn-normalize-count'),
    equivalence: number('data-state-churn-equivalence-count'),
    groupRepair: number('data-state-churn-group-repair-count'),
  };
});

const createSavedDocument = async (page: Page, name: string) => {
  await page.goto('/');
  await page.getByTestId('dashboard-new-document').click();
  await page.getByTestId('document-project-name').fill(name);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);
  await expect.poll(async () => {
    const diagnostics = await readLifecycleDiagnostics(page);
    return diagnostics.autosaveInvocations;
  }).toBe(0);
};

const startSaveStatusObservation = async (page: Page) => {
  await page.evaluate(() => {
    const status = document.querySelector<HTMLElement>('[data-testid="document-save-status"]');
    if (!status) throw new Error('document save status is unavailable');
    const states = [status.dataset.state || ''];
    const observer = new MutationObserver(() => {
      states.push(status.dataset.state || '');
    });
    observer.observe(status, { attributes: true, attributeFilter: ['data-state'] });
    (window as Window & {
      __designSpaceSaveStatusObservation?: { states: string[]; observer: MutationObserver };
    }).__designSpaceSaveStatusObservation = { states, observer };
  });
};

const readSaveStatusObservation = async (page: Page) => page.evaluate(() => {
  const observation = (window as Window & {
    __designSpaceSaveStatusObservation?: { states: string[]; observer: MutationObserver };
  }).__designSpaceSaveStatusObservation;
  observation?.observer.disconnect();
  return observation?.states || [];
});

const observeLastTypingEvent = async (editor: Locator) => {
  await editor.evaluate((element) => {
    let lastKeyAt = performance.now();
    element.addEventListener('keydown', () => {
      lastKeyAt = performance.now();
    });
    (window as Window & {
      __designSpaceLastTypingEventAt?: () => number;
    }).__designSpaceLastTypingEventAt = () => lastKeyAt;
  });
};

const readLastTypingEventAt = async (page: Page) => page.evaluate(() => (
  (window as Window & {
    __designSpaceLastTypingEventAt?: () => number;
  }).__designSpaceLastTypingEventAt?.() || performance.now()
));

const waitUntilPageTime = async (page: Page, deadline: number) => {
  await page.evaluate((target) => new Promise<void>((resolve) => {
    window.setTimeout(resolve, Math.max(0, target - performance.now()));
  }), deadline);
};

const typeAtHumanPace = async (
  page: Page,
  editor: Locator,
  text: string
) => {
  for (const character of text) {
    await editor.type(character);
    await page.waitForTimeout(60);
  }
};

test.describe('unified autosave typing debounce', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('keeps body typing responsive and autosaves once after the 900ms idle window', async ({ page }) => {
    test.slow();
    await createSavedDocument(page, 'Body typing debounce regression');
    const baseline = await readLifecycleDiagnostics(page);
    const baselineStateChurn = await readTextStateChurn(page);
    await startSaveStatusObservation(page);

    const sentence = 'Continuous typing must remain unsaved until the pause.';
    const body = page.locator('.document-flow-prosemirror');
    await body.click();
    await observeLastTypingEvent(body);
    await typeAtHumanPace(page, body, sentence);

    await expect(body).toHaveText(sentence);
    const duringTyping = await readLifecycleDiagnostics(page);
    const duringTypingStateChurn = await readTextStateChurn(page);
    expect(duringTyping.authoredRevision - baseline.authoredRevision)
      .toBeGreaterThanOrEqual(sentence.length);
    expect(duringTyping.autosaveInvocations).toBe(baseline.autosaveInvocations);
    expect(duringTypingStateChurn).toEqual(baselineStateChurn);
    const lastTypingEventAt = await readLastTypingEventAt(page);
    const typingStatusStates = await page.evaluate(() => (
      (window as Window & {
        __designSpaceSaveStatusObservation?: { states: string[] };
      }).__designSpaceSaveStatusObservation?.states || []
    ));
    expect(typingStatusStates).not.toContain('saving');

    await waitUntilPageTime(page, lastTypingEventAt + 800);
    expect((await readLifecycleDiagnostics(page)).autosaveInvocations)
      .toBe(baseline.autosaveInvocations);

    await waitUntilPageTime(page, lastTypingEventAt + 1_000);
    await expect.poll(async () => (
      (await readLifecycleDiagnostics(page)).autosaveInvocations
    ), { timeout: 2_000 }).toBe(baseline.autosaveInvocations + 1);
    await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);
    await page.waitForTimeout(250);
    expect((await readLifecycleDiagnostics(page)).autosaveInvocations)
      .toBe(baseline.autosaveInvocations + 1);

    const statusStates = await readSaveStatusObservation(page);
    expect(statusStates).toContain('saving');
    expect(statusStates.filter((state) => state === 'saving')).toHaveLength(1);
  });

  test('applies the same trailing-edge lifecycle to title typing', async ({ page }) => {
    test.slow();
    await createSavedDocument(page, 'Title typing debounce regression');
    const baseline = await readLifecycleDiagnostics(page);
    const baselineStateChurn = await readTextStateChurn(page);
    await startSaveStatusObservation(page);

    const titleText = 'A title typed at a human pace';
    const title = page.locator('.document-title-prosemirror');
    // Empty titles expose an editor-only Add a title control. Use that real
    // affordance before typing so the regression follows the user workflow
    // without making the zero-flow editor surface a click shield over body
    // content.
    await page.getByTestId('document-title-placeholder').click();
    await expect(title).toBeFocused();
    await observeLastTypingEvent(title);
    await typeAtHumanPace(page, title, titleText);

    await expect(title).toHaveText(titleText);
    expect((await readLifecycleDiagnostics(page)).autosaveInvocations)
      .toBe(baseline.autosaveInvocations);
    expect(await readTextStateChurn(page)).toEqual(baselineStateChurn);
    const lastTypingEventAt = await readLastTypingEventAt(page);
    const typingStatusStates = await page.evaluate(() => (
      (window as Window & {
        __designSpaceSaveStatusObservation?: { states: string[] };
      }).__designSpaceSaveStatusObservation?.states || []
    ));
    expect(typingStatusStates).not.toContain('saving');
    await waitUntilPageTime(page, lastTypingEventAt + 800);
    expect((await readLifecycleDiagnostics(page)).autosaveInvocations)
      .toBe(baseline.autosaveInvocations);

    await waitUntilPageTime(page, lastTypingEventAt + 1_000);
    await expect.poll(async () => (
      (await readLifecycleDiagnostics(page)).autosaveInvocations
    ), { timeout: 2_000 }).toBe(baseline.autosaveInvocations + 1);
    await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);
    const statusStates = await readSaveStatusObservation(page);
    expect(statusStates).toContain('saving');
    expect(statusStates.filter((state) => state === 'saving')).toHaveLength(1);
  });

  test('flushes the live body draft before an immediate manual Save', async ({ page }) => {
    test.slow();
    const projectName = 'Immediate live draft save regression';
    await createSavedDocument(page, projectName);
    const bodyText = 'The latest body draft must reach the immediate manual save.';
    const body = page.locator('.document-flow-prosemirror');
    await body.click();
    await body.type(bodyText, { delay: 8 });
    await expect(body).toHaveText(bodyText);

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);
    await page.getByRole('button', { name: 'Back to projects' }).click();
    const savedCard = page.getByTestId('dashboard-project-card').filter({
      hasText: projectName,
    });
    await expect(savedCard).toBeVisible();
    await savedCard.getByRole('button').first().click();
    await expect(page.locator('.document-flow-prosemirror')).toContainText(bodyText);
  });

  test('flushes the live body draft before an immediate page switch', async ({ page }) => {
    test.slow();
    await createSavedDocument(page, 'Immediate live draft page switch regression');
    const bodyText = 'This page switch must not discard the newest body draft.';
    const body = page.locator('.document-flow-prosemirror');
    await body.click();
    await body.type(bodyText, { delay: 8 });
    await expect(body).toHaveText(bodyText);

    await page.getByTestId('document-add-page').click();
    await expect(page.getByTestId('document-page-tab-1')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await page.getByTestId('document-page-tab-0').click();
    await expect(page.getByTestId('document-page-tab-0')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.locator('.document-flow-prosemirror')).toContainText(bodyText);
  });
});
