
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { shallow } from 'zustand/shallow';
import { sanityCheckCanvas, useEditorStore, Layer } from '../state/editorStore';
import { useThemeStore } from '../state/useThemeStore';
import { Eye, EyeOff, ChevronUp, ChevronDown, Trash2, Lock, Unlock, Droplet, Plus, Square, Circle, Triangle, Star, Type, Image as ImageIcon, Search, CheckSquare, XSquare } from 'lucide-react';
import * as fabric from 'fabric';
import { isUserObject } from '../utils/objectUtils';
import * as objectFactories from '../fabric/objectFactories';
import { loadImageFromFile } from '../services/assetLoader';
import { Tooltip } from './Tooltip';

export const LayersPanel: React.FC = () => {
  const {
    canvas,
    layers,
    layersById,
    selectedLayerIds,
    requestLayerSync,
    syncCanvasToStore,
    toggleMovementLock,
    toggleObjectLock,
    toggleColorLock,
    saveState,
    setSelectedObjectId,
  } = useEditorStore(
    (state) => ({
      canvas: state.canvas,
      layers: state.layers,
      layersById: state.layersById,
      selectedLayerIds: state.selectedLayerIds,
      requestLayerSync: state.requestLayerSync,
      syncCanvasToStore: state.syncCanvasToStore,
      toggleMovementLock: state.toggleMovementLock,
      toggleObjectLock: state.toggleObjectLock,
      toggleColorLock: state.toggleColorLock,
      saveState: state.saveState,
      setSelectedObjectId: state.setSelectedObjectId,
    }),
    shallow
  );
  const { themeData } = useThemeStore(
    (state) => ({
      themeData: state.themeData,
    }),
    shallow
  );
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const orderedLayers = useMemo(() => [...layers].reverse(), [layers]);

  // Filter layers based on search query
  const filteredLayers = useMemo(() => {
    if (!searchQuery) return orderedLayers;
    const query = searchQuery.toLowerCase();
    return orderedLayers.filter(layer => {
      const object = findObjectById(layer.id);
      const label = getLayerLabel(object, layer.name).toLowerCase();
      const type = layer.type.toLowerCase();
      return label.includes(query) || type.includes(query);
    });
  }, [orderedLayers, searchQuery]);

  // Helper to find an object on canvas by its ID
  const findObjectById = (id: string): fabric.Object | null => {
    return layersById[id] || null;
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
      requestLayerSync();
      saveState();
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
      requestLayerSync();
      saveState();
    }
  };

  const applyLayerOrder = (nextOrder: Layer[]) => {
    if (!canvas) return;
    const orderedObjects = nextOrder
      .map((layer) => layersById[layer.id])
      .filter((obj): obj is fabric.Object => !!obj);
    if (orderedObjects.length === 0) return;

    const allObjects = canvas.getObjects();
    const nonGuideCount = allObjects.filter(isUserObject).length;
    if (orderedObjects.length !== nonGuideCount) return;
    let reorderIndex = 0;
    const nextObjects = allObjects.map((obj) => {
      if (!isUserObject(obj)) return obj;
      const nextObject = orderedObjects[reorderIndex];
      reorderIndex += 1;
      return nextObject || obj;
    });

    nextObjects.forEach((obj, index) => {
      canvas.moveObjectTo(obj, index);
    });

    canvas.requestRenderAll();
    syncCanvasToStore(canvas);
    requestLayerSync();
    saveState();
  };

  const handleReorder = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const sourceIndex = orderedLayers.findIndex((layer) => layer.id === sourceId);
    const targetIndex = orderedLayers.findIndex((layer) => layer.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const nextOrder = [...orderedLayers];
    const [moved] = nextOrder.splice(sourceIndex, 1);
    nextOrder.splice(targetIndex, 0, moved);
    applyLayerOrder(nextOrder);
  };

  const handleDragStart = (layerId: string) => (event: React.DragEvent<HTMLLIElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', layerId);
    setDraggedLayerId(layerId);
  };

  const handleDragOver = (layerId: string) => (event: React.DragEvent<HTMLLIElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverLayerId(layerId);
  };

  const handleDrop = (layerId: string) => (event: React.DragEvent<HTMLLIElement>) => {
    event.preventDefault();
    const sourceId = draggedLayerId || event.dataTransfer.getData('text/plain');
    if (!sourceId) return;
    handleReorder(sourceId, layerId);
    setDraggedLayerId(null);
    setDragOverLayerId(null);
  };

  const handleDragEnd = () => {
    setDraggedLayerId(null);
    setDragOverLayerId(null);
  };

  const handleDelete = (id: string) => {
    const object = findObjectById(id);
    if (canvas && object) {
      canvas.remove(object);
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      requestLayerSync();
      saveState();
    }
  };

  const handleToggleMovementLock = (id: string, event?: React.MouseEvent) => {
      if (event?.shiftKey) {
        const object = findObjectById(id);
        if (canvas && object) {
          canvas.setActiveObject(object);
          setSelectedObjectId(id);
          canvas.requestRenderAll();
          toggleObjectLock();
          requestLayerSync();
        }
        return;
      }
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
    // Automatically switch to selection tool after inserting a shape
    useEditorStore.getState().setActiveTool('select');
    setIsMenuOpen(false);
  };

  const handleAddText = () => {
    if (!canvas) return;
    objectFactories.addIText(canvas, { text: 'New Text', fontSize: 32, role: 'body' });
    // Automatically switch to selection tool after inserting text
    useEditorStore.getState().setActiveTool('select');
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
        className: 'rounded-md bg-black/10 border border-black/20 text-[9px] text-[color:var(--ui-panel-text)] font-semibold flex items-center justify-center',
        label: 'T',
        color: '',
        stroke: 'rgba(0,0,0,0.2)',
      };
    }
    if (object.type === 'image') {
      return {
        className: 'rounded-md bg-black/15 border border-black/20 text-[9px] text-[color:var(--ui-panel-text)] flex items-center justify-center',
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

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canvas) {
      if (imageInputRef.current) imageInputRef.current.value = '';
      setIsMenuOpen(false);
      return;
    }

    const result = await loadImageFromFile(file);

    if (!result.success) {
      console.error('Failed to load image:', result.errorMessage);
      if (imageInputRef.current) imageInputRef.current.value = '';
      setIsMenuOpen(false);
      return;
    }

    result.asset.set({
      id: result.id,
      tokenRole: 'brand.accent.value',
      colorLocked: false,
      originX: 'center',
      originY: 'center',
    });

    canvas.add(result.asset);
    canvas.centerObject(result.asset);
    canvas.setActiveObject(result.asset);
    sanityCheckCanvas(canvas, themeData);
    canvas.requestRenderAll();
    saveState();

    if (imageInputRef.current) imageInputRef.current.value = '';
    setIsMenuOpen(false);
  };

  return (
    <div className="h-full p-4 text-[color:var(--ui-panel-text)] transition-all duration-300 ease-in-out">
      <div className="mb-4 flex items-center justify-between">
        <div className="relative flex-1 mr-2">
          <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[color:var(--ui-panel-text)]" />
          <input
            type="text"
            placeholder="Search layers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-8 py-1.5 text-xs text-[color:var(--ui-text)] placeholder:text-[color:var(--ui-panel-text)]/60 focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-primary)]"
          />
        </div>
      </div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm uppercase tracking-widest text-[color:var(--ui-panel-text)]">Layers</h3>
          {layers.length > 0 && (
            <span className="px-2 py-0.5 text-[10px] bg-[color:var(--brand-primary)]/20 text-[color:var(--brand-primary)] rounded-full font-medium">
              {layers.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {layers.length > 0 && (
            <>
              <Tooltip content="Select All" side="top">
                <button
                  onClick={() => {
                    if (!canvas) return;
                    const allObjects = canvas.getObjects().filter((obj) => !(obj as any).isGuide);
                    if (allObjects.length === 0) return;
                    canvas.discardActiveObject();
                    const selection = new fabric.ActiveSelection(allObjects, { canvas });
                    canvas.setActiveObject(selection);
                    canvas.requestRenderAll();
                  }}
                  className="ui-button-icon p-1.5 rounded-lg text-[color:var(--ui-panel-text)] transition-all duration-200"
                >
                  <CheckSquare className="h-3.5 w-3.5 stroke-[1.5]" />
                </button>
              </Tooltip>
              <Tooltip content="Deselect All" side="top">
                <button
                  onClick={() => {
                    if (!canvas) return;
                    canvas.discardActiveObject();
                    canvas.requestRenderAll();
                  }}
                  className="ui-button-icon p-1.5 rounded-lg text-[color:var(--ui-panel-text)] transition-all duration-200"
                >
                  <XSquare className="h-3.5 w-3.5 stroke-[1.5]" />
                </button>
              </Tooltip>
            </>
          )}
          <div className="relative" ref={menuRef}>
          <button
            onClick={() => setIsMenuOpen((prev) => !prev)}
            className="ui-button-icon rounded-full p-1 transition-all duration-300 ease-in-out"
            aria-label="New Layer"
            title="New Layer"
          >
            <Plus className="h-4 w-4 stroke-[1.5]" />
          </button>
          {isMenuOpen && (
            <div className="ui-dropdown-surface absolute right-0 mt-2 w-44 rounded-xl p-2">
              <button
                onClick={() => handleAddShape(objectFactories.addRectangle)}
                className="ui-menu-item text-xs uppercase tracking-widest"
              >
                <Square className="h-4 w-4 stroke-[1.5]" />
                Rectangle
              </button>
              <button
                onClick={() => handleAddShape(objectFactories.addCircle)}
                className="ui-menu-item text-xs uppercase tracking-widest"
              >
                <Circle className="h-4 w-4 stroke-[1.5]" />
                Circle
              </button>
              <button
                onClick={() => handleAddShape(objectFactories.addTriangle)}
                className="ui-menu-item text-xs uppercase tracking-widest"
              >
                <Triangle className="h-4 w-4 stroke-[1.5]" />
                Triangle
              </button>
              <button
                onClick={() => handleAddShape(objectFactories.addStar)}
                className="ui-menu-item text-xs uppercase tracking-widest"
              >
                <Star className="h-4 w-4 stroke-[1.5]" />
                Star
              </button>
              <button
                onClick={handleAddText}
                className="ui-menu-item text-xs uppercase tracking-widest"
              >
                <Type className="h-4 w-4 stroke-[1.5]" />
                Add Text
              </button>
              <button
                onClick={handleAddImage}
                className="ui-menu-item text-xs uppercase tracking-widest"
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
      </div>
      {layers.length === 0 ? (
         <p className="text-sm text-[color:var(--ui-panel-text)]">The canvas is empty.</p>
      ) : (
        <ul className="space-y-2">
          {filteredLayers.length === 0 ? (
            <li className="p-2 text-center text-xs text-[color:var(--ui-panel-text)]">
              No layers match your search
            </li>
          ) : (
            <>
              {filteredLayers.map((layer: Layer, index) => {
                const isSelected = selectedLayerIds.includes(layer.id);
                const object = findObjectById(layer.id);
                const label = getLayerLabel(object, layer.name);
                const preview = getPreviewStyle(object);
                const isDragging = draggedLayerId === layer.id;
                const isDragOver = dragOverLayerId === layer.id && draggedLayerId !== layer.id;

                return (
                  <li
                    key={layer.id || `layer-${index}`}
                    draggable
                    onClick={() => handleSelectLayer(layer.id)}
                    onDragStart={handleDragStart(layer.id)}
                    onDragOver={handleDragOver(layer.id)}
                    onDrop={handleDrop(layer.id)}
                    onDragEnd={handleDragEnd}
                    className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all duration-300 ease-in-out ${isSelected ? 'bg-white/15 ring-1 ring-[color:var(--brand-primary)]/40' : 'bg-white/5 hover:bg-white/10'} ${isDragging ? 'opacity-60' : ''} ${isDragOver ? 'ring-1 ring-[color:var(--brand-primary)]' : ''}`}
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
                      <span className="text-xs uppercase tracking-widest text-[color:var(--ui-panel-text)]">{label}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Tooltip content="Move Up" side="top">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleMove(layer.id, 'up'); }}
                          className="p-1 rounded hover:bg-white/10 active:scale-90 transition-all duration-150"
                        >
                          <ChevronUp className="icon-muted w-3.5 h-3.5 stroke-[1.5]" />
                        </button>
                      </Tooltip>
                      <Tooltip content="Move Down" side="top">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleMove(layer.id, 'down'); }}
                          className="p-1 rounded hover:bg-white/10 active:scale-90 transition-all duration-150"
                        >
                          <ChevronDown className="icon-muted w-3.5 h-3.5 stroke-[1.5]" />
                        </button>
                      </Tooltip>
                      <Tooltip content={layer.visible ? 'Hide' : 'Show'} side="top">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggleVisibility(layer.id); }}
                          className="p-1 rounded hover:bg-white/10 active:scale-90 transition-all duration-150"
                        >
                          {layer.visible
                            ? <Eye className="icon-muted w-3.5 h-3.5 stroke-[1.5]" />
                            : <EyeOff className="icon-muted w-3.5 h-3.5 stroke-[1.5] opacity-50" />
                          }
                        </button>
                      </Tooltip>
                      <Tooltip content={layer.movementLocked ? 'Unlock Position (Shift: Toggle Selection Lock)' : 'Lock Position (Shift: Toggle Selection Lock)'} side="top">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggleMovementLock(layer.id, e); }}
                          className="p-1 rounded hover:bg-white/10 active:scale-90 transition-all duration-150"
                        >
                          {layer.movementLocked
                            ? <Lock className="w-3.5 h-3.5 stroke-[1.5] text-rose-400" />
                            : <Unlock className="icon-muted w-3.5 h-3.5 stroke-[1.5]" />
                          }
                        </button>
                      </Tooltip>
                      <Tooltip content={layer.colorLocked ? 'Unlock Color' : 'Lock Color'} side="top">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggleColorLock(layer.id); }}
                          className="p-1 rounded hover:bg-white/10 active:scale-90 transition-all duration-150"
                        >
                          <Droplet className={`w-3.5 h-3.5 stroke-[1.5] transition-colors ${layer.colorLocked ? 'text-rose-400 fill-rose-400/20' : 'icon-muted'}`} />
                        </button>
                      </Tooltip>
                      <Tooltip content="Delete" side="top">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(layer.id); }}
                          className="p-1 rounded hover:bg-rose-500/20 active:scale-90 transition-all duration-150"
                        >
                          <Trash2 className="icon-muted w-3.5 h-3.5 stroke-[1.5] hover:text-rose-400" />
                        </button>
                      </Tooltip>
                    </div>
                  </li>
                );
              })}
            </>
          )}
        </ul>
      )}
    </div>
  );
};
