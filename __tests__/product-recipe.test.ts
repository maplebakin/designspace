import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { CANVAS_SETTINGS_PRESETS } from '../src/editor/config/canvasPresets';
import {
  DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
  extractProductProjectFields,
} from '../src/editor/project/projectSchema';
import { buildProductForgeHandoff } from '../src/editor/productForge/buildProductForgeHandoff';
import { AdvancedExportManager } from '../src/editor/export/advancedExportManager';
import {
  generateProductForgeArtifacts,
  type ProductForgeArtifactExportManager,
} from '../src/editor/productForge/generateProductForgeArtifacts';
import { packageProductForgeZip } from '../src/editor/productForge/packageProductForgeZip';
import { chaosCraftPlannerRecipe } from '../src/editor/recipes/chaosCraftPlanner';
import { crochetPatternDecoderRecipe } from '../src/editor/recipes/crochetPatternDecoder';
import {
  generateProjectFromRecipe,
  getGeneratedRecipeObjectBounds,
} from '../src/editor/recipes/generateProjectFromRecipe';
import { getProductRecipe, productRecipeRegistry } from '../src/editor/recipes/recipeRegistry';

const testTheme = {
  meta: {
    schema: 'generic-token-pack-v1',
    id: 'theme-moon-kit',
    name: 'Moon Kit',
    slug: 'moon-kit',
    version: '1.2.3',
  },
  brand: {
    primary: { value: '#26483f' },
    accent: { value: '#c26a2c' },
  },
  typography: {
    heading: { value: '#1f2f2a' },
    body: { value: '#283330' },
    texthint: { value: '#6e7772' },
  },
  surfaces: {
    pagebackground: { value: '#fbf6ec' },
    surfaceplain: { value: '#fffdf8' },
  },
  borders: {
    bordersubtle: { value: '#ded2bf' },
  },
};

const getRecipeObjects = (page: any) =>
  page.canvasData.objects.filter((object: any) => object.recipeId === 'chaosCraftPlanner');

const getRecipeObjectsFor = (page: any, recipeId: string) =>
  page.canvasData.objects.filter((object: any) => object.recipeId === recipeId);

const getObjectBySlot = (page: any, slotId: string) => {
  const object = getRecipeObjects(page).find((entry: any) => entry.slotId === slotId);
  if (!object) throw new Error(`Missing generated object with slotId "${slotId}" on ${page.name}`);
  return object;
};

const getObjectBySlotFor = (page: any, recipeId: string, slotId: string) => {
  const object = getRecipeObjectsFor(page, recipeId).find((entry: any) => entry.slotId === slotId);
  if (!object) throw new Error(`Missing ${recipeId} object with slotId "${slotId}" on ${page.name}`);
  return object;
};

const getPageTexts = (page: any) =>
  getRecipeObjects(page)
    .map((object: any) => object.text)
    .filter((text: unknown): text is string => typeof text === 'string' && text.length > 0);

const getPageTextsFor = (page: any, recipeId: string) =>
  getRecipeObjectsFor(page, recipeId)
    .map((object: any) => object.text)
    .filter((text: unknown): text is string => typeof text === 'string' && text.length > 0);

const testBlob = (content: string, type: string) => new Blob([content], { type });

const makeMockArtifactExportManager = (
  options: {
    failPdf?: boolean;
    failPreviewCallNumbers?: number[];
  } = {}
): ProductForgeArtifactExportManager => {
  let previewCallCount = 0;
  return {
    exportPagesPdfBlob: vi.fn(async () => {
      if (options.failPdf) {
        throw new Error('PDF render failed');
      }
      return testBlob('pdf', 'application/pdf');
    }),
    exportPagesToBlobs: vi.fn(async () => {
      previewCallCount += 1;
      if (options.failPreviewCallNumbers?.includes(previewCallCount)) {
        throw new Error(`Preview render ${previewCallCount} failed`);
      }
      return [{
        pageNumber: 1,
        fileName: `preview-${previewCallCount}.png`,
        blob: testBlob(`png-${previewCallCount}`, 'image/png'),
      }];
    }),
  };
};

const expectObjectWithinPage = (
  object: any,
  page: any,
  options: { minInset?: number } = {}
) => {
  const bounds = getGeneratedRecipeObjectBounds(object);
  const minInset = options.minInset ?? 0;
  expect(bounds.left, `${object.id} left`).toBeGreaterThanOrEqual(minInset);
  expect(bounds.top, `${object.id} top`).toBeGreaterThanOrEqual(minInset);
  expect(bounds.right, `${object.id} right`).toBeLessThanOrEqual(page.canvasSize.width - minInset);
  expect(bounds.bottom, `${object.id} bottom`).toBeLessThanOrEqual(page.canvasSize.height - minInset);
};

describe('product recipe generation', () => {
  it('registers the chaosCraftPlanner recipe', () => {
    expect(productRecipeRegistry.chaosCraftPlanner).toBe(chaosCraftPlannerRecipe);
    expect(getProductRecipe('chaosCraftPlanner')?.name).toBe('Chaos Craft Planner');
  });

  it('registers the crochetPatternDecoder recipe', () => {
    expect(productRecipeRegistry.crochetPatternDecoder).toBe(crochetPatternDecoderRecipe);
    expect(getProductRecipe('crochetPatternDecoder')?.displayName).toBe('Crochet Pattern Decoder Kit');
  });

  it('generates the expected chaos craft planner pages', () => {
    const project = generateProjectFromRecipe('chaosCraftPlanner', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });

    expect(project.pages).toHaveLength(10);
    expect(project.pages.map((page) => page.name)).toEqual([
      'Cover',
      'Project Overview',
      'WIP Tracker',
      'Yarn Stash',
      'Hook Inventory',
      'Pattern Notes',
      'Gift Planner',
      'Frog / Finish Decision',
      'Brain Dump',
      'Blank Notes',
    ]);
  });

  it('generates the expected Crochet Pattern Decoder Kit pages', () => {
    const project = generateProjectFromRecipe('crochetPatternDecoder', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });

    expect(project.pages).toHaveLength(10);
    expect(project.pages.map((page) => page.name)).toEqual([
      'Cover',
      'Pattern Snapshot',
      'Abbreviation Decoder',
      'Stitch & Symbol Key',
      'Gauge + Swatch Notes',
      'Row / Round Tracker',
      'Section Breakdown',
      'Modification Notes',
      'Trouble Spots',
      'Project Finish Notes',
    ]);
    expect(project.recipe).toMatchObject({
      id: 'crochetPatternDecoder',
      version: crochetPatternDecoderRecipe.version,
    });
  });

  it('generates design-space-project-v1 product-aware fields', () => {
    const project = generateProjectFromRecipe('chaosCraftPlanner', {
      theme: testTheme,
      projectId: 'recipe-project-1',
      now: '2026-01-01T00:00:00.000Z',
    });

    const usLetterPreset = CANVAS_SETTINGS_PRESETS.find((preset) => preset.id === 'us-letter');
    expect(usLetterPreset).toMatchObject({
      width: 2550,
      height: 3300,
      unitMode: 'in',
    });
    expect(project.schemaVersion).toBe(DESIGN_SPACE_PROJECT_SCHEMA_VERSION);
    expect(project.projectId).toBe('recipe-project-1');
    expect(project.recipe).toMatchObject({
      id: 'chaosCraftPlanner',
      version: chaosCraftPlannerRecipe.version,
      generatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(project.document.pageSize).toMatchObject({
      presetId: 'us-letter',
      width: usLetterPreset?.width,
      height: usLetterPreset?.height,
      unitMode: usLetterPreset?.unitMode,
      dpi: 300,
    });
    expect(project.canvasSize).toEqual({
      width: usLetterPreset?.width,
      height: usLetterPreset?.height,
    });
    expect(project.theme).toMatchObject({
      themeId: 'theme-moon-kit',
      name: 'Moon Kit',
      slug: 'moon-kit',
      version: '1.2.3',
    });
  });

  it('populates product metadata and export filenames', () => {
    const project = generateProjectFromRecipe('chaosCraftPlanner', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });

    expect(project.productMetadata).toMatchObject({
      title: 'Moon Kit Chaos Craft Planner',
      description:
        'A printable craft project planner for tracking works in progress, materials, yarn, hooks, gifts, pattern notes, and finish-or-frog decisions.',
      category: 'crafts',
    });
    expect(project.productMetadata?.tags).toContain('craft planner');
    expect(project.productMetadata?.includedFiles).toEqual([
      'printable PDF',
      'PNG preview images',
      'README',
      'listing copy',
      'metadata JSON',
    ]);
    expect(project.exportSettings?.pdfFileName).toBe('moon-kit-chaos-craft-planner.pdf');
    expect(project.exportSettings?.previewFileNames).toHaveLength(project.pages.length);
    expect(project.exportSettings?.previewFileNames?.[0]).toBe('moon-kit-chaos-craft-planner-preview-page-01.png');
    expect(project.exportSettings?.formats).toEqual(['pdf', 'png']);
  });

  it('populates Crochet Pattern Decoder product metadata and export filenames', () => {
    const project = generateProjectFromRecipe('crochetPatternDecoder', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });

    expect(project.productMetadata).toMatchObject({
      title: 'Moon Kit Crochet Pattern Decoder Kit',
      description:
        'A printable crochet pattern helper for decoding abbreviations, tracking rows and rounds, testing gauge, noting modifications, and untangling tricky instructions.',
      category: 'crafts',
    });
    expect(project.productMetadata?.tags).toEqual(expect.arrayContaining([
      'crochet pattern worksheet',
      'row tracker',
      'gauge notes',
      'digital download',
    ]));
    expect(project.productMetadata?.includedFiles).toEqual([
      'printable PDF',
      'PNG preview images',
      'metadata JSON',
      'manifest JSON',
      'README',
      'listing copy',
    ]);
    expect(project.exportSettings?.pdfFileName).toBe('moon-kit-crochet-pattern-decoder-kit.pdf');
    expect(project.exportSettings?.previewFileNames).toHaveLength(project.pages.length);
    expect(project.exportSettings?.previewFileNames?.[0]).toBe('moon-kit-crochet-pattern-decoder-kit-preview-page-01.png');
  });

  it('keeps generated pages compatible with pages canvasData', () => {
    const project = generateProjectFromRecipe('chaosCraftPlanner', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });
    const coverObjects = project.pages[0].canvasData.objects;
    const projectOverviewObjects = project.pages[1].canvasData.objects;
    const wipObjects = project.pages[2].canvasData.objects;
    const yarnObjects = project.pages[3].canvasData.objects;
    const coverTitle = coverObjects.find((object: any) => object.slotId === 'title');

    expect(project.canvasData).toBe(project.pages[0].canvasData);
    expect(project.pages.every((page) => Array.isArray(page.canvasData.objects))).toBe(true);
    expect(project.pages.every((page) => page.canvasSize.width === 2550 && page.canvasSize.height === 3300)).toBe(true);
    expect(coverTitle).toMatchObject({
      slotId: 'title',
      semanticRole: 'title',
      left: 210,
      originX: 'left',
      originY: 'top',
      width: 2130,
      fontSize: 94,
      textAlign: 'center',
    });
    expect(coverObjects.some((object: any) => object.slotId === 'cover-badge' && object.semanticRole === 'prompt')).toBe(true);
    expect(coverObjects.every((object: any) => typeof object.id === 'string' && typeof object.type === 'string')).toBe(true);
    expect(coverObjects.some((object: any) => object.tokenRole === 'brand.accent.value')).toBe(true);
    expect(projectOverviewObjects.map((object: any) => object.text).filter(Boolean)).toEqual(
      expect.arrayContaining([
        'Project name',
        'Project type',
        'Pattern/source',
        'Hook / needle size',
        'Yarn weight',
        'Start date',
        'Due date',
        'Materials checklist',
        'Notes / modifications',
      ])
    );
    expect(wipObjects.map((object: any) => object.text).filter(Boolean)).toEqual(
      expect.arrayContaining([
        'Project',
        'Status',
        'Next action',
        'Blocker',
        'Due / finish by',
        'Status key',
      ])
    );
    expect(yarnObjects.map((object: any) => object.text).filter(Boolean)).toEqual(
      expect.arrayContaining([
        'Brand',
        'Colorway',
        'Weight',
        'Fiber',
        'Quantity',
        'Yardage',
        'Intended project',
        'Notes',
      ])
    );
  });

  it('serializes generated recipe objects with document top-left origin', () => {
    const project = generateProjectFromRecipe('chaosCraftPlanner', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });

    project.pages.forEach((page) => {
      getRecipeObjects(page).forEach((object: any) => {
        expect(object.originX, object.id).toBe('left');
        expect(object.originY, object.id).toBe('top');
        expect(object).toMatchObject({
          recipeId: 'chaosCraftPlanner',
          recipePageId: expect.any(String),
          slotId: expect.any(String),
          semanticRole: expect.any(String),
        });
      });
    });
  });

  it('keeps polished chaos craft pages inside the US Letter page and safe margins', () => {
    const project = generateProjectFromRecipe('chaosCraftPlanner', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });
    const safeMargin = project.document.safeMarginPx ?? 0;
    const polishedPages = project.pages.slice(0, 4);

    polishedPages.forEach((page) => {
      expect(page.canvasSize).toEqual({ width: 2550, height: 3300 });
      getRecipeObjects(page).forEach((object: any) => {
        expectObjectWithinPage(object, page, { minInset: safeMargin });
      });
    });
  });

  it('keeps cover title and tracker tables fully inside the page', () => {
    const project = generateProjectFromRecipe('chaosCraftPlanner', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });
    const [coverPage, , wipPage, yarnPage] = project.pages;

    const coverTitle = getObjectBySlot(coverPage, 'title');
    const wipTable = getObjectBySlot(wipPage, 'wip-table');
    const yarnTable = getObjectBySlot(yarnPage, 'yarn-table');

    expectObjectWithinPage(coverTitle, coverPage, { minInset: project.document.safeMarginPx });
    expectObjectWithinPage(wipTable, wipPage, { minInset: project.document.safeMarginPx });
    expectObjectWithinPage(yarnTable, yarnPage, { minInset: project.document.safeMarginPx });
  });

  it('polishes Hook Inventory with inventory columns and go-to hook areas', () => {
    const project = generateProjectFromRecipe('chaosCraftPlanner', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });
    const hookPage = project.pages[4];
    const hookTexts = getPageTexts(hookPage);

    expect(hookTexts).toEqual(expect.arrayContaining([
      'Size',
      'Type',
      'Material',
      'Quantity',
      'In use?',
      'Notes',
      'Favorite hooks / current go-tos',
      'Everyday hook',
      'Travel kit / backup',
      'Inventory gaps / sizes to replace',
    ]));
    expect(getObjectBySlot(hookPage, 'hook-inventory-table')).toBeTruthy();
  });

  it('polishes Pattern Notes with structured pattern prompts and open notes', () => {
    const project = generateProjectFromRecipe('chaosCraftPlanner', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });
    const patternPage = project.pages[5];

    expect(getPageTexts(patternPage)).toEqual(expect.arrayContaining([
      'Pattern/source URL',
      'Designer/source',
      'Gauge',
      'Stitch count',
      'Row/round notes',
      'Modifications',
      'Trouble spots',
      'Open pattern notes',
    ]));
  });

  it('polishes Gift Planner with gifting fields and delivery status', () => {
    const project = generateProjectFromRecipe('chaosCraftPlanner', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });
    const giftPage = project.pages[6];

    expect(getPageTexts(giftPage)).toEqual(expect.arrayContaining([
      'Recipient',
      'Occasion',
      'Budget',
      'Deadline',
      'Pattern/project',
      'Materials needed',
      'Status',
      'Wrap / ship / deliver status',
      'Pattern picked',
      'Materials gathered',
      'Wrapped',
      'Shipped/delivered',
    ]));
  });

  it('polishes Frog or Finish as a clear decision-support page', () => {
    const project = generateProjectFromRecipe('chaosCraftPlanner', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });
    const decisionPage = project.pages[7];

    expect(decisionPage.name).toBe('Frog / Finish Decision');
    expect(getPageTexts(decisionPage)).toEqual(expect.arrayContaining([
      'Frog / Finish Decision',
      'What is working?',
      'What is bothering me?',
      'Time remaining',
      'Can it be salvaged?',
      'Next action',
      'Decision',
      'Frog it',
      'Finish it',
      'Pause it',
      'Repurpose it',
      'If I continue...',
      'If I frog / repurpose...',
      'Decision notes',
    ]));
  });

  it('makes Brain Dump sectioned while Blank Notes stays intentionally minimal', () => {
    const project = generateProjectFromRecipe('chaosCraftPlanner', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });
    const brainDumpTexts = getPageTexts(project.pages[8]);
    const blankNotesTexts = getPageTexts(project.pages[9]);

    expect(brainDumpTexts).toEqual(expect.arrayContaining([
      'Brain Dump',
      'Ideas',
      'Maybe later',
      'Supplies to check',
      'Questions / blockers',
    ]));
    expect(blankNotesTexts).toEqual([
      'Blank Notes',
      'Chaos Craft Planner / 10 of 10',
    ]);
    expect(blankNotesTexts).not.toEqual(expect.arrayContaining([
      'Ideas',
      'Maybe later',
      'Supplies to check',
      'Questions / blockers',
    ]));
  });

  it('keeps polished remaining pages inside the US Letter page and safe margins', () => {
    const project = generateProjectFromRecipe('chaosCraftPlanner', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });
    const safeMargin = project.document.safeMarginPx ?? 0;
    const remainingPages = project.pages.slice(4);

    remainingPages.forEach((page) => {
      expect(page.canvasSize).toEqual({ width: 2550, height: 3300 });
      getRecipeObjects(page).forEach((object: any) => {
        expect(object.originX, object.id).toBe('left');
        expect(object.originY, object.id).toBe('top');
        expectObjectWithinPage(object, page, { minInset: safeMargin });
      });
    });
  });

  it('generates Crochet Pattern Decoder pages with crochet-specific prompts and columns', () => {
    const project = generateProjectFromRecipe('crochetPatternDecoder', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });

    expect(getPageTextsFor(project.pages[0], 'crochetPatternDecoder')).toEqual(expect.arrayContaining([
      'Moon Kit Crochet Pattern Decoder Kit',
      'A printable decoding workspace for abbreviations, row counts, gauge checks, modifications, and tricky instructions',
      'Pattern decoding focus:',
      'Inside this kit',
      'Decode abbreviations',
      'Track rows + rounds',
      'Test gauge',
      'Note modifications',
      'Untangle tricky spots',
    ]));
    expect(getPageTextsFor(project.pages[1], 'crochetPatternDecoder')).toEqual(expect.arrayContaining([
      'Pattern name',
      'Designer/source',
      'URL/book/page',
      'Skill level',
      'Pattern format',
      'US or UK terms',
      'Yarn weight',
      'Hook size',
      'Gauge target',
      'Construction style',
      'Decoder notes',
    ]));
    expect(getPageTextsFor(project.pages[2], 'crochetPatternDecoder')).toEqual(expect.arrayContaining([
      'Abbrev.',
      'Meaning',
      'Notes / example',
      'Terms to double-check',
    ]));
    expect(getPageTextsFor(project.pages[3], 'crochetPatternDecoder')).toEqual(expect.arrayContaining([
      'Stitch / symbol',
      'Description',
      'Where it appears',
      'Notes',
    ]));
    expect(getPageTextsFor(project.pages[4], 'crochetPatternDecoder')).toEqual(expect.arrayContaining([
      'Hook size',
      'Yarn',
      'Gauge target',
      'Target stitches per 4 in / 10 cm',
      'Target rows per 4 in / 10 cm',
      'Hook adjustment: up / down / same',
      'Actual before blocking',
      'Actual after blocking',
      'Swatch notes',
      'Adjustment notes',
    ]));
    expect(getPageTextsFor(project.pages[5], 'crochetPatternDecoder')).toEqual(expect.arrayContaining([
      'Row / round',
      'Instruction summary',
      'Stitch count',
      'Done?',
      'Notes',
    ]));
    expect(getPageTextsFor(project.pages[6], 'crochetPatternDecoder')).toEqual(expect.arrayContaining([
      'Section / piece',
      'Rows / rounds',
      'Stitch count goal',
      'Shaping / repeats',
      'Tricky instruction',
      'Status',
    ]));
    expect(getPageTextsFor(project.pages[7], 'crochetPatternDecoder')).toEqual(expect.arrayContaining([
      'Original instruction',
      'Change made',
      'Reason',
      'Impact',
    ]));
    expect(getPageTextsFor(project.pages[8], 'crochetPatternDecoder')).toEqual(expect.arrayContaining([
      'Issue',
      'Where it happens',
      'Attempted fix',
      'Reference/source',
      'Resolved?',
      'Notes',
    ]));
    expect(getPageTextsFor(project.pages[9], 'crochetPatternDecoder')).toEqual(expect.arrayContaining([
      'Finish checklist',
      'Blocking',
      'Assembly',
      'Edging',
      'Weaving ends',
      'Final hook used',
      'Final yarn used',
      'Final measurements',
      'What I would change next time',
      'Lessons learned',
    ]));
  });

  it('keeps Crochet Pattern Decoder objects editable, metadata-rich, and inside US Letter bounds', () => {
    const project = generateProjectFromRecipe('crochetPatternDecoder', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });
    const safeMargin = project.document.safeMarginPx ?? 0;

    project.pages.forEach((page) => {
      expect(page.canvasSize).toEqual({ width: 2550, height: 3300 });
      getRecipeObjectsFor(page, 'crochetPatternDecoder').forEach((object: any) => {
        expect(object.originX, object.id).toBe('left');
        expect(object.originY, object.id).toBe('top');
        expect(object).toMatchObject({
          recipeId: 'crochetPatternDecoder',
          recipePageId: expect.any(String),
          slotId: expect.any(String),
          semanticRole: expect.any(String),
        });
        expectObjectWithinPage(object, page, { minInset: safeMargin });
      });
    });

    expect(getObjectBySlotFor(project.pages[0], 'crochetPatternDecoder', 'title')).toMatchObject({
      text: 'Moon Kit Crochet Pattern Decoder Kit',
      semanticRole: 'title',
      originX: 'left',
      originY: 'top',
    });
    expect(getObjectBySlotFor(project.pages[0], 'crochetPatternDecoder', 'cover-feature-frame')).toBeTruthy();
    expect(getObjectBySlotFor(project.pages[1], 'crochetPatternDecoder', 'pattern-format-label')).toBeTruthy();
    expect(getObjectBySlotFor(project.pages[4], 'crochetPatternDecoder', 'actual-after-blocking-label')).toBeTruthy();
    expect(getObjectBySlotFor(project.pages[6], 'crochetPatternDecoder', 'section-breakdown-table')).toBeTruthy();
    expect(getObjectBySlotFor(project.pages[2], 'crochetPatternDecoder', 'abbreviation-decoder-table')).toBeTruthy();
    expect(getObjectBySlotFor(project.pages[5], 'crochetPatternDecoder', 'row-round-tracker-table')).toBeTruthy();
  });

  it('builds Product Forge handoff metadata with recipe, page count, title, and manifest', () => {
    const project = generateProjectFromRecipe('chaosCraftPlanner', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });

    const handoff = buildProductForgeHandoff(project);

    expect(handoff).toMatchObject({
      schemaVersion: 'product-forge-handoff-v1',
      sourceApp: 'design-space',
      productTitle: 'Moon Kit Chaos Craft Planner',
      recipe: {
        id: 'chaosCraftPlanner',
        version: chaosCraftPlannerRecipe.version,
      },
      pageCount: 10,
    });
    expect(handoff.includedFilesManifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'pdf',
          label: 'printable PDF',
          fileName: 'moon-kit-chaos-craft-planner.pdf',
          status: 'metadata-only',
        }),
        expect.objectContaining({
          kind: 'readme',
          fileName: 'moon-kit-chaos-craft-planner-README.md',
        }),
        expect.objectContaining({
          kind: 'metadata-json',
          fileName: 'moon-kit-chaos-craft-planner-metadata.json',
        }),
      ])
    );
    expect(handoff.includedFilesManifest.filter((file) => file.kind === 'png-preview')).toHaveLength(10);
    expect(handoff.blobGeneration.status).toBe('not-generated');
  });

  it('builds Product Forge handoff metadata for Crochet Pattern Decoder Kit', () => {
    const project = generateProjectFromRecipe('crochetPatternDecoder', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });

    const handoff = buildProductForgeHandoff(project);

    expect(handoff).toMatchObject({
      schemaVersion: 'product-forge-handoff-v1',
      productTitle: 'Moon Kit Crochet Pattern Decoder Kit',
      recipe: {
        id: 'crochetPatternDecoder',
        version: crochetPatternDecoderRecipe.version,
      },
      pageCount: 10,
    });
    expect(handoff.includedFilesManifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'pdf',
          label: 'printable PDF',
          fileName: 'moon-kit-crochet-pattern-decoder-kit.pdf',
          status: 'metadata-only',
        }),
        expect.objectContaining({
          kind: 'metadata-json',
          fileName: 'moon-kit-crochet-pattern-decoder-kit-metadata.json',
        }),
      ])
    );
    expect(handoff.includedFilesManifest.filter((file) => file.kind === 'png-preview')).toHaveLength(10);
  });

  it('generates Product Forge artifact blobs and manifest from existing export settings', async () => {
    const project = generateProjectFromRecipe('chaosCraftPlanner', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });
    const exportManager = makeMockArtifactExportManager();

    const result = await generateProductForgeArtifacts(project, {
      exportManager,
      now: '2026-02-01T00:00:00.000Z',
    });

    const pdfArtifact = result.artifacts.find((artifact) => artifact.kind === 'printable-pdf');
    const previewArtifacts = result.artifacts.filter((artifact) => artifact.kind === 'preview-png');
    const metadataArtifact = result.artifacts.find((artifact) => artifact.kind === 'metadata-json');

    expect(result).toMatchObject({
      productTitle: 'Moon Kit Chaos Craft Planner',
      recipeId: 'chaosCraftPlanner',
      recipeVersion: chaosCraftPlannerRecipe.version,
      themeName: 'Moon Kit',
      pageCount: 10,
    });
    expect(pdfArtifact).toMatchObject({
      id: 'printable-pdf',
      fileName: 'moon-kit-chaos-craft-planner.pdf',
      mimeType: 'application/pdf',
      status: 'generated',
      sizeBytes: 3,
    });
    expect(previewArtifacts).toHaveLength(10);
    expect(previewArtifacts[0]).toMatchObject({
      id: 'preview-png-page-01',
      fileName: 'moon-kit-chaos-craft-planner-preview-page-01.png',
      mimeType: 'image/png',
      pageNumber: 1,
      status: 'generated',
    });
    expect(previewArtifacts[9]).toMatchObject({
      id: 'preview-png-page-10',
      fileName: 'moon-kit-chaos-craft-planner-preview-page-10.png',
      pageNumber: 10,
      status: 'generated',
    });
    expect(metadataArtifact).toMatchObject({
      id: 'metadata-json',
      fileName: 'moon-kit-chaos-craft-planner-metadata.json',
      mimeType: 'application/json',
      status: 'generated',
    });
    expect(result.manifest).toMatchObject({
      schemaVersion: 'product-forge-artifacts-v1',
      generatedAt: '2026-02-01T00:00:00.000Z',
      productTitle: 'Moon Kit Chaos Craft Planner',
      recipeId: 'chaosCraftPlanner',
      recipeVersion: chaosCraftPlannerRecipe.version,
      themeName: 'Moon Kit',
      pageCount: 10,
      pageSize: {
        width: 2550,
        height: 3300,
        unitMode: 'in',
        dpi: 300,
      },
    });
    expect(result.manifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileName: 'moon-kit-chaos-craft-planner.pdf',
          kind: 'printable-pdf',
          mimeType: 'application/pdf',
          sizeBytes: 3,
        }),
        expect.objectContaining({
          fileName: 'moon-kit-chaos-craft-planner-preview-page-07.png',
          kind: 'preview-png',
          mimeType: 'image/png',
          pageNumber: 7,
        }),
        expect.objectContaining({
          fileName: 'moon-kit-chaos-craft-planner-metadata.json',
          kind: 'metadata-json',
          mimeType: 'application/json',
        }),
      ])
    );
    expect(exportManager.exportPagesPdfBlob).toHaveBeenCalledTimes(1);
    expect(exportManager.exportPagesToBlobs).toHaveBeenCalledTimes(10);
  });

  it('generates Product Forge artifact metadata for Crochet Pattern Decoder Kit', async () => {
    const project = generateProjectFromRecipe('crochetPatternDecoder', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });
    const exportManager = makeMockArtifactExportManager();

    const result = await generateProductForgeArtifacts(project, {
      exportManager,
      previewPageLimit: 1,
      now: '2026-02-01T00:00:00.000Z',
    });

    expect(result).toMatchObject({
      productTitle: 'Moon Kit Crochet Pattern Decoder Kit',
      recipeId: 'crochetPatternDecoder',
      recipeVersion: crochetPatternDecoderRecipe.version,
      themeName: 'Moon Kit',
      pageCount: 10,
    });
    expect(result.artifacts.find((artifact) => artifact.kind === 'printable-pdf')).toMatchObject({
      fileName: 'moon-kit-crochet-pattern-decoder-kit.pdf',
      status: 'generated',
    });
    expect(result.artifacts.find((artifact) => artifact.id === 'preview-png-page-01')).toMatchObject({
      fileName: 'moon-kit-crochet-pattern-decoder-kit-preview-page-01.png',
      pageNumber: 1,
      status: 'generated',
    });
    expect(result.artifacts.find((artifact) => artifact.kind === 'metadata-json')).toMatchObject({
      fileName: 'moon-kit-crochet-pattern-decoder-kit-metadata.json',
      status: 'generated',
    });
    expect(result.manifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileName: 'moon-kit-crochet-pattern-decoder-kit.pdf',
          kind: 'printable-pdf',
        }),
        expect.objectContaining({
          fileName: 'moon-kit-crochet-pattern-decoder-kit-preview-page-01.png',
          kind: 'preview-png',
          pageNumber: 1,
        }),
      ])
    );
  });

  it('represents Product Forge render failures and skipped previews without throwing', async () => {
    const project = generateProjectFromRecipe('chaosCraftPlanner', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });
    const exportManager = makeMockArtifactExportManager({
      failPdf: true,
      failPreviewCallNumbers: [2],
    });

    const result = await generateProductForgeArtifacts(project, {
      exportManager,
      previewPageLimit: 2,
      now: '2026-02-01T00:00:00.000Z',
    });

    expect(result.artifacts.find((artifact) => artifact.kind === 'printable-pdf')).toMatchObject({
      status: 'failed',
      error: 'PDF render failed',
    });
    expect(result.artifacts.find((artifact) => artifact.id === 'preview-png-page-01')).toMatchObject({
      status: 'generated',
      pageNumber: 1,
    });
    expect(result.artifacts.find((artifact) => artifact.id === 'preview-png-page-02')).toMatchObject({
      status: 'failed',
      pageNumber: 2,
      error: 'Preview render 2 failed',
    });
    expect(result.artifacts.find((artifact) => artifact.id === 'preview-png-page-03')).toMatchObject({
      status: 'skipped',
      pageNumber: 3,
    });
    expect(result.artifacts.find((artifact) => artifact.kind === 'metadata-json')).toMatchObject({
      status: 'generated',
    });
    expect(result.manifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileName: 'moon-kit-chaos-craft-planner.pdf',
          kind: 'printable-pdf',
        }),
        expect.objectContaining({
          fileName: 'moon-kit-chaos-craft-planner-preview-page-02.png',
          kind: 'preview-png',
          pageNumber: 2,
        }),
      ])
    );
    expect(exportManager.exportPagesToBlobs).toHaveBeenCalledTimes(2);
  });

  it('generates Product Forge artifacts from current editor state-shaped input', async () => {
    const project = generateProjectFromRecipe('chaosCraftPlanner', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });
    const exportManager = makeMockArtifactExportManager();

    const result = await generateProductForgeArtifacts({
      projectName: project.projectName,
      pages: project.pages,
      activePageIndex: 0,
      imageAssets: {},
      productProjectFields: extractProductProjectFields(project),
      unitMode: project.unitMode,
      canvasSize: project.canvasSize,
      lastUpdated: project.lastUpdated,
    }, {
      exportManager,
      previewPageLimit: 1,
      now: '2026-02-01T00:00:00.000Z',
    });

    expect(result).toMatchObject({
      productTitle: 'Moon Kit Chaos Craft Planner',
      recipeId: 'chaosCraftPlanner',
      recipeVersion: chaosCraftPlannerRecipe.version,
      pageCount: 10,
    });
    expect(result.artifacts.find((artifact) => artifact.id === 'preview-png-page-01')).toMatchObject({
      status: 'generated',
      fileName: 'moon-kit-chaos-craft-planner-preview-page-01.png',
    });
    expect(result.artifacts.find((artifact) => artifact.id === 'preview-png-page-02')).toMatchObject({
      status: 'skipped',
      fileName: 'moon-kit-chaos-craft-planner-preview-page-02.png',
    });
  });

  it('generates all-pages PDF blobs through compressed page image bytes', async () => {
    const manager = new AdvancedExportManager();
    const renderSpy = vi.spyOn(manager as any, 'renderPageToPngBlob')
      .mockImplementation(async (_page: any, options: any) => {
        expect(options.format).toBe('jpeg');
        expect(options.dpi).toBeLessThanOrEqual(200);
        expect(options.quality).toBeLessThanOrEqual(0.95);
        return testBlob('jpeg-bytes', 'image/jpeg');
      });
    const pages = [
      { id: 'page-1', name: 'Page 1', canvasData: { objects: [] }, canvasSize: { width: 2550, height: 3300 } },
      { id: 'page-2', name: 'Page 2', canvasData: { objects: [] }, canvasSize: { width: 2550, height: 3300 } },
    ];

    const blob = await manager.exportPagesPdfBlob(pages as any, {
      dpi: 300,
      includeBackground: true,
      backgroundColor: '#ffffff',
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(0);
    expect(renderSpy).toHaveBeenCalledTimes(2);
  });

  it('packages generated Product Forge artifacts into a sellable ZIP bundle', async () => {
    const project = generateProjectFromRecipe('chaosCraftPlanner', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });
    const artifactResult = await generateProductForgeArtifacts(project, {
      exportManager: makeMockArtifactExportManager(),
      now: '2026-02-01T00:00:00.000Z',
    });

    const packageResult = await packageProductForgeZip(artifactResult, {
      productMetadata: project.productMetadata,
      recipe: project.recipe,
      theme: project.theme,
      exportSettings: project.exportSettings,
    });

    expect(packageResult).toMatchObject({
      status: 'generated',
      fileName: 'moon-kit-chaos-craft-planner-product-forge.zip',
      mimeType: 'application/zip',
      manifest: artifactResult.manifest,
    });
    expect(packageResult.blob).toBeInstanceOf(Blob);
    expect(packageResult.sizeBytes).toBeGreaterThan(0);
    expect(packageResult.packagedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'moon-kit-chaos-craft-planner/moon-kit-chaos-craft-planner.pdf',
          kind: 'printable-pdf',
          status: 'packaged',
        }),
        expect.objectContaining({
          path: 'moon-kit-chaos-craft-planner/previews/moon-kit-chaos-craft-planner-preview-page-01.png',
          kind: 'preview-png',
          status: 'packaged',
        }),
        expect.objectContaining({
          path: 'moon-kit-chaos-craft-planner/metadata.json',
          kind: 'metadata-json',
          status: 'packaged',
        }),
        expect.objectContaining({
          path: 'moon-kit-chaos-craft-planner/manifest.json',
          kind: 'manifest-json',
          status: 'packaged',
        }),
        expect.objectContaining({
          path: 'moon-kit-chaos-craft-planner/README.md',
          kind: 'readme',
          status: 'packaged',
        }),
        expect.objectContaining({
          path: 'moon-kit-chaos-craft-planner/listing-copy.md',
          kind: 'listing-copy',
          status: 'packaged',
        }),
      ])
    );

    const zip = await JSZip.loadAsync(packageResult.blob!);
    expect(zip.file('moon-kit-chaos-craft-planner/moon-kit-chaos-craft-planner.pdf')).toBeTruthy();
    expect(zip.file('moon-kit-chaos-craft-planner/previews/moon-kit-chaos-craft-planner-preview-page-10.png')).toBeTruthy();
    expect(zip.file('moon-kit-chaos-craft-planner/metadata.json')).toBeTruthy();
    expect(zip.file('moon-kit-chaos-craft-planner/manifest.json')).toBeTruthy();
    const readme = await zip.file('moon-kit-chaos-craft-planner/README.md')?.async('string');
    const listingCopy = await zip.file('moon-kit-chaos-craft-planner/listing-copy.md')?.async('string');
    expect(readme).toContain('# Moon Kit Chaos Craft Planner');
    expect(readme).toContain('## Print / Use Notes');
    expect(readme).toContain('Personal/commercial use terms are not configured yet');
    expect(listingCopy).toContain('## Suggested Tags');
    expect(listingCopy).toContain('Digital download only. No physical item will be shipped.');
  });

  it('fails ZIP packaging clearly when the required printable PDF is missing or failed', async () => {
    const project = generateProjectFromRecipe('chaosCraftPlanner', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });
    const artifactResult = await generateProductForgeArtifacts(project, {
      exportManager: makeMockArtifactExportManager({ failPdf: true }),
      previewPageLimit: 1,
      now: '2026-02-01T00:00:00.000Z',
    });

    const packageResult = await packageProductForgeZip(artifactResult, {
      productMetadata: project.productMetadata,
      exportSettings: project.exportSettings,
    });

    expect(packageResult).toMatchObject({
      status: 'failed',
      fileName: 'moon-kit-chaos-craft-planner-product-forge.zip',
      mimeType: 'application/zip',
      manifest: artifactResult.manifest,
    });
    expect(packageResult.blob).toBeUndefined();
    expect(packageResult.errors).toEqual([
      'Printable PDF artifact is failed: PDF render failed',
    ]);
  });

  it('records optional preview packaging failures without failing the ZIP', async () => {
    const project = generateProjectFromRecipe('chaosCraftPlanner', {
      theme: testTheme,
      now: '2026-01-01T00:00:00.000Z',
    });
    const artifactResult = await generateProductForgeArtifacts(project, {
      exportManager: makeMockArtifactExportManager({
        failPreviewCallNumbers: [2],
      }),
      previewPageLimit: 2,
      now: '2026-02-01T00:00:00.000Z',
    });

    const packageResult = await packageProductForgeZip(artifactResult, {
      productMetadata: project.productMetadata,
      exportSettings: project.exportSettings,
    });

    expect(packageResult.status).toBe('generated');
    expect(packageResult.blob).toBeInstanceOf(Blob);
    expect(packageResult.packagedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'moon-kit-chaos-craft-planner/previews/moon-kit-chaos-craft-planner-preview-page-01.png',
          status: 'packaged',
        }),
        expect.objectContaining({
          path: 'moon-kit-chaos-craft-planner/previews/moon-kit-chaos-craft-planner-preview-page-02.png',
          status: 'failed',
          error: 'Preview render 2 failed',
        }),
        expect.objectContaining({
          path: 'moon-kit-chaos-craft-planner/previews/moon-kit-chaos-craft-planner-preview-page-03.png',
          status: 'skipped',
        }),
      ])
    );
    expect(packageResult.errors).toEqual([
      'moon-kit-chaos-craft-planner/previews/moon-kit-chaos-craft-planner-preview-page-02.png: Preview render 2 failed',
    ]);
  });
});
