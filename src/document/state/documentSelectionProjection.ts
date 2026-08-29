import type { DocumentEditorRegion } from '../components/TitleEditor';

/**
 * The single UI-facing projection of the editor selection. ProseMirror (or
 * the page-scoped overlay/reference state) remains authoritative; this value
 * only describes the current presentation to shell/chrome consumers.
 */
export type DocumentSelectionMode =
  | 'none'
  | 'text'
  | 'image'
  | 'image-group'
  | 'overlay'
  | 'reference';

export type DocumentSelectionProjection = Readonly<{
  mode: DocumentSelectionMode;
  pageId: string | null;
  textRegion: DocumentEditorRegion | null;
  imageIds: readonly string[];
  primaryImageId: string | null;
  groupId: string | null;
  overlayId: string | null;
}>;

export const documentSelectionProjectionsAreEqual = (
  left: DocumentSelectionProjection,
  right: DocumentSelectionProjection
) => (
  left.mode === right.mode
  && left.pageId === right.pageId
  && left.textRegion === right.textRegion
  && left.primaryImageId === right.primaryImageId
  && left.groupId === right.groupId
  && left.overlayId === right.overlayId
  && left.imageIds.length === right.imageIds.length
  && left.imageIds.every((id, index) => id === right.imageIds[index])
);

export const EMPTY_DOCUMENT_SELECTION_PROJECTION: DocumentSelectionProjection =
  Object.freeze({
    mode: 'none' as const,
    pageId: null,
    textRegion: null,
    imageIds: Object.freeze([]) as readonly string[],
    primaryImageId: null,
    groupId: null,
    overlayId: null,
  });

/**
 * Constructs the complete UI projection for each authoritative selection
 * kind. Keeping these transitions together prevents individual chrome
 * consumers from inventing their own partial selection state.
 */
export const projectDocumentTextSelection = (
  pageId: string,
  textRegion: DocumentEditorRegion
): DocumentSelectionProjection => ({
  ...EMPTY_DOCUMENT_SELECTION_PROJECTION,
  mode: 'text',
  pageId,
  textRegion,
});

export const projectDocumentImageSelection = ({
  pageId,
  imageIds,
  primaryImageId,
  groupId = null,
}: {
  pageId: string;
  imageIds: readonly string[];
  primaryImageId: string;
  groupId?: string | null;
}): DocumentSelectionProjection => ({
  ...EMPTY_DOCUMENT_SELECTION_PROJECTION,
  mode: groupId ? 'image-group' : 'image',
  pageId,
  imageIds: [...imageIds],
  primaryImageId,
  groupId,
});

export const projectDocumentOverlaySelection = (
  pageId: string,
  overlayId: string
): DocumentSelectionProjection => ({
  ...EMPTY_DOCUMENT_SELECTION_PROJECTION,
  mode: 'overlay',
  pageId,
  overlayId,
});
