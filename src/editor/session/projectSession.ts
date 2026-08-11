import type { EditorMode } from '../project/projectSchema';
import type { FileDeliveryResult } from '../services/fileDeliveryService';
import type {
  PageAssetReferenceResult,
} from './assetReference';
import type {
  PageMutationCommand,
  PageMutationResult,
} from './projectMutation';
import type { ProjectChangeCoordinator } from './projectChangeCoordinator';
import type { ProjectChangeDiagnosticView } from './projectChangeDiagnostic';

/**
 * The shared page viewport contract uses CSS pixels only for display geometry.
 * It does not replace or reinterpret any persisted Canvas or Document
 * coordinates.
 */
export const PAGE_CSS_PIXELS_PER_INCH = 96 as const;
export const DEFAULT_LEGACY_CANVAS_DPI = 300 as const;

export type LegacyRendererKind = EditorMode;

export type ProjectSessionSource =
  | 'new'
  | 'library'
  | 'portable'
  | 'unknown';

export type SessionSaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';

export type PageCoordinateSpace =
  | 'canvas-logical-px'
  | 'document-page-css-px';

export type PageCapability =
  | 'freeform'
  | 'structured'
  | 'reference'
  | 'native-export'
  | 'page-navigation';

/**
 * A renderer-neutral page-size description. `sourceWidth` and
 * `sourceHeight` identify the legacy renderer's authored page units. The
 * `widthCssPx`/`heightCssPx` pair is the display-space representation used by
 * the shared viewport boundary.
 */
export type PageSizeDescriptor = Readonly<{
  sourceWidth: number;
  sourceHeight: number;
  sourceUnit: 'px';
  coordinateSpace: PageCoordinateSpace;
  widthCssPx: number;
  heightCssPx: number;
  physicalWidthIn: number;
  physicalHeightIn: number;
  outputDpi: number;
}>;

export type ProjectPageDescriptor = Readonly<{
  id: string;
  name: string;
  index: number;
  /** Product-facing page number; document adapters map this to the current folio. */
  folio: number;
  rendererKind: LegacyRendererKind;
  size: PageSizeDescriptor;
  capabilities: readonly PageCapability[];
}>;

export type ProjectSessionDescriptor = Readonly<{
  projectId: string;
  projectName: string;
  compatibilityMode: EditorMode;
  rendererKind: LegacyRendererKind;
  source: ProjectSessionSource;
  pages: readonly ProjectPageDescriptor[];
  activePageIndex: number;
  activePageId: string | null;
}>;

export type ProjectSessionSnapshot = ProjectSessionDescriptor & Readonly<{
  isDirty: boolean;
  saveStatus: SessionSaveStatus;
  canSave: boolean;
  canClose: boolean;
}>;

export type PageViewport = Readonly<{
  pageId: string | null;
  rendererKind: LegacyRendererKind;
  pageSize: PageSizeDescriptor | null;
  /** Legacy renderer owns its own engine chrome; shared chrome stays outside. */
  editorChromeBoundary: 'outside-legacy-renderer';
  zoom: number;
  viewportWidthCssPx: number | null;
  viewportHeightCssPx: number | null;
  mounted: boolean;
}>;

export type SelectionTarget =
  | { kind: 'none' }
  | { kind: 'page'; pageId: string }
  | { kind: 'structured-text'; pageId: string; editor: 'title' | 'body' }
  | { kind: 'structured-image'; pageId: string; imageId: string }
  | { kind: 'structured-group'; pageId: string; groupId: string }
  | {
      kind: 'freeform-object';
      pageId: string;
      objectId: string;
      objectIds?: readonly string[];
    };

/**
 * Selection is an observation channel for the shared shell only. It is
 * intentionally transient and contains no engine-native selection object.
 */
export type SelectionEvent = Readonly<{
  source: LegacyRendererKind | 'shell';
  pageId: string | null;
  target: SelectionTarget;
  isFocused: boolean;
  isEditing: boolean;
}>;

export type ProjectSessionCommands = Readonly<{
  save: (name?: string) => Promise<void>;
  download: () => Promise<FileDeliveryResult | null>;
  /** Product-level close is supplied by UnifiedEditorSession when routed. */
  close?: () => Promise<void>;
  notify: (message: string) => void;
  isDirty: () => boolean;
  renameProject: (name: string) => Promise<void>;
  /** Product-level page actions are delegated by stable ID at the adapter boundary. */
  mutatePage: (command: PageMutationCommand) => Promise<PageMutationResult>;
  /** Read-only adapter description; this is not a shared asset store. */
  describePageAssets?: (pageId: string) => Promise<PageAssetReferenceResult>;
  /** Runtime-only observation seam; it does not own mutation or persistence. */
  changeCoordinator?: ProjectChangeCoordinator;
  /** Opt-in runtime shadow view; it does not own dirty state or persistence. */
  changeDiagnostic?: ProjectChangeDiagnosticView;
  setViewportZoom: (zoom: number) => void;
  fitPage?: () => void;
}>;

export type SessionPageLike = Readonly<{
  id: string;
  name: string;
  kind?: 'canvas' | 'document';
  canvasSize?: Readonly<{ width: number; height: number }>;
  size?: Readonly<{ widthIn: number; heightIn: number; dpi: number }>;
}>;

export type SessionPayloadLike = Readonly<{
  editorMode: EditorMode;
  projectId: string;
  projectName: string;
  pages: readonly SessionPageLike[];
  activePageIndex?: number;
  document?: Readonly<{
    pageSize?: Readonly<{
      width?: number;
      height?: number;
      dpi?: number;
    }>;
    folios?: Readonly<{
      startingNumber?: number;
    }>;
  }>;
}>;

export type CreateProjectSessionOptions = Readonly<{
  source?: ProjectSessionSource;
}>;

const finitePositive = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

const clampPageIndex = (index: unknown, pageCount: number) => {
  if (pageCount <= 0) return 0;
  const numeric = Number(index);
  const requested = Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
  return Math.min(pageCount - 1, Math.max(0, requested));
};

const getCanvasDpi = (payload: SessionPayloadLike) => finitePositive(
  payload.document?.pageSize?.dpi,
  DEFAULT_LEGACY_CANVAS_DPI
);

/**
 * Converts a legacy Canvas page size into display geometry without changing
 * the stored Canvas size. Canvas page numbers are treated as authored logical
 * pixels at the payload's output DPI only at this boundary.
 */
const createCanvasPageSize = (
  payload: SessionPayloadLike,
  page: SessionPageLike
): PageSizeDescriptor => {
  const sourceWidth = finitePositive(
    page.canvasSize?.width,
    payload.document?.pageSize?.width || 1
  );
  const sourceHeight = finitePositive(
    page.canvasSize?.height,
    payload.document?.pageSize?.height || 1
  );
  const outputDpi = getCanvasDpi(payload);
  const physicalWidthIn = sourceWidth / outputDpi;
  const physicalHeightIn = sourceHeight / outputDpi;

  return {
    sourceWidth,
    sourceHeight,
    sourceUnit: 'px',
    coordinateSpace: 'canvas-logical-px',
    widthCssPx: physicalWidthIn * PAGE_CSS_PIXELS_PER_INCH,
    heightCssPx: physicalHeightIn * PAGE_CSS_PIXELS_PER_INCH,
    physicalWidthIn,
    physicalHeightIn,
    outputDpi,
  };
};

/**
 * Converts a Document page's physical size into the same display geometry.
 * Document authored page/body coordinates already use 96 CSS pixels per inch.
 */
const createDocumentPageSize = (
  page: SessionPageLike
): PageSizeDescriptor => {
  const physicalWidthIn = finitePositive(page.size?.widthIn, 1);
  const physicalHeightIn = finitePositive(page.size?.heightIn, 1);
  const outputDpi = finitePositive(page.size?.dpi, DEFAULT_LEGACY_CANVAS_DPI);
  const widthCssPx = physicalWidthIn * PAGE_CSS_PIXELS_PER_INCH;
  const heightCssPx = physicalHeightIn * PAGE_CSS_PIXELS_PER_INCH;

  return {
    sourceWidth: widthCssPx,
    sourceHeight: heightCssPx,
    sourceUnit: 'px',
    coordinateSpace: 'document-page-css-px',
    widthCssPx,
    heightCssPx,
    physicalWidthIn,
    physicalHeightIn,
    outputDpi,
  };
};

const getPageRendererKind = (
  payload: SessionPayloadLike,
  page: SessionPageLike
): LegacyRendererKind => page.kind === 'document' ? 'document' : payload.editorMode;

const getPageCapabilities = (
  rendererKind: LegacyRendererKind
): readonly PageCapability[] => rendererKind === 'document'
  ? ['structured', 'reference', 'native-export', 'page-navigation']
  : ['freeform', 'native-export', 'page-navigation'];

export const createProjectSessionDescriptor = (
  payload: SessionPayloadLike,
  options: CreateProjectSessionOptions = {}
): ProjectSessionDescriptor => {
  const pages = payload.pages.map((page, index) => {
    const rendererKind = getPageRendererKind(payload, page);
    const startingFolio = finitePositive(
      payload.document?.folios?.startingNumber,
      1
    );
    return {
      id: page.id,
      name: page.name,
      index,
      folio: Math.trunc(startingFolio) + index,
      rendererKind,
      size: rendererKind === 'document'
        ? createDocumentPageSize(page)
        : createCanvasPageSize(payload, page),
      capabilities: getPageCapabilities(rendererKind),
    } satisfies ProjectPageDescriptor;
  });
  const activePageIndex = clampPageIndex(payload.activePageIndex, pages.length);

  return {
    projectId: payload.projectId,
    projectName: payload.projectName,
    compatibilityMode: payload.editorMode,
    rendererKind: payload.editorMode,
    source: options.source ?? 'unknown',
    pages,
    activePageIndex,
    activePageId: pages[activePageIndex]?.id ?? null,
  };
};

export const createSessionSnapshot = (
  descriptor: ProjectSessionDescriptor,
  isDirty: boolean,
  saveStatus: SessionSaveStatus,
  lifecycle: Readonly<{
    canSave?: boolean;
    canClose?: boolean;
  }> = {}
): ProjectSessionSnapshot => ({
  ...descriptor,
  isDirty,
  saveStatus,
  canSave: lifecycle.canSave ?? true,
  canClose: lifecycle.canClose ?? true,
});

export const createEmptySelectionEvent = (): SelectionEvent => ({
  source: 'shell',
  pageId: null,
  target: { kind: 'none' },
  isFocused: false,
  isEditing: false,
});

export const createPageViewport = ({
  session,
  zoom,
  viewportWidthCssPx = null,
  viewportHeightCssPx = null,
  mounted = true,
}: {
  session: ProjectSessionDescriptor | null;
  zoom: number;
  viewportWidthCssPx?: number | null;
  viewportHeightCssPx?: number | null;
  mounted?: boolean;
}): PageViewport => {
  const activePage = session?.pages[session.activePageIndex];
  return {
    pageId: activePage?.id ?? null,
    rendererKind: session?.rendererKind ?? 'canvas',
    pageSize: activePage?.size ?? null,
    editorChromeBoundary: 'outside-legacy-renderer',
    zoom: finitePositive(zoom, 1),
    viewportWidthCssPx,
    viewportHeightCssPx,
    mounted,
  };
};
