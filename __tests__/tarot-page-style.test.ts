import * as fabric from 'fabric';
import { afterEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from '../src/editor/state/useCanvasStore';
import { useThemeStore } from '../src/editor/state/useThemeStore';
import {
  applyTarotPageStyle,
  createTarotPageStyleMarker,
  DEFAULT_TAROT_PAGE_STYLE,
  getTarotPageStyle,
} from '../src/editor/tarot/pageStyle';
import { toSerializableObject } from '../src/editor/utils/serialization';
import { loadCanvasFromJsonSafely, reviveCustomFabricProps } from '../src/editor/fabric/initFabricCanvas';

const makeCard = () => {
  const face = new fabric.Rect({ width: 190, height: 292, fill: '#302935', originX: 'center', originY: 'center' });
  (face as any).semanticRole = 'tarot-card-face';
  const inset = new fabric.Rect({ width: 170, height: 272, fill: 'transparent', stroke: '#7C647F', originX: 'center', originY: 'center' });
  (inset as any).semanticRole = 'tarot-card-inset';
  const number = new fabric.Text('1', { fontFamily: 'Georgia', fontSize: 75, fill: '#EADFCB' });
  (number as any).semanticRole = 'tarot-card-number';
  const label = new fabric.Textbox('What I know', { width: 158, fontFamily: 'Georgia', fontSize: 17, fill: '#EADFCB' });
  (label as any).semanticRole = 'tarot-position-label';
  const group = new fabric.Group([face, inset, number, label], { left: 600, top: 900 });
  (group as any).id = 'card-1';
  (group as any).semanticRole = 'tarot-card';
  (group as any).tarotPosition = { spreadId: 'spread-1', number: 1, label: 'What I know', prompt: 'What is known?' };
  return group;
};

describe('tarot page style decorations', () => {
  afterEach(() => {
    useCanvasStore.getState().clearPendingSize();
    useThemeStore.getState().setCanvasBackgroundColor(null);
  });

  it('updates existing decorations idempotently while preserving tarot metadata', () => {
    useCanvasStore.getState().setCanvasSize(2550, 3300);
    const canvas = new fabric.Canvas(document.createElement('canvas'));
    canvas.add(createTarotPageStyleMarker(DEFAULT_TAROT_PAGE_STYLE));
    canvas.add(makeCard());

    const style = applyTarotPageStyle(canvas, {
      border: { ...DEFAULT_TAROT_PAGE_STYLE.border, type: 'double' },
      card: { ...DEFAULT_TAROT_PAGE_STYLE.card, fillMode: 'outline', labelPlacement: 'below' },
      footer: { ...DEFAULT_TAROT_PAGE_STYLE.footer, visible: true, dateVisible: true },
      ornament: { ...DEFAULT_TAROT_PAGE_STYLE.ornament, style: 'divider' },
    });
    applyTarotPageStyle(canvas, style);

    expect(canvas.getObjects().filter((object) => (object as any).semanticRole === 'tarot-page-border')).toHaveLength(1);
    expect(canvas.getObjects().filter((object) => (object as any).isTarotPageStyle)).toHaveLength(1);
    expect(canvas.getObjects().filter((object) => (object as any).semanticRole === 'tarot-footer-date')).toHaveLength(1);
    expect(canvas.getObjects().filter((object) => (object as any).semanticRole === 'tarot-ornament')).toHaveLength(1);
    const card = canvas.getObjects().find((object) => (object as any).tarotPosition) as fabric.Group;
    expect((card as any).tarotPosition.prompt).toBe('What is known?');
    expect((card.getObjects()[0] as fabric.Rect).fill).toBe('transparent');
    expect((card.getObjects().find((object) => (object as any).semanticRole === 'tarot-position-label') as any).top).toBeGreaterThan(146);
  });

  it('serializes and restores the style marker as editable scene metadata', async () => {
    const canvas = new fabric.Canvas(document.createElement('canvas'));
    const marker = createTarotPageStyleMarker({
      ...DEFAULT_TAROT_PAGE_STYLE,
      header: { ...DEFAULT_TAROT_PAGE_STYLE.header, titleText: 'A saved spread' },
    });
    canvas.add(marker);
    const serialized = toSerializableObject(marker) as any;
    expect(serialized.isTarotPageStyle).toBe(true);
    expect(serialized.tarotPageStyle.header.titleText).toBe('A saved spread');

    const revived = new fabric.Canvas(document.createElement('canvas'));
    await loadCanvasFromJsonSafely(revived, { objects: [serialized] }, reviveCustomFabricProps);
    expect((revived.getObjects()[0] as any).tarotPageStyle.header.titleText).toBe('A saved spread');
  });

  it('keeps the current style available after a page is reopened', () => {
    const canvas = new fabric.Canvas(document.createElement('canvas'));
    canvas.add(createTarotPageStyleMarker({
      ...DEFAULT_TAROT_PAGE_STYLE,
      header: { ...DEFAULT_TAROT_PAGE_STYLE.header, titleText: 'Persisted title' },
    }));
    expect(getTarotPageStyle(canvas).header.titleText).toBe('Persisted title');
  });

  it('adopts legacy tarot title and card children instead of duplicating them', () => {
    const canvas = new fabric.Canvas(document.createElement('canvas'));
    const title = new fabric.Textbox('Legacy title', { width: 600, left: 600, top: 70 });
    (title as any).name = 'Tarot spread title: Legacy title';
    const face = new fabric.Rect({ width: 190, height: 292, fill: '#302935' });
    const inset = new fabric.Rect({ width: 170, height: 272, fill: 'transparent' });
    const number = new fabric.Text('1', { fontSize: 75 });
    const label = new fabric.Textbox('Legacy label', { width: 158 });
    (label as any).semanticRole = 'tarot-position-label';
    const card = new fabric.Group([face, inset, number, label], { left: 600, top: 900 });
    (card as any).tarotPosition = { spreadId: 'legacy', number: 1, label: 'Legacy label', prompt: 'Keep this question' };
    canvas.add(title, card);

    applyTarotPageStyle(canvas, {
      header: { ...DEFAULT_TAROT_PAGE_STYLE.header, titleText: 'Updated title' },
      border: { ...DEFAULT_TAROT_PAGE_STYLE.border, type: 'single' },
    });

    expect(canvas.getObjects().filter((object) => (object as any).semanticRole === 'tarot-page-title')).toHaveLength(1);
    expect((canvas.getObjects().find((object) => (object as any).tarotPosition) as any).tarotPosition.prompt).toBe('Keep this question');
    expect((face as any).semanticRole).toBe('tarot-card-face');
    expect((face as any).stroke).toBe(DEFAULT_TAROT_PAGE_STYLE.card.borderColor);
  });
});
