
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { shallow } from 'zustand/shallow';
import { CanvasSettingsPopover } from './CanvasSettingsPopover';
import {
  Layers,
  MousePointer2,
  Pencil,
  Eraser,
  Hand,
  PaintBucket,
  Magnet,
  Grid,
  SlidersHorizontal,
  Download,
  Home,
  Undo2,
  Redo2,
  Keyboard,
  Type,
  Frame,
  Search,
  FileText,
} from 'lucide-react';
import {
  getPendingInsertionCandidateIds,
  getPendingLayerSyncSelectionIds,
  useEditorStore,
  DEFAULT_CANVAS_BACKGROUND,
} from '../state/editorStore';
import { useCanUndo, useCanRedo } from '../state/useHistoryStore';
import { useThemeStore } from '../state/useThemeStore';
import { useCanvasStore } from '../state/useCanvasStore';
import { AssetLibrary } from './AssetLibrary';
import { BrandModal } from './BrandModal';
import { ExportModal } from './ExportModal';
import { LayersPanel } from './LayersPanel';
import { CanvasStage } from './CanvasStage';
import { CanvasRuler } from './CanvasRuler';
import { StatusBar } from './StatusBar';
import { Inserter } from './Inserter';
import { SettingsModal } from './SettingsModal';
import { ProjectPresetsModal } from './ProjectPresetsModal';
import { DesignSpaceImportModal } from './DesignSpaceImportModal';
import { Popover } from './Popover';
import { cleanupAssets } from '../services/assetLoader';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { SelectionToolbar } from './SelectionToolbar';
import { ProjectBrowser } from './ProjectBrowser';
import { PropertiesPanel } from './PropertiesPanel';
import { Tooltip } from './Tooltip';
import { KeyboardShortcutHelp } from './KeyboardShortcutHelp';
import { registerToastCallback } from '../utils/errorHandling';
import { SaveStatusBadge } from './SaveStatusBadge';
import { ProjectQuickOpenModal } from './ProjectQuickOpenModal';
import { PageStrip } from './PageStrip';
import { PageBorderPopover } from './PageBorderPopover';
import { FileDropdown } from './FileDropdown';
import { NavStrip, NAV_ITEMS, NavId } from './NavStrip';
import { ShapesPanel } from './ShapesPanel';

const ICON_SMALL = 'icon-muted w-4 h-4 stroke-[1.5]';
const CHROME_BUTTON = 'ui-button-soft group flex items-center gap-2 px-4 py-2 rounded-full text-[11px] uppercase tracking-widest';
const CHROME_ICON_BUTTON = 'ui-button-soft group flex items-center justify-center rounded-full p-2';
const TOOLBAR_GROUP = 'ui-toolbar-group flex items-center gap-1 rounded-full px-2 py-1.5';
const TOOLBAR_GROUP_SPACED = 'ui-toolbar-group flex items-center gap-2 rounded-full px-3 py-1.5';
const TOOL_BUTTON = 'ui-button-icon rounded-lg p-2 transition-all duration-200 hover:scale-105 active:scale-95';
const PANEL_ACTION_BUTTON = 'ui-button-soft w-full flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] uppercase tracking-widest';

interface ProjectNameEditorProps {
  name: string;
  onRename: (newName: string) => void;
}

const ProjectNameEditor: React.FC<ProjectNameEditorProps> = ({ name, onRename }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const beginEdit = () => {
    setDraft(name);
    setEditing(true);
  };

  const commitEdit = () => {
    const trimmed = draft.trim() || 'Untitled Project';
    setEditing(false);
    if (trimmed !== name) onRename(trimmed);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        data-testid="project-name-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
          if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
        }}
        aria-label="Project name"
        className="max-w-[180px] rounded border border-[color:var(--brand-primary)]/50 bg-[color:var(--ui-bg)] px-2 py-0.5 text-[11px] uppercase tracking-widest text-[color:var(--ui-text)] outline-none focus:ring-1 focus:ring-[color:var(--brand-primary)]"
      />
    );
  }

  return (
    <button
      data-testid="project-name-display"
      onClick={beginEdit}
      title="Click to rename project"
      className="group flex items-center gap-1.5 max-w-[180px] rounded px-2 py-0.5 text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)] hover:text-[color:var(--ui-text)] hover:bg-white/5 transition-colors"
    >
      <span className="truncate">{name}</span>
      <Pencil className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
    </button>
  );
};

interface EditorShellProps {
  onBackToDashboard?: () => void;
}

export const EditorShell: React.FC<EditorShellProps> = ({ onBackToDashboard }) => {
  useKeyboardShortcuts();
  const {
    toastMessage,
    toast,
    setToast,
    dismissToast,
    canvas,
    saveState,
    consumeHistoryDirty,
    saveStatus,
    activeTool,
    selectedObjectId,
    setActiveTool,
    setBrushColor,
    setCanvasBackgroundColor,
    snapEnabled,
    setSnapEnabled,
    gridEnabled,
    setGridEnabled,
    showExportModal,
    setShowExportModal,
    setProjectQuickOpenOpen,

    setShowHelpModal,
    undo,
    redo,
    projectName,
    renameCurrentProject,
  } = useEditorStore(
    (state) => ({
      toastMessage: state.toastMessage,
    toast: state.toast,
    setToast: state.setToast,
    dismissToast: state.dismissToast,
    canvas: state.canvas,
    saveState: state.saveState,
    consumeHistoryDirty: state.consumeHistoryDirty,
    saveStatus: state.saveStatus,
    activeTool: state.activeTool,
    selectedObjectId: state.selectedObjectId,
    setActiveTool: state.setActiveTool,
    setBrushColor: state.setBrushColor,
    setCanvasBackgroundColor: state.setCanvasBackgroundColor,
    snapEnabled: state.snapEnabled,
    setSnapEnabled: state.setSnapEnabled,
    gridEnabled: state.gridEnabled,
    setGridEnabled: state.setGridEnabled,
    showExportModal: state.showExportModal,
    setShowExportModal: state.setShowExportModal,
    setProjectQuickOpenOpen: state.setProjectQuickOpenOpen,

    setShowHelpModal: state.setShowHelpModal,
    undo: state.undo,
    redo: state.redo,
    projectName: state.projectName,
    renameCurrentProject: state.renameCurrentProject,
  }),
    shallow
  );
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const { themeData, canvasBackgroundColor } = useThemeStore(
    (state) => ({
      themeData: state.themeData,
      canvasBackgroundColor: state.canvasBackgroundColor,
    }),
    shallow
  );
  const safeCanvasBackgroundColor =
    canvasBackgroundColor && canvasBackgroundColor.toLowerCase() !== 'transparent'
      ? canvasBackgroundColor
      : null;
  const [isBrandModalOpen, setIsBrandModalOpen] = useState(false);
  const [isDesignSpaceImportOpen, setIsDesignSpaceImportOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [activeNav, setActiveNav] = useState<NavId | null>(null);
  const [isFillPopoverOpen, setIsFillPopoverOpen] = useState(false);
  const [expandedToastId, setExpandedToastId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<'layers' | 'properties' | 'settings'>('layers');

  const activeToast = useMemo(() => {
    if (toast) return toast;
    if (!toastMessage) return null;
    return {
      id: `legacy-${toastMessage}`,
      message: toastMessage,
      variant: 'info' as const,
      durationMs: 3000,
    };
  }, [toast, toastMessage]);

  // Register toast callback for error handling utilities
  useEffect(() => {
    registerToastCallback(setToast);
  }, [setToast]);

  useEffect(() => {
    if (!activeToast) return;
    if (!activeToast.durationMs || activeToast.durationMs <= 0) return;
    const timeout = window.setTimeout(() => dismissToast(), activeToast.durationMs);
    return () => window.clearTimeout(timeout);
  }, [activeToast, dismissToast]);

  useEffect(() => {
    if (!activeToast) {
      setExpandedToastId(null);
      return;
    }
    if (expandedToastId && expandedToastId !== activeToast.id) {
      setExpandedToastId(null);
    }
  }, [activeToast, expandedToastId]);

  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return;
    (window as any).__DESIGN_SPACE_QA__ = {
      snapshot: () => {
        const state = useEditorStore.getState();
        const activeObject = state.canvas?.getActiveObject();
        const canvasStore = useCanvasStore.getState();
        const themeState = useThemeStore.getState();
        return {
          canvasReady: !!state.canvas && state.canvasReadyState === 'ready',
          activeTool: state.activeTool,
          selectedObjectId: state.selectedObjectId,
          selectedLayerIds: state.selectedLayerIds,
          pendingInsertionCandidateIds: getPendingInsertionCandidateIds(),
          pendingLayerSyncSelectionIds: getPendingLayerSyncSelectionIds() ?? state.pendingLayerSyncSelectionIds,
          activeObjectId: activeObject ? (activeObject as any).id ?? null : null,
          activeObjectType: activeObject?.type ?? null,
          documentSize: { width: canvasStore.width, height: canvasStore.height },
          pageBackgroundColor: themeState.canvasBackgroundColor,
          viewportTransform: state.canvas?.viewportTransform ?? null,
          zoom: state.canvas?.getZoom() ?? null,
          objects: state.canvas?.getObjects()
            .filter((object) => {
              const target = object as any;
              return !target.isGuide && !target.isSmartGuide && !target.isDocumentPaper && !target.isSafeZoneOverlay;
            })
            .map((object) => ({
              id: (object as any).id ?? null,
              type: object.type,
              left: object.left,
              top: object.top,
              width: object.width,
              height: object.height,
              scaleX: object.scaleX,
              scaleY: object.scaleY,
              visible: object.visible,
              selectable: object.selectable,
              evented: object.evented,
              lockMovementX: object.lockMovementX,
              lockMovementY: object.lockMovementY,
              text: (object as any).text ?? null,
              isEditing: (object as any).isEditing ?? false,
            })) ?? [],
          canvasObjects: state.canvasObjects,
          layers: state.layers,
        };
      },
      documentLayout: () => {
        const canvas = useEditorStore.getState().canvas;
        if (!canvas) return null;
        const vpt = canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0];
        const canvasEl = canvas.getElement();
        const canvasRect = canvasEl?.getBoundingClientRect() ?? null;
        const { width: docW, height: docH } = useCanvasStore.getState();
        const paper = canvas.getObjects().find((o) => (o as any).isDocumentPaper);
        const safeZones = canvas.getObjects().filter((o) => (o as any).isSafeZoneOverlay);
        const paperBr = paper ? (() => { paper.setCoords(); return paper.getBoundingRect(); })() : null;
        const safeZoneBrs = safeZones.map((o) => { o.setCoords(); return o.getBoundingRect(); });
        return {
          vpt,
          zoom: vpt[0],
          documentSize: { width: docW, height: docH },
          canvasElementRect: canvasRect ? { left: canvasRect.left, top: canvasRect.top, width: canvasRect.width, height: canvasRect.height } : null,
          paperInCanvas: paper ? { left: (paper as any).left, top: (paper as any).top, width: (paper as any).width, height: (paper as any).height } : null,
          paperScreenBounds: paperBr ? { left: paperBr.left, top: paperBr.top, width: paperBr.width, height: paperBr.height } : null,
          safeZoneCount: safeZones.length,
          safeZoneScreenBounds: safeZoneBrs.map((br) => ({ left: br.left, top: br.top, width: br.width, height: br.height })),
          expectedPaperScreen: canvasRect ? {
            left: canvasRect.left + vpt[4],
            top: canvasRect.top + vpt[5],
            width: docW * vpt[0],
            height: docH * vpt[3],
          } : null,
        };
      },
      controlPoint: (id: string, key: string) => {
        const canvas = useEditorStore.getState().canvas;
        const object = canvas?.getObjects().find((candidate) => (candidate as any).id === id);
        if (!canvas || !object) return null;
        object.setCoords();
        const control = (object as any).oCoords?.[key];
        if (!control || typeof control.x !== 'number' || typeof control.y !== 'number') return null;
        const canvasRect = canvas.upperCanvasEl?.getBoundingClientRect?.()
          ?? canvas.getElement().getBoundingClientRect();
        return {
          x: canvasRect.left + control.x,
          y: canvasRect.top + control.y,
        };
      },
      domLayers: () => {
        const canvas = useEditorStore.getState().canvas;
        if (!canvas) return null;
        const lowerCanvas = canvas.getElement() as HTMLCanvasElement | null;
        const upperCanvas = canvas.upperCanvasEl as HTMLCanvasElement | null;
        const wrapper = lowerCanvas?.parentElement ?? null;
        const stage = wrapper?.parentElement ?? null;
        const toRect = (el: Element | null) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, width: r.width, height: r.height };
        };
        return {
          stageRect: toRect(stage),
          fabricWrapperRect: toRect(wrapper),
          lowerCanvasRect: toRect(lowerCanvas),
          upperCanvasRect: toRect(upperCanvas),
          canvasCssSize: lowerCanvas
            ? { width: lowerCanvas.style.width, height: lowerCanvas.style.height }
            : null,
          canvasAttributeSize: lowerCanvas
            ? { width: lowerCanvas.width, height: lowerCanvas.height }
            : null,
          fabricInternalSize: {
            width: canvas.getWidth(),
            height: canvas.getHeight(),
          },
        };
      },
      workspaceLayout: () => {
        const canvas = useEditorStore.getState().canvas;
        const toRect = (el: Element | null) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, width: r.width, height: r.height };
        };
        const editorShellRect = toRect(document.querySelector('[data-testid="editor-shell"]'));
        const headerRect = toRect(document.querySelector('[data-testid="editor-toolbar"]'));
        const leftPanelRect = toRect(document.querySelector('[data-testid="left-panel"]'));
        const rightPanelRect = toRect(document.querySelector('[data-testid="right-panel"]'));
        const workspaceRect = toRect(document.querySelector('[data-testid="canvas-workspace"]'));
        const canvasEl = canvas?.getElement() ?? null;
        const canvasRect = toRect(canvasEl);
        const vpt = canvas?.viewportTransform ?? null;
        const { width: docW, height: docH } = useCanvasStore.getState();
        const rulerInset = 24;
        const intendedViewportRect = workspaceRect ? {
          left: workspaceRect.left + rulerInset,
          top: workspaceRect.top + rulerInset,
          width: workspaceRect.width - rulerInset,
          height: workspaceRect.height - rulerInset,
        } : null;
        const paperScreenCenter = (canvasRect && vpt) ? {
          x: canvasRect.left + vpt[4] + docW * vpt[0] / 2,
          y: canvasRect.top + vpt[5] + docH * vpt[3] / 2,
        } : null;
        const intendedWorkspaceCenter = intendedViewportRect ? {
          x: intendedViewportRect.left + intendedViewportRect.width / 2,
          y: intendedViewportRect.top + intendedViewportRect.height / 2,
        } : null;
        return {
          editorShellRect,
          headerRect,
          leftPanelRect,
          rightPanelRect,
          workspaceRect,
          intendedViewportRect,
          canvasElementRect: canvasRect,
          paperScreenCenter,
          intendedWorkspaceCenter,
        };
      },
      fabricObjectsAudit: () => {
        const canvas = useEditorStore.getState().canvas;
        if (!canvas) return null;
        const { width: docW, height: docH } = useCanvasStore.getState();
        const vpt = canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0];
        const zoom = vpt[0];
        const canvasEl = canvas.getElement() as HTMLCanvasElement;
        const canvasRect = canvasEl.getBoundingClientRect();

        // Enumerate all Fabric objects with screen bounds
        const objects = canvas.getObjects().map((obj: any) => {
          obj.setCoords();
          const br = obj.getBoundingRect();
          const screenLeft = canvasRect.left + br.left * zoom + vpt[4];
          const screenTop = canvasRect.top + br.top * zoom + vpt[5];
          const fillStr = typeof obj.fill === 'string' ? obj.fill : (obj.fill ? '[filler]' : 'none');
          return {
            id: obj.id ?? null,
            type: obj.type,
            isDocumentPaper: !!obj.isDocumentPaper,
            isGuide: !!obj.isGuide,
            isPageBorder: !!obj.isPageBorder,
            isSafeZoneOverlay: !!obj.isSafeZoneOverlay,
            isBleedZone: !!obj.isBleedZone,
            fabricCoords: { left: obj.left, top: obj.top, width: obj.width, height: obj.height },
            fill: fillStr,
            stroke: obj.stroke ?? null,
            opacity: obj.opacity,
            visible: obj.visible,
            canvasBr: { left: Math.round(br.left), top: Math.round(br.top), width: Math.round(br.width), height: Math.round(br.height) },
            screenBounds: { left: Math.round(screenLeft), top: Math.round(screenTop), width: Math.round(br.width), height: Math.round(br.height) },
          };
        });

        // Check DOM backgrounds for each layer in the canvas stack
        const getLayerInfo = (el: Element | null) => {
          if (!el) return null;
          const s = window.getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            id: el.id || null,
            testid: el.getAttribute('data-testid') || null,
            className: (el as HTMLElement).className?.slice?.(0, 80) ?? '',
            bg: s.backgroundColor,
            bgImage: s.backgroundImage !== 'none' ? s.backgroundImage.slice(0, 80) : null,
            rect: { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
          };
        };

        const lowerCanvas = canvasEl;
        const fabricWrapper = lowerCanvas?.parentElement ?? null;
        const canvasContainerDiv = fabricWrapper?.parentElement ?? null;
        const canvasStageDiv = canvasContainerDiv?.parentElement ?? null;

        // Sample pixel values from the lower canvas at key positions
        const ctx = (canvasEl as HTMLCanvasElement).getContext('2d');
        const samplePixel = (cx: number, cy: number) => {
          if (!ctx) return null;
          try {
            const px = ctx.getImageData(Math.round(cx), Math.round(cy), 1, 1).data;
            return { r: px[0], g: px[1], b: px[2], a: px[3] };
          } catch { return null; }
        };

        // Compute where documentPaper should appear on the canvas element
        const paperCanvasLeft = vpt[4];
        const paperCanvasTop = vpt[5];
        const paperCanvasW = docW * zoom;
        const paperCanvasH = docH * zoom;

        const pixelSamples = {
          // Inside the expected document paper area (at center)
          paperCenter: samplePixel(paperCanvasLeft + paperCanvasW / 2, paperCanvasTop + paperCanvasH / 2),
          // 10px left of expected paper left edge
          leftOfPaper: samplePixel(paperCanvasLeft - 10, paperCanvasTop + paperCanvasH / 2),
          // At paper left edge
          paperLeftEdge: samplePixel(paperCanvasLeft + 2, paperCanvasTop + paperCanvasH / 2),
          // Far left of canvas (x=10)
          farLeft: samplePixel(10, paperCanvasTop + paperCanvasH / 2),
          // x=60 (between ruler edge at 24 and expected paper left)
          midLeft: samplePixel(60, paperCanvasTop + paperCanvasH / 2),
        };

        // elementFromPoint samples at screen coordinates
        const sampleDom = (sx: number, sy: number) => {
          const el = document.elementFromPoint(sx, sy);
          if (!el) return null;
          return {
            tag: el.tagName.toLowerCase(),
            id: el.id || null,
            testid: el.getAttribute('data-testid') || null,
            className: (el as HTMLElement).className?.slice?.(0, 60) ?? '',
          };
        };

        const domSamples = {
          paperCenter: sampleDom(canvasRect.left + paperCanvasLeft + paperCanvasW / 2, canvasRect.top + paperCanvasTop + paperCanvasH / 2),
          leftOfPaper: sampleDom(canvasRect.left + Math.max(0, paperCanvasLeft - 10), canvasRect.top + paperCanvasTop + paperCanvasH / 2),
          farLeft: sampleDom(canvasRect.left + 10, canvasRect.top + 200),
        };

        return {
          documentSize: { width: docW, height: docH },
          canvasBackgroundColor: canvas.backgroundColor,
          vpt,
          zoom,
          canvasElementRect: { left: Math.round(canvasRect.left), top: Math.round(canvasRect.top), width: Math.round(canvasRect.width), height: Math.round(canvasRect.height) },
          expectedPaperScreen: {
            left: Math.round(canvasRect.left + paperCanvasLeft),
            top: Math.round(canvasRect.top + paperCanvasTop),
            width: Math.round(paperCanvasW),
            height: Math.round(paperCanvasH),
          },
          objectCount: objects.length,
          documentPaperObjects: objects.filter((o) => o.isDocumentPaper),
          pageBorderObjects: objects.filter((o) => o.isPageBorder),
          guideObjects: objects.filter((o) => o.isGuide),
          userObjects: objects.filter((o) => !o.isDocumentPaper && !o.isGuide && !o.isPageBorder),
          domLayers: {
            lowerCanvas: getLayerInfo(lowerCanvas),
            fabricWrapper: getLayerInfo(fabricWrapper),
            canvasContainerDiv: getLayerInfo(canvasContainerDiv),
            canvasStageDiv: getLayerInfo(canvasStageDiv),
          },
          pixelSamples,
          domSamples,
        };
      },
    };
    return () => {
      delete (window as any).__DESIGN_SPACE_QA__;
    };
  }, []);

  useEffect(() => {
    if (activeTool !== 'draw' && activeTool !== 'pan' && activeTool !== 'select') {
      setIsFillPopoverOpen(false);
    }
  }, [activeTool]);

  useEffect(() => {
    const handleMouseUp = () => {
      if (!canvas) return;
      if (consumeHistoryDirty()) {
        saveState();
      }
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [canvas, consumeHistoryDirty, saveState]);

  // Cleanup tracked blob URLs on unmount
  useEffect(() => {
    const handleUnload = () => {
      cleanupAssets();
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      cleanupAssets();
    };
  }, []);

  useEffect(() => {
    if (selectedObjectId) setRightTab('properties');
  }, [selectedObjectId]);

  const handleSelectNav = (id: NavId | 'layers') => {
    if (id === 'layers') {
      setRightTab('layers');
      return;
    }
    setActiveNav((prev) => (prev === id ? null : id));
  };

  const renderPanel = () => {
    if (!activeNav) return null;
    switch (activeNav) {
      case 'shapes':
        return <ShapesPanel />;
      case 'insert':
        return <Inserter />;
      case 'assets':
        return <AssetLibrary />;
      default:
        return null;
    }
  };

  return (
    <div data-testid="editor-shell" tabIndex={-1} className="w-screen h-screen bg-[color:var(--ui-bg)] text-[color:var(--ui-text)] flex flex-col">
        <BrandModal isOpen={isBrandModalOpen} onClose={() => setIsBrandModalOpen(false)} />
        <ExportModal isOpen={showExportModal} onClose={() => setShowExportModal(false)} />
        <SettingsModal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} />
        <DesignSpaceImportModal isOpen={isDesignSpaceImportOpen} onClose={() => setIsDesignSpaceImportOpen(false)} />
        <ProjectPresetsModal />
        <ProjectQuickOpenModal />
        
        {activeToast && (
            <div
              className={`fixed bottom-4 right-4 z-50 w-[22rem] rounded-2xl border px-4 py-3 text-sm backdrop-blur-[var(--ui-blur)] ${
                activeToast.variant === 'error'
                  ? 'border-[rgba(199,88,88,0.38)] bg-[rgba(199,88,88,0.12)] text-[#8b3535]'
                  : activeToast.variant === 'warning'
                    ? 'border-[rgba(214,160,90,0.38)] bg-[rgba(214,160,90,0.12)] text-[#7a5420]'
                    : activeToast.variant === 'success'
                      ? 'border-[rgba(106,155,122,0.38)] bg-[rgba(106,155,122,0.12)] text-[#2e5e45]'
                      : 'border-[color:var(--ui-border)] bg-[color:var(--ui-panel-opaque)] text-[color:var(--ui-panel-text)]'
              }`}
              style={{ boxShadow: 'var(--popover-shadow)' }}
              role="status"
              aria-live={activeToast.variant === 'error' ? 'assertive' : 'polite'}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-xs uppercase tracking-widest">{activeToast.message}</p>
                </div>
                <button
                  onClick={dismissToast}
                  className="rounded-md border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-widest hover:bg-white/10"
                  aria-label="Dismiss toast"
                >
                  Close
                </button>
              </div>
              {(activeToast.details || activeToast.action) && (
                <div className="mt-2 flex items-center gap-2">
                  {activeToast.details && (
                    <button
                      onClick={() => setExpandedToastId((current) => (current === activeToast.id ? null : activeToast.id))}
                      className="rounded-md border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-widest hover:bg-white/10"
                    >
                      {expandedToastId === activeToast.id ? 'Hide Details' : 'Details'}
                    </button>
                  )}
                  {activeToast.action && (
                    <button
                      onClick={() => activeToast.action?.onAction()}
                      className="rounded-md border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-widest hover:bg-white/10"
                    >
                      {activeToast.action.label}
                    </button>
                  )}
                </div>
              )}
              {activeToast.details && expandedToastId === activeToast.id && (
                <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-white/15 bg-black/20 p-2 text-[10px] leading-relaxed text-[color:var(--ui-text)] whitespace-pre-wrap">
{activeToast.details}
                </pre>
              )}
            </div>
        )}

      <header data-testid="editor-toolbar" className="h-14 flex items-center justify-between px-5 shrink-0 bg-[color:var(--ui-panel)] backdrop-blur-[var(--ui-blur)] border-b border-[color:var(--ui-border)] z-10">
        <div className="min-w-[22rem] flex items-center gap-3">
          <h1 className="font-semibold uppercase tracking-widest text-xs text-[color:var(--ui-text)] shrink-0">DSGN Studio</h1>
          <span className="text-[color:var(--ui-border)] text-xs select-none shrink-0">/</span>
          <ProjectNameEditor
            name={projectName}
            onRename={(n) => void renameCurrentProject(n)}
          />
          <FileDropdown onImportDesignSpace={() => setIsDesignSpaceImportOpen(true)} />
          <SaveStatusBadge status={saveStatus} />
        </div>
        <div className="flex-1 flex justify-center items-center gap-4">
            <div className={TOOLBAR_GROUP}>
                <Tooltip content="Undo (⌘Z)" side="bottom">
                  <button
                      data-testid="toolbar-undo"
                      onClick={() => void undo()}
                      disabled={!canUndo}
                      className={`rounded-lg p-2 transition-all duration-200 ${
                          canUndo
                            ? TOOL_BUTTON
                            : 'text-[color:var(--ui-panel-text)]/60 cursor-not-allowed'
                      }`}
                  >
                      <Undo2 className="w-4 h-4 stroke-[1.5]" />
                  </button>
                </Tooltip>
                <Tooltip content="Redo (⌘⇧Z)" side="bottom">
                  <button
                      data-testid="toolbar-redo"
                      onClick={() => void redo()}
                      disabled={!canRedo}
                      className={`rounded-lg p-2 transition-all duration-200 ${
                          canRedo
                            ? TOOL_BUTTON
                            : 'text-[color:var(--ui-panel-text)]/60 cursor-not-allowed'
                      }`}
                  >
                      <Redo2 className="w-4 h-4 stroke-[1.5]" />
                  </button>
                </Tooltip>
            </div>
            <div className={TOOLBAR_GROUP_SPACED}>
                <Tooltip content="Select (V)" side="bottom">
                  <button
                      onClick={() => setActiveTool('select')}
                      className={`rounded-lg p-2 transition-all duration-200 ${
                          activeTool === 'select'
                            ? `${TOOL_BUTTON} ui-button-active`
                            : TOOL_BUTTON
                      }`}
                  >
                      <MousePointer2 className="w-4 h-4 stroke-[1.5]" />
                  </button>
                </Tooltip>
                <Tooltip content="Eraser (E)" side="bottom">
                  <button
                      onClick={() => setActiveTool('erase')}
                      className={`rounded-lg p-2 transition-all duration-200 ${
                          activeTool === 'erase'
                            ? `${TOOL_BUTTON} ui-button-active`
                            : TOOL_BUTTON
                      }`}
                  >
                      <Eraser className="w-4 h-4 stroke-[1.5]" />
                  </button>
                </Tooltip>
                <Tooltip content="Pan (H)" side="bottom">
                  <button
                      onClick={() => setActiveTool('pan')}
                      className={`rounded-lg p-2 transition-all duration-200 ${
                          activeTool === 'pan'
                            ? `${TOOL_BUTTON} ui-button-active`
                            : TOOL_BUTTON
                      }`}
                  >
                      <Hand className="w-4 h-4 stroke-[1.5]" />
                  </button>
                </Tooltip>
                <Tooltip content="Text Box (T)" side="bottom">
                  <button
                      onClick={() => setActiveTool('textbox')}
                      data-testid="tool-textbox"
                      className={`rounded-lg p-2 transition-all duration-200 ${
                          activeTool === 'textbox'
                            ? `${TOOL_BUTTON} ui-button-active`
                            : TOOL_BUTTON
                      }`}
                  >
                      <Type className="w-4 h-4 stroke-[1.5]" />
                  </button>
                </Tooltip>
                <div className="w-px h-5 bg-[color:var(--ui-border)]/70 mx-1" />
                <Tooltip content={snapEnabled ? 'Snapping On' : 'Snapping Off'} side="bottom">
                  <button
                      onClick={() => setSnapEnabled(!snapEnabled)}
                      className={`rounded-lg p-2 transition-all duration-200 ${
                        snapEnabled
                          ? `${TOOL_BUTTON} ui-button-active text-[color:var(--brand-primary)]`
                          : TOOL_BUTTON
                      }`}
                  >
                      <Magnet className="w-4 h-4 stroke-[1.5]" />
                  </button>
                </Tooltip>
                <Tooltip content={gridEnabled ? 'Grid On' : 'Grid Off'} side="bottom">
                  <button
                      onClick={() => setGridEnabled(!gridEnabled)}
                      className={`rounded-lg p-2 transition-all duration-200 ${
                        gridEnabled
                          ? `${TOOL_BUTTON} ui-button-active text-[color:var(--brand-primary)]`
                          : TOOL_BUTTON
                      }`}
                  >
                      <Grid className="w-4 h-4 stroke-[1.5]" />
                  </button>
                </Tooltip>
            </div>
            <div className={`relative ${TOOLBAR_GROUP_SPACED}`}>
                <Tooltip content="Pencil (P)" side="bottom">
                  <button
                      onClick={() => {
                          setActiveTool('draw');
                          setBrushColor((themeData as { brand?: { primary?: { value?: string } } } | null)?.brand?.primary?.value || '#1f2933');
                      }}
                      className={`rounded-lg p-2 transition-all duration-200 ${
                          activeTool === 'draw'
                            ? `${TOOL_BUTTON} ui-button-active`
                            : TOOL_BUTTON
                      }`}
                  >
                      <Pencil className="w-4 h-4 stroke-[1.5]" />
                  </button>
                </Tooltip>
                <Popover
                  isOpen={isFillPopoverOpen}
                  onOpenChange={setIsFillPopoverOpen}
                  ariaLabel="Paint bucket"
                  trigger={
                    <Tooltip content="Canvas Fill" side="bottom">
                      <button
                          className={TOOL_BUTTON}
                      >
                          <PaintBucket className="w-4 h-4 stroke-[1.5]" />
                      </button>
                    </Tooltip>
                  }
                >
                    <div
                        className="absolute left-1/2 top-full z-30 mt-3 w-40 -translate-x-1/2 rounded-xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel-opaque)] p-3 shadow-[0_16px_30px_rgba(0,0,0,0.4)] backdrop-blur-[var(--ui-blur)]"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">Canvas</span>
                                <input
                                type="color"
                                value={safeCanvasBackgroundColor || DEFAULT_CANVAS_BACKGROUND}
                                onChange={(e) => {
                                  setCanvasBackgroundColor(e.target.value);
                                  setIsFillPopoverOpen(false);
                                }}
                                className="h-6 w-10 cursor-pointer rounded border border-[color:var(--ui-border)] bg-transparent"
                                aria-label="Canvas background color"
                            />
                        </div>
                    </div>
                </Popover>
            </div>
        </div>
        <div className="w-auto flex justify-end items-center gap-4">
            <CanvasSettingsPopover />
            {onBackToDashboard ? (
              <button
                onClick={onBackToDashboard}
                className={CHROME_BUTTON}
              >
                <Home className={ICON_SMALL} />
                <span>Projects</span>
              </button>
            ) : (
              <ProjectBrowser />
            )}
            <Tooltip content="Quick Open (⌘K)" side="bottom">
              <button
                onClick={() => setProjectQuickOpenOpen(true)}
                className={CHROME_ICON_BUTTON}
                aria-label="Quick Open Projects"
              >
                <Search className={ICON_SMALL} />
              </button>
            </Tooltip>
            <Tooltip content="Keyboard Shortcuts (⌘⇧/)" side="bottom">
              <button
                onClick={() => setShowHelpModal(true)}
                className={CHROME_ICON_BUTTON}
                aria-label="Keyboard Shortcuts"
              >
                <Keyboard className={ICON_SMALL} />
              </button>
            </Tooltip>
            <Tooltip content="Export (⌘E)" side="bottom">
              <button
                onClick={() => setShowExportModal(true)}
                className={CHROME_ICON_BUTTON}
                aria-label="Export"
              >
                <Download className={ICON_SMALL} />
              </button>
            </Tooltip>
        </div>
      </header>
      <div className="flex-1 flex overflow-hidden">
        <aside data-testid="left-panel" className="editor-side-panel-left w-[320px] bg-[color:var(--ui-panel)]/70 backdrop-blur-[var(--ui-blur)] border-r border-[color:var(--ui-border)] flex-col">
          <div className="px-4 py-2.5 border-b border-[color:var(--border-subtle)] shrink-0">
            <p className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">Workspace</p>
          </div>
          <div className="flex-1 min-h-0 flex overflow-hidden">
            <div className="w-[88px] border-r border-[color:var(--border-subtle)] overflow-y-auto shrink-0">
              <NavStrip activeNav={activeNav} onSelect={handleSelectNav} />
            </div>
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {activeNav ? (
                <div className="flex flex-col h-full">
                  <div className="px-3 py-2 border-b border-[color:var(--border-subtle)] shrink-0">
                    <span className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">{NAV_ITEMS.find((item) => item.id === activeNav)?.label}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {renderPanel()}
                  </div>
                </div>
              ) : (
                <div className="p-3 text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">Select Shapes, Insert, or Assets.</div>
              )}
            </div>
          </div>
        </aside>

        <main data-testid="canvas-workspace" className="flex-1 relative overflow-hidden bg-[color:var(--ui-bg)]">
            <CanvasRuler />
            <SelectionToolbar />
            <CanvasStage onSelectNav={handleSelectNav} />
        </main>

        <aside data-testid="right-panel" className="editor-side-panel-right bg-[color:var(--ui-panel)]/70 backdrop-blur-[var(--ui-blur)] transition-all duration-300 ease-in-out overflow-hidden w-80 border-l border-[color:var(--ui-border)] flex-col">
            {/* Tab strip */}
            <div className="flex border-b border-[color:var(--ui-border)] shrink-0">
              <button
                onClick={() => setRightTab('layers')}
                data-testid="right-tab-layers"
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-[11px] uppercase tracking-widest transition-all duration-200 ${
                  rightTab === 'layers'
                    ? 'text-[color:var(--brand-primary)] border-b-2 border-[color:var(--brand-primary)] bg-[color:var(--ui-active-soft)]'
                    : 'text-[color:var(--ui-panel-text)] hover:text-[color:var(--ui-text)] hover:bg-[color:var(--ui-hover-soft)]'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Layers
              </button>
              <button
                onClick={() => setRightTab('properties')}
                data-testid="right-tab-properties"
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-[11px] uppercase tracking-widest transition-all duration-200 ${
                  rightTab === 'properties'
                    ? 'text-[color:var(--brand-primary)] border-b-2 border-[color:var(--brand-primary)] bg-[color:var(--ui-active-soft)]'
                    : 'text-[color:var(--ui-panel-text)] hover:text-[color:var(--ui-text)] hover:bg-[color:var(--ui-hover-soft)]'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                Properties
              </button>
              <button
                onClick={() => setRightTab('settings')}
                data-testid="right-tab-settings"
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-[11px] uppercase tracking-widest transition-all duration-200 ${
                  rightTab === 'settings'
                    ? 'text-[color:var(--brand-primary)] border-b-2 border-[color:var(--brand-primary)] bg-[color:var(--ui-active-soft)]'
                    : 'text-[color:var(--ui-panel-text)] hover:text-[color:var(--ui-text)] hover:bg-[color:var(--ui-hover-soft)]'
                }`}
              >
                <Frame className="w-3.5 h-3.5" />
                Style
              </button>
            </div>
            {/* Tab content */}
            <div className="flex-1 overflow-hidden">
              {rightTab === 'layers' && (
                <div className="h-full overflow-y-auto">
                  <LayersPanel />
                </div>
              )}
              {rightTab === 'properties' && <PropertiesPanel />}
              {rightTab === 'settings' && (
                <div className="h-full overflow-y-auto p-4 space-y-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)] mb-3">Page Border</p>
                    <PageBorderPopover />
                  </div>
                  <div className="border-t border-[color:var(--ui-border)] pt-4">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setIsBrandModalOpen(true)}
                        className={PANEL_ACTION_BUTTON}
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Brand
                      </button>
                      <button
                        onClick={() => setIsSettingsModalOpen(true)}
                        className={PANEL_ACTION_BUTTON}
                      >
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                        Vibe Settings
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
        </aside>
      </div>
      <PageStrip />
      <StatusBar />
      <KeyboardShortcutHelp />
    </div>
  );
};
