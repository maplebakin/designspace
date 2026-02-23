
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import * as fabric from 'fabric';
import { v4 as uuidv4 } from 'uuid';
import { Square, Monitor, Printer, Settings2, FileText, Image, Smartphone } from 'lucide-react';
import { useEditorStore, DEFAULT_CANVAS_BACKGROUND } from '../state/editorStore';
import { PRINT_DPI } from '../utils/units';
import { useThemeStore } from '../state/useThemeStore';
import { initFabricSerialization } from '../fabric/initFabricCanvas';
import { resizeCanvas, updateGuides, fitCanvasToViewport, updateDocumentPaper, clearDocumentPaper } from '../fabric/canvasUtils';
import { useCanvasLifecycle } from '../hooks/useCanvasLifecycle';
import { resolveThemeValue } from '../utils/themeResolver';
import { dirtyObjects, registerAllCanvasEventHandlers } from '../services/canvasEventService';
import { loadImageFromFile, safeLoadImage } from '../services/assetLoader';
import { ContextMenu, useContextMenu } from './ContextMenu';
import { useCanvasStore } from '../state/useCanvasStore';
import { guideRegistry } from '../fabric/guideRegistry';
import { frameScheduler, TaskPriority } from '../utils/frameScheduler';
import { coordinateSystem } from '../utils/coordinateSystem';

initFabricSerialization();

type CanvasNavKey = 'insert' | 'layers';

// Canvas size presets
type SizePreset = {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  icon: React.ReactNode;
  category: 'print' | 'digital';
  recommended?: boolean;
};

const SIZE_PRESETS: SizePreset[] = [
  // Print presets (300 DPI)
  { id: 'us-letter', name: 'US Letter', description: '8.5" × 11"', width: Math.round(8.5 * PRINT_DPI), height: Math.round(11 * PRINT_DPI), icon: <FileText className="w-5 h-5" />, category: 'print', recommended: true },
  { id: 'a4', name: 'A4', description: '210 × 297 mm', width: 2480, height: 3508, icon: <FileText className="w-5 h-5" />, category: 'print' },
  { id: 'a5', name: 'A5', description: '148 × 210 mm', width: 1748, height: 2480, icon: <FileText className="w-5 h-5" />, category: 'print' },
  { id: 'postcard', name: 'Postcard', description: '4" × 6"', width: Math.round(4 * PRINT_DPI), height: Math.round(6 * PRINT_DPI), icon: <Image className="w-5 h-5" />, category: 'print' },
  // Digital presets
  { id: 'instagram-square', name: 'Instagram', description: '1080 × 1080', width: 1080, height: 1080, icon: <Square className="w-5 h-5" />, category: 'digital' },
  { id: 'instagram-story', name: 'Story', description: '1080 × 1920', width: 1080, height: 1920, icon: <Smartphone className="w-5 h-5" />, category: 'digital' },
  { id: 'hd', name: 'HD', description: '1920 × 1080', width: 1920, height: 1080, icon: <Monitor className="w-5 h-5" />, category: 'digital' },
  { id: '4k', name: '4K', description: '3840 × 2160', width: 3840, height: 2160, icon: <Monitor className="w-5 h-5" />, category: 'digital' },
];

type CanvasSizePickerProps = {
  onSelect: (width: number, height: number) => void;
  onDismiss: () => void;
};

const CanvasSizePicker: React.FC<CanvasSizePickerProps> = ({ onSelect, onDismiss }) => {
  const [showCustom, setShowCustom] = useState(false);
  const [customWidth, setCustomWidth] = useState('8.5');
  const [customHeight, setCustomHeight] = useState('11');
  const [customUnit, setCustomUnit] = useState<'in' | 'px'>('in');

  const printPresets = SIZE_PRESETS.filter(p => p.category === 'print');
  const digitalPresets = SIZE_PRESETS.filter(p => p.category === 'digital');

  const handleCustomApply = () => {
    const w = parseFloat(customWidth);
    const h = parseFloat(customHeight);
    if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) return;

    const widthPx = customUnit === 'in' ? Math.round(w * PRINT_DPI) : Math.round(w);
    const heightPx = customUnit === 'in' ? Math.round(h * PRINT_DPI) : Math.round(h);
    onSelect(widthPx, heightPx);
  };

  const getPreviewAspect = (preset: SizePreset) => {
    const maxSize = 48;
    const aspect = preset.width / preset.height;
    if (aspect > 1) {
      return { width: maxSize, height: Math.round(maxSize / aspect) };
    }
    return { width: Math.round(maxSize * aspect), height: maxSize };
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40">
      <div className="pointer-events-auto flex flex-col gap-6 rounded-3xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel-opaque)] px-8 py-7 backdrop-blur-[var(--ui-blur)] shadow-[0_25px_70px_rgba(0,0,0,0.5)] max-w-2xl">
        {/* Header */}
        <div className="text-center space-y-1">
          <h2 className="text-lg font-medium text-[color:var(--ui-panel-text)]">New Canvas</h2>
          <p className="text-xs text-[color:var(--ui-panel-text)]/60">Choose a size to get started</p>
        </div>

        {/* Presets Grid */}
        <div className="space-y-5">
          {/* Print Section */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[color:var(--ui-panel-text)]/70">
              <Printer className="w-3.5 h-3.5" />
              <span className="text-[10px] uppercase tracking-widest">Print (300 DPI)</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {printPresets.map(preset => {
                const preview = getPreviewAspect(preset);
                return (
                  <button
                    key={preset.id}
                    onClick={() => onSelect(preset.width, preset.height)}
                    className={`group relative flex flex-col items-center gap-2 p-3 rounded-xl border transition-all duration-200 ${
                      preset.recommended
                        ? 'border-[color:var(--brand-primary)]/50 bg-[color:var(--brand-primary)]/10 hover:bg-[color:var(--brand-primary)]/20'
                        : 'border-white/10 bg-white/5 hover:border-[color:var(--brand-primary)]/50 hover:bg-white/10'
                    }`}
                  >
                    {preset.recommended && (
                      <span className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 text-[8px] uppercase tracking-wider bg-[color:var(--brand-primary)] text-white rounded-full">
                        Default
                      </span>
                    )}
                    <div
                      className="border border-[color:var(--ui-panel-text)]/20 bg-white/90 rounded-sm"
                      style={{ width: preview.width, height: preview.height }}
                    />
                    <div className="text-center">
                      <div className={`text-xs font-medium ${preset.recommended ? 'text-[color:var(--brand-primary)]' : 'text-[color:var(--ui-panel-text)]'}`}>
                        {preset.name}
                      </div>
                      <div className="text-[10px] text-[color:var(--ui-panel-text)]/50">{preset.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Digital Section */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[color:var(--ui-panel-text)]/70">
              <Monitor className="w-3.5 h-3.5" />
              <span className="text-[10px] uppercase tracking-widest">Digital</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {digitalPresets.map(preset => {
                const preview = getPreviewAspect(preset);
                return (
                  <button
                    key={preset.id}
                    onClick={() => onSelect(preset.width, preset.height)}
                    className="group flex flex-col items-center gap-2 p-3 rounded-xl border border-white/10 bg-white/5 hover:border-[color:var(--brand-primary)]/50 hover:bg-white/10 transition-all duration-200"
                  >
                    <div
                      className="border border-[color:var(--ui-panel-text)]/20 bg-white/90 rounded-sm"
                      style={{ width: preview.width, height: preview.height }}
                    />
                    <div className="text-center">
                      <div className="text-xs font-medium text-[color:var(--ui-panel-text)]">{preset.name}</div>
                      <div className="text-[10px] text-[color:var(--ui-panel-text)]/50">{preset.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Size */}
          <div className="pt-2 border-t border-white/10">
            {showCustom ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 space-y-1">
                    <label className="text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/50">Width</label>
                    <input
                      type="number"
                      step="0.1"
                      min="1"
                      value={customWidth}
                      onChange={(e) => setCustomWidth(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-black/30 border border-white/10 rounded-lg text-[color:var(--ui-panel-text)] focus:border-[color:var(--brand-primary)] outline-none"
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <label className="text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/50">Height</label>
                    <input
                      type="number"
                      step="0.1"
                      min="1"
                      value={customHeight}
                      onChange={(e) => setCustomHeight(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-black/30 border border-white/10 rounded-lg text-[color:var(--ui-panel-text)] focus:border-[color:var(--brand-primary)] outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/50">Unit</label>
                    <select
                      value={customUnit}
                      onChange={(e) => setCustomUnit(e.target.value as 'in' | 'px')}
                      className="px-3 py-2 text-sm bg-black/30 border border-white/10 rounded-lg text-[color:var(--ui-panel-text)] focus:border-[color:var(--brand-primary)] outline-none"
                    >
                      <option value="in">inches</option>
                      <option value="px">pixels</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowCustom(false)}
                    className="flex-1 px-4 py-2 text-xs uppercase tracking-widest text-[color:var(--ui-panel-text)]/70 bg-white/5 rounded-lg hover:bg-white/10 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCustomApply}
                    className="flex-1 px-4 py-2 text-xs uppercase tracking-widest text-white bg-[color:var(--brand-primary)] rounded-lg hover:brightness-110 transition-all"
                  >
                    Create Canvas
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowCustom(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 text-xs uppercase tracking-widest text-[color:var(--ui-panel-text)]/70 border border-dashed border-white/20 rounded-xl hover:border-[color:var(--brand-primary)]/50 hover:text-[color:var(--ui-panel-text)] hover:bg-white/5 transition-all"
              >
                <Settings2 className="w-4 h-4" />
                Custom Size
              </button>
            )}
          </div>
        </div>

        {/* Skip */}
        <button
          onClick={onDismiss}
          className="text-xs text-[color:var(--ui-panel-text)]/40 hover:text-[color:var(--ui-panel-text)]/70 transition-colors"
        >
          Skip and use default (US Letter)
        </button>
      </div>
    </div>
  );
};

type CanvasStageProps = {
  onSelectNav?: (nav: CanvasNavKey) => void;
};

export const CanvasStage: React.FC<CanvasStageProps> = ({ onSelectNav: _onSelectNav }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // Context menu integration
  const { contextMenu, showContextMenu, hideContextMenu } = useContextMenu();
  const {
    canvas: fabricCanvas,
    setSelectedObjectId,
    syncCanvasToStore,
    setSelectedLayerIds,
    bleedPx,
    layers,
    layersById,
    activeTool,
    brushSize,
    setVpt,
    setZoom,
    setCanvasOffset,
    snapEnabled,
    gridEnabled,
    addImageAsset,
    showOnboarding,
    setShowOnboarding,
    setLayerSyncHandler,
    showGuides,
    markHistoryDirty,
    unitScale,
    setDirtyObjectsRef,
    showSafeZones,
  } = useEditorStore(
    (state) => ({
      canvas: state.canvas,
      setSelectedObjectId: state.setSelectedObjectId,
      syncCanvasToStore: state.syncCanvasToStore,
      setSelectedLayerIds: state.setSelectedLayerIds,
      bleedPx: state.bleedPx,
      layers: state.layers,
      layersById: state.layersById,
      activeTool: state.activeTool,
      brushSize: state.brushSize,
      setVpt: state.setVpt,
      setZoom: state.setZoom,
      setCanvasOffset: state.setCanvasOffset,
      snapEnabled: state.snapEnabled,
      gridEnabled: state.gridEnabled,
      addImageAsset: state.addImageAsset,
      showOnboarding: state.showOnboarding,
      setShowOnboarding: state.setShowOnboarding,
      setLayerSyncHandler: state.setLayerSyncHandler,
      showGuides: state.showGuides,
      markHistoryDirty: state.markHistoryDirty,
      unitScale: state.unitScale,
      setDirtyObjectsRef: state.setDirtyObjectsRef,
      showSafeZones: state.showSafeZones,
    }),
    shallow
  );
  const { themeData, brushColor, canvasBackgroundColor } = useThemeStore(
    (state) => ({
      themeData: state.themeData,
      brushColor: state.brushColor,
      canvasBackgroundColor: state.canvasBackgroundColor,
    }),
    shallow
  );

  // Subscribe to document dimensions for paper updates
  const { width: docWidth, height: docHeight } = useCanvasStore(
    (state) => ({ width: state.width, height: state.height }),
    shallow
  );

  const isSpacebarDownRef = useRef(false);
  const isPanningRef = useRef(false);
  const lastPosXRef = useRef(0);
  const lastPosYRef = useRef(0);
  const pendingPromisesRef = useRef<Set<Promise<unknown>>>(new Set());
  const placeholderHighlightRef = useRef<{
    obj: fabric.Object;
    shadow: fabric.Shadow | null;
  } | null>(null);

  const frameHighlightRef = useRef<{
    obj: fabric.Object;
    originalFill: string | fabric.Pattern | fabric.Gradient<'linear'> | fabric.Gradient<'radial'> | null;
    originalOpacity: number;
  } | null>(null);
  const updateRafRef = useRef<number | null>(null);
  const updateScheduledRef = useRef(false);
  const viewportRafRef = useRef<number | null>(null);
  const viewportScheduledRef = useRef(false);
  const persistCountRef = useRef(0); // PHASE 2.3: Counter-based persistence
  const activeToolRef = useRef(activeTool);
  const canvasOffsetRef = useRef({ x: 0, y: 0 });
  const snapEnabledRef = useRef(snapEnabled);
  const viewportRecoveryAttemptsRef = useRef(0);
  const didForceRerenderRef = useRef(false);
  const didInitialViewportFitRef = useRef(false);
  const [isOverlayDismissed, setIsOverlayDismissed] = useState(false);

  // PHASE 3.3: Circuit breaker for infinite re-render loop prevention
  const MAX_FORCE_RERENDER_ATTEMPTS = 3;
  const forceRerenderAttemptsRef = useRef(0);
  const forceRerenderBackoffRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Use the canvas lifecycle hook for atomic initialization and cleanup
  const { initializeCanvas, disposeCanvas } = useCanvasLifecycle(canvasRef, containerRef);

  useEffect(() => {
    if (!fabricCanvas) return;
    const pendingSize = useCanvasStore.getState().consumePendingSize();
    if (!pendingSize) return;
    resizeCanvas(pendingSize.width, pendingSize.height);
  }, [fabricCanvas]);

  // Canvas frame styling is now handled by CSS .canvas-wrapper class

  const updateViewportState = useCallback((nextCanvas: fabric.Canvas) => {
    const vpt = nextCanvas.viewportTransform;
    if (vpt) {
      setVpt([...vpt]);
    }
    if (containerRef.current && canvasRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const canvasRect = canvasRef.current.getBoundingClientRect();
      const nextOffset = {
        x: canvasRect.left - containerRect.left,
        y: canvasRect.top - containerRect.top,
      };
      if (
        Math.abs(nextOffset.x - canvasOffsetRef.current.x) >= 1.0  // Increased threshold to 1px
        || Math.abs(nextOffset.y - canvasOffsetRef.current.y) >= 1.0
      ) {
        canvasOffsetRef.current = nextOffset;
        // Use unitScale from store for conversion (keeping consistent with existing approach)
        const scaledOffset = {
          x: nextOffset.x * unitScale,
          y: nextOffset.y * unitScale,
        };
        setCanvasOffset(scaledOffset);
        nextCanvas.calcOffset();
      }
    }
  }, [setCanvasOffset, setVpt]);

  useEffect(() => {
    if (!fabricCanvas || !containerRef.current || didInitialViewportFitRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;

    didInitialViewportFitRef.current = true;
    requestAnimationFrame(() => {
      fitCanvasToViewport(rect.width, rect.height);
      updateViewportState(fabricCanvas);
    });
  }, [fabricCanvas, updateViewportState]);

  const scheduleUpdate = useCallback((
    targetCanvas?: fabric.Canvas | null,
    options?: { persist?: boolean; activate?: boolean }
  ) => {
    const nextCanvas = targetCanvas ?? fabricCanvas;
    if (!nextCanvas) return;
    const shouldPersist = !!options?.persist;

    // PHASE 2.3: Counter-based persistence - increment instead of setting boolean
    if (shouldPersist) {
      if (persistCountRef.current === 0) {
        useEditorStore.getState().startBatch();
      }
      persistCountRef.current += 1;
    }

    // Use the FrameScheduler to schedule the update
    frameScheduler.schedule({
      callback: () => {
        updateScheduledRef.current = false;
        updateRafRef.current = null;
        syncCanvasToStore(nextCanvas);
        updateViewportState(nextCanvas);
        nextCanvas.requestRenderAll();

        // PHASE 2.3: Counter-based persistence - reset counter and persist if > 0
        if (persistCountRef.current > 0) {
          persistCountRef.current = 0;
          useEditorStore.getState().endBatch();
        }
      },
      priority: TaskPriority.REQUEST_RENDER,
    });
  }, [fabricCanvas, syncCanvasToStore, updateViewportState]);

  const addObjectToCanvas = useCallback((
    canvas: fabric.Canvas,
    obj: fabric.Object,
    options?: { persist?: boolean; activate?: boolean }
  ) => {
    canvas.add(obj);
    if (options?.activate ?? true) {
      canvas.setActiveObject(obj);
    }
    scheduleUpdate(canvas, options);
  }, [scheduleUpdate]);

  const scheduleViewportUpdate = useCallback((targetCanvas?: fabric.Canvas | null) => {
    const nextCanvas = targetCanvas ?? fabricCanvas;
    if (!nextCanvas) return;

    // Use the FrameScheduler to schedule the viewport update
    frameScheduler.schedule({
      callback: () => {
        viewportScheduledRef.current = false;
        viewportRafRef.current = null;
        updateViewportState(nextCanvas);
      },
      priority: TaskPriority.UPDATE_VIEWPORT,
    });
  }, [fabricCanvas, updateViewportState]);

  const getViewportBounds = useCallback((canvas: fabric.Canvas) => {
    const vpt = canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0];
    const zoom = canvas.getZoom() || 1;
    const viewWidth = canvas.getWidth() / zoom;
    const viewHeight = canvas.getHeight() / zoom;
    const left = -vpt[4] / zoom;
    const top = -vpt[5] / zoom;
    return {
      left,
      top,
      right: left + viewWidth,
      bottom: top + viewHeight,
    };
  }, []);

  const getObjectsBounds = useCallback((objects: fabric.Object[]) => {
    if (objects.length === 0) return null;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    objects.forEach((obj) => {
      const rect = obj.getBoundingRect();
      minX = Math.min(minX, rect.left);
      minY = Math.min(minY, rect.top);
      maxX = Math.max(maxX, rect.left + rect.width);
      maxY = Math.max(maxY, rect.top + rect.height);
    });
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
    return {
      left: minX,
      top: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };
  }, []);

  const focusObjectsInView = useCallback(
    (canvas: fabric.Canvas, objects: fabric.Object[]) => {
      const bounds = getObjectsBounds(objects);
      if (!bounds) return;
      const padding = 40;
      const width = canvas.getWidth();
      const height = canvas.getHeight();
      if (!width || !height) return;
      const zoomX = width / (bounds.width + padding * 2);
      const zoomY = height / (bounds.height + padding * 2);
      const nextZoom = Math.min(1, zoomX, zoomY);
      const centerX = bounds.left + bounds.width / 2;
      const centerY = bounds.top + bounds.height / 2;
      const vpt = canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0];
      vpt[0] = nextZoom;
      vpt[3] = nextZoom;
      vpt[4] = width / 2 - centerX * nextZoom;
      vpt[5] = height / 2 - centerY * nextZoom;
      canvas.setViewportTransform(vpt);
      canvas.requestRenderAll();
      setZoom(nextZoom);
      setVpt([...vpt]);
    },
    [getObjectsBounds, setVpt, setZoom]
  );

  const areObjectsInView = useCallback((canvas: fabric.Canvas, objects: fabric.Object[]) => {
    if (objects.length === 0) return true;
    const viewport = getViewportBounds(canvas);
    return objects.some((obj) => {
      const rect = obj.getBoundingRect();
      return !(
        rect.left + rect.width < viewport.left
        || rect.left > viewport.right
        || rect.top + rect.height < viewport.top
        || rect.top > viewport.bottom
      );
    });
  }, [getViewportBounds]);

  const forceRerenderCanvas = useCallback(() => {
    if (!fabricCanvas) return;
    const orderedObjects = layers
      .map((layer) => layersById[layer.id])
      .filter((obj): obj is fabric.Object => !!obj);
    const background = fabricCanvas.backgroundColor;
    const backgroundImage = fabricCanvas.backgroundImage;
    fabricCanvas.discardActiveObject();
    fabricCanvas.clear();
    if (background !== undefined) {
      fabricCanvas.backgroundColor = background;
    }
    if (backgroundImage) {
      fabricCanvas.backgroundImage = backgroundImage;
    }
    orderedObjects.forEach((obj) => {
      addObjectToCanvas(fabricCanvas, obj, { activate: false });
      obj.setCoords();
    });
    updateGuides(fabricCanvas, showGuides);
    fabricCanvas.calcOffset();
    fabricCanvas.requestRenderAll();
    if (!areObjectsInView(fabricCanvas, orderedObjects)) {
      focusObjectsInView(fabricCanvas, orderedObjects);
    }
    scheduleUpdate(fabricCanvas);
  }, [areObjectsInView, fabricCanvas, layers, layersById, showGuides, focusObjectsInView]);

  // PHASE 3.1: Use guideRegistry for bulletproof guide filtering
  const isCanvasInSync = useCallback(() => {
    if (!fabricCanvas) return true;
    const canvasIds = new Set(
      guideRegistry.filterNonGuides(fabricCanvas.getObjects())
        .map((obj) => (obj as any).id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    );
    const storeIds = Object.keys(layersById).filter((id) => id);
    if (storeIds.length === 0) return true;
    if (canvasIds.size === 0) return false;
    return storeIds.every((id) => canvasIds.has(id));
  }, [fabricCanvas, layersById]);

  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    snapEnabledRef.current = snapEnabled;
  }, [snapEnabled]);

  useEffect(() => {
    const win = window as unknown as { __forceCanvasRerender?: () => void };
    win.__forceCanvasRerender = forceRerenderCanvas;
    return () => {
      if (win.__forceCanvasRerender === forceRerenderCanvas) {
        delete win.__forceCanvasRerender;
      }
    };
  }, [forceRerenderCanvas]);

  // PHASE 3.3: Canvas sync check with circuit breaker
  useEffect(() => {
    if (!fabricCanvas) return;
    const hasLayers = Object.keys(layersById).length > 0;
    if (!hasLayers) {
      viewportRecoveryAttemptsRef.current = 0;
      didForceRerenderRef.current = false;
      forceRerenderAttemptsRef.current = 0; // Reset circuit breaker
      setSyncError(null);
      return;
    }

    if (!isCanvasInSync()) {
      // Circuit breaker: prevent infinite loops
      forceRerenderAttemptsRef.current += 1;

      if (forceRerenderAttemptsRef.current > MAX_FORCE_RERENDER_ATTEMPTS) {
        console.error('[CIRCUIT BREAKER] Canvas sync failed after', MAX_FORCE_RERENDER_ATTEMPTS, 'attempts. Manual intervention required.');
        setSyncError('Canvas synchronization failed. Please save your work and reload the page.');
        return;
      }

      if (didForceRerenderRef.current) return;
      didForceRerenderRef.current = true;

      // Exponential backoff: 0ms, 100ms, 500ms
      const backoffDelay = forceRerenderAttemptsRef.current === 1
        ? 0
        : 100 * Math.pow(5, forceRerenderAttemptsRef.current - 2);

      // Clear any pending backoff timeout
      if (forceRerenderBackoffRef.current) {
        clearTimeout(forceRerenderBackoffRef.current);
      }

      forceRerenderBackoffRef.current = setTimeout(() => {
        forceRerenderBackoffRef.current = null;
        forceRerenderCanvas();
      }, backoffDelay);

      return;
    }

    // Success - reset circuit breaker counter
    forceRerenderAttemptsRef.current = 0;
    didForceRerenderRef.current = false;
    setSyncError(null);
  }, [fabricCanvas, forceRerenderCanvas, isCanvasInSync, layersById]);

  // Cleanup backoff timeout on unmount
  useEffect(() => {
    return () => {
      if (forceRerenderBackoffRef.current) {
        clearTimeout(forceRerenderBackoffRef.current);
        forceRerenderBackoffRef.current = null;
      }
    };
  }, []);

  // PHASE 3.4: Improved viewport recovery with smarter off-screen detection
  // Only auto-focus if ALL objects are COMPLETELY off-screen
  // Don't fight with the user if they intentionally panned away
  useEffect(() => {
    if (!fabricCanvas) return;
    const objects = guideRegistry.filterNonGuides(fabricCanvas.getObjects());
    if (objects.length === 0) {
      viewportRecoveryAttemptsRef.current = 0;
      return;
    }

    // Check if ANY objects are at least partially visible
    const hasAnyVisibleObject = areObjectsInView(fabricCanvas, objects);

    if (hasAnyVisibleObject) {
      // At least one object is visible - no recovery needed
      viewportRecoveryAttemptsRef.current = 0;
      return;
    }

    // All objects are off-screen - check if COMPLETELY off-screen
    const viewport = getViewportBounds(fabricCanvas);
    const objectBounds = getObjectsBounds(objects);

    if (!objectBounds) {
      viewportRecoveryAttemptsRef.current = 0;
      return;
    }

    // Calculate if objects are COMPLETELY off-screen (no overlap at all)
    const completelyOffScreen = (
      objectBounds.left + objectBounds.width < viewport.left ||
      objectBounds.left > viewport.right ||
      objectBounds.top + objectBounds.height < viewport.top ||
      objectBounds.top > viewport.bottom
    );

    if (completelyOffScreen && viewportRecoveryAttemptsRef.current < 2) {
      viewportRecoveryAttemptsRef.current += 1;
      // Only auto-focus on first mount or after canvas changes
      // Don't repeatedly try if user has panned away
      if (viewportRecoveryAttemptsRef.current === 1) {
        focusObjectsInView(fabricCanvas, objects);
      }
    }
  }, [areObjectsInView, fabricCanvas, layers, focusObjectsInView, getViewportBounds, getObjectsBounds]);

  useEffect(() => {
    if (layers.length > 0) {
      setShowOnboarding(false);
    }
  }, [layers, setShowOnboarding]);

  // Safe Zone Overlay Effect
  useEffect(() => {
    if (!fabricCanvas) return;

    const addSafeZoneOverlay = () => {
      // Remove existing safe zone overlay if it exists
      const existingOverlays = fabricCanvas.getObjects().filter(obj => (obj as any).isSafeZoneOverlay);
      existingOverlays.forEach(overlay => fabricCanvas.remove(overlay));

      if (!showSafeZones) {
        fabricCanvas.requestRenderAll();
        return;
      }

      // Calculate safe zone dimensions
      const canvasWidth = fabricCanvas.getWidth();
      const canvasHeight = fabricCanvas.getHeight();

      // Create four rectangles for the safe zone borders
      const overlays = [];

      // Top rectangle (above safe area)
      const topOverlay = new fabric.Rect({
        left: 0,
        top: 0,
        width: canvasWidth,
        height: bleedPx,
        fill: 'rgba(255, 0, 0, 0.2)', // Semi-transparent red
        selectable: false,
        evented: false,
        isSafeZoneOverlay: true,
      });
      overlays.push(topOverlay);

      // Bottom rectangle (below safe area)
      const bottomOverlay = new fabric.Rect({
        left: 0,
        top: canvasHeight - bleedPx,
        width: canvasWidth,
        height: bleedPx,
        fill: 'rgba(255, 0, 0, 0.2)', // Semi-transparent red
        selectable: false,
        evented: false,
        isSafeZoneOverlay: true,
      });
      overlays.push(bottomOverlay);

      // Left rectangle (left of safe area)
      const leftOverlay = new fabric.Rect({
        left: 0,
        top: bleedPx,
        width: bleedPx,
        height: canvasHeight - 2 * bleedPx,
        fill: 'rgba(255, 0, 0, 0.2)', // Semi-transparent red
        selectable: false,
        evented: false,
        isSafeZoneOverlay: true,
      });
      overlays.push(leftOverlay);

      // Right rectangle (right of safe area)
      const rightOverlay = new fabric.Rect({
        left: canvasWidth - bleedPx,
        top: bleedPx,
        width: bleedPx,
        height: canvasHeight - 2 * bleedPx,
        fill: 'rgba(255, 0, 0, 0.2)', // Semi-transparent red
        selectable: false,
        evented: false,
        isSafeZoneOverlay: true,
      });
      overlays.push(rightOverlay);

      // Add all overlays to canvas
      overlays.forEach(overlay => fabricCanvas.add(overlay));
      fabricCanvas.renderAll();
    };

    addSafeZoneOverlay();

    // Return cleanup function
    return () => {
      if (fabricCanvas) {
        // Remove existing safe zone overlay if it exists
        const existingOverlays = fabricCanvas.getObjects().filter(obj => (obj as any).isSafeZoneOverlay);
        existingOverlays.forEach(overlay => fabricCanvas.remove(overlay));
        fabricCanvas.renderAll();
      }
    };
  }, [fabricCanvas, showSafeZones, bleedPx]);

  // Document Paper Cleanup - Clears paper rect when canvas is disposed
  useEffect(() => {
    if (!fabricCanvas) return;

    return () => {
      if (fabricCanvas) {
        clearDocumentPaper(fabricCanvas);
      }
    };
  }, [fabricCanvas]);

  const trackPromise = <T,>(promise: Promise<T>, abortSignal?: AbortSignal) => {
    pendingPromisesRef.current.add(promise);
    promise.finally(() => pendingPromisesRef.current.delete(promise));

    // If aborted, return a rejected promise immediately
    if (abortSignal?.aborted) {
      return Promise.reject(new Error('Operation aborted'));
    }

    return promise;
  };

  const applyDrawingBrush = (canvas: fabric.Canvas, tool: 'draw' | 'erase') => {
    if (tool === 'erase') {
      const fallbackBrush = new fabric.PencilBrush(canvas);
      (fallbackBrush as any).globalCompositeOperation = 'destination-out';
      fallbackBrush.color = '#000000';
      fallbackBrush.width = brushSize;
      canvas.freeDrawingBrush = fallbackBrush;
      return;
    }

    const pencilBrush = new fabric.PencilBrush(canvas);
    pencilBrush.color = brushColor;
    pencilBrush.width = brushSize;
    canvas.freeDrawingBrush = pencilBrush;
  };

  // Setup function that registers all canvas event handlers using the canvas event service
  // This is passed to the lifecycle hook for atomic initialization
  const setupCanvasHandlers = useCallback((canvas: fabric.Canvas, abortSignal: AbortSignal) => {
    if (!containerRef.current) return null;
    const container = containerRef.current;

    // Check for early abort
    if (abortSignal.aborted) return null;

    // Register layer sync handler BEFORE setting canvas in store
    setLayerSyncHandler(() => scheduleUpdate(canvas));
    scheduleUpdate(canvas);
    dirtyObjects.clear();
    setDirtyObjectsRef(dirtyObjects);

    // Register all canvas event handlers using the service
    const eventRegistry = registerAllCanvasEventHandlers({
      canvas,
      container,
      abortSignal,
      callbacks: {
        onUpdate: scheduleUpdate,
        onHistoryDirty: markHistoryDirty,
        onSelectedObjectId: setSelectedObjectId,
        onSelectedLayerIds: setSelectedLayerIds,
        onZoom: setZoom,
        onViewportChange: scheduleViewportUpdate,
      },
      refs: {
        activeTool: activeToolRef,
        isSpacebarDown: isSpacebarDownRef,
        isPanning: isPanningRef,
        lastPosX: lastPosXRef,
        lastPosY: lastPosYRef,
      },
      config: {
        snapEnabled,
        gridEnabled,
      },
    });

    // Return cleanup function that will be called by the lifecycle hook
    return () => {
      // Clean up pending promises
      const pendingPromises = Array.from(pendingPromisesRef.current);
      pendingPromises.forEach((promise) => {
        promise.catch((error) => {
          const message = error instanceof Error ? error.message.toLowerCase() : '';
          if (message.includes('aborted')) return;
        });
      });

      // Clean up guides and clear the guide registry
      updateGuides(canvas, false);
      guideRegistry.clear(); // PHASE 3.1: Clear guide registry on dispose

      // Clean up animation frame
      if (updateRafRef.current !== null) {
        cancelAnimationFrame(updateRafRef.current);
        updateRafRef.current = null;
        updateScheduledRef.current = false;

        // PHASE 2.3: Counter-based persistence cleanup
        if (persistCountRef.current > 0) {
          persistCountRef.current = 0;
          useEditorStore.getState().endBatch();
        }
      }
      if (viewportRafRef.current !== null) {
        cancelAnimationFrame(viewportRafRef.current);
        viewportRafRef.current = null;
        viewportScheduledRef.current = false;
      }

      // Clean up the FrameScheduler
      frameScheduler.cancel();

      // Clean up all event handlers using the registry
      eventRegistry.cleanupAll();
      setDirtyObjectsRef(null);
    };
  }, [
    scheduleUpdate,
    setLayerSyncHandler,
    markHistoryDirty,
    setSelectedObjectId,
    setSelectedLayerIds,
    setZoom,
    snapEnabled,
    gridEnabled,
    setDirtyObjectsRef,
  ]);

  // Main initialization effect using the lifecycle hook
  // IMPORTANT: This should only run ONCE on mount, not when setupCanvasHandlers changes
  useEffect(() => {
    let canvasInstance: fabric.Canvas | null = null;
    let cleanupHandlers: (() => void) | null = null;
    let abortController: AbortController | null = null;

    const init = async () => {
      const result = await initializeCanvas(setupCanvasHandlers);
      if (result) {
        canvasInstance = result.canvas;
        cleanupHandlers = result.cleanup;
        abortController = result.abortController;
      }
    };

    void init();

    return () => {
      if (canvasInstance) {
        void disposeCanvas(canvasInstance, cleanupHandlers, abortController);
      }
    };
  }, [initializeCanvas, disposeCanvas]);

  useEffect(() => {
    if (!fabricCanvas) return;
    const paperColor =
      canvasBackgroundColor
      || resolveThemeValue(themeData, 'surfaces.page-background')
      || DEFAULT_CANVAS_BACKGROUND; // Use the defined default background

    // Set canvas background to transparent so workspace shows through
    fabricCanvas.backgroundColor = 'transparent';

    // Create/update the document paper rectangle with the background color
    // This ensures only the document area has the background color
    updateDocumentPaper(fabricCanvas, paperColor);

    updateGuides(fabricCanvas, showGuides);
    fabricCanvas.requestRenderAll();
  }, [fabricCanvas, themeData, bleedPx, canvasBackgroundColor, showGuides, docWidth, docHeight]);

  // Update CoordinateSystem when unit mode changes
  const { unitMode } = useEditorStore(
    (state) => ({ unitMode: state.unitMode }),
    shallow
  );

  useEffect(() => {
    try {
      coordinateSystem.setMode(unitMode);
    } catch (error) {
      console.error('Error setting unit mode in CoordinateSystem:', error);
    }
  }, [unitMode]);

  useEffect(() => {
    if (!fabricCanvas) return;
    const tool = activeTool;
    const isDrawing = tool === 'draw' || tool === 'erase';
    fabricCanvas.isDrawingMode = isDrawing;
    fabricCanvas.selection = tool === 'select';
    fabricCanvas.skipTargetFind = tool !== 'select' && tool !== 'textbox';

    if (tool === 'pan') {
      fabricCanvas.defaultCursor = 'grab';
      fabricCanvas.hoverCursor = 'grab';
    } else if (tool === 'draw' || tool === 'erase') {
      fabricCanvas.defaultCursor = 'crosshair';
      fabricCanvas.hoverCursor = 'crosshair';
    } else if (tool === 'textbox') {
      fabricCanvas.defaultCursor = 'crosshair';
      fabricCanvas.hoverCursor = 'crosshair';
    } else {
      fabricCanvas.defaultCursor = 'crosshair';
      fabricCanvas.hoverCursor = 'move';
    }

    if (isDrawing) {
      applyDrawingBrush(fabricCanvas, tool === 'erase' ? 'erase' : 'draw');
    }
  }, [fabricCanvas, activeTool, brushColor, brushSize]);

  // Update CoordinateSystem when zoom changes
  const { zoom } = useEditorStore(
    (state) => ({ zoom: state.zoom }),
    shallow
  );

  useEffect(() => {
    coordinateSystem.setZoom(zoom);
  }, [zoom]);

  useEffect(() => {
    if (!fabricCanvas) return;
    (fabricCanvas as any).snapToGrid = snapEnabled;
  }, [fabricCanvas, snapEnabled]);

  const clearPlaceholderHighlight = () => {
    const current = placeholderHighlightRef.current;
    if (!current || !fabricCanvas) return;
    current.obj.set('shadow', current.shadow || undefined);
    placeholderHighlightRef.current = null;
    fabricCanvas.requestRenderAll();
  };

  const setPlaceholderHighlight = (placeholder: fabric.Object | null) => {
    if (!fabricCanvas) return;
    if (placeholderHighlightRef.current?.obj === placeholder) return;
    clearPlaceholderHighlight();
    if (!placeholder) return;

    const previousShadow = (placeholder.shadow as fabric.Shadow | null) ?? null;
    placeholder.set(
      'shadow',
      new fabric.Shadow({
        color: 'rgba(253, 224, 71, 0.55)',
        blur: 18,
        offsetX: 0,
        offsetY: 0,
      })
    );
    placeholderHighlightRef.current = { obj: placeholder, shadow: previousShadow };
    if (placeholder.group) {
      (placeholder.group as any).dirty = true;
    }
    fabricCanvas.requestRenderAll();
  };

  const clearFrameHighlight = () => {
    const current = frameHighlightRef.current;
    if (!current || !fabricCanvas) return;
    current.obj.set({
      fill: current.originalFill,
      opacity: current.originalOpacity,
    });
    frameHighlightRef.current = null;
    fabricCanvas.requestRenderAll();
  };

  const setFrameHighlight = (frame: fabric.Object | null) => {
    if (!fabricCanvas) return;
    if (frameHighlightRef.current?.obj === frame) return;
    clearFrameHighlight();
    if (!frame) return;

    const originalFill = frame.fill;
    const originalOpacity = frame.opacity ?? 1;

    // Apply highlight effect - change fill to a brighter version or add glow
    frame.set({
      fill: 'rgba(128, 0, 128, 0.5)', // Purple semi-transparent fill
      opacity: 0.8,
    });

    frameHighlightRef.current = { obj: frame, originalFill, originalOpacity };
    if (frame.group) {
      (frame.group as any).dirty = true;
    }
    fabricCanvas.requestRenderAll();
  };

  const findPlaceholderAtPointer = (pointer: fabric.Point) => {
    if (!fabricCanvas) return null;
    const objects = fabricCanvas.getObjects().slice().reverse();

    const findInObject = (obj: fabric.Object): fabric.Object | null => {
      if ((obj as any).isPlaceholder && obj.containsPoint(pointer)) {
        return obj;
      }
      if (obj.type === 'group' || obj.type === 'activeSelection') {
        const children = (obj as fabric.Group).getObjects().slice().reverse();
        for (const child of children) {
          const found = findInObject(child);
          if (found) return found;
        }
      }
      return null;
    };

    for (const obj of objects) {
      const found = findInObject(obj);
      if (found) return found;
    }
    return null;
  };

  const findFrameAtPointer = (pointer: fabric.Point) => {
    if (!fabricCanvas) return null;
    const objects = fabricCanvas.getObjects().slice().reverse();

    const findInObject = (obj: fabric.Object): fabric.Object | null => {
      if ((obj as any).isFrame && obj.containsPoint(pointer)) {
        return obj;
      }
      if (obj.type === 'group' || obj.type === 'activeSelection') {
        const children = (obj as fabric.Group).getObjects().slice().reverse();
        for (const child of children) {
          const found = findInObject(child);
          if (found) return found;
        }
      }
      return null;
    };

    for (const obj of objects) {
      const found = findInObject(obj);
      if (found) return found;
    }
    return null;
  };

  const resolveFrameType = (placeholder: fabric.Object) => {
    const rawType = (placeholder as any).frameType;
    if (rawType === 'circle' || rawType === 'star' || rawType === 'hexagon' || rawType === 'badge') {
      return rawType;
    }
    if (placeholder.type === 'circle') return 'circle';
    if (placeholder.type === 'polygon') {
      const points = (placeholder as fabric.Polygon).points ?? [];
      if (points.length === 6) return 'hexagon';
      if (points.length === 10) return 'star';
      if (points.length >= 12) return 'badge';
    }
    return null;
  };

  const buildRegularPolygonPoints = (sides: number, radius: number) => {
    const points = [];
    const step = (Math.PI * 2) / sides;
    const startAngle = -Math.PI / 2;
    for (let i = 0; i < sides; i += 1) {
      const angle = startAngle + step * i;
      points.push({
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
      });
    }
    return points;
  };

  const buildStarPoints = (points: number, outerRadius: number, innerRadius: number) => {
    const result = [];
    const totalPoints = points * 2;
    const step = (Math.PI * 2) / totalPoints;
    const startAngle = -Math.PI / 2;
    for (let i = 0; i < totalPoints; i += 1) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = startAngle + step * i;
      result.push({
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
      });
    }
    return result;
  };

  const createFrameClipPath = (
    frameType: ReturnType<typeof resolveFrameType>,
    clipWidth: number,
    clipHeight: number,
    angle: number
  ) => {
    const radius = Math.min(clipWidth, clipHeight) / 2;
    if (frameType === 'circle') {
      return new fabric.Circle({
        radius,
        left: 0,
        top: 0,
        originX: 'center',
        originY: 'center',
        angle,
      });
    }
    if (frameType === 'hexagon') {
      return new fabric.Polygon(buildRegularPolygonPoints(6, radius), {
        left: 0,
        top: 0,
        originX: 'center',
        originY: 'center',
        angle,
      });
    }
    if (frameType === 'star') {
      return new fabric.Polygon(buildStarPoints(5, radius, radius * 0.5), {
        left: 0,
        top: 0,
        originX: 'center',
        originY: 'center',
        angle,
      });
    }
    if (frameType === 'badge') {
      return new fabric.Polygon(buildStarPoints(12, radius, radius * 0.82), {
        left: 0,
        top: 0,
        originX: 'center',
        originY: 'center',
        angle,
      });
    }
    return new fabric.Rect({
      width: clipWidth,
      height: clipHeight,
      left: 0,
      top: 0,
      originX: 'center',
      originY: 'center',
      angle,
    });
  };

  const replacePlaceholderWithImage = (
    canvas: fabric.Canvas,
    placeholder: fabric.Object,
    img: fabric.FabricImage,
    options?: { persist?: boolean }
  ) => {
    const center = placeholder.getCenterPoint();
    const angle = placeholder.angle || 0;
    const bounds = placeholder.getBoundingRect();
    const boxWidth = bounds.width;
    const boxHeight = bounds.height;
    const group = placeholder.group as fabric.Group | undefined;
    const groupScaleX = group?.scaleX ?? 1;
    const groupScaleY = group?.scaleY ?? 1;

    // Calculate aspect fill (cover) scaling - ensure image fills the entire frame
    const imgWidth = img.width || 1;
    const imgHeight = img.height || 1;

    // Calculate scale to cover the entire frame (aspect fill)
    const scaleX = boxWidth / imgWidth;
    const scaleY = boxHeight / imgHeight;
    const scale = Math.max(scaleX, scaleY); // Use max to ensure coverage

    const clipWidth = boxWidth / (scale * groupScaleX);
    const clipHeight = boxHeight / (scale * groupScaleY);

    let left = center.x;
    let top = center.y;
    if (group) {
      const inverseGroup = fabric.util.invertTransform(group.calcTransformMatrix());
      const localPoint = fabric.util.transformPoint(center, inverseGroup);
      left = localPoint.x;
      top = localPoint.y;
    }

    img.set({
      left,
      top,
      originX: 'center',
      originY: 'center',
      scaleX: scale,
      scaleY: scale,
      angle,
      id: (placeholder as any).id ?? uuidv4(),
      tokenRole: (placeholder as any).tokenRole ?? null,
      colorLocked: (placeholder as any).colorLocked ?? false,
    });

    const frameType = resolveFrameType(placeholder);
    img.clipPath = createFrameClipPath(frameType, clipWidth, clipHeight, angle);

    if (group) {
      const groupAny = group as any;
      const groupIndex = group.getObjects().indexOf(placeholder);
      group.remove(placeholder);
      group.add(img);
      if (groupIndex >= 0 && typeof groupAny.moveObjectTo === 'function') {
        groupAny.moveObjectTo(img, groupIndex);
      }
      if (typeof groupAny.addWithUpdate === 'function') {
        groupAny.addWithUpdate();
      }
    } else {
      const placeholderIndex = canvas.getObjects().indexOf(placeholder);
      canvas.remove(placeholder);
      addObjectToCanvas(canvas, img, options);
      if (placeholderIndex >= 0) {
        canvas.moveObjectTo(img, placeholderIndex);
      }
    }
    scheduleUpdate(canvas, options);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!fabricCanvas) return;
    const imageUrl = e.dataTransfer.getData('text/plain');
    if (!imageUrl) {
      clearPlaceholderHighlight();
      clearFrameHighlight();
      return;
    }
    const pointer = fabricCanvas.getPointer(e.nativeEvent as MouseEvent);
    const placeholder = findPlaceholderAtPointer(pointer);

    // Check if the dragged item is hovering over a frame
    const frameAtPointer = findFrameAtPointer(pointer);

    if (frameAtPointer) {
      // Highlight the frame
      setFrameHighlight(frameAtPointer);
      // Clear placeholder highlight since we're highlighting a frame instead
      clearPlaceholderHighlight();
    } else {
      // Highlight placeholder as before
      setPlaceholderHighlight(placeholder);
      // Clear frame highlight if no frame is detected
      clearFrameHighlight();
    }
  };

  const handleDragLeave = () => {
    clearPlaceholderHighlight();
    clearFrameHighlight();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setShowOnboarding(false);
    const imageUrl = e.dataTransfer.getData('text/plain');
    const isSticker = e.dataTransfer.getData('isSticker') === 'true';

    if (!fabricCanvas) return;

    if (!imageUrl) {
      const file = e.dataTransfer.files?.[0];
      if (!file) {
        clearPlaceholderHighlight();
        clearFrameHighlight();
        return;
      }
      clearPlaceholderHighlight();
      clearFrameHighlight();
      const pointer = fabricCanvas.getPointer(e.nativeEvent as MouseEvent);

      trackPromise(loadImageFromFile(file))
        .then((result) => {
          if (!result.success) {
            console.error('Failed to load dropped image:', result.errorMessage);
            return;
          }

          const id = result.id;
          result.asset.set({
            id,
            src: result.blobUrl,
            left: pointer.x,
            top: pointer.y,
            originX: 'center',
            originY: 'center',
          });
          addImageAsset(id, result.blobUrl!);
          addObjectToCanvas(fabricCanvas, result.asset, { persist: true });
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message.toLowerCase() : '';
          if (!message.includes('aborted')) {
            console.error('Error loading dropped image:', error);
          }
        });
      return;
    }
    clearPlaceholderHighlight();
    clearFrameHighlight();

    const pointer = fabricCanvas.getPointer(e.nativeEvent as MouseEvent);
    const placeholder = findPlaceholderAtPointer(pointer);
    const targetObject = fabricCanvas.getObjects().find(obj =>
      obj.containsPoint(pointer) && obj.type === 'image'
    ) as fabric.Image;

    trackPromise(safeLoadImage(imageUrl, { crossOrigin: 'anonymous' }))
      .then((result) => {
        if (!result.success) {
          const message = result.errorMessage.toLowerCase();
          if (!message.includes('aborted')) {
            console.error('Failed to load image:', result.errorMessage);
          }
          return;
        }

        const img = result.asset;

        if (placeholder) {
            replacePlaceholderWithImage(fabricCanvas, placeholder, img, { persist: true });
        } else if (targetObject) {
            // Inherit settings from the target object
            img.set({
                left: targetObject.left,
                top: targetObject.top,
                scaleX: targetObject.scaleX,
                scaleY: targetObject.scaleY,
                angle: targetObject.angle,
                flipX: targetObject.flipX,
                flipY: targetObject.flipY,
                skewX: targetObject.skewX,
                skewY: targetObject.skewY,
                opacity: targetObject.opacity,
                id: (targetObject as any).id,
                tokenRole: (targetObject as any).tokenRole,
                colorLocked: (targetObject as any).colorLocked,
                filters: targetObject.filters,
            });
            img.applyFilters();
            fabricCanvas.remove(targetObject);
            addObjectToCanvas(fabricCanvas, img, { persist: true });
        } else {
            const maxWidth = isSticker ? 150 : 200;
            if (img.width! > maxWidth) {
                img.scaleToWidth(maxWidth);
            }
            img.set({
                id: uuidv4(),
                tokenRole: 'brand.accent.value',
                colorLocked: false,
                left: pointer.x,
                top: pointer.y,
                originX: 'center',
                originY: 'center',
            });
            addObjectToCanvas(fabricCanvas, img, { persist: true });
        }
        scheduleUpdate(fabricCanvas, { persist: true });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        if (message.includes('aborted')) return;
        console.error('Error loading image:', error);
      });
  };

  const handleHearthUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setShowOnboarding(false);
    const file = e.target.files?.[0];

    if (file && fabricCanvas) {
      const result = await loadImageFromFile(file);

      if (!result.success) {
        console.error('Failed to load image:', result.errorMessage);
        if (uploadInputRef.current) uploadInputRef.current.value = '';
        return;
      }

      const id = result.id;
      result.asset.set({ id, src: result.blobUrl });
      addImageAsset(id, result.blobUrl!);
      addObjectToCanvas(fabricCanvas, result.asset, { persist: true });
      fabricCanvas.centerObject(result.asset);
      scheduleUpdate(fabricCanvas, { persist: true });
    }

    if (uploadInputRef.current) uploadInputRef.current.value = '';
  };

  const handleDismissOverlay = () => {
    if (!isOverlayDismissed) {
      setShowOnboarding(false);
      setIsOverlayDismissed(true);
    }
  };

  return (
    <div
      className="workspace relative w-full h-full flex items-center justify-center overflow-hidden"
      onClick={handleDismissOverlay}
    >
      <div
        ref={containerRef}
        className="w-full h-full overflow-hidden bg-transparent"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragLeave={handleDragLeave}
        onContextMenu={showContextMenu}
      >
        <canvas id="design-canvas" ref={canvasRef} />
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={hideContextMenu}
          />
        )}
      </div>
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/png, image/jpeg"
        onChange={handleHearthUpload}
        className="hidden"
      />
      {showOnboarding && !isOverlayDismissed && (
        <CanvasSizePicker
          onSelect={(width, height) => {
            resizeCanvas(width, height);
            // Fit canvas to viewport after a brief delay to ensure DOM is updated
            requestAnimationFrame(() => {
              if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                fitCanvasToViewport(rect.width, rect.height);
              }
            });
            setIsOverlayDismissed(true);
            setShowOnboarding(false);
          }}
          onDismiss={() => {
            // Default to US Letter and fit to viewport
            if (containerRef.current) {
              const rect = containerRef.current.getBoundingClientRect();
              fitCanvasToViewport(rect.width, rect.height);
            }
            setIsOverlayDismissed(true);
            setShowOnboarding(false);
          }}
        />
      )}
      {/* PHASE 3.3: Circuit breaker error notification */}
      {syncError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-50">
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-red-500/30 bg-white px-8 py-6 text-center shadow-xl max-w-md">
            <div className="flex items-center gap-2 text-red-600">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <h3 className="text-lg font-semibold">Canvas Synchronization Error</h3>
            </div>
            <p className="text-sm text-gray-600">{syncError}</p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  // Attempt to download project file for safety
                  useEditorStore.getState().downloadProjectFile();
                }}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Download Project
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-lg bg-gray-200 text-gray-800 text-sm font-medium hover:bg-gray-300 transition-colors"
              >
                Reload Page
              </button>
              <button
                onClick={() => {
                  setSyncError(null);
                  forceRerenderAttemptsRef.current = 0;
                }}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
