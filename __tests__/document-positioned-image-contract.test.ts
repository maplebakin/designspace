import React from 'react';
import type {
  Editor,
  JSONContent,
} from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react';
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  commitStructuredDocumentImageSize,
  commitStructuredDocumentImagePosition,
  FlowEditor,
} from '../src/document/components/FlowEditor';
import {
  buildMultiDocumentSpanLayoutModel,
  clampResizeWidthWithoutCollisions,
  moveRectangleWithoutCollisions,
  rectanglesOverlap,
} from '../src/document/components/StructuredDocumentSpanLayout';
import {
  clampDocumentImageXOffset,
  clampDocumentImageY,
} from '../src/document/extensions/DocumentImageExtension';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const textParagraph = (text: string): JSONContent => ({
  type: 'paragraph',
  attrs: { documentStyleId: 'body' },
  content: [{ type: 'text', text }],
});

const positionedImage = ({
  id,
  spanStartColumn,
  xOffsetPx,
  yPx,
  caption = `${id} caption`,
}: {
  id: string;
  spanStartColumn: 1 | 2;
  xOffsetPx: number;
  yPx: number;
  caption?: string;
}): JSONContent => ({
  type: 'documentFlowImage',
  attrs: {
    id,
    assetId: `asset-${id}`,
    altText: `${id} photograph`,
    widthPx: 180,
    heightPx: 120,
    naturalWidth: 900,
    naturalHeight: 600,
    wrap: 'span-columns',
    spanCount: 2,
    spanStartColumn,
    wrapPaddingPx: 12,
    verticalSpacingPx: 10,
    verticalAnchor: 'page-position',
    yPx,
    horizontalPlacement: 'custom',
    xOffsetPx,
    caption,
    captionAlignment: 'center',
    captionItalic: true,
    captionSpacingPx: 6,
  },
});

const multiImageContent = ({
  firstY = 90,
  secondY = 360,
}: {
  firstY?: number;
  secondY?: number;
} = {}): JSONContent => ({
  type: 'doc',
  content: [
    textParagraph(`Opening ${'historical text '.repeat(18)}`),
    positionedImage({
      id: 'photo-left',
      spanStartColumn: 1,
      xOffsetPx: 20,
      yPx: firstY,
    }),
    textParagraph(`Middle ${'historical text '.repeat(18)}`),
    positionedImage({
      id: 'photo-right',
      spanStartColumn: 2,
      xOffsetPx: 30,
      yPx: secondY,
    }),
    textParagraph(`Closing ${'historical text '.repeat(24)}`),
  ],
});

const findImages = (editor: Editor) => (
  editor.getJSON().content || []
).filter((node) => node.type === 'documentFlowImage');

const renderFlowEditor = async ({
  content = multiImageContent(),
  viewScale = 1,
  onUpdate,
}: {
  content?: JSONContent;
  viewScale?: number;
  onUpdate?: (content: JSONContent, editor: Editor) => void;
} = {}) => {
  let editor: Editor | null = null;
  const rendered = render(React.createElement(FlowEditor, {
    content,
    columnCount: 3,
    columnGapPx: 24,
    dropCap: false,
    viewScale,
    maxSpanImageWidthPx: 720,
    resolveAssetSource: () => 'data:image/png;base64,AA==',
    onUpdate,
    onEditorReady: (readyEditor: Editor | null) => {
      editor = readyEditor;
    },
  }));
  await waitFor(() => {
    expect(editor).not.toBeNull();
    expect(rendered.container.querySelector(
      '[data-document-span-layout]'
    )).not.toBeNull();
  });
  return {
    ...rendered,
    editor: editor as unknown as Editor,
  };
};

const dispatchPointer = (
  target: Element | Window,
  type: string,
  {
    pointerId,
    clientX,
    clientY,
  }: {
    pointerId: number;
    clientX: number;
    clientY: number;
  }
) => {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  fireEvent(target, event);
};

describe('positioned document image contract', () => {
  it('derives one caption-aware exclusion rectangle per stable image ID', async () => {
    const { editor } = await renderFlowEditor();
    const model = buildMultiDocumentSpanLayoutModel(
      editor,
      3,
      24,
      720,
      640
    );

    expect(model).not.toBeNull();
    expect(model!.images.map((image) => image.imageId)).toEqual([
      'photo-left',
      'photo-right',
    ]);
    expect(model!.collisionRectangles).toHaveLength(2);
    expect(model!.exclusions).toHaveLength(2);

    model!.images.forEach((image, index) => {
      const exclusion = model!.exclusions[index];
      const expectedLeft = Math.max(
        0,
        image.imageLeftPx - image.attributes.wrapPaddingPx
      );
      const expectedRight = Math.min(
        720,
        image.imageLeftPx
          + image.renderedImageWidthPx
          + image.attributes.wrapPaddingPx
      );
      const expectedTop = Math.max(
        0,
        image.imageTopPx - image.attributes.verticalSpacingPx
      );
      const expectedBottom = Math.min(
        640,
        image.imageTopPx
          + image.imageRegionHeightPx
          + image.attributes.verticalSpacingPx
      );

      expect(exclusion).toEqual({
        imageId: image.imageId,
        leftPx: expectedLeft,
        topPx: expectedTop,
        widthPx: expectedRight - expectedLeft,
        heightPx: expectedBottom - expectedTop,
      });
      expect(image.imageRegionHeightPx).toBeGreaterThan(
        image.renderedImageHeightPx
      );
      expect(exclusion.leftPx).toBeGreaterThanOrEqual(0);
      expect(exclusion.topPx).toBeGreaterThanOrEqual(0);
      expect(exclusion.leftPx + exclusion.widthPx).toBeLessThanOrEqual(720);
      expect(exclusion.topPx + exclusion.heightPx).toBeLessThanOrEqual(640);
    });
  });

  it('clamps printable boundaries and stops drag/resize geometry at collisions', () => {
    expect(clampDocumentImageXOffset(-80, 472, 180)).toBe(0);
    expect(clampDocumentImageXOffset(900, 472, 180)).toBe(292);
    expect(clampDocumentImageY(-80, 640, 150, 10)).toBe(10);
    expect(clampDocumentImageY(900, 640, 150, 10)).toBe(480);

    const start = {
      imageId: 'moving',
      leftPx: 20,
      topPx: 100,
      widthPx: 100,
      heightPx: 100,
    };
    const obstacle = {
      imageId: 'fixed',
      leftPx: 200,
      topPx: 100,
      widthPx: 100,
      heightPx: 100,
    };
    const moved = moveRectangleWithoutCollisions({
      start,
      desiredLeftPx: 360,
      desiredTopPx: 100,
      obstacles: [obstacle],
    });
    expect(moved).toEqual({ leftPx: 100, topPx: 100 });
    expect(rectanglesOverlap(
      { ...start, leftPx: moved.leftPx, topPx: moved.topPx },
      obstacle
    )).toBe(false);

    const resizedWidth = clampResizeWidthWithoutCollisions({
      startWidthPx: 100,
      desiredWidthPx: 300,
      buildRectangle: (widthPx) => ({
        imageId: 'moving',
        leftPx: 20,
        topPx: 100,
        widthPx,
        heightPx: 100,
      }),
      obstacles: [obstacle],
    });
    expect(resizedWidth).toBeCloseTo(180, 4);
    expect(rectanglesOverlap(
      {
        ...start,
        widthPx: resizedWidth,
      },
      obstacle
    )).toBe(false);
  });

  it.each([0.5, 1, 2])(
    'commits identical unzoomed coordinates after a drag at %d× view scale',
    async (viewScale) => {
      const onUpdate = vi.fn();
      const content: JSONContent = {
        type: 'doc',
        content: [
          textParagraph('Text before'),
          positionedImage({
            id: 'zoom-photo',
            spanStartColumn: 1,
            xOffsetPx: 40,
            yPx: 120,
            caption: '',
          }),
          textParagraph('Text after'),
        ],
      };
      const { container, editor } = await renderFlowEditor({
        content,
        viewScale,
        onUpdate,
      });
      const slot = container.querySelector<HTMLElement>(
        '[data-layout-role="occupied-columns"][data-image-id="zoom-photo"]'
      )!;
      const pointerId = Math.round(viewScale * 100) + 7;
      onUpdate.mockClear();

      dispatchPointer(slot, 'pointerdown', {
        pointerId,
        clientX: 100,
        clientY: 100,
      });
      dispatchPointer(slot, 'pointermove', {
        pointerId,
        clientX: 100 + 24 * viewScale,
        clientY: 100 + 36 * viewScale,
      });

      expect(findImages(editor)[0].attrs).toMatchObject({
        xOffsetPx: 40,
        yPx: 120,
      });
      await waitFor(() => {
        expect(Number(slot.dataset.imageXOffsetPx)).toBeCloseTo(64, 5);
        expect(Number(slot.dataset.imageTopPx)).toBeCloseTo(156, 5);
      });

      dispatchPointer(window, 'pointerup', {
        pointerId,
        clientX: 100 + 24 * viewScale,
        clientY: 100 + 36 * viewScale,
      });
      await waitFor(() => {
        expect(findImages(editor)[0].attrs).toMatchObject({
          horizontalPlacement: 'custom',
          xOffsetPx: 64,
          yPx: 156,
        });
      });
      expect(onUpdate).toHaveBeenCalledTimes(1);
    }
  );

  it('reselects independent images and commits a stale position by stable ID', async () => {
    const onUpdate = vi.fn();
    const { container, editor } = await renderFlowEditor({ onUpdate });
    const leftSlot = container.querySelector<HTMLElement>(
      '[data-layout-role="occupied-columns"][data-image-id="photo-left"]'
    )!;
    const rightSlot = container.querySelector<HTMLElement>(
      '[data-layout-role="occupied-columns"][data-image-id="photo-right"]'
    )!;

    fireEvent.click(rightSlot);
    await waitFor(() => {
      expect(editor.state.selection).toBeInstanceOf(NodeSelection);
      expect((editor.state.selection as NodeSelection).node.attrs.id).toBe(
        'photo-right'
      );
    });
    fireEvent.click(leftSlot);
    await waitFor(() => {
      expect((editor.state.selection as NodeSelection).node.attrs.id).toBe(
        'photo-left'
      );
    });
    onUpdate.mockClear();

    expect(commitStructuredDocumentImagePosition(
      editor,
      0,
      'photo-right',
      74,
      410
    )).toBe(true);
    const [leftImage, rightImage] = findImages(editor);
    expect(leftImage.attrs).toMatchObject({
      id: 'photo-left',
      xOffsetPx: 20,
      yPx: 90,
    });
    expect(rightImage.attrs).toMatchObject({
      id: 'photo-right',
      horizontalPlacement: 'custom',
      xOffsetPx: 74,
      yPx: 410,
    });
    expect((editor.state.selection as NodeSelection).node.attrs.id).toBe(
      'photo-right'
    );
    expect(onUpdate).toHaveBeenCalledTimes(1);

    fireEvent.click(leftSlot);
    await waitFor(() => {
      expect((editor.state.selection as NodeSelection).node.attrs.id).toBe(
        'photo-left'
      );
    });
  });

  it('commits a structured resize by stable ID when its position is stale', async () => {
    const onUpdate = vi.fn();
    const { editor } = await renderFlowEditor({ onUpdate });
    const before = findImages(editor);
    onUpdate.mockClear();

    expect(commitStructuredDocumentImageSize(
      editor,
      0,
      'photo-right',
      210,
      140,
      54
    )).toBe(true);
    const [leftImage, rightImage] = findImages(editor);
    expect(leftImage.attrs).toEqual(before[0].attrs);
    expect(rightImage.attrs).toMatchObject({
      id: 'photo-right',
      widthPx: 210,
      heightPx: 140,
      xOffsetPx: 54,
    });
    expect((editor.state.selection as NodeSelection).node.attrs.id).toBe(
      'photo-right'
    );
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('uses vertical spacing for drag bounds without a preview-to-commit jump', async () => {
    const onUpdate = vi.fn();
    const content: JSONContent = {
      type: 'doc',
      content: [
        textParagraph('Text before'),
        positionedImage({
          id: 'spaced-photo',
          spanStartColumn: 1,
          xOffsetPx: 40,
          yPx: 30,
          caption: '',
        }),
        textParagraph('Text after'),
      ],
    };
    const { container, editor } = await renderFlowEditor({
      content,
      viewScale: 2,
      onUpdate,
    });
    const slot = container.querySelector<HTMLElement>(
      '[data-layout-role="occupied-columns"][data-image-id="spaced-photo"]'
    )!;
    onUpdate.mockClear();

    dispatchPointer(slot, 'pointerdown', {
      pointerId: 87,
      clientX: 100,
      clientY: 200,
    });
    dispatchPointer(slot, 'pointermove', {
      pointerId: 87,
      clientX: 100,
      clientY: -200,
    });
    await waitFor(() => {
      expect(Number(slot.dataset.imageTopPx)).toBe(10);
    });
    expect(findImages(editor)[0].attrs?.yPx).toBe(30);

    dispatchPointer(window, 'pointerup', {
      pointerId: 87,
      clientX: 100,
      clientY: -200,
    });
    await waitFor(() => {
      expect(findImages(editor)[0].attrs?.yPx).toBe(10);
      expect(Number(slot.dataset.imageTopPx)).toBe(10);
    });
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('resolves initially overlapping positioned images into non-overlapping rectangles', async () => {
    const overlapContent: JSONContent = {
      type: 'doc',
      content: [
        textParagraph('Text before'),
        positionedImage({
          id: 'overlap-a',
          spanStartColumn: 1,
          xOffsetPx: 20,
          yPx: 140,
          caption: '',
        }),
        positionedImage({
          id: 'overlap-b',
          spanStartColumn: 1,
          xOffsetPx: 20,
          yPx: 140,
          caption: '',
        }),
        textParagraph('Text after'),
      ],
    };
    const { editor } = await renderFlowEditor({
      content: overlapContent,
    });
    const committedBeforeLayout = findImages(editor).map((image) => ({
      id: image.attrs?.id,
      xOffsetPx: image.attrs?.xOffsetPx,
      yPx: image.attrs?.yPx,
    }));
    const model = buildMultiDocumentSpanLayoutModel(
      editor,
      3,
      24,
      720,
      640
    )!;

    expect(model.collisionRectangles).toHaveLength(2);
    expect(rectanglesOverlap(
      model.collisionRectangles[0],
      model.collisionRectangles[1]
    )).toBe(false);
    expect(findImages(editor).map((image) => ({
      id: image.attrs?.id,
      xOffsetPx: image.attrs?.xOffsetPx,
      yPx: image.attrs?.yPx,
    }))).toEqual(committedBeforeLayout);
  });

  it('reports overflow when an initial overlap cannot fit its span bounds', async () => {
    const content: JSONContent = {
      type: 'doc',
      content: [
        positionedImage({
          id: 'blocked-a',
          spanStartColumn: 1,
          xOffsetPx: 0,
          yPx: 10,
          caption: '',
        }),
        positionedImage({
          id: 'blocked-b',
          spanStartColumn: 1,
          xOffsetPx: 0,
          yPx: 10,
          caption: '',
        }),
      ],
    };
    const { editor } = await renderFlowEditor({ content });
    const model = buildMultiDocumentSpanLayoutModel(
      editor,
      3,
      24,
      200,
      100
    )!;

    expect(model.textBands.every((band) => band.html === '')).toBe(true);
    expect(rectanglesOverlap(
      model.collisionRectangles[0],
      model.collisionRectangles[1]
    )).toBe(true);
    expect(model.overflowing).toBe(true);
    expect(model.unresolvedCollisionIds).toEqual([
      'blocked-a',
      'blocked-b',
    ]);
  });
});
