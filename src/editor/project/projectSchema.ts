import type { UnitMode } from '../utils/units';
import type {
  DocumentContentJson,
  DocumentOverlayImage,
  DocumentPage,
  ScanReference,
} from '../../document/types/documentProject';
import {
  constrainDocumentOverlayToPage,
  constrainDocumentReferenceToPage,
  getDocumentPaperDimensions,
} from '../../document/utils/documentPageOrientation';

export const LEGACY_DESIGN_SPACE_PROJECT_SCHEMA_VERSION = 'design-space-project-v1' as const;
export const DESIGN_SPACE_PROJECT_SCHEMA_VERSION = 'design-space-project-v2' as const;

export type DesignSpaceProjectSchemaVersion = typeof DESIGN_SPACE_PROJECT_SCHEMA_VERSION;
export type SupportedDesignSpaceProjectSchemaVersion =
  | typeof LEGACY_DESIGN_SPACE_PROJECT_SCHEMA_VERSION
  | DesignSpaceProjectSchemaVersion;
export type EditorMode = 'canvas' | 'document';
export type ProjectExportFormat = 'pdf' | 'png' | 'jpeg' | 'svg';

/**
 * The legacy canvas page shape remains exported because recipes, Fabric export,
 * and old project files use it directly. Normalized v2 canvas payloads add
 * `kind: 'canvas'` without changing the existing canvas data fields.
 */
export type ExistingProjectPage = {
  kind?: 'canvas';
  id: string;
  name: string;
  canvasData?: any;
  pages?: ExistingProjectPage[];
  activePageIndex?: number;
  canvasSize: { width: number; height: number };
  thumbnail?: string;
};

export type CanvasProjectPage = ExistingProjectPage & {
  kind: 'canvas';
};

export type DesignSpaceProjectPage = CanvasProjectPage | DocumentPage;

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

export type ProjectRecoveryMetadata = {
  originalProjectId: string;
  originalTimestamp?: string;
  recoveredAt: string;
  sourceBrowserProfile: string;
  sourceRecord?: string;
  sourceSequence?: number;
  validationWarnings: string[];
  assetsDeduplicated: number;
  complete: boolean;
  payloadHash?: string;
};

export type ProductProjectFields = {
  schemaVersion: DesignSpaceProjectSchemaVersion;
  editorMode: EditorMode;
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
  recovery?: ProjectRecoveryMetadata;
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
  editorMode?: EditorMode;
  projectName?: string;
  projectId?: string;
  now?: string;
  pages?: TPage[];
  canvasSize?: { width: number; height: number };
  unitMode?: UnitMode;
  activeTheme?: unknown;
  defaultBackground?: string;
};

export type CanvasProjectPayload = ProductAwareProjectPayload<CanvasProjectPage> & {
  editorMode: 'canvas';
};

export type DocumentProjectPayload = ProductAwareProjectPayload<DocumentPage> & {
  editorMode: 'document';
};

export type DesignSpaceProjectPayload = CanvasProjectPayload | DocumentProjectPayload;

const DEFAULT_PAGE_SIZE = { width: 2550, height: 3300 };
const DEFAULT_BACKGROUND = '#FAF8F5';

const isObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const safeString = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

export const assertSupportedDesignSpaceProjectSchema = (
  payload: unknown
): SupportedDesignSpaceProjectSchemaVersion | undefined => {
  if (!isObject(payload) || payload.schemaVersion === undefined) {
    return undefined;
  }
  if (
    payload.schemaVersion === LEGACY_DESIGN_SPACE_PROJECT_SCHEMA_VERSION
    || payload.schemaVersion === DESIGN_SPACE_PROJECT_SCHEMA_VERSION
  ) {
    return payload.schemaVersion;
  }
  throw new Error(`Unsupported project schema: ${String(payload.schemaVersion)}`);
};

export const getDesignSpaceProjectEditorMode = (
  payload: unknown,
  fallback?: EditorMode
): EditorMode => {
  const schemaVersion = assertSupportedDesignSpaceProjectSchema(payload);
  if (!isObject(payload)) {
    return fallback ?? 'canvas';
  }

  // A missing version and v1 both predate document projects. Treating them as
  // canvas projects is the compatibility contract, even if they contain an
  // unrelated `editorMode` property.
  if (
    schemaVersion === undefined
    || schemaVersion === LEGACY_DESIGN_SPACE_PROJECT_SCHEMA_VERSION
  ) {
    return fallback ?? 'canvas';
  }

  if (payload.editorMode === 'canvas' || payload.editorMode === 'document') {
    return payload.editorMode;
  }
  if (payload.editorMode !== undefined) {
    throw new Error(`Unsupported editor mode: ${String(payload.editorMode)}`);
  }

  // Early v2 development payloads may not have written the discriminator.
  // Defaulting those to canvas is lossless because document pages always carry
  // an explicit `kind: 'document'` and production document writers set mode.
  const hasDocumentPage = Array.isArray(payload.pages)
    && payload.pages.some((page) => isObject(page) && page.kind === 'document');
  return hasDocumentPage ? 'document' : fallback ?? 'canvas';
};

const isUnitMode = (value: unknown): value is UnitMode =>
  value === 'px' || value === 'in' || value === 'cm' || value === 'mm';

const normalizeUnitMode = (value: unknown, fallback: UnitMode = 'in'): UnitMode =>
  isUnitMode(value) ? value : fallback;

const normalizeDimension = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback;
};

const normalizePositiveNumber = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

const normalizeNonNegativeNumber = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
};

const normalizeFiniteNumber = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

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

const normalizeRecoveryMetadata = (value: unknown): ProjectRecoveryMetadata | undefined => {
  if (!isObject(value)) return undefined;
  const originalProjectId = safeString(value.originalProjectId);
  const recoveredAt = safeString(value.recoveredAt);
  const sourceBrowserProfile = safeString(value.sourceBrowserProfile);
  if (!originalProjectId || !recoveredAt || !sourceBrowserProfile) return undefined;
  return {
    originalProjectId,
    originalTimestamp: safeString(value.originalTimestamp),
    recoveredAt,
    sourceBrowserProfile,
    sourceRecord: safeString(value.sourceRecord),
    sourceSequence: typeof value.sourceSequence === 'number' && Number.isFinite(value.sourceSequence)
      ? value.sourceSequence
      : undefined,
    validationWarnings: normalizeStringArray(value.validationWarnings) || [],
    assetsDeduplicated: Math.max(0, Math.trunc(Number(value.assetsDeduplicated) || 0)),
    complete: value.complete === true,
    payloadHash: safeString(value.payloadHash),
  };
};

const createEmptyDocumentContent = (): DocumentContentJson => ({
  type: 'doc',
  content: [{ type: 'paragraph' }],
});

const normalizeDocumentContent = (value: unknown): DocumentContentJson =>
  isObject(value) && value.type === 'doc'
    ? value as DocumentContentJson
    : createEmptyDocumentContent();

const normalizeOverlayImage = (
  value: unknown,
  index: number
): DocumentOverlayImage | null => {
  if (!isObject(value)) return null;
  const assetId = safeString(value.assetId);
  if (!assetId) return null;

  return {
    id: safeString(value.id) || `overlay-${index + 1}`,
    assetId,
    altText: typeof value.altText === 'string' ? value.altText : '',
    xPx: normalizeFiniteNumber(value.xPx, 0),
    yPx: normalizeFiniteNumber(value.yPx, 0),
    widthPx: normalizePositiveNumber(value.widthPx, 240),
    heightPx: normalizePositiveNumber(value.heightPx, 180),
    placement: value.placement === 'behind' ? 'behind' : 'front',
    caption: safeString(value.caption),
    naturalWidth: value.naturalWidth === undefined
      ? undefined
      : normalizePositiveNumber(value.naturalWidth, 1),
    naturalHeight: value.naturalHeight === undefined
      ? undefined
      : normalizePositiveNumber(value.naturalHeight, 1),
    locked: typeof value.locked === 'boolean' ? value.locked : undefined,
  };
};

const normalizeScanReference = (value: unknown): ScanReference | undefined => {
  if (!isObject(value)) return undefined;
  const assetId = safeString(value.assetId);
  if (!assetId) return undefined;

  return {
    assetId,
    sourceType: value.sourceType === 'pdf' ? 'pdf' : 'image',
    opacity: clamp(normalizeFiniteNumber(value.opacity, 0.35), 0, 1),
    fit: value.fit === 'cover' || value.fit === 'stretch' ? value.fit : 'contain',
    scale: clamp(normalizePositiveNumber(value.scale, 1), 0.05, 20),
    offsetXPx: normalizeFiniteNumber(value.offsetXPx, 0),
    offsetYPx: normalizeFiniteNumber(value.offsetYPx, 0),
    visible: typeof value.visible === 'boolean' ? value.visible : true,
    // Reference scans are editor-only source material and must always reopen
    // locked. A transient adjust-reference mode may unlock its UI controls.
    locked: true,
  };
};

export const normalizeDocumentProjectPage = (
  value: unknown,
  index = 0
): DocumentPage => {
  const source = isObject(value) ? value : {};
  const size = isObject(source.size) ? source.size : {};
  const presetId = size.presetId === 'a4' ? 'a4' : 'letter';
  const orientation = size.orientation === 'landscape' ? 'landscape' : 'portrait';
  const { widthIn, heightIn } = getDocumentPaperDimensions(
    presetId,
    orientation
  );
  const margins = isObject(source.margins) ? source.margins : {};
  const rawOverlays = Array.isArray(source.overlayObjects) ? source.overlayObjects : [];
  const overlayObjects = rawOverlays
    .map(normalizeOverlayImage)
    .filter((image): image is DocumentOverlayImage => image !== null)
    .map((image) => constrainDocumentOverlayToPage(image, widthIn, heightIn));
  const rawColumnCount = Number(source.columnCount);
  const columnCount: 1 | 2 | 3 =
    rawColumnCount === 2 || rawColumnCount === 3 ? rawColumnCount : 1;

  return {
    kind: 'document',
    id: safeString(source.id) || `document-page-${index + 1}`,
    name: safeString(source.name) || `Page ${index + 1}`,
    size: {
      presetId,
      orientation,
      widthIn,
      heightIn,
      dpi: normalizeDimension(size.dpi, 300),
    },
    margins: {
      topIn: clamp(normalizeNonNegativeNumber(margins.topIn, 0.5), 0, heightIn),
      rightIn: clamp(normalizeNonNegativeNumber(margins.rightIn, 0.5), 0, widthIn),
      bottomIn: clamp(normalizeNonNegativeNumber(margins.bottomIn, 0.5), 0, heightIn),
      leftIn: clamp(normalizeNonNegativeNumber(margins.leftIn, 0.5), 0, widthIn),
    },
    titleContent: normalizeDocumentContent(source.titleContent),
    bodyContent: normalizeDocumentContent(source.bodyContent),
    titleFontSizePx: clamp(normalizePositiveNumber(source.titleFontSizePx, 42), 8, 240),
    columnCount,
    columnGapPx: clamp(normalizeNonNegativeNumber(source.columnGapPx, 24), 0, 480),
    dropCap: source.dropCap === true,
    overlayObjects,
    reference: constrainDocumentReferenceToPage(
      normalizeScanReference(source.reference),
      widthIn,
      heightIn
    ),
  };
};

const normalizeCanvasProjectPage = (
  value: unknown,
  index: number,
  fallbackSize: { width: number; height: number }
): CanvasProjectPage => {
  const source = isObject(value) ? value : {};
  const size = isObject(source.canvasSize) ? source.canvasSize : {};
  return {
    ...source,
    kind: 'canvas',
    id: safeString(source.id) || `canvas-page-${index + 1}`,
    name: safeString(source.name) || `Page ${index + 1}`,
    canvasSize: {
      width: normalizeDimension(size.width, fallbackSize.width),
      height: normalizeDimension(size.height, fallbackSize.height),
    },
  } as CanvasProjectPage;
};

export const normalizeDesignSpaceProjectPayload = <TPage = ExistingProjectPage>(
  payload: unknown,
  options: NormalizeProjectOptions<TPage> = {}
): ProductAwareProjectPayload<TPage> => {
  const raw = isObject(payload) ? payload : {};
  const detectedEditorMode = getDesignSpaceProjectEditorMode(raw);
  const editorMode = options.editorMode ?? detectedEditorMode;
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
  const pageCandidates = Array.isArray(rawPages) ? rawPages : [];
  const firstPage = pageCandidates.length > 0 && isObject(pageCandidates[0])
    ? pageCandidates[0] as any
    : null;
  const fallbackCanvasSize = options.canvasSize || raw.canvasSize || firstPage?.canvasSize || DEFAULT_PAGE_SIZE;
  const fallbackSize = {
    width: normalizeDimension((fallbackCanvasSize as any)?.width, DEFAULT_PAGE_SIZE.width),
    height: normalizeDimension((fallbackCanvasSize as any)?.height, DEFAULT_PAGE_SIZE.height),
  };
  const normalizedPages = editorMode === 'document'
    ? (
        pageCandidates.length > 0
          ? pageCandidates.map((page, index) => normalizeDocumentProjectPage(page, index))
          : [normalizeDocumentProjectPage(undefined, 0)]
      )
    : pageCandidates.map((page, index) => normalizeCanvasProjectPage(page, index, fallbackSize));
  const pages = normalizedPages as TPage[];
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
    editorMode,
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
    recovery: normalizeRecoveryMetadata(raw.recovery),

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
  editorMode: payload.editorMode,
  projectId: payload.projectId,
  createdAt: payload.createdAt,
  updatedAt: payload.updatedAt,
  metadata: payload.metadata,
  document: payload.document,
  theme: payload.theme,
  recipe: payload.recipe,
  exportSettings: payload.exportSettings,
  productMetadata: payload.productMetadata,
  recovery: payload.recovery,
});
