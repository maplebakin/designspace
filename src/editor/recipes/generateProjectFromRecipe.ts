import {
  normalizeDesignSpaceProjectPayload,
  type ExistingProjectPage,
  type ProjectProductMetadata,
} from '../project/projectSchema';
import type { ApocapaletteTheme } from '../types/apocapalette';
import type {
  GenerateProjectFromRecipeOptions,
  GeneratedRecipeProject,
  ProductRecipe,
  ProductRecipePageDefinition,
  RecipeSemanticRole,
} from './productRecipeTypes';
import { getProductRecipe } from './recipeRegistry';

type RecipeObject = Record<string, any>;

export type RecipeObjectBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type RecipeColors = {
  background: string;
  primary: string;
  accent: string;
  text: string;
  mutedText: string;
  border: string;
  surface: string;
};

const DEFAULT_THEME: ApocapaletteTheme = {
  meta: {
    schema: 'generic-token-pack-v1',
    name: 'Default Theme',
    slug: 'default-theme',
  },
  brand: {
    primary: { value: '#2f4f46' },
    accent: { value: '#b7791f' },
  },
  typography: {
    heading: { value: '#24332e' },
    body: { value: '#303735' },
    texthint: { value: '#6b746f' },
  },
  surfaces: {
    background: { value: '#faf8f5' },
    pagebackground: { value: '#faf8f5' },
    surfaceplain: { value: '#fffdf8' },
  },
  borders: {
    bordersubtle: { value: '#d8d0c2' },
  },
};

const TOKEN_ROLES = {
  background: 'surfaces.pagebackground.value',
  primary: 'brand.primary.value',
  accent: 'brand.accent.value',
  text: 'typography.body.value',
  heading: 'typography.heading.value',
  mutedText: 'typography.texthint.value',
  border: 'borders.bordersubtle.value',
  surface: 'surfaces.surfaceplain.value',
} as const;

const PAGE_LAYOUT = {
  outerX: 210,
  outerWidth: 2130,
  headerTop: 170,
  headerDividerTop: 286,
  footerDividerTop: 3038,
  footerTop: 3072,
  introTop: 314,
  introWidth: 1900,
  cover: {
    titleTop: 448,
    titleWidth: 2130,
    titleFontSize: 94,
    badgeLeft: 210,
    badgeTop: 190,
    badgeWidth: 460,
    badgeHeight: 78,
    accentTop: 882,
    accentWidth: 1360,
    subtitleTop: 958,
    subtitleWidth: 2130,
    subtitleFontSize: 44,
    notesLeft: 260,
    notesTop: 1320,
    notesWidth: 1620,
    notesHeight: 760,
    notesContentLeft: 330,
    notesContentTop: 1490,
    notesContentWidth: 1480,
  },
  table: {
    rowHeight: 136,
    headerFontSize: 28,
    headerTopPadding: 36,
    headerSidePadding: 24,
    strokeWidth: 4,
  },
  checklist: {
    columnWidth: 860,
    rowGap: 132,
    boxSize: 56,
  },
  notes: {
    strokeWidth: 4,
    rowGap: 108,
  },
} as const;

const getPathValue = (target: any, path: string) =>
  path.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), target);

const getTokenColor = (theme: ApocapaletteTheme, paths: string[], fallback: string) => {
  for (const path of paths) {
    const token = getPathValue(theme, path);
    if (typeof token === 'string' && token.trim()) return token;
    if (token && typeof token === 'object' && typeof token.value === 'string' && token.value.trim()) {
      return token.value;
    }
  }
  return fallback;
};

const getThemeName = (theme: ApocapaletteTheme) =>
  typeof theme.meta?.name === 'string' && theme.meta.name.trim()
    ? theme.meta.name.trim()
    : typeof theme.meta?.label === 'string' && theme.meta.label.trim()
      ? theme.meta.label.trim()
      : 'Default Theme';

const getThemeSlug = (theme: ApocapaletteTheme) =>
  typeof theme.meta?.slug === 'string' && theme.meta.slug.trim()
    ? theme.meta.slug.trim()
    : slugify(getThemeName(theme));

const getThemeId = (theme: ApocapaletteTheme, explicitThemeId?: string) => {
  if (explicitThemeId?.trim()) return explicitThemeId.trim();
  const meta = theme.meta as Record<string, unknown> | undefined;
  const candidate = meta?.id ?? meta?.themeId;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
};

const slugify = (value: string) => {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled-project';
};

const pageNumber = (index: number) => String(index + 1).padStart(2, '0');

export const getGeneratedRecipeObjectBounds = (object: RecipeObject): RecipeObjectBounds => {
  const width = Math.max(0, Number(object.width ?? 0)) * Math.abs(Number(object.scaleX ?? 1));
  const height = Math.max(0, Number(object.height ?? object.fontSize ?? 0)) * Math.abs(Number(object.scaleY ?? 1));
  const left = Number(object.left ?? 0);
  const top = Number(object.top ?? 0);
  const originX = object.originX ?? 'left';
  const originY = object.originY ?? 'top';
  const resolvedLeft = originX === 'center' ? left - width / 2 : originX === 'right' ? left - width : left;
  const resolvedTop = originY === 'center' ? top - height / 2 : originY === 'bottom' ? top - height : top;

  return {
    left: resolvedLeft,
    top: resolvedTop,
    right: resolvedLeft + width,
    bottom: resolvedTop + height,
    width,
    height,
  };
};

const resolveColors = (theme: ApocapaletteTheme): RecipeColors => ({
  background: getTokenColor(theme, ['surfaces.pagebackground', 'surfaces.page-background', 'surfaces.background'], '#faf8f5'),
  primary: getTokenColor(theme, ['brand.primary'], '#2f4f46'),
  accent: getTokenColor(theme, ['brand.accent', 'accents.accent'], '#b7791f'),
  text: getTokenColor(theme, ['typography.body', 'typography.textbody', 'typography.text-body'], '#303735'),
  mutedText: getTokenColor(theme, ['typography.texthint', 'typography.text-hint', 'typography.footertextmuted'], '#6b746f'),
  border: getTokenColor(theme, ['borders.bordersubtle', 'borders.border-subtle'], '#d8d0c2'),
  surface: getTokenColor(theme, ['surfaces.surfaceplain', 'surfaces.surface-plain'], '#fffdf8'),
});

const recipeObjectProps = (
  recipe: ProductRecipe,
  page: ProductRecipePageDefinition,
  slotId: string,
  semanticRole: RecipeSemanticRole
) => ({
  id: `${recipe.id}-${page.id}-${slotId}`,
  name: `${page.name} ${semanticRole}`,
  recipeId: recipe.id,
  recipePageId: page.id,
  slotId,
  semanticRole,
});

const textObject = (
  recipe: ProductRecipe,
  page: ProductRecipePageDefinition,
  slotId: string,
  semanticRole: RecipeSemanticRole,
  text: string,
  left: number,
  top: number,
  options: {
    width?: number;
    fontSize?: number;
    fontWeight?: string | number;
    fill?: string;
    tokenRole?: string;
    fontFamily?: string;
    textAlign?: string;
  } = {}
): RecipeObject => ({
  type: options.width ? 'textbox' : 'i-text',
  left,
  top,
  originX: 'left',
  originY: 'top',
  width: options.width,
  text,
  fontSize: options.fontSize ?? 46,
  fontFamily: options.fontFamily ?? 'Arial',
  fontWeight: options.fontWeight ?? 'normal',
  textAlign: options.textAlign ?? 'left',
  fill: options.fill ?? '#303735',
  tokenRole: options.tokenRole ?? TOKEN_ROLES.text,
  colorLocked: false,
  ...recipeObjectProps(recipe, page, slotId, semanticRole),
});

const rectObject = (
  recipe: ProductRecipe,
  page: ProductRecipePageDefinition,
  slotId: string,
  semanticRole: RecipeSemanticRole,
  left: number,
  top: number,
  width: number,
  height: number,
  options: {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    tokenRole?: string;
    rx?: number;
    ry?: number;
  } = {}
): RecipeObject => ({
  type: 'rect',
  left,
  top,
  originX: 'left',
  originY: 'top',
  width,
  height,
  fill: options.fill ?? 'transparent',
  stroke: options.stroke,
  strokeWidth: options.strokeWidth ?? 0,
  rx: options.rx ?? 0,
  ry: options.ry ?? 0,
  tokenRole: options.tokenRole ?? null,
  colorLocked: false,
  ...recipeObjectProps(recipe, page, slotId, semanticRole),
});

const addHeader = (
  objects: RecipeObject[],
  recipe: ProductRecipe,
  page: ProductRecipePageDefinition,
  colors: RecipeColors,
  title: string
) => {
  objects.push(
    textObject(recipe, page, 'heading', 'heading', title, PAGE_LAYOUT.outerX, PAGE_LAYOUT.headerTop, {
      width: PAGE_LAYOUT.outerWidth,
      fontSize: 68,
      fontWeight: 700,
      fill: colors.primary,
      tokenRole: TOKEN_ROLES.heading,
    }),
    rectObject(recipe, page, 'heading-divider', 'divider', PAGE_LAYOUT.outerX, PAGE_LAYOUT.headerDividerTop, 660, 10, {
      fill: colors.accent,
      tokenRole: TOKEN_ROLES.accent,
      rx: 6,
      ry: 6,
    })
  );
};

const addFooter = (
  objects: RecipeObject[],
  recipe: ProductRecipe,
  page: ProductRecipePageDefinition,
  colors: RecipeColors,
  pageIndex: number,
  pageCount: number
) => {
  objects.push(
    rectObject(recipe, page, 'footer-divider', 'divider', PAGE_LAYOUT.outerX, PAGE_LAYOUT.footerDividerTop, PAGE_LAYOUT.outerWidth, 4, {
      fill: colors.border,
      tokenRole: TOKEN_ROLES.border,
    }),
    textObject(recipe, page, 'footer', 'footer', `${recipe.name} / ${pageNumber(pageIndex)} of ${pageNumber(pageCount - 1)}`, PAGE_LAYOUT.outerX, PAGE_LAYOUT.footerTop, {
      width: 1200,
      fontSize: 28,
      fill: colors.mutedText,
      tokenRole: TOKEN_ROLES.mutedText,
    })
  );
};

const addLabelField = (
  objects: RecipeObject[],
  recipe: ProductRecipe,
  page: ProductRecipePageDefinition,
  colors: RecipeColors,
  slotId: string,
  label: string,
  left: number,
  top: number,
  width: number,
  height = 130
) => {
  objects.push(
    textObject(recipe, page, `${slotId}-label`, 'prompt', label, left, top, {
      width,
      fontSize: 34,
      fontWeight: 700,
      fill: colors.text,
      tokenRole: TOKEN_ROLES.text,
    }),
    rectObject(recipe, page, `${slotId}-field`, 'notesBlock', left, top + 54, width, height, {
      fill: colors.surface,
      stroke: colors.border,
      strokeWidth: 4,
      tokenRole: TOKEN_ROLES.surface,
      rx: 18,
      ry: 18,
    })
  );
};

const addLinedNotes = (
  objects: RecipeObject[],
  recipe: ProductRecipe,
  page: ProductRecipePageDefinition,
  colors: RecipeColors,
  slotId: string,
  left: number,
  top: number,
  width: number,
  rowCount: number,
  rowGap = 120
) => {
  objects.push(rectObject(recipe, page, `${slotId}-block`, 'notesBlock', left, top - 34, width, rowCount * rowGap + 58, {
    fill: colors.surface,
    stroke: colors.border,
    strokeWidth: PAGE_LAYOUT.notes.strokeWidth,
    tokenRole: TOKEN_ROLES.surface,
    rx: 18,
    ry: 18,
  }));
  for (let index = 0; index < rowCount; index += 1) {
    objects.push(rectObject(recipe, page, `${slotId}-line-${pageNumber(index)}`, 'divider', left + 60, top + index * rowGap + 64, width - 120, 4, {
      fill: colors.border,
      tokenRole: TOKEN_ROLES.border,
    }));
  }
};

const addTable = (
  objects: RecipeObject[],
  recipe: ProductRecipe,
  page: ProductRecipePageDefinition,
  colors: RecipeColors,
  slotId: string,
  columns: string[],
  left: number,
  top: number,
  width: number,
  rowCount: number,
  options: {
    rowHeight?: number;
    headerFontSize?: number;
    headerTopPadding?: number;
    headerSidePadding?: number;
    strokeWidth?: number;
  } = {}
) => {
  const rowHeight = options.rowHeight ?? PAGE_LAYOUT.table.rowHeight;
  const columnWidth = width / columns.length;
  objects.push(rectObject(recipe, page, `${slotId}-table`, 'notesBlock', left, top, width, rowHeight * (rowCount + 1), {
    fill: colors.surface,
    stroke: colors.border,
    strokeWidth: options.strokeWidth ?? PAGE_LAYOUT.table.strokeWidth,
    tokenRole: TOKEN_ROLES.surface,
    rx: 16,
    ry: 16,
  }));
  columns.forEach((column, index) => {
    const headerSidePadding = options.headerSidePadding ?? PAGE_LAYOUT.table.headerSidePadding;
    const headerTopPadding = options.headerTopPadding ?? PAGE_LAYOUT.table.headerTopPadding;
    objects.push(textObject(recipe, page, `${slotId}-heading-${index + 1}`, 'heading', column, left + headerSidePadding + index * columnWidth, top + headerTopPadding, {
      width: columnWidth - headerSidePadding * 2,
      fontSize: options.headerFontSize ?? PAGE_LAYOUT.table.headerFontSize,
      fontWeight: 700,
      fill: colors.primary,
      tokenRole: TOKEN_ROLES.heading,
    }));
    if (index > 0) {
      objects.push(rectObject(recipe, page, `${slotId}-column-${index}`, 'divider', left + index * columnWidth, top, 4, rowHeight * (rowCount + 1), {
        fill: colors.border,
        tokenRole: TOKEN_ROLES.border,
      }));
    }
  });
  for (let row = 1; row <= rowCount; row += 1) {
    objects.push(rectObject(recipe, page, `${slotId}-row-${row}`, 'divider', left, top + row * rowHeight, width, 4, {
      fill: colors.border,
      tokenRole: TOKEN_ROLES.border,
    }));
  }
};

const addChecklist = (
  objects: RecipeObject[],
  recipe: ProductRecipe,
  page: ProductRecipePageDefinition,
  colors: RecipeColors,
  slotId: string,
  labels: string[],
  left: number,
  top: number,
  columns = 2,
  options: {
    columnWidth?: number;
    rowGap?: number;
    boxSize?: number;
  } = {}
) => {
  const columnWidth = options.columnWidth ?? PAGE_LAYOUT.checklist.columnWidth;
  const rowGap = options.rowGap ?? PAGE_LAYOUT.checklist.rowGap;
  const boxSize = options.boxSize ?? PAGE_LAYOUT.checklist.boxSize;
  labels.forEach((label, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = left + column * columnWidth;
    const y = top + row * rowGap;
    objects.push(
      rectObject(recipe, page, `${slotId}-box-${index + 1}`, 'checklist', x, y, boxSize, boxSize, {
        fill: 'transparent',
        stroke: colors.accent,
        strokeWidth: 5,
        tokenRole: TOKEN_ROLES.accent,
        rx: 8,
        ry: 8,
      }),
      textObject(recipe, page, `${slotId}-label-${index + 1}`, 'checklist', label, x + 82, y - 4, {
        width: columnWidth - 110,
        fontSize: 34,
        fill: colors.text,
        tokenRole: TOKEN_ROLES.text,
      })
    );
  });
};

const addCoverBadge = (
  objects: RecipeObject[],
  recipe: ProductRecipe,
  page: ProductRecipePageDefinition,
  colors: RecipeColors,
  text: string
) => {
  objects.push(
    rectObject(recipe, page, 'cover-badge', 'prompt', PAGE_LAYOUT.cover.badgeLeft, PAGE_LAYOUT.cover.badgeTop, PAGE_LAYOUT.cover.badgeWidth, PAGE_LAYOUT.cover.badgeHeight, {
      fill: colors.surface,
      stroke: colors.accent,
      strokeWidth: 4,
      tokenRole: TOKEN_ROLES.surface,
      rx: 22,
      ry: 22,
    }),
    textObject(recipe, page, 'cover-badge-text', 'prompt', text, PAGE_LAYOUT.cover.badgeLeft + 24, PAGE_LAYOUT.cover.badgeTop + 18, {
      width: PAGE_LAYOUT.cover.badgeWidth - 48,
      fontSize: 26,
      fontWeight: 700,
      textAlign: 'center',
      fill: colors.accent,
      tokenRole: TOKEN_ROLES.accent,
    }),
    rectObject(recipe, page, 'cover-corner-mark', 'divider', PAGE_LAYOUT.cover.badgeLeft + PAGE_LAYOUT.cover.badgeWidth + 36, PAGE_LAYOUT.cover.badgeTop + 16, 92, 12, {
      fill: colors.primary,
      tokenRole: TOKEN_ROLES.primary,
      rx: 8,
      ry: 8,
    })
  );
};

const addSectionIntro = (
  objects: RecipeObject[],
  recipe: ProductRecipe,
  page: ProductRecipePageDefinition,
  colors: RecipeColors,
  slotId: string,
  text: string,
  left: number,
  top: number,
  width: number = PAGE_LAYOUT.introWidth
) => {
  objects.push(
    textObject(recipe, page, slotId, 'prompt', text, left, top, {
      width,
      fontSize: 30,
      fill: colors.mutedText,
      tokenRole: TOKEN_ROLES.mutedText,
    })
  );
};

const addNotesSection = (
  objects: RecipeObject[],
  recipe: ProductRecipe,
  page: ProductRecipePageDefinition,
  colors: RecipeColors,
  slotId: string,
  title: string,
  left: number,
  top: number,
  width: number,
  rowCount: number,
  rowGap: number = PAGE_LAYOUT.notes.rowGap,
  options: {
    headingWidth?: number;
    headingFontSize?: number;
  } = {}
) => {
  objects.push(textObject(recipe, page, `${slotId}-heading`, 'heading', title, left, top, {
    width: options.headingWidth ?? width,
    fontSize: options.headingFontSize ?? 36,
    fontWeight: 700,
    fill: colors.primary,
    tokenRole: TOKEN_ROLES.heading,
  }));
  addLinedNotes(objects, recipe, page, colors, slotId, left, top + 82, width, rowCount, rowGap);
};

const addStatusLegend = (
  objects: RecipeObject[],
  recipe: ProductRecipe,
  page: ProductRecipePageDefinition,
  colors: RecipeColors,
  left: number,
  top: number
) => {
  const entries = [
    { label: 'Active', fill: colors.primary },
    { label: 'Blocked', fill: colors.accent },
    { label: 'Waiting', fill: colors.border },
    { label: 'Done', fill: colors.text },
  ];
  objects.push(
    textObject(recipe, page, 'status-legend-heading', 'prompt', 'Status key', left, top, {
      width: 360,
      fontSize: 28,
      fontWeight: 700,
      fill: colors.mutedText,
      tokenRole: TOKEN_ROLES.mutedText,
    })
  );
  entries.forEach((entry, index) => {
    const x = left + index * 190;
    objects.push(
      rectObject(recipe, page, `status-legend-box-${index + 1}`, 'checklist', x, top + 46, 26, 26, {
        fill: entry.fill,
        stroke: entry.fill,
        strokeWidth: 1,
        tokenRole: TOKEN_ROLES.primary,
        rx: 5,
        ry: 5,
      }),
      textObject(recipe, page, `status-legend-label-${index + 1}`, 'prompt', entry.label, x + 38, top + 38, {
        width: 130,
        fontSize: 26,
        fill: colors.text,
        tokenRole: TOKEN_ROLES.text,
      })
    );
  });
};

const buildPageObjects = (
  recipe: ProductRecipe,
  page: ProductRecipePageDefinition,
  pageIndex: number,
  colors: RecipeColors,
  productTitle: string
) => {
  const objects: RecipeObject[] = [];
  const pageCount = recipe.pages.length;

  if (page.id === 'cover') {
    const coverSubtitle = recipe.id === 'crochetPatternDecoder'
      ? 'A printable decoding workspace for abbreviations, row counts, gauge checks, modifications, and tricky instructions'
      : 'WIPs, stash, hooks, gifts, pattern notes, and finish-or-frog decisions';
    const coverPrompt = recipe.id === 'crochetPatternDecoder'
      ? 'Pattern decoding focus:'
      : 'Current craft chaos:';
    objects.push(
      textObject(recipe, page, 'title', 'title', productTitle, PAGE_LAYOUT.outerX, PAGE_LAYOUT.cover.titleTop, {
        width: PAGE_LAYOUT.cover.titleWidth,
        fontSize: PAGE_LAYOUT.cover.titleFontSize,
        fontWeight: 700,
        fill: colors.primary,
        tokenRole: TOKEN_ROLES.heading,
        textAlign: 'center',
      }),
      rectObject(recipe, page, 'cover-accent', 'divider', 610, PAGE_LAYOUT.cover.accentTop, PAGE_LAYOUT.cover.accentWidth, 16, {
        fill: colors.accent,
        tokenRole: TOKEN_ROLES.accent,
        rx: 10,
        ry: 10,
      }),
      textObject(recipe, page, 'subtitle', 'prompt', coverSubtitle, PAGE_LAYOUT.outerX, PAGE_LAYOUT.cover.subtitleTop, {
        width: PAGE_LAYOUT.cover.subtitleWidth,
        fontSize: PAGE_LAYOUT.cover.subtitleFontSize,
        fill: colors.text,
        tokenRole: TOKEN_ROLES.text,
        textAlign: 'center',
      }),
      rectObject(recipe, page, 'cover-notes-frame', 'notesBlock', PAGE_LAYOUT.cover.notesLeft, PAGE_LAYOUT.cover.notesTop, PAGE_LAYOUT.cover.notesWidth, PAGE_LAYOUT.cover.notesHeight, {
        fill: colors.surface,
        stroke: colors.border,
        strokeWidth: 4,
        tokenRole: TOKEN_ROLES.surface,
        rx: 28,
        ry: 28,
      }),
      textObject(recipe, page, 'cover-prompt', 'prompt', coverPrompt, PAGE_LAYOUT.cover.notesContentLeft, 1390, {
        width: 980,
        fontSize: 42,
        fontWeight: 700,
        fill: colors.accent,
        tokenRole: TOKEN_ROLES.accent,
      })
    );
    addCoverBadge(objects, recipe, page, colors, 'EDITABLE PRINTABLE DRAFT');
    addLinedNotes(objects, recipe, page, colors, 'cover-notes', PAGE_LAYOUT.cover.notesContentLeft, PAGE_LAYOUT.cover.notesContentTop, PAGE_LAYOUT.cover.notesContentWidth, 4, 130);
    if (recipe.id === 'crochetPatternDecoder') {
      objects.push(
        rectObject(recipe, page, 'cover-feature-frame', 'notesBlock', 1940, PAGE_LAYOUT.cover.notesTop, 400, PAGE_LAYOUT.cover.notesHeight, {
          fill: colors.surface,
          stroke: colors.border,
          strokeWidth: 4,
          tokenRole: TOKEN_ROLES.surface,
          rx: 28,
          ry: 28,
        }),
        textObject(recipe, page, 'cover-feature-heading', 'heading', 'Inside this kit', 1990, 1390, {
          width: 300,
          fontSize: 34,
          fontWeight: 700,
          fill: colors.primary,
          tokenRole: TOKEN_ROLES.heading,
        })
      );
      addChecklist(
        objects,
        recipe,
        page,
        colors,
        'cover-features',
        ['Decode abbreviations', 'Track rows + rounds', 'Test gauge', 'Note modifications', 'Untangle tricky spots'],
        1990,
        1488,
        1,
        {
          columnWidth: 320,
          rowGap: 102,
          boxSize: 44,
        }
      );
    }
  } else {
    addHeader(objects, recipe, page, colors, page.label);
  }

  switch (page.id) {
    case 'project-overview':
      addSectionIntro(objects, recipe, page, colors, 'overview-intro', 'Capture the project identity, the material plan, and the edits you still need to remember.', PAGE_LAYOUT.outerX, PAGE_LAYOUT.introTop);
      addLabelField(objects, recipe, page, colors, 'project-name', 'Project name', PAGE_LAYOUT.outerX, 420, 1000);
      addLabelField(objects, recipe, page, colors, 'project-type', 'Project type', 1260, 420, 1080);
      addLabelField(objects, recipe, page, colors, 'pattern-source', 'Pattern/source', PAGE_LAYOUT.outerX, 720, 1000);
      addLabelField(objects, recipe, page, colors, 'hook-needle-size', 'Hook / needle size', 1260, 720, 470);
      addLabelField(objects, recipe, page, colors, 'yarn-weight', 'Yarn weight', 1780, 720, 590);
      addLabelField(objects, recipe, page, colors, 'started', 'Start date', PAGE_LAYOUT.outerX, 1020, 620);
      addLabelField(objects, recipe, page, colors, 'deadline', 'Due date', 900, 1020, 620);
      objects.push(textObject(recipe, page, 'materials-heading', 'heading', 'Materials checklist', PAGE_LAYOUT.outerX, 1286, {
        width: 980,
        fontSize: 40,
        fontWeight: 700,
        fill: colors.primary,
        tokenRole: TOKEN_ROLES.heading,
      }));
      addChecklist(objects, recipe, page, colors, 'materials', ['Yarn', 'Hook/needles', 'Notions', 'Stitch markers', 'Tapestry needle', 'Scissors', 'Pattern copy', 'Other'], 260, 1352, 2, {
        columnWidth: 850,
        rowGap: 122,
        boxSize: 54,
      });
      objects.push(textObject(recipe, page, 'notes-heading', 'heading', 'Notes / modifications', PAGE_LAYOUT.outerX, 1948, {
        width: 1100,
        fontSize: 40,
        fontWeight: 700,
        fill: colors.primary,
        tokenRole: TOKEN_ROLES.heading,
      }));
      addLinedNotes(objects, recipe, page, colors, 'project-notes', PAGE_LAYOUT.outerX, 2040, PAGE_LAYOUT.outerWidth, 6, PAGE_LAYOUT.notes.rowGap);
      break;
    case 'wip-tracker':
      addSectionIntro(objects, recipe, page, colors, 'wip-intro', 'Track what is moving, what is stuck, and what needs attention next.', PAGE_LAYOUT.outerX, PAGE_LAYOUT.introTop, 1240);
      addStatusLegend(objects, recipe, page, colors, 1450, 302);
      addTable(objects, recipe, page, colors, 'wip', ['Project', 'Status', 'Next action', 'Blocker', 'Due / finish by'], PAGE_LAYOUT.outerX, 470, PAGE_LAYOUT.outerWidth, 9, {
        rowHeight: 132,
        headerFontSize: 26,
        headerTopPadding: 34,
        headerSidePadding: 18,
        strokeWidth: 4,
      });
      break;
    case 'yarn-stash':
      addSectionIntro(objects, recipe, page, colors, 'yarn-intro', 'Capture stash details that matter when you are trying to match yarn to a project.', PAGE_LAYOUT.outerX, PAGE_LAYOUT.introTop, 1420);
      addTable(objects, recipe, page, colors, 'yarn', ['Brand', 'Colorway', 'Weight', 'Fiber', 'Quantity', 'Yardage', 'Intended project', 'Notes'], PAGE_LAYOUT.outerX, 470, PAGE_LAYOUT.outerWidth, 9, {
        rowHeight: 128,
        headerFontSize: 24,
        headerTopPadding: 34,
        headerSidePadding: 14,
        strokeWidth: 4,
      });
      break;
    case 'hook-inventory':
      addSectionIntro(objects, recipe, page, colors, 'hook-intro', 'Track hook sizes, materials, duplicates, and which tools are currently tied up in projects.', PAGE_LAYOUT.outerX, PAGE_LAYOUT.introTop, 1560);
      addTable(objects, recipe, page, colors, 'hook-inventory', ['Size', 'Type', 'Material', 'Quantity', 'In use?', 'Notes'], PAGE_LAYOUT.outerX, 470, PAGE_LAYOUT.outerWidth, 8, {
        rowHeight: 118,
        headerFontSize: 24,
        headerTopPadding: 32,
        headerSidePadding: 16,
        strokeWidth: 4,
      });
      addNotesSection(objects, recipe, page, colors, 'favorite-hooks', 'Favorite hooks / current go-tos', PAGE_LAYOUT.outerX, 1700, 1000, 4, 106, {
        headingFontSize: 38,
      });
      addLabelField(objects, recipe, page, colors, 'everyday-hook', 'Everyday hook', 1260, 1700, 1080, 170);
      addLabelField(objects, recipe, page, colors, 'travel-kit', 'Travel kit / backup', 1260, 1990, 1080, 170);
      addNotesSection(objects, recipe, page, colors, 'hook-inventory-notes', 'Inventory gaps / sizes to replace', PAGE_LAYOUT.outerX, 2390, PAGE_LAYOUT.outerWidth, 4, PAGE_LAYOUT.notes.rowGap, {
        headingFontSize: 38,
      });
      break;
    case 'pattern-notes':
      addSectionIntro(objects, recipe, page, colors, 'pattern-intro', 'Keep source details, gauge notes, row changes, and trouble spots with the project.', PAGE_LAYOUT.outerX, PAGE_LAYOUT.introTop, 1560);
      addLabelField(objects, recipe, page, colors, 'pattern-url', 'Pattern/source URL', PAGE_LAYOUT.outerX, 420, 1320);
      addLabelField(objects, recipe, page, colors, 'designer-source', 'Designer/source', 1590, 420, 750);
      addLabelField(objects, recipe, page, colors, 'gauge', 'Gauge', PAGE_LAYOUT.outerX, 720, 620);
      addLabelField(objects, recipe, page, colors, 'stitch-count', 'Stitch count', 900, 720, 620);
      addLabelField(objects, recipe, page, colors, 'row-round-notes', 'Row/round notes', 1590, 720, 750, 180);
      addLabelField(objects, recipe, page, colors, 'modifications', 'Modifications', PAGE_LAYOUT.outerX, 1060, 1020, 260);
      addLabelField(objects, recipe, page, colors, 'trouble-spots', 'Trouble spots', 1320, 1060, 1020, 260);
      addNotesSection(objects, recipe, page, colors, 'pattern-open-notes', 'Open pattern notes', PAGE_LAYOUT.outerX, 1540, PAGE_LAYOUT.outerWidth, 10, 104, {
        headingFontSize: 38,
      });
      break;
    case 'gift-planner':
      addSectionIntro(objects, recipe, page, colors, 'gift-intro', 'Plan handmade gifts by recipient, budget, deadline, materials, and delivery status.', PAGE_LAYOUT.outerX, PAGE_LAYOUT.introTop, 1560);
      addTable(objects, recipe, page, colors, 'gifts', ['Recipient', 'Occasion', 'Budget', 'Deadline', 'Pattern/project', 'Materials needed', 'Status'], PAGE_LAYOUT.outerX, 470, PAGE_LAYOUT.outerWidth, 7, {
        rowHeight: 120,
        headerFontSize: 22,
        headerTopPadding: 32,
        headerSidePadding: 12,
        strokeWidth: 4,
      });
      objects.push(textObject(recipe, page, 'gift-status-heading', 'heading', 'Wrap / ship / deliver status', PAGE_LAYOUT.outerX, 1530, {
        width: 1100,
        fontSize: 40,
        fontWeight: 700,
        fill: colors.primary,
        tokenRole: TOKEN_ROLES.heading,
      }));
      addChecklist(objects, recipe, page, colors, 'gift-status', ['Pattern picked', 'Materials gathered', 'Making', 'Blocked', 'Wrapped', 'Shipped/delivered'], 260, 1610, 2, {
        columnWidth: 900,
        rowGap: 120,
        boxSize: 54,
      });
      addNotesSection(objects, recipe, page, colors, 'gift-notes', 'Gift notes', PAGE_LAYOUT.outerX, 2130, PAGE_LAYOUT.outerWidth, 6, PAGE_LAYOUT.notes.rowGap, {
        headingFontSize: 38,
      });
      break;
    case 'frog-or-finish':
      addSectionIntro(objects, recipe, page, colors, 'decision-intro', 'Decide whether this project deserves finishing, frogging, pausing, or a useful new life.', PAGE_LAYOUT.outerX, PAGE_LAYOUT.introTop, 1560);
      addLabelField(objects, recipe, page, colors, 'working', 'What is working?', PAGE_LAYOUT.outerX, 420, 1000, 220);
      addLabelField(objects, recipe, page, colors, 'bothering-me', 'What is bothering me?', 1260, 420, 1080, 220);
      addLabelField(objects, recipe, page, colors, 'time-remaining', 'Time remaining', PAGE_LAYOUT.outerX, 780, 620);
      addLabelField(objects, recipe, page, colors, 'salvageable', 'Can it be salvaged?', 900, 780, 620);
      addLabelField(objects, recipe, page, colors, 'next-action', 'Next action', 1590, 780, 750);
      objects.push(textObject(recipe, page, 'decision-heading', 'heading', 'Decision', PAGE_LAYOUT.outerX, 1128, {
        width: 900,
        fontSize: 42,
        fontWeight: 700,
        fill: colors.primary,
        tokenRole: TOKEN_ROLES.heading,
      }));
      addChecklist(objects, recipe, page, colors, 'decision', ['Frog it', 'Finish it', 'Pause it', 'Repurpose it'], 260, 1210, 2, {
        columnWidth: 850,
        rowGap: 122,
        boxSize: 54,
      });
      addLabelField(objects, recipe, page, colors, 'continue-plan', 'If I continue...', PAGE_LAYOUT.outerX, 1590, 1020, 260);
      addLabelField(objects, recipe, page, colors, 'frog-plan', 'If I frog / repurpose...', 1320, 1590, 1020, 260);
      addNotesSection(objects, recipe, page, colors, 'decision-notes', 'Decision notes', PAGE_LAYOUT.outerX, 2160, PAGE_LAYOUT.outerWidth, 6, PAGE_LAYOUT.notes.rowGap, {
        headingFontSize: 38,
      });
      break;
    case 'brain-dump':
      addSectionIntro(objects, recipe, page, colors, 'brain-dump-intro', 'A messy capture page for craft thoughts that do not belong anywhere tidy yet.', PAGE_LAYOUT.outerX, PAGE_LAYOUT.introTop, 1560);
      addNotesSection(objects, recipe, page, colors, 'ideas', 'Ideas', PAGE_LAYOUT.outerX, 430, 1000, 6, 104);
      addNotesSection(objects, recipe, page, colors, 'maybe-later', 'Maybe later', 1320, 430, 1020, 6, 104);
      addNotesSection(objects, recipe, page, colors, 'supplies-to-check', 'Supplies to check', PAGE_LAYOUT.outerX, 1510, 1000, 6, 104);
      addNotesSection(objects, recipe, page, colors, 'questions-blockers', 'Questions / blockers', 1320, 1510, 1020, 6, 104);
      break;
    case 'blank-notes':
      addLinedNotes(objects, recipe, page, colors, 'blank-notes', PAGE_LAYOUT.outerX, 430, PAGE_LAYOUT.outerWidth, 20, 120);
      break;
    case 'pattern-snapshot':
      addSectionIntro(objects, recipe, page, colors, 'pattern-snapshot-intro', 'Capture the pattern source, terms, gauge target, and construction notes before you start decoding.', PAGE_LAYOUT.outerX, PAGE_LAYOUT.introTop, 1680);
      addLabelField(objects, recipe, page, colors, 'pattern-name', 'Pattern name', PAGE_LAYOUT.outerX, 420, 900);
      addLabelField(objects, recipe, page, colors, 'designer-source', 'Designer/source', 1160, 420, 740);
      addLabelField(objects, recipe, page, colors, 'skill-level', 'Skill level', 1950, 420, 390);
      addLabelField(objects, recipe, page, colors, 'url-book-page', 'URL/book/page', PAGE_LAYOUT.outerX, 700, 1050);
      addLabelField(objects, recipe, page, colors, 'pattern-format', 'Pattern format', 1320, 700, 460);
      addLabelField(objects, recipe, page, colors, 'terms-used', 'US or UK terms', 1840, 700, 500);
      addLabelField(objects, recipe, page, colors, 'yarn-weight', 'Yarn weight', PAGE_LAYOUT.outerX, 980, 520);
      addLabelField(objects, recipe, page, colors, 'hook-size', 'Hook size', 790, 980, 430);
      addLabelField(objects, recipe, page, colors, 'gauge-target', 'Gauge target', 1270, 980, 520);
      addLabelField(objects, recipe, page, colors, 'construction-style', 'Construction style', 1850, 980, 490);
      addNotesSection(objects, recipe, page, colors, 'snapshot-notes', 'Decoder notes', PAGE_LAYOUT.outerX, 1390, PAGE_LAYOUT.outerWidth, 11, 104, {
        headingFontSize: 38,
      });
      break;
    case 'abbreviation-decoder':
      addSectionIntro(objects, recipe, page, colors, 'abbreviation-intro', 'Translate shorthand before it slows down your stitch rhythm.', PAGE_LAYOUT.outerX, PAGE_LAYOUT.introTop, 1560);
      addTable(objects, recipe, page, colors, 'abbreviation-decoder', ['Abbrev.', 'Meaning', 'Notes / example'], PAGE_LAYOUT.outerX, 470, PAGE_LAYOUT.outerWidth, 14, {
        rowHeight: 128,
        headerFontSize: 26,
        headerTopPadding: 34,
        headerSidePadding: 18,
        strokeWidth: 4,
      });
      addNotesSection(objects, recipe, page, colors, 'abbreviation-questions', 'Terms to double-check', PAGE_LAYOUT.outerX, 2510, PAGE_LAYOUT.outerWidth, 4, 98, {
        headingFontSize: 36,
      });
      break;
    case 'stitch-symbol-key':
      addSectionIntro(objects, recipe, page, colors, 'stitch-symbol-intro', 'Map stitches, chart symbols, and repeated instructions so the pattern stays readable.', PAGE_LAYOUT.outerX, PAGE_LAYOUT.introTop, 1660);
      addTable(objects, recipe, page, colors, 'stitch-symbol-key', ['Stitch / symbol', 'Description', 'Where it appears', 'Notes'], PAGE_LAYOUT.outerX, 470, PAGE_LAYOUT.outerWidth, 12, {
        rowHeight: 128,
        headerFontSize: 24,
        headerTopPadding: 34,
        headerSidePadding: 16,
        strokeWidth: 4,
      });
      addNotesSection(objects, recipe, page, colors, 'stitch-symbol-notes', 'Symbol or stitch reminders', PAGE_LAYOUT.outerX, 2300, PAGE_LAYOUT.outerWidth, 5, 96, {
        headingFontSize: 36,
      });
      break;
    case 'gauge-swatch-notes':
      addSectionIntro(objects, recipe, page, colors, 'gauge-intro', 'Record your target, actual swatch results, and what needs changing before the full project.', PAGE_LAYOUT.outerX, PAGE_LAYOUT.introTop, 1660);
      addLabelField(objects, recipe, page, colors, 'hook-size', 'Hook size', PAGE_LAYOUT.outerX, 420, 620);
      addLabelField(objects, recipe, page, colors, 'yarn', 'Yarn', 900, 420, 620);
      addLabelField(objects, recipe, page, colors, 'gauge-target', 'Gauge target', 1590, 420, 750);
      addLabelField(objects, recipe, page, colors, 'target-stitches', 'Target stitches per 4 in / 10 cm', PAGE_LAYOUT.outerX, 700, 620);
      addLabelField(objects, recipe, page, colors, 'target-rows', 'Target rows per 4 in / 10 cm', 900, 700, 620);
      addLabelField(objects, recipe, page, colors, 'hook-adjustment', 'Hook adjustment: up / down / same', 1590, 700, 750);
      addLabelField(objects, recipe, page, colors, 'actual-before-blocking', 'Actual before blocking', PAGE_LAYOUT.outerX, 980, 1000);
      addLabelField(objects, recipe, page, colors, 'actual-after-blocking', 'Actual after blocking', 1260, 980, 1080);
      addNotesSection(objects, recipe, page, colors, 'swatch-notes', 'Swatch notes', PAGE_LAYOUT.outerX, 1380, 1000, 7, 104, {
        headingFontSize: 38,
      });
      addNotesSection(objects, recipe, page, colors, 'adjustment-notes', 'Adjustment notes', 1320, 1380, 1020, 7, 104, {
        headingFontSize: 38,
      });
      break;
    case 'row-round-tracker':
      addSectionIntro(objects, recipe, page, colors, 'row-round-intro', 'Track each row or round with the instruction summary, stitch count, completion, and notes.', PAGE_LAYOUT.outerX, PAGE_LAYOUT.introTop, 1660);
      addTable(objects, recipe, page, colors, 'row-round-tracker', ['Row / round', 'Instruction summary', 'Stitch count', 'Done?', 'Notes'], PAGE_LAYOUT.outerX, 470, PAGE_LAYOUT.outerWidth, 14, {
        rowHeight: 128,
        headerFontSize: 23,
        headerTopPadding: 34,
        headerSidePadding: 14,
        strokeWidth: 4,
      });
      break;
    case 'section-breakdown':
      addSectionIntro(objects, recipe, page, colors, 'section-breakdown-intro', 'Break a long crochet pattern into pieces, row ranges, stitch-count goals, repeats, and tricky instructions.', PAGE_LAYOUT.outerX, PAGE_LAYOUT.introTop, 1740);
      addTable(objects, recipe, page, colors, 'section-breakdown', ['Section / piece', 'Rows / rounds', 'Stitch count goal', 'Shaping / repeats', 'Tricky instruction', 'Status'], PAGE_LAYOUT.outerX, 470, PAGE_LAYOUT.outerWidth, 11, {
        rowHeight: 130,
        headerFontSize: 20,
        headerTopPadding: 34,
        headerSidePadding: 12,
        strokeWidth: 4,
      });
      addNotesSection(objects, recipe, page, colors, 'section-plan-notes', 'Section plan notes', PAGE_LAYOUT.outerX, 2170, PAGE_LAYOUT.outerWidth, 6, 100, {
        headingFontSize: 36,
      });
      break;
    case 'modification-notes':
      addSectionIntro(objects, recipe, page, colors, 'modification-intro', 'Log every pattern change so you can repeat it, explain it, or undo it later.', PAGE_LAYOUT.outerX, PAGE_LAYOUT.introTop, 1560);
      addTable(objects, recipe, page, colors, 'modification-notes', ['Original instruction', 'Change made', 'Reason', 'Impact'], PAGE_LAYOUT.outerX, 470, PAGE_LAYOUT.outerWidth, 11, {
        rowHeight: 130,
        headerFontSize: 24,
        headerTopPadding: 34,
        headerSidePadding: 16,
        strokeWidth: 4,
      });
      addNotesSection(objects, recipe, page, colors, 'modification-open-notes', 'Modification notes', PAGE_LAYOUT.outerX, 2170, PAGE_LAYOUT.outerWidth, 6, 100, {
        headingFontSize: 36,
      });
      break;
    case 'trouble-spots':
      addSectionIntro(objects, recipe, page, colors, 'trouble-intro', 'Capture confusing instructions, where they happen, and the fix you want to try next.', PAGE_LAYOUT.outerX, PAGE_LAYOUT.introTop, 1660);
      addTable(objects, recipe, page, colors, 'trouble-spots', ['Issue', 'Where it happens', 'Attempted fix', 'Reference/source', 'Resolved?', 'Notes'], PAGE_LAYOUT.outerX, 470, PAGE_LAYOUT.outerWidth, 11, {
        rowHeight: 130,
        headerFontSize: 20,
        headerTopPadding: 34,
        headerSidePadding: 12,
        strokeWidth: 4,
      });
      addNotesSection(objects, recipe, page, colors, 'trouble-followup', 'Follow-up questions', PAGE_LAYOUT.outerX, 2170, PAGE_LAYOUT.outerWidth, 6, 100, {
        headingFontSize: 36,
      });
      break;
    case 'project-finish-notes':
      addSectionIntro(objects, recipe, page, colors, 'finish-intro', 'Finish the project cleanly and capture what you learned for the next pattern.', PAGE_LAYOUT.outerX, PAGE_LAYOUT.introTop, 1560);
      objects.push(textObject(recipe, page, 'finish-checklist-heading', 'heading', 'Finish checklist', PAGE_LAYOUT.outerX, 430, {
        width: 900,
        fontSize: 40,
        fontWeight: 700,
        fill: colors.primary,
        tokenRole: TOKEN_ROLES.heading,
      }));
      addChecklist(objects, recipe, page, colors, 'finish-checklist', ['Blocking', 'Assembly', 'Edging', 'Weaving ends', 'Final measurements', 'Photos / listing notes'], 260, 520, 2, {
        columnWidth: 900,
        rowGap: 128,
        boxSize: 54,
      });
      addLabelField(objects, recipe, page, colors, 'final-hook-used', 'Final hook used', PAGE_LAYOUT.outerX, 1100, 620, 160);
      addLabelField(objects, recipe, page, colors, 'final-yarn-used', 'Final yarn used', 900, 1100, 620, 160);
      addLabelField(objects, recipe, page, colors, 'final-measurements', 'Final measurements', 1590, 1100, 750, 160);
      addLabelField(objects, recipe, page, colors, 'pattern-changes-to-keep', 'Pattern changes to keep', PAGE_LAYOUT.outerX, 1390, 1000, 180);
      addLabelField(objects, recipe, page, colors, 'change-next-time', 'What I would change next time', 1260, 1390, 1080, 180);
      addNotesSection(objects, recipe, page, colors, 'lessons-learned', 'Lessons learned', PAGE_LAYOUT.outerX, 1780, PAGE_LAYOUT.outerWidth, 7, 104, {
        headingFontSize: 38,
      });
      break;
    default:
      break;
  }

  addFooter(objects, recipe, page, colors, pageIndex, pageCount);
  return objects;
};

const buildPages = (
  recipe: ProductRecipe,
  colors: RecipeColors,
  productTitle: string
): ExistingProjectPage[] =>
  recipe.pages.map((page, index) => ({
    id: `${recipe.id}-${page.id}`,
    name: page.name,
    canvasSize: {
      width: recipe.defaultPageSize.width,
      height: recipe.defaultPageSize.height,
    },
    canvasData: {
      version: '5.0.0',
      background: colors.background,
      objects: buildPageObjects(recipe, page, index, colors, productTitle),
    },
  }));

const buildPreviewFileNames = (slug: string, pageCount: number) =>
  Array.from({ length: pageCount }, (_, index) => `${slug}-preview-page-${pageNumber(index)}.png`);

const buildProductMetadata = (
  recipe: ProductRecipe,
  title: string
): ProjectProductMetadata => ({
  title,
  subtitle: recipe.name,
  description: recipe.productMetadataDefaults.description,
  category: recipe.productMetadataDefaults.category,
  tags: [...(recipe.productMetadataDefaults.tags ?? [])],
  useCases: [...(recipe.productMetadataDefaults.useCases ?? [])],
  includedFiles: [...(recipe.productMetadataDefaults.includedFiles ?? [])],
  listingCopy: recipe.productMetadataDefaults.listingCopy
    ? {
        ...recipe.productMetadataDefaults.listingCopy,
        bullets: [...(recipe.productMetadataDefaults.listingCopy.bullets ?? [])],
      }
    : undefined,
});

export const generateProjectFromRecipe = (
  recipeOrId: ProductRecipe | string,
  options: GenerateProjectFromRecipeOptions = {}
): GeneratedRecipeProject => {
  const recipe = typeof recipeOrId === 'string' ? getProductRecipe(recipeOrId) : recipeOrId;
  if (!recipe) {
    throw new Error(`Unknown product recipe: ${String(recipeOrId)}`);
  }

  const theme = options.theme ?? DEFAULT_THEME;
  const themeName = getThemeName(theme);
  const title = options.projectName
    || recipe.productMetadataDefaults.titleTemplate.replace('{Theme Name}', themeName);
  const slug = slugify(title);
  const now = options.now ?? new Date().toISOString();
  const colors = resolveColors(theme);
  const pages = buildPages(recipe, colors, title);
  const productMetadata = buildProductMetadata(recipe, title);
  const previewFileNames = buildPreviewFileNames(slug, pages.length);

  return normalizeDesignSpaceProjectPayload({
    projectId: options.projectId ?? `recipe-${recipe.id}-${slug}`,
    createdAt: now,
    updatedAt: now,
    metadata: {
      name: title,
      slug,
      sourceApp: 'design-space',
    },
    document: {
      pageSize: recipe.defaultPageSize,
      background: {
        tokenRole: TOKEN_ROLES.background,
        value: colors.background,
      },
      bleedPx: 0,
      safeMarginPx: 150,
    },
    theme: {
      source: theme.meta?.schema === 'generic-token-pack-v1' ? 'apocapalette' : 'unknown',
      themeId: getThemeId(theme, options.themeId),
      name: themeName,
      slug: getThemeSlug(theme),
      version: typeof theme.meta?.version === 'string' ? theme.meta.version : undefined,
      tokens: theme,
    },
    recipe: {
      id: recipe.id,
      version: recipe.version,
      generatedAt: now,
    },
    pages,
    activePageIndex: 0,
    canvasData: pages[0]?.canvasData,
    assets: {},
    activeTheme: theme,
    lastUpdated: now,
    canvasSize: {
      width: recipe.defaultPageSize.width,
      height: recipe.defaultPageSize.height,
    },
    unitMode: recipe.defaultPageSize.unitMode,
    exportSettings: {
      ...recipe.exportSettingsDefaults,
      pdfFileName: `${slug}.pdf`,
      previewFileNames,
      formats: ['pdf', 'png'],
      dpi: recipe.defaultPageSize.dpi,
      includeBackground: true,
    },
    productMetadata,
    projectName: title,
  }, {
    projectName: title,
    projectId: options.projectId,
    now,
    pages,
    canvasSize: {
      width: recipe.defaultPageSize.width,
      height: recipe.defaultPageSize.height,
    },
    unitMode: recipe.defaultPageSize.unitMode,
    activeTheme: theme,
    defaultBackground: colors.background,
  });
};
