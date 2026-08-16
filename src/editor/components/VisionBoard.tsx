import React, { useCallback, useRef, useState, useEffect } from 'react';
import { shallow } from 'zustand/shallow';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Trash2,
  Palette,
  Layout,
  Pin,
  Grid3X3,
} from 'lucide-react';
import { useVisionBoardStore, useExtractedColors, useSortedItems, VisionItem } from '../state/visionBoardStore';
import { DEFAULT_CANVAS_BACKGROUND, useEditorStore } from '../state/editorStore';
import { useThemeStore } from '../state/useThemeStore';
import { captureCanvasState } from '../utils/serialization';
import { BoardItem } from './BoardItem';
import { loadCanvasFromJsonSafely } from '../fabric/initFabricCanvas';
import { withCanvasObjectMutationSuppressed } from '../services/canvasMutationObservation';

interface VisionBoardProps {
  onClose?: () => void;
}

export const VisionBoard: React.FC<VisionBoardProps> = ({ onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [showColorPalette, setShowColorPalette] = useState(false);

  // Vision Board Store
  const {
    selectedItemIds,
    zoom,
    panOffset,
    addItem,
    removeItem,
    removeItems,
    updatePosition,
    duplicateItem,
    selectItem,
    deselectAll,
    setZoom,
    setPanOffset,
    resetView,
  } = useVisionBoardStore(
    (state) => ({
      selectedItemIds: state.selectedItemIds,
      zoom: state.zoom,
      panOffset: state.panOffset,
      addItem: state.addItem,
      removeItem: state.removeItem,
      removeItems: state.removeItems,
      updatePosition: state.updatePosition,
      duplicateItem: state.duplicateItem,
      selectItem: state.selectItem,
      deselectAll: state.deselectAll,
      setZoom: state.setZoom,
      setPanOffset: state.setPanOffset,
      resetView: state.resetView,
    }),
    shallow
  );

  const sortedItems = useSortedItems();
  const extractedColors = useExtractedColors();
  const canvasBackgroundColor = useThemeStore((state) => state.canvasBackgroundColor);

  // Editor Store - for loading states and pinning current design
  const { canvas, setToastMessage } = useEditorStore(
    (state) => ({
      canvas: state.canvas,
      setToastMessage: state.setToastMessage,
    }),
    shallow
  );

  // Handle loading a design state back to canvas
  const handleLoadState = useCallback(
    (item: VisionItem) => {
      if (item.type !== 'design-state' || !canvas) return;

      void (async () => {
        try {
        const data = JSON.parse(item.canvasData);
        const objects = data.objects || [];

        const {
          clearSelection,
          setCanvasBackgroundColor,
          syncCanvasToStore,
          syncActivePageFromCanvas,
          saveState,
          reportCommittedCanvasPageContent,
        } = useEditorStore.getState();
        const beforeFingerprint = JSON.stringify({
          objects: useEditorStore.getState().canvasObjects,
          background: useThemeStore.getState().canvasBackgroundColor,
        });
        clearSelection();
        setCanvasBackgroundColor(typeof data.background === 'string' ? data.background : DEFAULT_CANVAS_BACKGROUND, { save: false });
        canvas.backgroundColor = 'transparent';

        if (objects.length > 0) {
          await loadCanvasFromJsonSafely(canvas, { objects });
          canvas.backgroundColor = 'transparent';
          canvas.requestRenderAll();
          syncCanvasToStore();
          setToastMessage(`Loaded: ${item.label || 'Design state'}`);
        } else {
          withCanvasObjectMutationSuppressed(canvas, () => canvas.clear());
          canvas.requestRenderAll();
          setToastMessage(`Loaded empty state: ${item.label || 'Design state'}`);
        }
        syncCanvasToStore(canvas);
        syncActivePageFromCanvas();
        saveState();
        reportCommittedCanvasPageContent(
          beforeFingerprint,
          JSON.stringify({
            objects: useEditorStore.getState().canvasObjects,
            background: useThemeStore.getState().canvasBackgroundColor,
          }),
        );
        } catch (error) {
          console.error('Failed to load design state:', error);
          setToastMessage('Failed to load design state');
        }
      })();
    },
    [canvas, setToastMessage]
  );

  // Handle double-click on items
  const handleItemDoubleClick = useCallback(
    (item: VisionItem) => {
      if (item.type === 'design-state') {
        handleLoadState(item);
      }
    },
    [handleLoadState]
  );

  // Pin current canvas state to board
  const handlePinCurrentDesign = useCallback(() => {
    if (!canvas) {
      setToastMessage('No canvas available');
      return;
    }

    const state = captureCanvasState(canvas, {
      thumbnailMaxSize: 400,
      thumbnailFormat: 'png',
      backgroundColor: canvasBackgroundColor || DEFAULT_CANVAS_BACKGROUND,
    });

    addItem({
      type: 'design-state',
      canvasData: state.canvasData,
      thumbnail: state.thumbnail,
      canvasSize: state.canvasSize,
      label: `Iteration ${new Date().toLocaleTimeString()}`,
      position: {
        x: Math.random() * 200 + 50,
        y: Math.random() * 200 + 50,
        width: 200,
        height: (200 * state.canvasSize.height) / state.canvasSize.width,
      },
    });

    setToastMessage('Design pinned to vision board');
  }, [canvas, canvasBackgroundColor, addItem, setToastMessage]);

  // Handle adding a color
  const handleAddColor = useCallback(
    (hex: string) => {
      addItem({
        type: 'color',
        hex,
        label: hex.toUpperCase(),
        source: 'manual',
        position: {
          x: Math.random() * 200 + 50,
          y: Math.random() * 200 + 50,
          width: 80,
          height: 80,
        },
      });
    },
    [addItem]
  );

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    setZoom(Math.min(zoom * 1.2, 5));
  }, [zoom, setZoom]);

  const handleZoomOut = useCallback(() => {
    setZoom(Math.max(zoom / 1.2, 0.1));
  }, [zoom, setZoom]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setZoom(Math.max(0.1, Math.min(5, zoom * delta)));
      } else {
        // Pan with scroll
        setPanOffset({
          x: panOffset.x - e.deltaX,
          y: panOffset.y - e.deltaY,
        });
      }
    },
    [zoom, panOffset, setZoom, setPanOffset]
  );

  // Pan with middle mouse or space+drag
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        e.preventDefault();
        setIsPanning(true);
        setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
      } else if (e.target === containerRef.current) {
        deselectAll();
      }
    },
    [panOffset, deselectAll]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning) {
        setPanOffset({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        });
      }
    },
    [isPanning, panStart, setPanOffset]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Handle position changes from BoardItem
  const handlePositionChange = useCallback(
    (id: string, x: number, y: number) => {
      updatePosition(id, { x, y });
    },
    [updatePosition]
  );

  // Delete selected items
  const handleDeleteSelected = useCallback(() => {
    if (selectedItemIds.length > 0) {
      removeItems(selectedItemIds);
    }
  }, [selectedItemIds, removeItems]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedItemIds.length > 0 && document.activeElement === document.body) {
          handleDeleteSelected();
        }
      }
      if (e.key === 'Escape') {
        deselectAll();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        useVisionBoardStore.getState().selectAll();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItemIds, handleDeleteSelected, deselectAll]);

  return (
    <div className="flex flex-col h-full bg-[color:var(--ui-bg)] text-[color:var(--ui-text)]">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[color:var(--ui-border)] bg-[color:var(--ui-panel)]">
        <div className="flex items-center gap-3">
          <Grid3X3 className="w-5 h-5 text-[color:var(--brand-primary)]" />
          <div>
            <h2 className="text-lg font-bold uppercase tracking-wider">Vision Board</h2>
            <p className="text-xs text-[color:var(--ui-panel-text)]">
              {sortedItems.length} items · {extractedColors.length} colors extracted
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Pin current design */}
          <button
            onClick={handlePinCurrentDesign}
            className="flex items-center gap-2 px-3 py-1.5 bg-[color:var(--brand-primary)] rounded-lg hover:opacity-90 transition-opacity text-sm"
            title="Pin current design"
          >
            <Pin className="w-4 h-4" />
            Pin Design
          </button>

          {/* Toggle color palette */}
          <button
            onClick={() => setShowColorPalette(!showColorPalette)}
            className={`p-2 rounded-lg transition-colors ${
              showColorPalette
                ? 'bg-[color:var(--brand-primary)] text-white'
                : 'bg-white/10 hover:bg-white/20'
            }`}
            title="Toggle color palette"
          >
            <Palette className="w-4 h-4" />
          </button>

          {/* Delete selected */}
          {selectedItemIds.length > 0 && (
            <button
              onClick={handleDeleteSelected}
              className="p-2 rounded-lg bg-red-500/20 hover:bg-red-500/40 text-red-400 transition-colors"
              title={`Delete ${selectedItemIds.length} selected`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          {/* Zoom controls */}
          <div className="flex items-center gap-1 ml-2 px-2 py-1 bg-white/10 rounded-lg">
            <button
              onClick={handleZoomOut}
              className="p-1 hover:bg-white/10 rounded transition-colors"
              title="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
            <button
              onClick={handleZoomIn}
              className="p-1 hover:bg-white/10 rounded transition-colors"
              title="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={resetView}
              className="p-1 hover:bg-white/10 rounded transition-colors ml-1"
              title="Reset view"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors ml-2"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Extracted Colors Palette */}
      {showColorPalette && extractedColors.length > 0 && (
        <div className="p-3 border-b border-[color:var(--ui-border)] bg-[color:var(--ui-panel)]/50">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-[color:var(--ui-panel-text)] mr-2">Extracted Colors:</span>
            {extractedColors.map((color) => (
              <button
                key={color}
                onClick={() => handleAddColor(color)}
                className="w-6 h-6 rounded-full border-2 border-white/20 hover:scale-110 transition-transform shadow-md"
                style={{ backgroundColor: color }}
                title={`Add ${color} to board`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Canvas Area */}
      <div
        ref={containerRef}
        className={`flex-1 overflow-hidden relative ${isPanning ? 'cursor-grabbing' : 'cursor-default'}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          backgroundImage: `
            radial-gradient(circle at 1px 1px, var(--ui-border) 1px, transparent 0)
          `,
          backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
          backgroundPosition: `${panOffset.x}px ${panOffset.y}px`,
        }}
      >
        {/* Transformed container for items */}
        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          {sortedItems.map((item) => (
            <BoardItem
              key={item.id}
              item={item}
              isSelected={selectedItemIds.includes(item.id)}
              zoom={zoom}
              onSelect={selectItem}
              onPositionChange={handlePositionChange}
              onDoubleClick={handleItemDoubleClick}
              onDelete={removeItem}
              onDuplicate={duplicateItem}
            />
          ))}
        </div>

        {/* Empty state */}
        {sortedItems.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <Grid3X3 className="mx-auto h-16 w-16 mb-4 opacity-20" />
              <h3 className="text-lg font-medium text-[color:var(--ui-panel-text)]">Your vision board is empty</h3>
              <p className="text-sm text-[color:var(--ui-panel-text)]/60 mt-1 max-w-xs">
                Pin designs, add images, or collect colors to build your mood board.
              </p>
              <button
                onClick={handlePinCurrentDesign}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-[color:var(--brand-primary)] rounded-lg hover:opacity-90 transition-opacity pointer-events-auto"
              >
                <Pin className="w-4 h-4" />
                Pin Current Design
              </button>
            </div>
          </div>
        )}

        {/* Coordinates indicator */}
        <div className="absolute bottom-4 left-4 px-2 py-1 bg-black/50 rounded text-xs text-white/70 font-mono">
          {Math.round(-panOffset.x / zoom)}, {Math.round(-panOffset.y / zoom)}
        </div>
      </div>

      {/* Quick add buttons */}
      <div className="absolute bottom-6 right-6 flex flex-col gap-2">
        <button
          onClick={handlePinCurrentDesign}
          className="p-3 rounded-full bg-[color:var(--brand-primary)] shadow-lg hover:scale-110 transition-transform"
          title="Pin current design"
        >
          <Layout className="w-5 h-5 text-white" />
        </button>
        <button
          onClick={() =>
            handleAddColor(
              '#' +
                Math.floor(Math.random() * 16777215)
                  .toString(16)
                  .padStart(6, '0')
            )
          }
          className="p-3 rounded-full bg-[color:var(--ui-panel)] border border-[color:var(--ui-border)] shadow-lg hover:scale-110 transition-transform"
          title="Add random color"
        >
          <Palette className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

export default VisionBoard;
