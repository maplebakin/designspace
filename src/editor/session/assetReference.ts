/** Semantic media vocabulary shared by the product/session layer. */
export type AssetReferenceKind =
  | 'image'
  | 'svg'
  | 'sticker'
  | 'reference'
  | 'other';

export type AssetReferenceSourceKind =
  | 'embedded'
  | 'data-url'
  | 'blob-url'
  | 'remote'
  | 'generated'
  | 'legacy';

/**
 * A read-only description of an engine-owned media reference.
 *
 * `assetId` is optional because some legacy records only carry a source. A
 * blob URL is always runtime-only and is never intended to be a durable
 * identity; adapters should prefer a stable ID when one exists.
 */
export type AssetReference = Readonly<{
  assetId?: string;
  kind: AssetReferenceKind;
  sourceKind?: AssetReferenceSourceKind;
  runtimeOnly: boolean;
  mimeType?: string;
  filename?: string;
  naturalWidth?: number;
  naturalHeight?: number;
}>;

export type PageAssetReferenceSuccess = Readonly<{
  ok: true;
  pageId: string;
  references: readonly AssetReference[];
}>;

export type PageAssetReferenceFailure = Readonly<{
  ok: false;
  pageId: string;
  reason: 'page-not-found' | 'adapter-unavailable' | 'engine-error';
  message: string;
}>;

export type PageAssetReferenceResult =
  | PageAssetReferenceSuccess
  | PageAssetReferenceFailure;

const SOURCE_KIND_DATA_URL = /^data:/i;
const SOURCE_KIND_BLOB_URL = /^blob:/i;
const SOURCE_KIND_REMOTE = /^https?:\/\//i;

export const inferAssetReferenceSource = (
  source: unknown
): Pick<AssetReference, 'sourceKind' | 'runtimeOnly'> => {
  if (typeof source !== 'string' || source.length === 0) {
    return { runtimeOnly: false };
  }
  if (SOURCE_KIND_BLOB_URL.test(source)) {
    return { sourceKind: 'blob-url', runtimeOnly: true };
  }
  if (SOURCE_KIND_DATA_URL.test(source)) {
    return { sourceKind: 'data-url', runtimeOnly: false };
  }
  if (SOURCE_KIND_REMOTE.test(source)) {
    return { sourceKind: 'remote', runtimeOnly: false };
  }
  return { sourceKind: 'legacy', runtimeOnly: false };
};

export const inferAssetMimeType = (
  source: unknown,
  hint?: unknown
): string | undefined => {
  if (typeof hint === 'string' && hint.trim()) return hint.trim();
  if (typeof source !== 'string') return undefined;
  const dataUrlMatch = /^data:([^;,]+)/i.exec(source);
  if (dataUrlMatch?.[1]) return dataUrlMatch[1].toLowerCase();
  if (/^<svg[\s>]/i.test(source.trim())) return 'image/svg+xml';
  return undefined;
};

export const createAssetReference = (
  value: Readonly<{
    assetId?: unknown;
    kind: AssetReferenceKind;
    source?: unknown;
    sourceKind?: AssetReferenceSourceKind;
    runtimeOnly?: boolean;
    mimeType?: unknown;
    filename?: unknown;
    naturalWidth?: unknown;
    naturalHeight?: unknown;
  }>
): AssetReference => {
  const sourceInfo = inferAssetReferenceSource(value.source);
  const numericWidth = Number(value.naturalWidth);
  const numericHeight = Number(value.naturalHeight);
  const assetId = typeof value.assetId === 'string' && value.assetId.trim()
    ? value.assetId
    : undefined;
  const filename = typeof value.filename === 'string' && value.filename.trim()
    ? value.filename
    : undefined;
  const mimeType = inferAssetMimeType(value.source, value.mimeType);

  return {
    ...(assetId ? { assetId } : {}),
    kind: value.kind,
    ...(value.sourceKind || sourceInfo.sourceKind
      ? { sourceKind: value.sourceKind || sourceInfo.sourceKind }
      : {}),
    runtimeOnly: value.runtimeOnly ?? sourceInfo.runtimeOnly,
    ...(mimeType ? { mimeType } : {}),
    ...(filename ? { filename } : {}),
    ...(Number.isFinite(numericWidth) && numericWidth > 0
      ? { naturalWidth: numericWidth }
      : {}),
    ...(Number.isFinite(numericHeight) && numericHeight > 0
      ? { naturalHeight: numericHeight }
      : {}),
  };
};
