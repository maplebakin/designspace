import type {
  DocumentContentJson,
  DocumentImageGroup,
  DocumentImageGroupKind,
  DocumentOverlayImage,
  DocumentPage,
} from '../types/documentProject';

export const DEFAULT_DOCUMENT_IMAGE_GROUP_GAP_PX = 16;
// Keep group spacing bounded without changing the established inspector
// contract for existing projects and portable files.
export const MAX_DOCUMENT_IMAGE_GROUP_GAP_PX = 480;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const normalizeIdentifier = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  // Stable image IDs are opaque references. Trimming accidental surrounding
  // whitespace is safe, but truncating or rewriting them could redirect a
  // group to a different image.
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

export const normalizeDocumentImageGroupGapPx = (
  value: unknown,
  fallback = DEFAULT_DOCUMENT_IMAGE_GROUP_GAP_PX
) => {
  const fallbackNumber = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNumber)
    ? Math.min(
        MAX_DOCUMENT_IMAGE_GROUP_GAP_PX,
        Math.max(0, fallbackNumber)
      )
    : DEFAULT_DOCUMENT_IMAGE_GROUP_GAP_PX;
  const numeric = Number(value);
  const bounded = Number.isFinite(numeric)
    ? Math.min(MAX_DOCUMENT_IMAGE_GROUP_GAP_PX, Math.max(0, numeric))
    : safeFallback;
  return Math.round(bounded * 10) / 10;
};

const normalizeDocumentImageGroupKind = (
  value: unknown
): DocumentImageGroupKind => (
  value === 'stack' ? 'stack' : 'row'
);

const makeUniqueIdentifier = (
  requested: unknown,
  fallback: string,
  reserved: Set<string>
) => {
  const base = normalizeIdentifier(requested)
    ?? normalizeIdentifier(fallback)
    ?? 'image-group';
  let candidate = base;
  let suffix = 2;
  while (reserved.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  reserved.add(candidate);
  return candidate;
};

const getValidImageIdSet = (
  validImageIds: Iterable<string>
) => new Set(
  Array.from(validImageIds)
    .map(normalizeIdentifier)
    .filter((id): id is string => id !== null)
);

type NormalizedImageGroupCandidate = Omit<DocumentImageGroup, 'id'> & {
  requestedId: unknown;
  sourceIndex: number;
};

const normalizeImageGroupCandidate = (
  value: unknown,
  sourceIndex: number,
  validImageIds: ReadonlySet<string>
): NormalizedImageGroupCandidate | null => {
  if (!isRecord(value)) return null;
  const kind = normalizeDocumentImageGroupKind(value.kind);
  const childImageIds = Array.isArray(value.childImageIds)
    ? Array.from(new Set(
        value.childImageIds
          .map(normalizeIdentifier)
          .filter((id): id is string => (
            id !== null && validImageIds.has(id)
          ))
      ))
    : [];

  return {
    requestedId: value.id,
    sourceIndex,
    kind,
    childImageIds,
    gapPx: normalizeDocumentImageGroupGapPx(value.gapPx),
    // Shared width only has defined layout semantics for a stack. Keeping row
    // records canonical avoids a dormant policy changing future row rendering.
    sharedWidth: kind === 'stack' && value.sharedWidth === true,
  };
};

/**
 * Produces canonical group metadata for a page.
 *
 * An image may belong to at most one group. Earlier valid records win;
 * duplicate memberships are removed from later records. A repaired record
 * with fewer than two children is discarded without claiming its remaining
 * child, allowing a later complete record to retain it.
 */
export const normalizeDocumentImageGroups = (
  value: unknown,
  validImageIds: Iterable<string>
): DocumentImageGroup[] => {
  if (!Array.isArray(value)) return [];
  const validIds = getValidImageIdSet(validImageIds);
  const candidates = value
    .map((group, sourceIndex) => normalizeImageGroupCandidate(
      group,
      sourceIndex,
      validIds
    ))
    .filter((group): group is NormalizedImageGroupCandidate => group !== null);
  const claimedImageIds = new Set<string>();
  const usedGroupIds = new Set<string>();

  return candidates.flatMap((group) => {
    const childImageIds = group.childImageIds.filter(
      (imageId) => !claimedImageIds.has(imageId)
    );
    if (childImageIds.length < 2) return [];

    childImageIds.forEach((imageId) => claimedImageIds.add(imageId));
    return [{
      id: makeUniqueIdentifier(
        group.requestedId,
        `image-group-${group.sourceIndex + 1}`,
        usedGroupIds
      ),
      kind: group.kind,
      childImageIds,
      gapPx: group.gapPx,
      sharedWidth: group.sharedWidth,
    }];
  });
};

export const repairDocumentImageGroups = (
  groups: readonly DocumentImageGroup[],
  validImageIds: Iterable<string>
) => normalizeDocumentImageGroups(groups, validImageIds);

export const removeDocumentImageIdsFromGroups = (
  groups: readonly DocumentImageGroup[],
  imageIds: Iterable<string>
): DocumentImageGroup[] => {
  const removedIds = getValidImageIdSet(imageIds);
  return groups.flatMap((group) => {
    const childImageIds = group.childImageIds.filter(
      (imageId) => !removedIds.has(imageId)
    );
    return childImageIds.length < 2
      ? []
      : [{ ...group, childImageIds }];
  });
};

export const removeDocumentImageGroup = (
  groups: readonly DocumentImageGroup[],
  groupId: string
) => groups.filter((group) => group.id !== groupId);

export const findDocumentImageGroupForImage = (
  groups: readonly DocumentImageGroup[],
  imageId: string
) => groups.find((group) => group.childImageIds.includes(imageId));

const visitDocumentContentImages = (
  content: DocumentContentJson,
  visit: (node: DocumentContentJson, imageId: string | null) => void
) => {
  const isImage = content.type === 'documentInlineImage'
    || content.type === 'documentFlowImage';
  if (isImage) {
    visit(content, normalizeIdentifier(content.attrs?.id));
  }
  (content.content || []).forEach((child) => (
    visitDocumentContentImages(child, visit)
  ));
};

/**
 * Returns positioned flow-image IDs that occur exactly once across the
 * supplied stories. Duplicate legacy IDs are intentionally excluded because
 * group membership would otherwise be ambiguous.
 */
export const collectGroupableDocumentImageIds = (
  contents: readonly DocumentContentJson[]
): string[] => {
  const counts = new Map<string, number>();
  contents.forEach((content) => {
    visitDocumentContentImages(content, (node, imageId) => {
      if (
        imageId
        && node.type === 'documentFlowImage'
        && node.attrs?.wrap === 'span-columns'
        && node.attrs?.verticalAnchor === 'page-position'
      ) {
        counts.set(imageId, (counts.get(imageId) ?? 0) + 1);
      }
    });
  });
  return Array.from(counts)
    .filter(([, count]) => count === 1)
    .map(([imageId]) => imageId);
};

const collectAllPageImageIdOccurrences = (
  page: DocumentPage
): string[] => {
  const ids: string[] = [];
  [page.titleContent, page.bodyContent].forEach((content) => {
    visitDocumentContentImages(content, (_node, imageId) => {
      if (imageId) ids.push(imageId);
    });
  });
  page.overlayObjects.forEach((overlay) => {
    const imageId = normalizeIdentifier(overlay.id);
    if (imageId) ids.push(imageId);
  });
  return ids;
};

const cloneContentNodeWithImageIds = (
  content: DocumentContentJson,
  createImageId: (
    sourceImageId: string | undefined,
    occurrenceIndex: number
  ) => string,
  reservedImageIds: Set<string>,
  sourceImageIdCounts: ReadonlyMap<string, number>,
  imageIdMap: Map<string, string>,
  nextOccurrenceIndex: { value: number }
): DocumentContentJson => {
  const sourceImageId = normalizeIdentifier(content.attrs?.id) ?? undefined;
  const isImage = content.type === 'documentInlineImage'
    || content.type === 'documentFlowImage';
  const occurrenceIndex = isImage
    ? nextOccurrenceIndex.value
    : -1;
  if (isImage) nextOccurrenceIndex.value += 1;
  const duplicatedImageId = isImage
    ? makeUniqueIdentifier(
        createImageId(sourceImageId, occurrenceIndex),
        `duplicated-image-${occurrenceIndex + 1}`,
        reservedImageIds
      )
    : null;

  if (
    sourceImageId
    && duplicatedImageId
    && sourceImageIdCounts.get(sourceImageId) === 1
  ) {
    imageIdMap.set(sourceImageId, duplicatedImageId);
  }

  return {
    ...content,
    ...(content.attrs || duplicatedImageId
      ? {
          attrs: {
            ...(content.attrs || {}),
            ...(duplicatedImageId ? { id: duplicatedImageId } : {}),
          },
        }
      : {}),
    ...(content.marks
      ? {
          marks: content.marks.map((mark) => ({
            ...mark,
            ...(mark.attrs ? { attrs: { ...mark.attrs } } : {}),
          })),
        }
      : {}),
    ...(content.content
      ? {
          content: content.content.map((child) => (
            cloneContentNodeWithImageIds(
              child,
              createImageId,
              reservedImageIds,
              sourceImageIdCounts,
              imageIdMap,
              nextOccurrenceIndex
            )
          )),
        }
      : {}),
  };
};

const getRemappedImageId = (
  imageIdMap: ReadonlyMap<string, string>,
  sourceImageId: string
) => imageIdMap.get(sourceImageId);

export type DocumentImageGroupIdFactory = (
  sourceGroupId: string,
  groupIndex: number
) => string;

/**
 * Remaps group records onto already-duplicated image IDs. Missing or
 * ambiguous image mappings remove the affected child, and groups that no
 * longer have two children are discarded.
 */
export const remapDocumentImageGroupsForDuplicate = (
  groups: readonly DocumentImageGroup[],
  imageIdMap: ReadonlyMap<string, string>,
  createGroupId: DocumentImageGroupIdFactory
): DocumentImageGroup[] => {
  const reservedGroupIds = new Set(
    groups
      .map((group) => normalizeIdentifier(group.id))
      .filter((id): id is string => id !== null)
  );
  const usedNewGroupIds = new Set(reservedGroupIds);
  const mappedGroups = groups.map((group, groupIndex) => ({
    ...group,
    id: makeUniqueIdentifier(
      createGroupId(group.id, groupIndex),
      `duplicated-image-group-${groupIndex + 1}`,
      usedNewGroupIds
    ),
    childImageIds: group.childImageIds
      .map((sourceImageId) => getRemappedImageId(
        imageIdMap,
        sourceImageId
      ))
      .filter((imageId): imageId is string => imageId !== undefined),
  }));
  return normalizeDocumentImageGroups(
    mappedGroups,
    imageIdMap.values()
  );
};

export type DuplicateDocumentPageImageStateOptions = {
  createImageId: (
    sourceImageId: string | undefined,
    occurrenceIndex: number
  ) => string;
  createGroupId: DocumentImageGroupIdFactory;
};

export type DuplicatedDocumentPageImageState = {
  titleContent: DocumentContentJson;
  bodyContent: DocumentContentJson;
  overlayObjects: DocumentOverlayImage[];
  imageGroups: DocumentImageGroup[];
  imageIdMap: ReadonlyMap<string, string>;
};

/**
 * Deep-clones all page image-bearing state for page duplication. IDs generated
 * by a faulty factory are still made unique, and legacy duplicate source IDs
 * are deliberately omitted from the returned mapping so ambiguous group
 * membership is repaired rather than silently attached to the wrong child.
 */
export const duplicateDocumentPageImageState = (
  page: DocumentPage,
  options: DuplicateDocumentPageImageStateOptions
): DuplicatedDocumentPageImageState => {
  const sourceImageIds = collectAllPageImageIdOccurrences(page);
  const sourceImageIdCounts = sourceImageIds.reduce((counts, imageId) => {
    counts.set(imageId, (counts.get(imageId) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const reservedImageIds = new Set(sourceImageIds);
  const imageIdMap = new Map<string, string>();
  const nextOccurrenceIndex = { value: 0 };
  const cloneContent = (content: DocumentContentJson) => (
    cloneContentNodeWithImageIds(
      content,
      options.createImageId,
      reservedImageIds,
      sourceImageIdCounts,
      imageIdMap,
      nextOccurrenceIndex
    )
  );
  const titleContent = cloneContent(page.titleContent);
  const bodyContent = cloneContent(page.bodyContent);
  const overlayObjects = page.overlayObjects.map((overlay) => {
    const sourceImageId = normalizeIdentifier(overlay.id) ?? undefined;
    const occurrenceIndex = nextOccurrenceIndex.value;
    nextOccurrenceIndex.value += 1;
    const id = makeUniqueIdentifier(
      options.createImageId(sourceImageId, occurrenceIndex),
      `duplicated-image-${occurrenceIndex + 1}`,
      reservedImageIds
    );
    if (
      sourceImageId
      && sourceImageIdCounts.get(sourceImageId) === 1
    ) {
      imageIdMap.set(sourceImageId, id);
    }
    return { ...overlay, id };
  });

  return {
    titleContent,
    bodyContent,
    overlayObjects,
    imageGroups: remapDocumentImageGroupsForDuplicate(
      page.imageGroups,
      imageIdMap,
      options.createGroupId
    ),
    imageIdMap,
  };
};
