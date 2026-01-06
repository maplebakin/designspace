
import React from 'react';
import { useEditorStore, Layer } from '../state/editorStore';
import { Eye, EyeOff, ChevronUp, ChevronDown, Trash2, Lock, Unlock, Droplet } from 'lucide-react';
import * as fabric from 'fabric';

export const LayersPanel: React.FC = () => {
  const { canvas, layers, setLayers, selectedLayerId, toggleMovementLock, toggleColorLock } = useEditorStore();

  // Helper to find an object on canvas by its ID
  const findObjectById = (id: string): fabric.Object | null => {
    return canvas?.getObjects().find(obj => (obj as any).id === id) || null;
  };

  const handleSelectLayer = (id: string) => {
    if (!canvas) return;
    const object = findObjectById(id);
    if (object) {
      canvas.setActiveObject(object);
      canvas.requestRenderAll();
    }
  };

  const handleToggleVisibility = (id: string) => {
    const object = findObjectById(id);
    if (canvas && object) {
      object.set('visible', !object.visible);
      canvas.requestRenderAll();
      setLayers(canvas.getObjects()); // Refresh layers state
    }
  };
  
  const handleMove = (id: string, direction: 'up' | 'down') => {
    const object = findObjectById(id);
    if (canvas && object) {
      if (direction === 'up') {
        canvas.bringObjectForward(object);
      } else {
        canvas.sendObjectBackwards(object);
      }
      canvas.requestRenderAll();
      setLayers(canvas.getObjects()); // Refresh layers to show new order
    }
  };

  const handleDelete = (id: string) => {
    const object = findObjectById(id);
    if (canvas && object) {
      canvas.remove(object);
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      setLayers(canvas.getObjects());
    }
  };

  const handleToggleMovementLock = (id: string) => {
      toggleMovementLock(id);
  }

  const handleToggleColorLock = (id: string) => {
      toggleColorLock(id);
  }

  return (
    <div className="p-4 bg-[#1c0d0d]/80 backdrop-blur-md border border-[color:var(--border-subtle)] rounded-xl transition-all duration-300 ease-in-out">
      <h3 className="text-sm uppercase tracking-widest text-slate-300 mb-4">Layers</h3>
      {layers.length === 0 ? (
         <p className="text-sm text-slate-500">The canvas is empty.</p>
      ) : (
        <ul className="space-y-2">
          {[...layers].reverse().map((layer: Layer) => {
            const isSelected = selectedLayerId === layer.id;
            return (
            <li
              key={layer.id}
              onClick={() => handleSelectLayer(layer.id)}
              className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all duration-300 ease-in-out ${isSelected ? 'bg-white/15 ring-1 ring-[color:var(--brand-primary)]/40' : 'bg-white/5 hover:bg-white/10'}`}
            >
              <span className="text-xs uppercase tracking-widest text-slate-200">{layer.name}</span>
              <div className="flex items-center gap-2">
                <button onClick={(e) => { e.stopPropagation(); handleMove(layer.id, 'up')}} aria-label="Move Up">
                    <ChevronUp className="icon-muted w-4 h-4 stroke-[1.5] transition-all duration-300 ease-in-out" />
                </button>
                 <button onClick={(e) => { e.stopPropagation(); handleMove(layer.id, 'down')}} aria-label="Move Down">
                    <ChevronDown className="icon-muted w-4 h-4 stroke-[1.5] transition-all duration-300 ease-in-out" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleToggleVisibility(layer.id)}} aria-label="Toggle Visibility">
                  {layer.visible ? <Eye className="icon-muted w-4 h-4 stroke-[1.5] transition-all duration-300 ease-in-out"/> : <EyeOff className="icon-muted w-4 h-4 stroke-[1.5] transition-all duration-300 ease-in-out"/>}
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleToggleMovementLock(layer.id)}} aria-label="Toggle Movement Lock">
                    {layer.movementLocked ? <Lock className="icon-muted w-4 h-4 stroke-[1.5] text-rose-400"/> : <Unlock className="icon-muted w-4 h-4 stroke-[1.5]"/>}
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleToggleColorLock(layer.id)}} aria-label="Toggle Color Lock">
                    <Droplet className={`w-4 h-4 stroke-[1.5] transition-colors ${layer.colorLocked ? 'text-rose-400 fill-rose-400/20' : 'icon-muted'}`} />
                </button>
                 <button onClick={(e) => { e.stopPropagation(); handleDelete(layer.id)}} aria-label="Delete Object">
                    <Trash2 className="icon-muted w-4 h-4 stroke-[1.5] transition-all duration-300 ease-in-out hover:text-rose-400"/>
                </button>
              </div>
            </li>
          )})}
        </ul>
      )}
    </div>
  );
};

