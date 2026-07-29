import { expect, test } from '@playwright/test';

test.describe('document semantic typography', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('persists German named styles, semantic roles, and a configured drop cap', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto('/');
    await page.getByTestId('dashboard-new-document').click();
    await page.getByTestId('document-project-name').fill(
      'Historical Typography'
    );

    await page.getByTestId('document-language').selectOption('de');
    await page.getByTestId('document-named-style').selectOption(
      'article-title'
    );
    await page.getByLabel('Named style font size').fill('44');
    await page.getByLabel('Named style text colour').fill('#176aa5');

    const title = page.locator('.document-title-prosemirror');
    await title.fill('Eine historische Überschrift');
    await expect(title.locator('p')).toHaveAttribute(
      'data-document-style-id',
      'article-title'
    );
    await expect(title.locator('p')).toHaveCSS(
      'color',
      'rgb(23, 106, 165)'
    );

    const body = page.locator('.document-flow-prosemirror');
    await body.fill('Erster Absatz.');
    await body.press('End');
    await body.press('Enter');
    await body.type('Zweiter Abschnitt.');
    await expect(body.locator('p')).toHaveCount(2);
    await body.locator('p').nth(1).click();
    await page.getByTestId('document-block-style').selectOption(
      'subsection-heading'
    );
    await expect(body.locator('p').nth(1)).toHaveAttribute(
      'data-document-style-id',
      'subsection-heading'
    );

    await page.getByTestId('document-drop-cap-toggle').click();
    await page.getByLabel('Drop cap size').fill('4.25');
    await page.getByLabel('Drop cap line span').fill('4');
    await page.getByLabel('Drop cap spacing').fill('8');
    await page.getByLabel('Drop cap colour mode').selectOption('custom');
    await page.getByLabel('Drop cap custom colour').fill('#176aa5');

    await expect(page.locator('.document-flow-editor')).toHaveAttribute(
      'lang',
      'de'
    );
    await expect(page.locator('.document-flow-editor')).toHaveClass(
      /document-flow-editor--drop-cap/
    );
    await expect(page.getByTestId('document-export-root')).toHaveAttribute(
      'data-document-language',
      'de'
    );
    await expect(page.getByTestId('document-page')).toHaveCSS(
      '--document-style-article-title-font-size',
      '44px'
    );
    await expect(page.getByTestId('document-page')).toHaveCSS(
      '--document-drop-cap-color',
      '#176AA5'
    );

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('document-save-status')).toHaveText(/saved/i);
    await page.getByRole('button', { name: 'Back to projects' }).click();
    const projectCard = page.getByTestId('dashboard-project-card').filter({
      hasText: 'Historical Typography',
    });
    await projectCard.getByRole('button').first().click();

    await expect(page.getByTestId('document-language')).toHaveValue('de');
    await expect(page.getByTestId('document-drop-cap-toggle')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.getByTestId('document-page')).toHaveCSS(
      '--document-style-article-title-font-size',
      '44px'
    );
    await expect(page.locator('.document-flow-prosemirror p').nth(1))
      .toHaveAttribute('data-document-style-id', 'subsection-heading');
    await expect(page.getByTestId('document-export-root')).toHaveAttribute(
      'data-document-language',
      'de'
    );
  });
});
