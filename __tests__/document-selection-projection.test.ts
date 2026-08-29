import { describe, expect, it } from 'vitest';
import {
  EMPTY_DOCUMENT_SELECTION_PROJECTION,
  projectDocumentImageSelection,
  projectDocumentOverlaySelection,
  projectDocumentTextSelection,
} from '../src/document/state/documentSelectionProjection';

describe('document selection projection', () => {
  it('projects text as the exclusive selection owner', () => {
    const projection = projectDocumentTextSelection('page-1', 'body');

    expect(projection).toMatchObject({
      mode: 'text',
      pageId: 'page-1',
      textRegion: 'body',
      imageIds: [],
      primaryImageId: null,
      groupId: null,
      overlayId: null,
    });
  });

  it('projects a grouped image selection without carrying text or overlay state', () => {
    const projection = projectDocumentImageSelection({
      pageId: 'page-1',
      imageIds: ['image-a', 'image-b'],
      primaryImageId: 'image-b',
      groupId: 'group-1',
    });

    expect(projection).toMatchObject({
      mode: 'image-group',
      pageId: 'page-1',
      imageIds: ['image-a', 'image-b'],
      primaryImageId: 'image-b',
      groupId: 'group-1',
      textRegion: null,
      overlayId: null,
    });
  });

  it('projects overlays and provides a complete empty projection', () => {
    const projection = projectDocumentOverlaySelection('page-1', 'overlay-1');

    expect(projection).toMatchObject({
      mode: 'overlay',
      pageId: 'page-1',
      overlayId: 'overlay-1',
      imageIds: [],
      primaryImageId: null,
      groupId: null,
      textRegion: null,
    });
    expect(EMPTY_DOCUMENT_SELECTION_PROJECTION).toMatchObject({
      mode: 'none',
      pageId: null,
      textRegion: null,
      imageIds: [],
      primaryImageId: null,
      groupId: null,
      overlayId: null,
    });
  });
});
