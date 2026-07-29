import React from 'react';
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
import { DocumentOverlayLayer } from '../src/document/components/DocumentOverlayLayer';
import {
  commitDocumentOverlayGeometry,
  getDocumentOverlayPageBounds,
  resolveNewDocumentOverlayGeometry,
} from '../src/document/layout/overlayGeometry';
import type {
  DocumentOverlayImage,
} from '../src/document/types/documentProject';

const overlay = (
  id: string,
  update: Partial<DocumentOverlayImage> = {}
): DocumentOverlayImage => ({
  id,
  assetId: `asset-${id}`,
  altText: id,
  xPx: 20,
  yPx: 30,
  widthPx: 100,
  heightPx: 80,
  placement: 'front',
  ...update,
});

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('document overlay geometry', () => {
  it('resolves new overlaps and keeps numeric commits inside the page', () => {
    const existing = overlay('existing', {
      xPx: 100,
      yPx: 100,
    });
    const incoming = overlay('incoming', {
      xPx: 100,
      yPx: 100,
    });
    const bounds = getDocumentOverlayPageBounds(4, 3);
    const initial = resolveNewDocumentOverlayGeometry({
      overlay: incoming,
      objects: [existing],
      bounds,
    });
    expect(initial).not.toMatchObject({ xPx: 100, yPx: 100 });

    const committed = commitDocumentOverlayGeometry({
      overlay: incoming,
      update: { xPx: 900, yPx: 900 },
      objects: [],
      bounds,
    });
    expect(committed).toEqual({
      xPx: 284,
      yPx: 208,
      widthPx: 100,
      heightPx: 80,
    });
  });

  it('stops a move and resize at same-layer image collisions', () => {
    const moving = overlay('moving', { xPx: 0, yPx: 100 });
    const fixed = overlay('fixed', { xPx: 180, yPx: 100 });
    const bounds = getDocumentOverlayPageBounds(6, 6);
    const moved = commitDocumentOverlayGeometry({
      overlay: moving,
      update: { xPx: 300 },
      objects: [moving, fixed],
      bounds,
    });
    expect(moved.xPx).toBeCloseTo(80);

    const resized = commitDocumentOverlayGeometry({
      overlay: moving,
      update: { widthPx: 300 },
      objects: [moving, fixed],
      bounds,
    });
    expect(resized.widthPx).toBeCloseTo(180, 6);
  });
});

describe('document overlay transactional interaction', () => {
  it.each([0.5, 1, 2])(
    'previews locally and commits one unzoomed move at %d× zoom',
    async (zoom) => {
      const onChange = vi.fn();
      const object = overlay('moving');
      const { container } = render(React.createElement(
        DocumentOverlayLayer,
        {
          placement: 'front',
          objects: [object],
          assetSources: {
            [object.assetId]: 'data:image/png;base64,AA==',
          },
          selectedId: object.id,
          zoom,
          pageWidthPx: 500,
          pageHeightPx: 500,
          onSelect: vi.fn(),
          onChange,
        }
      ));
      const figure = container.querySelector<HTMLElement>(
        '[data-document-overlay-id="moving"]'
      )!;
      const pointerId = Math.round(zoom * 100) + 1;

      dispatchPointer(figure, 'pointerdown', {
        pointerId,
        clientX: 100,
        clientY: 100,
      });
      dispatchPointer(figure, 'pointermove', {
        pointerId,
        clientX: 100 + 20 * zoom,
        clientY: 100 + 30 * zoom,
      });

      expect(onChange).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(figure.dataset.previewing).toBe('true');
        expect(figure.style.left).toBe('40px');
        expect(figure.style.top).toBe('60px');
      });

      dispatchPointer(window, 'pointerup', {
        pointerId,
        clientX: 100 + 20 * zoom,
        clientY: 100 + 30 * zoom,
      });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith('moving', {
        xPx: 40,
        yPx: 60,
      });
    }
  );

  it('rolls a cancelled preview back without committing', async () => {
    const onChange = vi.fn();
    const object = overlay('cancelled');
    const { container } = render(React.createElement(
      DocumentOverlayLayer,
      {
        placement: 'front',
        objects: [object],
        assetSources: {
          [object.assetId]: 'data:image/png;base64,AA==',
        },
        selectedId: object.id,
        zoom: 1,
        pageWidthPx: 500,
        pageHeightPx: 500,
        onSelect: vi.fn(),
        onChange,
      }
    ));
    const figure = container.querySelector<HTMLElement>(
      '[data-document-overlay-id="cancelled"]'
    )!;

    dispatchPointer(figure, 'pointerdown', {
      pointerId: 71,
      clientX: 100,
      clientY: 100,
    });
    dispatchPointer(figure, 'pointermove', {
      pointerId: 71,
      clientX: 180,
      clientY: 190,
    });
    await waitFor(() => expect(figure.style.left).toBe('100px'));
    dispatchPointer(window, 'pointercancel', {
      pointerId: 71,
      clientX: 180,
      clientY: 190,
    });

    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(figure.style.left).toBe('20px');
      expect(figure.style.top).toBe('30px');
    });
  });

  it('clamps movement to the page and peers before its single commit', () => {
    const onChange = vi.fn();
    const moving = overlay('moving', { xPx: 0, yPx: 100 });
    const fixed = overlay('fixed', { xPx: 180, yPx: 100 });
    const { container } = render(React.createElement(
      DocumentOverlayLayer,
      {
        placement: 'front',
        objects: [moving, fixed],
        assetSources: {
          [moving.assetId]: 'data:image/png;base64,AA==',
          [fixed.assetId]: 'data:image/png;base64,AA==',
        },
        selectedId: moving.id,
        zoom: 1,
        pageWidthPx: 400,
        pageHeightPx: 300,
        onSelect: vi.fn(),
        onChange,
      }
    ));
    const figure = container.querySelector<HTMLElement>(
      '[data-document-overlay-id="moving"]'
    )!;

    dispatchPointer(figure, 'pointerdown', {
      pointerId: 72,
      clientX: 0,
      clientY: 0,
    });
    dispatchPointer(figure, 'pointermove', {
      pointerId: 72,
      clientX: 900,
      clientY: 0,
    });
    dispatchPointer(window, 'pointerup', {
      pointerId: 72,
      clientX: 900,
      clientY: 0,
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('moving', {
      xPx: 80,
      yPx: 100,
    });
  });
});
