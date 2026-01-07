
import React, { useEffect, useRef, useState } from 'react';
import { sanityCheckCanvas, useEditorStore, Layer } from '../state/editorStore';
import { Eye, EyeOff, ChevronUp, ChevronDown, Trash2, Lock, Unlock, Droplet, Plus, Square, Circle, Triangle, Star, Type, Image as ImageIcon, MousePointer2, Pencil, Eraser, Hand } from 'lucide-react';
import * as fabric from 'fabric';
import { v4 as uuidv4 } from 'uuid';
import * as objectFactories from '../fabric/objectFactories';

export const LayersPanel: React.FC = () => {
  const {
    canvas,
    layers,
    setLayers,
    selectedLayerId,
    toggleMovementLock,
    toggleColorLock,
    saveState,
    themeData,
    activeTool,
    setActiveTool,
    brushSize,
    setBrushSize,
    brushColor,
    setBrushColor,
  } = useEditorStore();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!menuRef.current || menuRef.current.contains(event.target as Node)) return;
      setIsMenuOpen(false);
    };
    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  const handleAddShape = (factory: (canvas: fabric.Canvas) => void) => {
    if (!canvas) return;
    factory(canvas);
    sanityCheckCanvas(canvas, themeData);
    saveState();
    setIsMenuOpen(false);
  };

  const handleAddText = () => {
    if (!canvas) return;
    objectFactories.addIText(canvas, { text: 'New Text', fontSize: 32, role: 'body' });
    sanityCheckCanvas(canvas, themeData);
    saveState();
    setIsMenuOpen(false);
  };

  const handleAddImage = () => {
    imageInputRef.current?.click();
  };

  const getLayerLabel = (object: fabric.Object | null, fallback: string) => {
    if (!object) return fallback || 'Layer';
    const type = object.type;
    if (type === 'i-text' || type === 'textbox') {
      const raw = String((object as any).text ?? '').trim();
      if (!raw) return 'Text';
      return raw.length > 15 ? `${raw.slice(0, 15)}...` : raw;
    }
    if (type === 'rect') {
      const rx = (object as any).rx ?? 0;
      const ry = (object as any).ry ?? 0;
      return rx || ry ? 'Rounded Rectangle' : 'Rectangle';
    }
    if (type === 'circle') return 'Circle';
    if (type === 'triangle') return 'Triangle';
    if (type === 'polygon') {
      const points = (object as any).points as Array<{ x: number; y: number }> | undefined;
      if (points && points.length === 10) return 'Star';
      return 'Polygon';
    }
    if (type === 'image') return 'Image';
    return fallback || 'Layer';
  };

  const getPreviewStyle = (object: fabric.Object | null) => {
    if (!object) {
      return {
        className: 'rounded-md bg-white/5 border border-white/10',
        label: '',
        color: '',
      };
    }
    const fill = typeof (object as any).fill === 'string' ? ((object as any).fill as string) : 'rgba(15, 23, 42, 0.25)';
    const stroke = typeof (object as any).stroke === 'string' ? ((object as any).stroke as string) : 'rgba(255, 255, 255, 0.15)';
    if (object.type === 'circle') {
      return {
        className: 'rounded-full',
        label: '',
        color: fill,
        stroke,
      };
    }
    if (object.type === 'i-text' || object.type === 'textbox') {
      return {
        className: 'rounded-md bg-black/10 border border-black/20 text-[9px] text-slate-800 font-semibold flex items-center justify-center',
        label: 'T',
        color: '',
        stroke: 'rgba(0,0,0,0.2)',
      };
    }
    if (object.type === 'image') {
      return {
        className: 'rounded-md bg-black/15 border border-black/20 text-[9px] text-slate-200 flex items-center justify-center',
        label: 'IMG',
        color: '',
        stroke: 'rgba(0,0,0,0.2)',
      };
    }
    return {
      className: 'rounded-md border border-white/10',
      label: '',
      color: fill,
      stroke,
    };
  };

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canvas) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      fabric.Image.fromURL(dataUrl, { crossOrigin: 'anonymous' }).then((img: fabric.FabricImage) => {
        img.set({
          id: uuidv4(),
          tokenRole: 'brand.accent.value',
          colorLocked: false,
          originX: 'center',
          originY: 'center',
        });
        canvas.add(img);
        canvas.centerObject(img);
        canvas.setActiveObject(img);
        sanityCheckCanvas(canvas, themeData);
        canvas.requestRenderAll();
        saveState();
      });
    };
    reader.readAsDataURL(file);
    if (imageInputRef.current) imageInputRef.current.value = '';
    setIsMenuOpen(false);
  };

  return (
    <div className="p-4 bg-[color:var(--ui-panel)]/70 backdrop-blur-[var(--ui-blur)] border border-[color:var(--ui-border)] rounded-xl transition-all duration-300 ease-in-out">
      <div className="mb-4 space-y-3">
        <h3 className="text-[11px] uppercase tracking-widest text-[#F8F9FA]">Tools</h3>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setActiveTool('select')}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition-all duration-300 ease-in-out ${
              activeTool === 'select'
                ? 'border-[color:var(--brand-primary)] bg-white/15 text-slate-100'
                : 'border-white/10 bg-white/5 text-slate-200 hover:border-[color:var(--brand-primary)]'
            }`}
          >
            <MousePointer2 className="icon-muted h-4 w-4 stroke-[1.5]" />
            Select
          </button>
          <button
            onClick={() => setActiveTool('draw')}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition-all duration-300 ease-in-out ${
              activeTool === 'draw'
                ? 'border-[color:var(--brand-primary)] bg-white/15 text-slate-100'
                : 'border-white/10 bg-white/5 text-slate-200 hover:border-[color:var(--brand-primary)]'
            }`}
          >
            <Pencil className="icon-muted h-4 w-4 stroke-[1.5]" />
            Pencil
          </button>
          <button
            onClick={() => setActiveTool('erase')}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition-all duration-300 ease-in-out ${
              activeTool === 'erase'
                ? 'border-[color:var(--brand-primary)] bg-white/15 text-slate-100'
                : 'border-white/10 bg-white/5 text-slate-200 hover:border-[color:var(--brand-primary)]'
            }`}
          >
            <Eraser className="icon-muted h-4 w-4 stroke-[1.5]" />
            Erase
          </button>
          <button
            onClick={() => setActiveTool('pan')}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs uppercase tracking-widest transition-all duration-300 ease-in-out ${
              activeTool === 'pan'
                ? 'border-[color:var(--brand-primary)] bg-white/15 text-slate-100'
                : 'border-white/10 bg-white/5 text-slate-200 hover:border-[color:var(--brand-primary)]'
            }`}
          >
            <Hand className="icon-muted h-4 w-4 stroke-[1.5]" />
            Hand
          </button>
        </div>
        {(activeTool === 'draw' || activeTool === 'erase') && (
          <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 px-3 py-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest text-slate-400">Brush Size</span>
              <span className="text-[10px] uppercase tracking-widest text-slate-300">{brushSize}px</span>
            </div>
            <input
              type="range"
              min="2"
              max="40"
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="w-full accent-[color:var(--brand-primary)]"
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest text-slate-400">Brush Color</span>
              <input
                type="color"
                value={brushColor}
                onChange={(e) => setBrushColor(e.target.value)}
                className="h-6 w-10 cursor-pointer rounded border border-white/10 bg-transparent"
                aria-label="Brush color"
              />
            </div>
          </div>
        )}
      </div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm uppercase tracking-widest text-[#F8F9FA]">Layers</h3>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setIsMenuOpen((prev) => !prev)}
            className="rounded-full border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] p-1 text-[color:var(--ui-accent)] transition-all duration-300 ease-in-out hover:shadow-[0_0_12px_var(--ui-accent)]"
            aria-label="New Layer"
            title="New Layer"
          >
            <Plus className="h-4 w-4 stroke-[1.5]" />
          </button>
          {isMenuOpen && (
            <div className="absolute right-0 mt-2 w-40 rounded-xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] p-2 text-[color:var(--ui-accent)] shadow-[0_16px_30px_rgba(0,0,0,0.35)]">
              <button
                onClick={() => handleAddShape(objectFactories.addRectangle)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs uppercase tracking-widest transition-all duration-300 ease-in-out hover:bg-white/10"
              >
                <Square className="h-4 w-4 stroke-[1.5]" />
                Rectangle
              </button>
              <button
                onClick={() => handleAddShape(objectFactories.addCircle)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs uppercase tracking-widest transition-all duration-300 ease-in-out hover:bg-white/10"
              >
                <Circle className="h-4 w-4 stroke-[1.5]" />
                Circle
              </button>
              <button
                onClick={() => handleAddShape(objectFactories.addTriangle)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs uppercase tracking-widest transition-all duration-300 ease-in-out hover:bg-white/10"
              >
                <Triangle className="h-4 w-4 stroke-[1.5]" />
                Triangle
              </button>
              <button
                onClick={() => handleAddShape(objectFactories.addStar)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs uppercase tracking-widest transition-all duration-300 ease-in-out hover:bg-white/10"
              >
                <Star className="h-4 w-4 stroke-[1.5]" />
                Star
              </button>
              <button
                onClick={handleAddText}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs uppercase tracking-widest transition-all duration-300 ease-in-out hover:bg-white/10"
              >
                <Type className="h-4 w-4 stroke-[1.5]" />
                Add Text
              </button>
              <button
                onClick={handleAddImage}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs uppercase tracking-widest transition-all duration-300 ease-in-out hover:bg-white/10"
              >
                <ImageIcon className="h-4 w-4 stroke-[1.5]" />
                Add Image
              </button>
            </div>
          )}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png, image/jpeg"
            onChange={handleImageFileChange}
            className="hidden"
          />
        </div>
      </div>
      {layers.length === 0 ? (
         <p className="text-sm text-slate-500">The canvas is empty.</p>
      ) : (
        <ul className="space-y-2">
          {[...layers].reverse().map((layer: Layer, index) => {
            const isSelected = selectedLayerId === layer.id;
            const object = findObjectById(layer.id);
            const label = getLayerLabel(object, layer.name);
            const preview = getPreviewStyle(object);
            return (
            <li
              key={layer.id || `layer-${index}`}
              onClick={() => handleSelectLayer(layer.id)}
              className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all duration-300 ease-in-out ${isSelected ? 'bg-white/15 ring-1 ring-[color:var(--brand-primary)]/40' : 'bg-white/5 hover:bg-white/10'}`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`h-6 w-6 flex items-center justify-center border ${preview.className}`}
                  style={{
                    backgroundColor: preview.color || undefined,
                    borderColor: preview.stroke || undefined,
                  }}
                >
                  {preview.label && <span>{preview.label}</span>}
                </div>
                <span className="text-xs uppercase tracking-widest text-[#F8F9FA]">{label}</span>
              </div>
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
