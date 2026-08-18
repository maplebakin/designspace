import React from 'react';
import type {
  Editor,
  JSONContent,
} from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import {
  act,
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
  findDocumentImagePositionById,
  findDocumentImagePositions,
  getDocumentImageSpanDimensions,
  selectDocumentImageById,
} from '../src/document/extensions/DocumentImageExtension';
import {
  buildMultiDocumentSpanLayoutModel,
  clampResizeWidthWithoutCollisions,
  getStructuredImageFrameGeometry,
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
  verticalAnchor = 'page-position' as const,
}: {
  id: string;
  spanStartColumn: 1 | 2;
  xOffsetPx: number;
  yPx: number;
  caption?: string;
  verticalAnchor?: 'flow' | 'page-position';
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
    verticalAnchor,
    yPx,
    horizontalPlacement: 'custom',
    xOffsetPx,
    caption,
    captionAlignment: 'center',
    captionItalic: true,
    captionSpacingPx: 6,
  },
});

const ordinaryFlowImage = (id: string, wrap = 'float-left'): JSONContent => ({
  type: 'documentFlowImage',
  attrs: {
    id,
    assetId: `asset-${id}`,
    altText: `${id} photograph`,
    widthPx: 180,
    heightPx: 120,
    naturalWidth: 900,
    naturalHeight: 600,
    wrap,
    spanCount: 1,
    spanStartColumn: 1,
    verticalAnchor: 'flow',
    yPx: 0,
    horizontalPlacement: 'left',
    xOffsetPx: 0,
    caption: '',
    captionAlignment: 'inherit',
    captionItalic: 'inherit',
    captionSpacingPx: 'inherit',
    cropMode: 'fit',
    cropFocalX: 0.5,
    cropFocalY: 0.5,
  },
});

const ordinaryInlineImage = (id: string): JSONContent => ({
  ...ordinaryFlowImage(id, 'inline'),
  type: 'documentInlineImage',
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
  it.each([
    {
      cropMode: 'fit' as const,
      widthPx: 240,
      heightPx: 160,
      spanWidthPx: 180,
      expected: { widthPx: 180, heightPx: 120 },
    },
    {
      cropMode: 'fill' as const,
      widthPx: 240,
      heightPx: 190,
      spanWidthPx: 180,
      expected: { widthPx: 180, heightPx: 190 },
    },
    {
      cropMode: 'fit' as const,
      widthPx: 180,
      heightPx: 120,
      spanWidthPx: 360,
      expected: { widthPx: 180, heightPx: 120 },
    },
  ])(
    'preserves span dimensions and clamps only when the frame is too wide',
    ({ cropMode, widthPx, heightPx, spanWidthPx, expected }) => {
      expect(getDocumentImageSpanDimensions({
        cropMode,
        widthPx,
        heightPx,
        naturalWidth: 900,
        naturalHeight: 600,
      }, spanWidthPx)).toEqual(expected);
    }
  );

  it('anchors transform chrome to the rendered frame, not caption flow', async () => {
    const { container, editor } = await renderFlowEditor();
    const model = buildMultiDocumentSpanLayoutModel(
      editor,
      3,
      24,
      720,
      640
    );
    const image = model!.images[0];
    const frameGeometry = getStructuredImageFrameGeometry(image);

    expect(frameGeometry).toEqual({
      leftPx: image.imageLeftPx,
      topPx: image.imageTopPx,
      widthPx: image.renderedImageWidthPx,
      heightPx: image.renderedImageHeightPx,
    });
    expect(image.imageRegionHeightPx).toBeGreaterThan(
      frameGeometry.heightPx
    );

    const slot = container.querySelector<HTMLElement>(
      `[data-layout-role="occupied-columns"][data-image-id="${image.imageId}"]`
    );
    expect(slot).not.toBeNull();
    fireEvent.click(slot!);

    const chrome = await waitFor(() => {
      const value = slot!.querySelector<HTMLElement>(
        '[data-document-image-frame-chrome="true"]'
      );
      expect(value).not.toBeNull();
      return value!;
    });
    const frame = slot!.querySelector<HTMLElement>(
      '[data-document-image-frame="true"]'
    );
    expect(frame).not.toBeNull();
    expect(Number.parseFloat(chrome.style.width)).toBe(
      Number.parseFloat(frame!.style.width)
    );
    expect(Number.parseFloat(chrome.style.height)).toBe(
      Number.parseFloat(frame!.style.height)
    );
    expect(chrome.classList).toContain(
      'document-span-layout__image-transform-chrome--selected'
    );
    expect(chrome.getAttribute('data-document-editor-only')).toBe('true');
    expect(chrome.getAttribute('data-document-export-exclude')).toBe('true');
    expect(slot?.getAttribute('data-document-visible-image-id')).toBe(
      image.imageId
    );
    expect(frame?.getAttribute('data-document-visible-image-id')).toBe(
      image.imageId
    );
    expect(frame?.getAttribute('data-document-image-hit-target')).toBe('true');
  });

  it('retains ordinary flow photos as explicit structured interaction records', async () => {
    const content: JSONContent = {
      type: 'doc',
      content: [
        textParagraph('Text before the mixed images.'),
        positionedImage({
          id: 'mixed-span-a',
          spanStartColumn: 1,
          xOffsetPx: 20,
          yPx: 100,
          caption: '',
        }),
        ordinaryFlowImage('mixed-flow-b'),
        {
          type: 'paragraph',
          attrs: { documentStyleId: 'body' },
          content: [
            { type: 'text', text: 'Inline before ' },
            ordinaryInlineImage('mixed-inline-c'),
            { type: 'text', text: ' inline after.' },
          ],
        },
        textParagraph('Text after the mixed images.'),
      ],
    };
    const { container, editor } = await renderFlowEditor({ content });
    const model = buildMultiDocumentSpanLayoutModel(
      editor,
      3,
      24,
      720,
      640
    );

    expect(model).not.toBeNull();
    expect(model!.images.map((image) => image.imageId)).toEqual([
      'mixed-span-a',
    ]);
    expect(model!.flowImages).toMatchObject([{
      imageId: 'mixed-flow-b',
      nodeType: 'documentFlowImage',
      attributes: { wrap: 'float-left' },
    }, {
      imageId: 'mixed-inline-c',
      nodeType: 'documentInlineImage',
      attributes: { wrap: 'inline' },
    }]);
    expect(model!.flowImages).toHaveLength(2);
    const bandHtml = model!.textBands.map((band) => band.html).join('');
    expect(bandHtml).toContain('data-document-structured-flow-image="true"');
    expect(bandHtml).toContain('data-image-id="mixed-flow-b"');

    const bandImage = container.querySelector<HTMLElement>(
      '[data-document-structured-flow-image="true"][data-image-id="mixed-flow-b"]'
    );
    expect(bandImage).not.toBeNull();
    expect(bandHtml).toContain('data-image-id="mixed-inline-c"');
    expect(selectDocumentImageById(
      editor,
      'mixed-flow-b',
      'documentFlowImage'
    )).not.toBeNull();
    expect((editor.state.selection as NodeSelection).node.attrs.id).toBe(
      'mixed-flow-b'
    );
    expect(selectDocumentImageById(
      editor,
      'mixed-inline-c',
      'documentInlineImage'
    )).not.toBeNull();
    expect((editor.state.selection as NodeSelection).node.attrs.id).toBe(
      'mixed-inline-c'
    );
  });

  it('selects a visible image by ID after its cached visual position is stale', async () => {
    const { container, editor } = await renderFlowEditor();
    const rightSlot = container.querySelector<HTMLElement>(
      '[data-layout-role="occupied-columns"][data-image-id="photo-right"]'
    );
    expect(rightSlot).not.toBeNull();
    const originalPosition = findDocumentImagePositionById(
      editor,
      'photo-right',
      'documentFlowImage'
    );
    expect(originalPosition).not.toBeNull();

    act(() => {
      const paragraph = editor.schema.nodes.paragraph.create(
        null,
        editor.schema.text('Inserted before the second photo.')
      );
      editor.view.dispatch(
        editor.state.tr.insert(originalPosition!, paragraph)
      );
      // The DOM handler still belongs to the old layout model here. Its
      // position hint is intentionally stale when the click is dispatched.
      fireEvent.click(rightSlot!);
    });

    await waitFor(() => {
      expect(editor.state.selection).toBeInstanceOf(NodeSelection);
      expect((editor.state.selection as NodeSelection).node.attrs.id).toBe(
        'photo-right'
      );
    });
    const currentPosition = findDocumentImagePositionById(
      editor,
      'photo-right',
      'documentFlowImage'
    );
    expect(currentPosition).not.toBe(originalPosition);
    expect(editor.state.selection.from).toBe(currentPosition);
  });

  it('fails closed when an image ID is missing or duplicated', async () => {
    const duplicateContent: JSONContent = {
      type: 'doc',
      content: [
        positionedImage({
          id: 'duplicate-photo',
          spanStartColumn: 1,
          xOffsetPx: 10,
          yPx: 80,
          caption: '',
        }),
        positionedImage({
          id: 'duplicate-photo',
          spanStartColumn: 2,
          xOffsetPx: 10,
          yPx: 260,
          caption: '',
        }),
      ],
    };
    const { editor } = await renderFlowEditor({ content: duplicateContent });

    expect(findDocumentImagePositions(editor, 'duplicate-photo')).toHaveLength(2);
    expect(findDocumentImagePositionById(editor, 'duplicate-photo')).toBeNull();
    expect(findDocumentImagePositionById(editor, 'missing-photo')).toBeNull();
    expect(selectDocumentImageById(editor, 'duplicate-photo')).toBeNull();
    expect(selectDocumentImageById(editor, 'missing-photo')).toBeNull();
  });

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
    'commits identical snapped unzoomed coordinates after a drag at %d× view scale',
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
        expect(Number(slot.dataset.imageXOffsetPx)).toBeCloseTo(68, 5);
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
          xOffsetPx: 68,
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

  it('preserves initially overlapping positioned image rectangles', async () => {
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
    )).toBe(true);
    model.images.forEach((image) => {
      expect(image.imageLeftPx).toBe(image.authoredFrame.leftPx);
      expect(image.imageTopPx).toBe(image.authoredFrame.topPx);
      expect(image.renderedImageWidthPx).toBe(image.authoredFrame.widthPx);
      expect(image.renderedImageHeightPx).toBe(image.authoredFrame.heightPx);
    });
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

  it('keeps existing positioned frames stable when other photos are added', async () => {
    const firstContent = {
      type: 'doc',
      content: [positionedImage({
        id: 'photo-a',
        spanStartColumn: 1,
        xOffsetPx: 24,
        yPx: 96,
        caption: '',
      })],
    } satisfies JSONContent;
    const allContent = {
      type: 'doc',
      content: [
        positionedImage({
          id: 'photo-a',
          spanStartColumn: 1,
          xOffsetPx: 24,
          yPx: 96,
          caption: '',
        }),
        positionedImage({
          id: 'photo-b',
          spanStartColumn: 1,
          xOffsetPx: 24,
          yPx: 96,
          caption: '',
        }),
        positionedImage({
          id: 'photo-c',
          spanStartColumn: 2,
          xOffsetPx: 18,
          yPx: 360,
          caption: '',
        }),
      ],
    } satisfies JSONContent;
    const first = await renderFlowEditor({ content: firstContent });
    const all = await renderFlowEditor({ content: allContent });
    const firstModel = buildMultiDocumentSpanLayoutModel(
      first.editor,
      3,
      24,
      720,
      640
    )!;
    const allModel = buildMultiDocumentSpanLayoutModel(
      all.editor,
      3,
      24,
      720,
      640
    )!;
    const firstPhoto = firstModel.images.find(
      (image) => image.imageId === 'photo-a'
    )!;
    const existingPhoto = allModel.images.find(
      (image) => image.imageId === 'photo-a'
    )!;
    expect(existingPhoto).toMatchObject({
      imageLeftPx: firstPhoto.imageLeftPx,
      imageTopPx: firstPhoto.imageTopPx,
      renderedImageWidthPx: firstPhoto.renderedImageWidthPx,
      renderedImageHeightPx: firstPhoto.renderedImageHeightPx,
      authoredFrame: firstPhoto.authoredFrame,
    });
    expect(allModel.images.map((image) => image.imageId)).toEqual([
      'photo-a',
      'photo-b',
      'photo-c',
    ]);
  });

  it('keeps positioned frames independent of document traversal order', async () => {
    const makeContent = (ids: Array<'photo-a' | 'photo-b'>) => ({
      type: 'doc',
      content: ids.map((id) => positionedImage({
        id,
        spanStartColumn: id === 'photo-a' ? 1 : 2,
        xOffsetPx: id === 'photo-a' ? 24 : 18,
        yPx: id === 'photo-a' ? 96 : 300,
        caption: '',
      })),
    } satisfies JSONContent);
    const forward = await renderFlowEditor({
      content: makeContent(['photo-a', 'photo-b']),
    });
    const reverse = await renderFlowEditor({
      content: makeContent(['photo-b', 'photo-a']),
    });
    const getFrames = (editor: Editor) => {
      const model = buildMultiDocumentSpanLayoutModel(
        editor,
        3,
        24,
        720,
        640
      )!;
      return new Map(model.images.map((image) => [image.imageId, {
        leftPx: image.imageLeftPx,
        topPx: image.imageTopPx,
        widthPx: image.renderedImageWidthPx,
        heightPx: image.renderedImageHeightPx,
      }]));
    };
    expect(getFrames(forward.editor)).toEqual(getFrames(reverse.editor));
  });

  it('resolves a flow image around positioned obstacles without moving them', async () => {
    const content: JSONContent = {
      type: 'doc',
      content: [
        positionedImage({
          id: 'positioned-photo',
          spanStartColumn: 1,
          xOffsetPx: 24,
          yPx: 12,
          caption: '',
        }),
        positionedImage({
          id: 'flow-photo',
          spanStartColumn: 1,
          xOffsetPx: 24,
          yPx: 0,
          caption: '',
          verticalAnchor: 'flow',
        }),
      ],
    };
    const { editor } = await renderFlowEditor({ content });
    const model = buildMultiDocumentSpanLayoutModel(
      editor,
      3,
      24,
      720,
      640
    )!;
    const positioned = model.images.find(
      (image) => image.imageId === 'positioned-photo'
    )!;
    const flow = model.images.find(
      (image) => image.imageId === 'flow-photo'
    )!;
    expect(positioned.imageLeftPx).toBe(positioned.authoredFrame.leftPx);
    expect(positioned.imageTopPx).toBe(positioned.authoredFrame.topPx);
    expect(rectanglesOverlap(
      model.collisionRectangles.find(
        (rectangle) => rectangle.imageId === 'positioned-photo'
      )!,
      model.collisionRectangles.find(
        (rectangle) => rectangle.imageId === 'flow-photo'
      )!
    )).toBe(false);
    expect(
      flow.imageLeftPx !== flow.authoredFrame.leftPx
      || flow.imageTopPx !== flow.authoredFrame.topPx
    ).toBe(true);
  });

  it('keeps an authored row group stable when an unrelated photo is added', async () => {
    const content: JSONContent = {
      type: 'doc',
      content: [
        positionedImage({
          id: 'group-left',
          spanStartColumn: 1,
          xOffsetPx: 24,
          yPx: 120,
          caption: '',
        }),
        positionedImage({
          id: 'group-right',
          spanStartColumn: 1,
          xOffsetPx: 210,
          yPx: 120,
          caption: '',
        }),
        positionedImage({
          id: 'unrelated-photo',
          spanStartColumn: 2,
          xOffsetPx: 30,
          yPx: 400,
          caption: '',
        }),
      ],
    };
    const { editor } = await renderFlowEditor({ content });
    const model = buildMultiDocumentSpanLayoutModel(
      editor,
      3,
      24,
      720,
      640,
      {},
      {},
      [{
        id: 'photo-group',
        kind: 'row',
        childImageIds: ['group-left', 'group-right'],
        gapPx: 16,
        sharedWidth: false,
      }]
    )!;
    expect(model.imageGroups).toHaveLength(1);
    model.images
      .filter((image) => image.imageId.startsWith('group-'))
      .forEach((image) => {
        expect(image.imageLeftPx).toBe(image.authoredFrame.leftPx);
        expect(image.imageTopPx).toBe(image.authoredFrame.topPx);
      });
    expect(model.images.find(
      (image) => image.imageId === 'unrelated-photo'
    )?.groupId).toBeUndefined();
  });
});
