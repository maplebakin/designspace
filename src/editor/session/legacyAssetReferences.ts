import type { DocumentAssetMetadata } from '../../document/types/documentAsset';
import type { DocumentPage } from '../../document/types/documentProject';
import type {
  ProjectPage,
  StickerData,
} from '../state/editorStore';
import {
  createAssetReference,
  type AssetReference,
  type AssetReferenceKind,
} from './assetReference';

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const readCanvasObjects = (canvasData: unknown): readonly Record<string, unknown>[] => {
  let parsed = canvasData;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  const root = asRecord(parsed);
  return Array.isArray(root?.objects)
    ? root.objects.map(asRecord).filter((object): object is Record<string, unknown> => !!object)
    : [];
};

const getString = (value: unknown) => (
  typeof value === 'string' && value.trim() ? value.trim() : undefined
);

const getSource = (
  object: Record<string, unknown>,
  assetId: string | undefined,
  imageAssets: Record<string, string>,
  stickers: readonly StickerData[]
) => {
  const sticker = assetId
    ? stickers.find((candidate) => candidate.id === assetId)
    : undefined;
  const objectSource = getString(object.src);
  const source = (assetId ? imageAssets[assetId] : undefined)
    || sticker?.url
    || sticker?.svg
    || (objectSource && objectSource !== assetId ? objectSource : undefined);
  return {
    source,
    sticker,
  };
};

const canvasObjectKind = (
  object: Record<string, unknown>,
  sticker?: StickerData
): AssetReferenceKind | null => {
  const type = getString(object.type)?.toLowerCase();
  if (type === 'image') return 'image';
  if (type === 'svg' || sticker?.format === 'svg' || sticker?.svg) return 'svg';
  if (type === 'sticker' || sticker) return 'sticker';
  if (getString(object.assetId) || getString(object.imageAssetId)) return 'other';
  return null;
};

/**
 * Describes the media records reachable from one legacy Canvas page. Canvas
 * currently uses image object IDs as imageAssets keys; this adapter reports
 * that stable key without making object and asset identity canonical.
 */
export const describeCanvasPageAssetReferences = ({
  page,
  imageAssets,
  stickers = [],
}: Readonly<{
  page: Pick<ProjectPage, 'canvasData'>;
  imageAssets: Record<string, string>;
  stickers?: readonly StickerData[];
}>): readonly AssetReference[] => {
  const references: AssetReference[] = [];
  const seen = new Set<string>();

  const visit = (object: Record<string, unknown>) => {
    const type = getString(object.type)?.toLowerCase();
    const nestedObjects = Array.isArray(object.objects)
      ? object.objects
      : [];
    nestedObjects
      .map(asRecord)
      .filter((child): child is Record<string, unknown> => !!child)
      .forEach(visit);

    const kind = canvasObjectKind(object);
    if (!kind || type === 'group' || type === 'activeselection') return;

    const assetId = getString(object.assetId)
      || getString(object.imageAssetId)
      || (type === 'image' || type === 'svg' || type === 'sticker'
        ? getString(object.id)
        : undefined);
    const { source, sticker } = getSource(object, assetId, imageAssets, stickers);
    const resolvedKind = canvasObjectKind(object, sticker) || kind;
    const sourceKey = source || assetId || `${type || 'asset'}-${references.length}`;
    const seenKey = `${resolvedKind}:${assetId || sourceKey}`;
    if (seen.has(seenKey)) return;
    seen.add(seenKey);

    const mimeType = sticker?.format === 'svg'
      ? 'image/svg+xml'
      : sticker?.format
        ? `image/${sticker.format === 'jpeg' ? 'jpeg' : sticker.format}`
        : undefined;
    references.push(createAssetReference({
      assetId,
      kind: resolvedKind,
      source,
      mimeType,
      naturalWidth: object.naturalWidth ?? object.width,
      naturalHeight: object.naturalHeight ?? object.height,
    }));
  };

  readCanvasObjects(page.canvasData).forEach(visit);
  return references;
};

const visitDocumentContent = (
  content: unknown,
  visit: (node: Record<string, unknown>) => void
) => {
  const node = asRecord(content);
  if (!node) return;
  visit(node);
  if (Array.isArray(node.content)) {
    node.content.forEach((child) => visitDocumentContent(child, visit));
  }
};

/** Describes structured images, overlays, and the editor-only reference. */
export const describeDocumentPageAssetReferences = ({
  page,
  assets = {},
  assetMetadata = {},
}: Readonly<{
  page: DocumentPage;
  assets?: Record<string, string>;
  assetMetadata?: Record<string, DocumentAssetMetadata>;
}>): readonly AssetReference[] => {
  const references: AssetReference[] = [];
  const seen = new Set<string>();

  const append = (
    assetId: unknown,
    kind: AssetReferenceKind,
    dimensions?: Readonly<{ width?: unknown; height?: unknown }>
  ) => {
    const id = getString(assetId);
    if (!id) return;
    const seenKey = `${kind}:${id}`;
    if (seen.has(seenKey)) return;
    seen.add(seenKey);
    const metadata = assetMetadata[id];
    references.push(createAssetReference({
      assetId: id,
      kind,
      source: assets[id],
      mimeType: metadata?.mimeType,
      filename: metadata?.fileName,
      naturalWidth: metadata?.naturalWidth ?? dimensions?.width,
      naturalHeight: metadata?.naturalHeight ?? dimensions?.height,
    }));
  };

  [page.titleContent, page.bodyContent].forEach((content) => {
    visitDocumentContent(content, (node) => {
      const type = getString(node.type);
      if (type !== 'documentInlineImage' && type !== 'documentFlowImage') return;
      const attrs = asRecord(node.attrs);
      append(attrs?.assetId, 'image', {
        width: attrs?.naturalWidth,
        height: attrs?.naturalHeight,
      });
    });
  });

  page.overlayObjects.forEach((overlay) => append(overlay.assetId, 'image', {
    width: overlay.naturalWidth,
    height: overlay.naturalHeight,
  }));
  if (page.reference?.assetId) append(page.reference.assetId, 'reference');

  return references;
};
