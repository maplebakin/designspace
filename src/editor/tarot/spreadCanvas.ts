import * as fabric from 'fabric';
import { v4 as uuidv4 } from 'uuid';
import { useEditorStore } from '../state/editorStore';
import { useCanvasStore } from '../state/useCanvasStore';
import { toSerializableObject } from '../utils/serialization';
import { withManifestZIndex, ZIndexLayer } from '../fabric/zIndexManifest';
import type { TarotPosition, TarotPresetId } from './spreadPresets';

export interface TarotPositionMetadata {
  spreadId: string;
  number: number;
  label: string;
  prompt: string;
}

const CARD_WIDTH = 190;
const CARD_HEIGHT = 292;
const TEXT_COLOR = '#EADFCB';
const BORDER_COLOR = '#B98F9D';

export const isTarotPosition = (object: fabric.Object | null | undefined): object is fabric.Group =>
  object?.type === 'group'
  && Number.isInteger((object as any).tarotPosition?.number)
  && typeof (object as any).tarotPosition?.spreadId === 'string';

const makeCard = (
  position: TarotPosition,
  spreadId: string,
  documentWidth: number,
  documentHeight: number,
  scale: number,
): fabric.Group => {
  const face = new fabric.Rect({
    left: 0, top: 0, width: CARD_WIDTH, height: CARD_HEIGHT,
    originX: 'center', originY: 'center',
    rx: 9, ry: 9, fill: '#302935', stroke: BORDER_COLOR,
    strokeWidth: 2, strokeUniform: true,
  });
  const inset = new fabric.Rect({
    left: 0, top: 0, width: CARD_WIDTH - 20, height: CARD_HEIGHT - 20,
    originX: 'center', originY: 'center',
    rx: 6, ry: 6, fill: 'transparent', stroke: '#7C647F',
    strokeWidth: 1, strokeUniform: true,
  });
  const number = new fabric.Text(String(position.number), {
    left: 0, top: -72, originX: 'center', originY: 'center',
    fontFamily: 'Georgia', fontSize: 75, fill: TEXT_COLOR,
  });
  const label = new fabric.Textbox(position.label.slice(0, 52), {
    left: 0, top: 46, width: CARD_WIDTH - 32,
    originX: 'center', originY: 'top',
    fontFamily: 'Georgia', fontSize: 17,
    fill: TEXT_COLOR, textAlign: 'center',
    lineHeight: 1.1,
  });
  (label as any).semanticRole = 'tarot-position-label';
  [face, inset, number, label].forEach((child) => {
    (child as any).id = uuidv4();
  });

  const group = new fabric.Group([face, inset, number, label], {
    originX: 'center',
    originY: 'center',
    left: documentWidth * position.x,
    top: documentHeight * position.y,
    angle: position.angle,
    scaleX: scale,
    scaleY: scale,
  });
  (group as any).id = uuidv4();
  (group as any).name = `Tarot · ${position.number}: ${position.label}`;
  (group as any).tarotPosition = {
    spreadId,
    number: position.number,
    label: position.label,
    prompt: position.prompt,
  } satisfies TarotPositionMetadata;
  return group;
};

/**
 * Inserts page-space Fabric groups through the existing scene/store pipeline.
 * Each card is one selectable, movable, rotatable object with durable metadata.
 * An optional title is a separate editable text object.
 */
export const insertTarotSpread = (
  positions: TarotPosition[],
  presetId: TarotPresetId,
  title: string,
): boolean => {
  const store = useEditorStore.getState();
  if (!store.canvas || positions.length === 0) return false;
  const { width, height } = useCanvasStore.getState();
  if (width <= 0 || height <= 0) return false;

  const spreadId = uuidv4();
  const maxCardWidth = width * (presetId === 'celtic-cross' ? 0.115 : presetId === 'custom' && positions.length > 3 ? 0.16 : 0.165);
  const maxCardHeight = height * (presetId === 'celtic-cross' ? 0.155 : presetId === 'custom' && positions.length > 4 ? 0.15 : 0.22);
  const scale = Math.min(maxCardWidth / CARD_WIDTH, maxCardHeight / CARD_HEIGHT);

  const objects: fabric.Object[] = [];
  if (title.trim()) {
    const heading = new fabric.Textbox(title.trim(), {
      left: width / 2,
      top: height * 0.065,
      width: width * 0.8,
      originX: 'center',
      originY: 'top',
      fontFamily: 'Georgia',
      fontSize: Math.max(20, Math.min(84, width * 0.037)),
      fontWeight: 'bold',
      textAlign: 'center',
      fill: '#302935',
    });
    (heading as any).id = uuidv4();
    (heading as any).name = `Tarot spread title: ${title.trim()}`;
    objects.push(heading);
  }

  objects.push(...positions.map((position) => makeCard(position, spreadId, width, height, scale)));
  store.addObjects(objects.map((object) =>
    withManifestZIndex(toSerializableObject(object), ZIndexLayer.Content)
  ), { save: true, selectLast: true });
  store.setActiveTool('select');
  return true;
};

/** Mutates the selected live Fabric group before the inspector's existing save pipeline. */
export const updateTarotGroupContents = (
  group: fabric.Group,
  metadata: TarotPositionMetadata,
): void => {
  (group as any).tarotPosition = metadata;
  (group as any).name = `Tarot · ${metadata.number}: ${metadata.label}`;
  const child = group.getObjects().find(
    (object) => (object as any).semanticRole === 'tarot-position-label'
  );
  if (child instanceof fabric.Textbox) {
    child.set('text', metadata.label.slice(0, 52));
    child.setCoords();
  }
  group.set('dirty', true);
  group.setCoords();
};
