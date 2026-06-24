import type { UnitMode } from '../utils/units';

export const DESIGN_SPACE_PROJECT_SCHEMA_VERSION = 'design-space-project-v1' as const;

export type DesignSpaceProjectSchemaVersion = typeof DESIGN_SPACE_PROJECT_SCHEMA_VERSION;
export type ProjectExportFormat = 'pdf' | 'png' | 'jpeg' | 'svg';

export type ExistingProjectPage = {
  id: string;
  name: string;
  canvasData?: any;
  pages?: ExistingProjectPage[];
  activePageIndex?: number;
  canvasSize: { width: number; height: number };
  thumbnail?: string;
};

export type ProjectPageSize = {
  presetId?: string;
  width: number;
  height: number;
  unitMode: UnitMode;
  dpi: number;
};

export type ProjectDocument = {
  pageSize: ProjectPageSize;
  background?: {
    tokenRole?: string;
    value: string;
  };
  bleedPx?: number;
  safeMarginPx?: number;
};

export type ProjectTheme = {
  source?: 'apocapalette' | 'manual' | 'unknown';
  themeId?: string;
  name?: string;
  slug?: string;
  version?: string;
  tokens?: unknown;
};

export type ProjectRecipe = {
  id?: string;
  version?: string;
  generatedAt?: string;
};

export type ProjectExportSettings = {
  pdfFileName?: string;
  previewFileNames?: string[];
  formats?: ProjectExportFormat[];
  dpi?: number;
  includeBackground?: boolean;
};

export type ProjectProductMetadata = {
  title?: string;
  subtitle?: string;
  description?: string;
  tags?: string[];
  category?: string;
  useCases?: string[];
  includedFiles?: string[];
  listingCopy?: {
    shortDescription?: string;
    longDescription?: string;
    bullets?: string[];
  };
};

export type ProductProjectFields = {
  schemaVersion: DesignSpaceProjectSchemaVersion;
  projectId: string;
  createdAt?: string;
  updatedAt: string;
  metadata: {
    name: string;
    slug?: string;
    author?: string;
    sourceApp: 'design-space';
  };
  document: ProjectDocument;
  theme?: ProjectTheme;
  recipe?: ProjectRecipe;
  exportSettings?: ProjectExportSettings;
  productMetadata?: ProjectProductMetadata;
};

export type ProductAwareProjectPayload<TPage = ExistingProjectPage> = ProductProjectFields & {
  pages: TPage[];

  // Legacy editor payload fields kept for existing save/load compatibility.
  projectName: string;
  activePageIndex?: number;
  canvasData?: any;
  assets?: Record<string, string>;
  activeTheme?: unknown;
  lastUpdated: string;
  canvasSize?: { width: number; height: number };
  unitMode?: UnitMode;
};

export type NormalizeProjectOptions<TPage = ExistingProjectPage> = {
  projectName?: string;
  projectId?: string;
  now?: string;
  pages?: TPage[];
  canvasSize?: { width: number; height: number };
  unitMode?: UnitMode;
  activeTheme?: unknown;
  defaultBackground?: string;
};

const DEFAULT_PAGE_SIZE = { width: 2550, height: 3300 };
const DEFAULT_BACKGROUND = '#FAF8F5';

const isObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const safeString = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const isUnitMode = (value: unknown): value is UnitMode =>
  value === 'px' || value === 'in' || value === 'cm' || value === 'mm';

const normalizeUnitMode = (value: unknown, fallback: UnitMode = 'in'): UnitMode =>
  isUnitMode(value) ? value : fallback;

const normalizeDimension = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback;
};

const normalizeIso = (value: unknown, fallback: string) => {
  const candidate = safeString(value);
  if (!candidate) return fallback;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
};

const slugify = (value: string) => {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled-project';
};

const getValueByPath = (target: any, path: string) =>
  path.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), target);

const getThemeName = (theme: unknown) =>
  safeString(getValueByPath(theme, 'meta.name'))
  || safeString(getValueByPath(theme, 'name'));

const getThemeSlug = (theme: unknown) =>
  safeString(getValueByPath(theme, 'meta.slug'))
  || safeString(getValueByPath(theme, 'slug'));

const getThemeVersion = (theme: unknown) =>
  safeString(getValueByPath(theme, 'meta.version'))
  || safeString(getValueByPath(theme, 'version'));

const inferThemeSource = (theme: unknown): ProjectTheme['source'] => {
  const schema = safeString(getValueByPath(theme, 'meta.schema'));
  return schema === 'generic-token-pack-v1' ? 'apocapalette' : 'unknown';
};

const getCanvasDataBackground = (canvasData: unknown) => {
  if (!isObject(canvasData)) return undefined;
  return safeString(canvasData.background);
};

const getFirstPageBackground = (pages: unknown[]) => {
  const first = pages[0];
  if (!isObject(first)) return undefined;
  return getCanvasDataBackground(first.canvasData);
};

const normalizeStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : undefined;

const normalizeExportFormats = (value: unknown): ProjectExportFormat[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set<ProjectExportFormat>(['pdf', 'png', 'jpeg', 'svg']);
  const formats = value.filter((entry): entry is ProjectExportFormat => allowed.has(entry));
  return formats.length > 0 ? formats : undefined;
};

const normalizePageSize = (
  candidate: unknown,
  fallbackSize: { width: number; height: number },
  fallbackUnitMode: UnitMode
): ProjectPageSize => {
  const source = isObject(candidate) ? candidate : {};
  const unitMode = normalizeUnitMode(source.unitMode, fallbackUnitMode);
  const dpi = normalizeDimension(source.dpi, unitMode === 'px' ? 96 : 300);
  return {
    presetId: safeString(source.presetId),
    width: normalizeDimension(source.width, fallbackSize.width),
    height: normalizeDimension(source.height, fallbackSize.height),
    unitMode,
    dpi,
  };
};

const normalizeDocument = (
  raw: Record<string, any>,
  pages: unknown[],
  fallbackSize: { width: number; height: number },
  fallbackUnitMode: UnitMode,
  defaultBackground: string
): ProjectDocument => {
  const document = isObject(raw.document) ? raw.document : {};
  const pageSize = normalizePageSize(document.pageSize, fallbackSize, fallbackUnitMode);
  const backgroundCandidate = isObject(document.background) ? document.background : null;
  const backgroundValue =
    safeString(backgroundCandidate?.value)
    || getFirstPageBackground(pages)
    || getCanvasDataBackground(raw.canvasData)
    || defaultBackground;

  return {
    pageSize,
    background: backgroundValue
      ? {
          tokenRole: safeString(backgroundCandidate?.tokenRole),
          value: backgroundValue,
        }
      : undefined,
    bleedPx: typeof document.bleedPx === 'number' ? document.bleedPx : undefined,
    safeMarginPx: typeof document.safeMarginPx === 'number' ? document.safeMarginPx : undefined,
  };
};

const normalizeTheme = (rawTheme: unknown, activeTheme: unknown): ProjectTheme | undefined => {
  const theme = isObject(rawTheme) ? rawTheme : null;
  const tokens = activeTheme ?? theme?.tokens;
  if (!theme && !tokens) return undefined;

  return {
    source: theme?.source === 'apocapalette' || theme?.source === 'manual' || theme?.source === 'unknown'
      ? theme.source
      : inferThemeSource(tokens),
    themeId: safeString(theme?.themeId),
    name: safeString(theme?.name) || getThemeName(tokens),
    slug: safeString(theme?.slug) || getThemeSlug(tokens),
    version: safeString(theme?.version) || getThemeVersion(tokens),
    tokens,
  };
};

const normalizeRecipe = (value: unknown): ProjectRecipe | undefined => {
  if (!isObject(value)) return undefined;
  const recipe = {
    id: safeString(value.id),
    version: safeString(value.version),
    generatedAt: safeString(value.generatedAt),
  };
  return recipe.id || recipe.version || recipe.generatedAt ? recipe : undefined;
};

const normalizeExportSettings = (
  value: unknown,
  slug: string,
  dpi: number
): ProjectExportSettings => {
  const source = isObject(value) ? value : {};
  return {
    pdfFileName: safeString(source.pdfFileName) || `${slug}.pdf`,
    previewFileNames: normalizeStringArray(source.previewFileNames) || [`${slug}-preview-page-01.png`],
    formats: normalizeExportFormats(source.formats) || ['pdf', 'png'],
    dpi: normalizeDimension(source.dpi, dpi),
    includeBackground: typeof source.includeBackground === 'boolean' ? source.includeBackground : true,
  };
};

const normalizeProductMetadata = (
  value: unknown,
  name: string
): ProjectProductMetadata => {
  const source = isObject(value) ? value : {};
  const listingCopy = isObject(source.listingCopy) ? source.listingCopy : {};
  return {
    title: safeString(source.title) || name,
    subtitle: safeString(source.subtitle),
    description: safeString(source.description) || '',
    tags: normalizeStringArray(source.tags) || [],
    category: safeString(source.category) || '',
    useCases: normalizeStringArray(source.useCases) || [],
    includedFiles: normalizeStringArray(source.includedFiles) || [],
    listingCopy: {
      shortDescription: safeString(listingCopy.shortDescription),
      longDescription: safeString(listingCopy.longDescription),
      bullets: normalizeStringArray(listingCopy.bullets) || [],
    },
  };
};

export const normalizeDesignSpaceProjectPayload = <TPage = ExistingProjectPage>(
  payload: unknown,
  options: NormalizeProjectOptions<TPage> = {}
): ProductAwareProjectPayload<TPage> => {
  const raw = isObject(payload) ? payload : {};
  const now = normalizeIso(options.now, new Date().toISOString());
  const updatedAt = normalizeIso(raw.updatedAt ?? raw.lastUpdated, now);
  const createdAt = raw.createdAt ? normalizeIso(raw.createdAt, updatedAt) : undefined;
  const metadata = isObject(raw.metadata) ? raw.metadata : {};
  const name =
    safeString(metadata.name)
    || safeString(raw.projectName)
    || safeString(options.projectName)
    || 'Untitled Project';
  const slug = safeString(metadata.slug) || slugify(name);
  const rawPages = Array.isArray(raw.pages) ? raw.pages : options.pages;
  const pages = (Array.isArray(rawPages) ? rawPages : []) as TPage[];
  const firstPage = pages.length > 0 && isObject(pages[0]) ? pages[0] as any : null;
  const fallbackCanvasSize = options.canvasSize || raw.canvasSize || firstPage?.canvasSize || DEFAULT_PAGE_SIZE;
  const fallbackSize = {
    width: normalizeDimension((fallbackCanvasSize as any)?.width, DEFAULT_PAGE_SIZE.width),
    height: normalizeDimension((fallbackCanvasSize as any)?.height, DEFAULT_PAGE_SIZE.height),
  };
  const unitMode = normalizeUnitMode(raw.unitMode, options.unitMode || 'in');
  const activeTheme = raw.activeTheme ?? options.activeTheme ?? (isObject(raw.theme) ? raw.theme.tokens : undefined);
  const document = normalizeDocument(
    raw,
    pages as unknown[],
    fallbackSize,
    unitMode,
    options.defaultBackground || DEFAULT_BACKGROUND
  );
  const theme = normalizeTheme(raw.theme, activeTheme);
  const projectId =
    safeString(raw.projectId)
    || safeString(options.projectId)
    || `local-${slug}`;

  return {
    schemaVersion: DESIGN_SPACE_PROJECT_SCHEMA_VERSION,
    projectId,
    createdAt,
    updatedAt,
    metadata: {
      name,
      slug,
      author: safeString(metadata.author),
      sourceApp: 'design-space',
    },
    document,
    theme,
    recipe: normalizeRecipe(raw.recipe),
    pages,
    exportSettings: normalizeExportSettings(raw.exportSettings, slug, document.pageSize.dpi),
    productMetadata: normalizeProductMetadata(raw.productMetadata, name),

    projectName: name,
    activePageIndex: typeof raw.activePageIndex === 'number' ? raw.activePageIndex : undefined,
    canvasData: raw.canvasData,
    assets: isObject(raw.assets) ? raw.assets as Record<string, string> : undefined,
    activeTheme,
    lastUpdated: updatedAt,
    canvasSize: {
      width: document.pageSize.width,
      height: document.pageSize.height,
    },
    unitMode: document.pageSize.unitMode,
  };
};

export const extractProductProjectFields = (
  payload: ProductAwareProjectPayload<any>
): ProductProjectFields => ({
  schemaVersion: payload.schemaVersion,
  projectId: payload.projectId,
  createdAt: payload.createdAt,
  updatedAt: payload.updatedAt,
  metadata: payload.metadata,
  document: payload.document,
  theme: payload.theme,
  recipe: payload.recipe,
  exportSettings: payload.exportSettings,
  productMetadata: payload.productMetadata,
});
