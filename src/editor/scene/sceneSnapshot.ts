import type * as fabric from 'fabric';
import {
  normalizeSerializedObjectForFabric,
  serializeCanvasObjects,
} from '../utils/serialization';
import type { AuthoredRevision } from '../session/authoredRevision';
import { PRINT_DPI, type UnitMode } from '../utils/units';

/** The authored canvas background used when a legacy scene omits one. */
export const DEFAULT_CANVAS_BACKGROUND = '#FAF8F5';

/**
 * Geometry in a serialized canvas scene is always expressed in page space.
 * Selection-local transforms are realized by the canonical serializer before
 * this type is produced.
 */
export type SceneCoordinateSpace = 'page-space';

export type SceneCanvasSize = Readonly<{
  width: number;
  height: number;
}>;

/**
 * Page dimensions carried with an authored canvas snapshot. `canvasSize` is
 * the page-space pixel extent; `sourceDpi` is the only value used to convert
 * that extent to physical export dimensions.
 */
export type CanvasPageDimensions = Readonly<{
  canvasSize: SceneCanvasSize;
  unitMode: UnitMode;
  sourceDpi: number;
}>;

/**
 * Plain JSON-compatible Fabric data. This is deliberately not a Fabric
 * instance: runtime methods such as `set`, `toObject`, and `getCoords` do not
 * exist at this boundary.
 */
export interface CanonicalSerializedObject {
  type: string;
  id: string | null;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
  angle?: number;
  src?: string;
  assetId?: string;
  objects?: CanonicalSerializedObject[];
  clipPath?: CanonicalSerializedObject;
  filters?: Array<Record<string, unknown>> | null;
  /** Legacy and Fabric-versioned fields remain representable at this edge. */
  [key: string]: unknown;
}

/** Canonical, serializable scene data used by page and history boundaries. */
export interface CanonicalSerializedScene {
  objects: CanonicalSerializedObject[];
  background?: string;
  canvasSize?: SceneCanvasSize;
  coordinateSpace?: SceneCoordinateSpace;
  [key: string]: unknown;
}

/** The only representation allowed to call Fabric runtime APIs. */
export type LiveRuntimeScene = Readonly<{
  kind: 'live-runtime-scene';
  canvas: fabric.Canvas;
  sessionIdentity: string;
  pageId: string;
}>;

export type PageSceneSnapshot = Readonly<{
  kind: 'page-scene-snapshot';
  pageId: string;
  canvasSize: SceneCanvasSize;
  scene: CanonicalSerializedScene;
  thumbnail?: string;
}>;

/** Durable project payload for a scene-bearing editor. */
export type DurableSceneSnapshot = Readonly<{
  kind: 'durable-scene-snapshot';
  projectId: string;
  sessionIdentity: string;
  authoredRevision: AuthoredRevision;
  activePageId: string | null;
  pages: readonly PageSceneSnapshot[];
  assets: Readonly<Record<string, string>>;
}>;

/** Snapshot carried by templates and Vision Board-style auxiliary records. */
export type TemplateSceneSnapshot = Readonly<{
  kind: 'template-scene-snapshot';
  canvasSize: SceneCanvasSize;
  scene: CanonicalSerializedScene;
  assets: Readonly<Record<string, string>>;
}>;

/** Snapshot handed to an export adapter; it is not itself a durable save. */
export type ExportSceneSnapshot = Readonly<{
  kind: 'export-scene-snapshot';
  pageId: string | null;
  canvasSize: SceneCanvasSize;
  sourceDpi?: number;
  scene: CanonicalSerializedScene;
  assets: Readonly<Record<string, string>>;
}>;

/**
 * Authored canvas page state before a renderer-specific export adapter runs.
 * A portable snapshot cannot contain session blob URLs. A session snapshot
 * may contain them only for an ephemeral export while the live session owns
 * the URL.
 */
export type AuthoredCanvasPageSnapshot = Readonly<{
  kind: 'authored-canvas-page-snapshot';
  pageId: string;
  dimensions: CanvasPageDimensions;
  backgroundColor: string;
  resourceScope: 'portable' | 'session';
  scene: CanonicalSerializedScene;
  assets: Readonly<Record<string, string>>;
}>;

/** A document renderer has different geometry and intentionally remains DOM-based. */
export type DocumentExportSceneSnapshot<ProjectPayload = unknown> = Readonly<{
  kind: 'document-export-scene-snapshot';
  project: ProjectPayload;
  pageIds: readonly string[];
}>;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const hasRuntimeMethods = (value: Record<string, unknown>) => (
  typeof value.toObject === 'function'
  || typeof value.set === 'function'
  || typeof value.getCoords === 'function'
  || typeof value.getObjects === 'function'
);

const validateAssetMap = (
  value: unknown,
  label: string,
  allowBlobUrls: boolean,
): Readonly<Record<string, string>> => {
  if (!isRecord(value)) {
    throw new Error(`${label} must be a string asset map.`);
  }
  Object.entries(value).forEach(([assetId, source]) => {
    if (typeof source !== 'string') {
      throw new Error(`${label}.${assetId} must be a string.`);
    }
    if (!allowBlobUrls && source.startsWith('blob:')) {
      throw new Error(`${label}.${assetId} contains a session-only blob URL.`);
    }
  });
  return value as Readonly<Record<string, string>>;
};

const assertSceneCanvasSize = (value: SceneCanvasSize, label: string): SceneCanvasSize => {
  if (
    !Number.isFinite(value.width)
    || !Number.isFinite(value.height)
    || value.width <= 0
    || value.height <= 0
  ) {
    throw new Error(`${label} must contain positive finite dimensions.`);
  }
  return {
    width: Math.max(1, Math.round(value.width)),
    height: Math.max(1, Math.round(value.height)),
  };
};

export const resolveCanvasSourceDpi = (
  unitMode: UnitMode,
  declaredDpi?: number,
): number => (
  typeof declaredDpi === 'number'
  && Number.isFinite(declaredDpi)
  && declaredDpi > 0
    ? declaredDpi
    : unitMode === 'px'
      ? 96
      : PRINT_DPI
);

export const resolveAuthoredCanvasBackground = (value: unknown): string => {
  if (typeof value !== 'string') return DEFAULT_CANVAS_BACKGROUND;
  const normalized = value.trim();
  if (!normalized || normalized.toLowerCase() === 'transparent') {
    return DEFAULT_CANVAS_BACKGROUND;
  }
  return normalized;
};

const assertSceneObject: (
  value: unknown,
  path: string,
  depth: number,
  allowBlobUrls: boolean,
) => asserts value is CanonicalSerializedObject = (
  value: unknown,
  path: string,
  depth: number,
  allowBlobUrls: boolean,
): asserts value is CanonicalSerializedObject => {
  if (!isRecord(value) || hasRuntimeMethods(value)) {
    throw new Error(`${path} must be a serialized Fabric object, not a live runtime object.`);
  }
  if (typeof value.type !== 'string' || value.type.trim().length === 0) {
    throw new Error(`${path} must contain a Fabric object type.`);
  }
  if (depth > 50) {
    throw new Error(`${path} exceeds the maximum serialized scene depth.`);
  }
  if (
    !allowBlobUrls
    && typeof value.src === 'string'
    && value.src.startsWith('blob:')
  ) {
    throw new Error(`${path}.src contains a session-only blob URL.`);
  }
  if (Array.isArray(value.objects)) {
    value.objects.forEach((child, index) => {
      assertSceneObject(child, `${path}.objects[${index}]`, depth + 1, allowBlobUrls);
    });
  } else if (value.objects !== undefined) {
    throw new Error(`${path}.objects must be an array when present.`);
  }
  if (value.clipPath !== undefined) {
    assertSceneObject(value.clipPath, `${path}.clipPath`, depth + 1, allowBlobUrls);
  }
};

/**
 * Validate a plain scene at a representation boundary. The input is returned
 * unchanged so existing schema identity and history ownership remain intact.
 */
export const assertCanonicalSerializedScene = (
  value: unknown,
  options: { allowBlobUrls?: boolean } = {},
): CanonicalSerializedScene => {
  if (!isRecord(value) || !Array.isArray(value.objects)) {
    throw new Error('A serialized scene must contain an objects array.');
  }
  const allowBlobUrls = options.allowBlobUrls ?? true;
  value.objects.forEach((object, index) => {
    assertSceneObject(object, `scene.objects[${index}]`, 0, allowBlobUrls);
  });
  if (value.assets !== undefined && value.assets !== null) {
    validateAssetMap(value.assets, 'scene.assets', allowBlobUrls);
  }
  if (
    value.coordinateSpace !== undefined
    && value.coordinateSpace !== 'page-space'
  ) {
    throw new Error('A serialized scene coordinateSpace must be page-space.');
  }
  if (
    value.canvasSize !== undefined
    && (
      !isRecord(value.canvasSize)
      || typeof value.canvasSize.width !== 'number'
      || typeof value.canvasSize.height !== 'number'
      || !Number.isFinite(value.canvasSize.width)
      || !Number.isFinite(value.canvasSize.height)
      || value.canvasSize.width <= 0
      || value.canvasSize.height <= 0
    )
  ) {
    throw new Error('A serialized scene canvasSize must contain positive finite dimensions.');
  }
  return value as CanonicalSerializedScene;
};

/** Durable scenes may contain data URLs, but never session-local blob URLs. */
export const assertPortableScene = (
  scene: unknown,
  assets: Readonly<Record<string, string>> = {},
): CanonicalSerializedScene => {
  const canonical = assertCanonicalSerializedScene(scene, { allowBlobUrls: false });
  validateAssetMap(assets, 'assets', false);
  return canonical;
};

/**
 * Reuse the production serializer as the sole live -> serialized adapter.
 */
export const captureCanonicalSerializedScene = (
  canvas: fabric.Canvas,
  options: {
    canvasSize?: SceneCanvasSize;
    allowBlobUrls?: boolean;
    filter?: (object: fabric.Object) => boolean;
  } = {},
): CanonicalSerializedScene => {
  const scene = {
    objects: serializeCanvasObjects(canvas, options.filter),
    coordinateSpace: 'page-space' as const,
    ...(options.canvasSize ? { canvasSize: options.canvasSize } : {}),
  };
  return assertCanonicalSerializedScene(scene, {
    allowBlobUrls: options.allowBlobUrls ?? true,
  });
};

export const createPageSceneSnapshot = (options: {
  pageId: string;
  canvasSize: SceneCanvasSize;
  scene: unknown;
  thumbnail?: string;
}): PageSceneSnapshot => {
  const canvasSize = assertSceneCanvasSize(options.canvasSize, 'page canvasSize');
  const scene = assertCanonicalSerializedScene(options.scene);
  return {
    kind: 'page-scene-snapshot',
    pageId: options.pageId,
    canvasSize,
    scene: {
      ...scene,
      canvasSize,
      coordinateSpace: 'page-space',
      background: resolveAuthoredCanvasBackground(scene.background),
    },
    ...(options.thumbnail ? { thumbnail: options.thumbnail } : {}),
  };
};

export const createDurableSceneSnapshot = (options: {
  projectId: string;
  sessionIdentity: string;
  authoredRevision: AuthoredRevision;
  activePageId: string | null;
  pages: readonly PageSceneSnapshot[];
  assets?: Readonly<Record<string, string>>;
}): DurableSceneSnapshot => {
  const assets = validateAssetMap(options.assets ?? {}, 'assets', false);
  const pages = options.pages.map((page) => ({
    ...page,
    scene: assertPortableScene(page.scene, assets),
  }));
  return {
    kind: 'durable-scene-snapshot',
    projectId: options.projectId,
    sessionIdentity: options.sessionIdentity,
    authoredRevision: options.authoredRevision,
    activePageId: options.activePageId,
    pages,
    assets,
  };
};

export const createTemplateSceneSnapshot = (options: {
  canvasSize: SceneCanvasSize;
  scene: unknown;
  assets?: Readonly<Record<string, string>>;
}): TemplateSceneSnapshot => {
  const canvasSize = assertSceneCanvasSize(options.canvasSize, 'template canvasSize');
  const canonical = assertPortableScene(options.scene, options.assets);
  if (
    canonical.canvasSize
    && (
      Math.round(canonical.canvasSize.width) !== canvasSize.width
      || Math.round(canonical.canvasSize.height) !== canvasSize.height
    )
  ) {
    throw new Error('The serialized scene dimensions do not match the template dimensions.');
  }
  return {
    kind: 'template-scene-snapshot',
    canvasSize,
    scene: {
      ...canonical,
      canvasSize,
      coordinateSpace: 'page-space',
      background: resolveAuthoredCanvasBackground(canonical.background),
    },
    assets: validateAssetMap(options.assets ?? {}, 'assets', false),
  };
};

export const createExportSceneSnapshot = (options: {
  pageId?: string | null;
  canvasSize: SceneCanvasSize;
  sourceDpi?: number;
  scene: unknown;
  assets?: Readonly<Record<string, string>>;
}): ExportSceneSnapshot => {
  const canvasSize = assertSceneCanvasSize(options.canvasSize, 'export canvasSize');
  const scene = assertCanonicalSerializedScene(options.scene);
  if (
    scene.canvasSize
    && (
      Math.round(scene.canvasSize.width) !== canvasSize.width
      || Math.round(scene.canvasSize.height) !== canvasSize.height
    )
  ) {
    throw new Error('The serialized scene dimensions do not match the export dimensions.');
  }
  return {
    kind: 'export-scene-snapshot',
    pageId: options.pageId ?? null,
    canvasSize,
    ...(options.sourceDpi !== undefined ? { sourceDpi: options.sourceDpi } : {}),
    // Export delivery is an ephemeral runtime consumer. It may still need a
    // live blob URL while the export adapter resolves the image, but its
    // discriminant keeps it from being mistaken for a durable project payload.
    scene,
    assets: validateAssetMap(options.assets ?? {}, 'assets', true),
  };
};

/**
 * Create the shared authored-page boundary used by canvas persistence and
 * canvas export. This is an adapter, not a second serializer.
 */
export const createAuthoredCanvasPageSnapshot = (options: {
  pageId: string;
  canvasSize: SceneCanvasSize;
  unitMode: UnitMode;
  sourceDpi?: number;
  backgroundColor?: unknown;
  resourceScope?: 'portable' | 'session';
  scene: unknown;
  assets?: Readonly<Record<string, string>>;
}): AuthoredCanvasPageSnapshot => {
  const canvasSize = assertSceneCanvasSize(options.canvasSize, 'canvasSize');
  const resourceScope = options.resourceScope ?? 'portable';
  const canonical = assertCanonicalSerializedScene(options.scene, {
    allowBlobUrls: resourceScope === 'session',
  });
  if (
    canonical.canvasSize
    && (
      Math.round(canonical.canvasSize.width) !== canvasSize.width
      || Math.round(canonical.canvasSize.height) !== canvasSize.height
    )
  ) {
    throw new Error('The serialized scene dimensions do not match the authored page dimensions.');
  }
  const backgroundColor = resolveAuthoredCanvasBackground(options.backgroundColor);
  const assets = validateAssetMap(
    options.assets ?? {},
    'assets',
    resourceScope === 'session',
  );
  return {
    kind: 'authored-canvas-page-snapshot',
    pageId: options.pageId,
    dimensions: {
      canvasSize,
      unitMode: options.unitMode,
      sourceDpi: resolveCanvasSourceDpi(options.unitMode, options.sourceDpi),
    },
    backgroundColor,
    resourceScope,
    scene: {
      ...canonical,
      canvasSize,
      coordinateSpace: 'page-space',
      background: backgroundColor,
    },
    assets,
  };
};

export const createDocumentExportSceneSnapshot = <ProjectPayload>(
  project: ProjectPayload,
  pageIds: readonly string[],
): DocumentExportSceneSnapshot<ProjectPayload> => ({
  kind: 'document-export-scene-snapshot',
  project,
  pageIds: [...pageIds],
});

/**
 * The revival adapter is intentionally re-exported from the boundary module
 * so callers do not invent a second normalization path.
 */
export { normalizeSerializedObjectForFabric };
