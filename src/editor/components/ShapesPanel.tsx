import React, { useRef } from 'react';
import * as fabric from 'fabric';
import { Square, Circle, Triangle, Star } from 'lucide-react';
import { finalizeInsertionSelection, useEditorStore } from '../state/editorStore';
import * as objectFactories from '../fabric/objectFactories';

const ICON_SMALL = 'icon-muted w-4 h-4 stroke-[1.5]';

export const ShapesPanel: React.FC = () => {
  const lastInsertAtRef = useRef(0);

  const handleAddShape = (factory: (canvas: fabric.Canvas) => fabric.Object | void) => {
    const canvas = useEditorStore.getState().canvas;
    if (!canvas) return;
    const now = performance.now();
    if (now - lastInsertAtRef.current < 150) return;
    lastInsertAtRef.current = now;
    const inserted = factory(canvas);
    const insertedId = inserted ? (inserted as any).id : null;
    if (typeof insertedId === 'string') {
      finalizeInsertionSelection(insertedId);
    }
    useEditorStore.getState().setActiveTool('select');
  };

  return (
    <div className="p-4 space-y-3">
      <h3 className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">Shapes</h3>
      <div className="grid grid-cols-1 gap-2">
        <button data-testid="shape-rectangle" onClick={() => handleAddShape(objectFactories.addRectangle)} className="ui-button-soft flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] uppercase tracking-widest">
          <Square className={ICON_SMALL} /><span>Rectangle</span>
        </button>
        <button onClick={() => handleAddShape(objectFactories.addCircle)} className="ui-button-soft flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] uppercase tracking-widest">
          <Circle className={ICON_SMALL} /><span>Circle</span>
        </button>
        <button onClick={() => handleAddShape(objectFactories.addTriangle)} className="ui-button-soft flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] uppercase tracking-widest">
          <Triangle className={ICON_SMALL} /><span>Triangle</span>
        </button>
        <button onClick={() => handleAddShape(objectFactories.addStar)} className="ui-button-soft flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] uppercase tracking-widest">
          <Star className={ICON_SMALL} /><span>Star</span>
        </button>
      </div>
    </div>
  );
};
