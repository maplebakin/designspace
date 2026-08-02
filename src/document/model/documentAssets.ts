import type { DocumentContentJson, DocumentPage } from '../types/documentProject';
import type { DocumentAssetMetadata } from '../types/documentAsset';

/** A bounded, synchronous fingerprint suitable for deduplication on the UI path. */
export const fingerprintDocumentAssetSource = (source: string) => {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${source.length.toString(36)}-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
};

const visitContent = (
  content: DocumentContentJson,
  visit: (node: DocumentContentJson) => void
) => {
  visit(content);
  (content.content || []).forEach((child) => visitContent(child, visit));
};

export const collectDocumentAssetReferences = (
  pages: readonly DocumentPage[]
) => {
  const references = new Set<string>();
  pages.forEach((page) => {
    [page.titleContent, page.bodyContent].forEach((content) => {
      visitContent(content, (node) => {
        if (
          (node.type === 'documentInlineImage'
            || node.type === 'documentFlowImage')
          && typeof node.attrs?.assetId === 'string'
        ) {
          references.add(node.attrs.assetId);
        }
      });
    });
    page.overlayObjects.forEach((overlay) => references.add(overlay.assetId));
    if (page.reference?.assetId) references.add(page.reference.assetId);
  });
  return references;
};

export const findMissingDocumentAssetIds = (
  pages: readonly DocumentPage[],
  assets: Record<string, string> | undefined
) => Array.from(collectDocumentAssetReferences(pages))
  .filter((assetId) => !assets?.[assetId])
  .sort();

export const pruneDocumentAssets = <T extends Record<string, string>>(
  pages: readonly DocumentPage[],
  assets: T | undefined,
  metadata: Record<string, DocumentAssetMetadata> | undefined
) => {
  const references = collectDocumentAssetReferences(pages);
  const nextAssets = {} as T;
  const nextMetadata: Record<string, DocumentAssetMetadata> = {};
  Object.entries(assets || {}).forEach(([assetId, source]) => {
    if (!references.has(assetId)) return;
    nextAssets[assetId as keyof T] = source as T[keyof T];
    const entry = metadata?.[assetId];
    if (entry) nextMetadata[assetId] = entry;
  });
  return { assets: nextAssets, assetMetadata: nextMetadata };
};

export const normalizeDocumentAssetMetadata = (
  value: unknown,
  assets: Record<string, string> | undefined
): Record<string, DocumentAssetMetadata> => {
  const result: Record<string, DocumentAssetMetadata> = {};
  const sourceMetadata = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  Object.entries(assets || {}).forEach(([assetId, source]) => {
    const raw = sourceMetadata[assetId];
    if (typeof source !== 'string') return;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      result[assetId] = {
        contentHash: fingerprintDocumentAssetSource(source),
        byteLength: source.length,
      };
      return;
    }
    const record = raw as Record<string, unknown>;
    const contentHash = typeof record.contentHash === 'string'
      ? record.contentHash.trim()
      : '';
    if (!contentHash) {
      result[assetId] = {
        contentHash: fingerprintDocumentAssetSource(source),
        byteLength: source.length,
      };
      return;
    }
    const byteLength = Number(record.byteLength);
    if (!Number.isFinite(byteLength) || byteLength < 0) return;
    result[assetId] = {
      contentHash,
      byteLength: Math.round(byteLength),
      ...(typeof record.mimeType === 'string' ? { mimeType: record.mimeType.slice(0, 128) } : {}),
      ...(Number.isFinite(Number(record.naturalWidth)) && Number(record.naturalWidth) > 0
        ? { naturalWidth: Number(record.naturalWidth) }
        : {}),
      ...(Number.isFinite(Number(record.naturalHeight)) && Number(record.naturalHeight) > 0
        ? { naturalHeight: Number(record.naturalHeight) }
        : {}),
      ...(typeof record.fileName === 'string' ? { fileName: record.fileName.slice(0, 255) } : {}),
    };
  });
  return result;
};
