import type { SerializedFabricObject } from '../state/editorStore';

export interface SuggestionPatch {
  id: string;
  changes: Partial<SerializedFabricObject>;
}

export interface LayoutSuggestion {
  id: string;
  name: string;
  description: string;
  score: number;
  patches: SuggestionPatch[];
}

const getRenderableObjects = (objects: SerializedFabricObject[]) =>
  objects.filter((obj) => !obj.isGuide && !obj.isDocumentPaper && typeof obj.id === 'string');

const getWidth = (obj: SerializedFabricObject) => (obj.width ?? 0) * (obj.scaleX ?? 1);
export const generateSuggestions = (
  objects: SerializedFabricObject[],
  canvasSize: { width: number; height: number } = { width: 1200, height: 1200 }
): LayoutSuggestion[] => {
  const renderableObjects = getRenderableObjects(objects);
  if (renderableObjects.length < 2) {
    return [];
  }

  const suggestions: LayoutSuggestion[] = [];

  const averageLeft = renderableObjects.reduce((sum, obj) => sum + (obj.left ?? 0), 0) / renderableObjects.length;
  const averageTop = renderableObjects.reduce((sum, obj) => sum + (obj.top ?? 0), 0) / renderableObjects.length;
  const canvasCenterX = canvasSize.width / 2;
  const canvasCenterY = canvasSize.height / 2;
  const offsetX = Math.round(canvasCenterX - averageLeft);
  const offsetY = Math.round(canvasCenterY - averageTop);

  if (Math.abs(offsetX) > 24 || Math.abs(offsetY) > 24) {
    suggestions.push({
      id: 'center-selection',
      name: 'Center Composition',
      description: 'Move the current composition closer to the canvas center.',
      score: 0.82,
      patches: renderableObjects.map((obj) => ({
        id: obj.id as string,
        changes: {
          left: (obj.left ?? 0) + offsetX,
          top: (obj.top ?? 0) + offsetY,
        },
      })),
    });
  }

  const sortedByLeft = [...renderableObjects].sort((a, b) => (a.left ?? 0) - (b.left ?? 0));
  if (sortedByLeft.length >= 3) {
    const totalWidth = sortedByLeft.reduce((sum, obj) => sum + getWidth(obj), 0);
    const gap = (canvasSize.width - totalWidth) / (sortedByLeft.length + 1);
    if (Number.isFinite(gap) && gap > 0) {
      let cursor = gap;
      suggestions.push({
        id: 'distribute-horizontal',
        name: 'Distribute Horizontally',
        description: 'Create more even spacing between objects.',
        score: 0.7,
        patches: sortedByLeft.map((obj) => {
          const nextLeft = cursor + getWidth(obj) / 2;
          cursor += getWidth(obj) + gap;
          return {
            id: obj.id as string,
            changes: { left: nextLeft },
          };
        }),
      });
    }
  }

  const leftRange = Math.max(...renderableObjects.map((obj) => obj.left ?? 0)) - Math.min(...renderableObjects.map((obj) => obj.left ?? 0));
  if (leftRange > 12) {
    const anchorLeft = Math.min(...renderableObjects.map((obj) => obj.left ?? 0));
    suggestions.push({
      id: 'align-left',
      name: 'Align Left Edge',
      description: 'Tighten the composition by aligning objects to a shared left edge.',
      score: 0.64,
      patches: renderableObjects.map((obj) => ({
        id: obj.id as string,
        changes: { left: anchorLeft },
      })),
    });
  }

  const topRange = Math.max(...renderableObjects.map((obj) => obj.top ?? 0)) - Math.min(...renderableObjects.map((obj) => obj.top ?? 0));
  if (topRange > 12) {
    const anchorTop = Math.min(...renderableObjects.map((obj) => obj.top ?? 0));
    suggestions.push({
      id: 'align-top',
      name: 'Align Top Edge',
      description: 'Line objects up across a shared horizontal axis.',
      score: 0.6,
      patches: renderableObjects.map((obj) => ({
        id: obj.id as string,
        changes: { top: anchorTop },
      })),
    });
  }

  return suggestions.sort((a, b) => b.score - a.score);
};

export const applySuggestionToObjects = (
  objects: SerializedFabricObject[],
  suggestion: LayoutSuggestion
) => {
  const patchById = new Map(suggestion.patches.map((patch) => [patch.id, patch.changes]));
  return objects.map((obj) => {
    if (!obj.id) {
      return obj;
    }
    const patch = patchById.get(obj.id);
    return patch ? { ...obj, ...patch } : obj;
  });
};
