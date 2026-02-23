
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { shallow } from 'zustand/shallow';
import * as fabric from 'fabric';
import { CanvasSettingsPopover } from './CanvasSettingsPopover';
import {
  ChevronDown,
  FileText,
  Layers,
  MousePointer2,
  Pencil,
  Eraser,
  Hand,
  PaintBucket,
  Magnet,
  Grid,
  SlidersHorizontal,
  Square,
  Circle,
  Triangle,
  Star,
  Image as ImageIcon,
  Search,
  Download,
  Home,
  Undo2,
  Redo2,
  Keyboard,
  Type,
  Pin,
} from 'lucide-react';
import { useEditorStore, DEFAULT_CANVAS_BACKGROUND } from '../state/editorStore';
import { useCanUndo, useCanRedo } from '../state/useHistoryStore';
import { useThemeStore } from '../state/useThemeStore';
import { AssetLibrary } from './AssetLibrary';
import { BrandModal } from './BrandModal';
import { ExportModal } from './ExportModal';
import { LayersPanel } from './LayersPanel';
import { CanvasStage } from './CanvasStage';
import { CanvasRuler } from './CanvasRuler';
import { StatusBar } from './StatusBar';
import { Inserter } from './Inserter';
import * as objectFactories from '../fabric/objectFactories';
import { SettingsModal } from './SettingsModal';
import { ProjectPresetsModal } from './ProjectPresetsModal';
import { DesignSpaceImportModal } from './DesignSpaceImportModal';
import { Popover } from './Popover';
import { PopoverSurface } from './PopoverSurface';
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

const ICON_SMALL = 'icon-muted w-4 h-4 stroke-[1.5]';
const NAV_ICON = 'w-5 h-5 stroke-[1.5]';

type NavId = 'shapes' | 'insert' | 'layers' | 'assets';

const NAV_ITEMS: Array<{ id: NavId; label: string; icon: React.ReactElement; description: string }> = [
  { id: 'shapes', label: 'Shapes', icon: <Square />, description: 'Quick geometric primitives' },
  { id: 'insert', label: 'Insert', icon: <Type />, description: 'Text, placeholders, and media tools' },
  { id: 'layers', label: 'Layers', icon: <Layers />, description: 'Order, visibility, and locking' },
  { id: 'assets', label: 'Assets', icon: <ImageIcon />, description: 'Library and imports' },
];

interface FileDropdownProps {
  onImportDesignSpace: () => void;
}

const FileDropdown: React.FC<FileDropdownProps> = ({ onImportDesignSpace }) => {
    const [isOpen, setIsOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { downloadProjectFile, loadProjectFile, setProjectPresetsOpen } = useEditorStore(
        (state) => ({
            downloadProjectFile: state.downloadProjectFile,
            loadProjectFile: state.loadProjectFile,
            setProjectPresetsOpen: state.setProjectPresetsOpen,
        }),
        shallow
    );

    const handleOpenFile = () => {
        fileInputRef.current?.click();
        setIsOpen(false);
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        await loadProjectFile(file);
        event.target.value = '';
        setIsOpen(false);
    };

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="group flex items-center gap-2 px-4 py-2 bg-white/5 text-slate-200 rounded-full border border-[color:var(--border-subtle)] hover:bg-white/10 transition-all duration-300 ease-in-out text-[11px] uppercase tracking-widest"
            >
                <FileText className="icon-muted w-4 h-4 stroke-[1.5]" />
                <span>File</span>
                <ChevronDown className={`icon-muted w-4 h-4 stroke-[1.5] transition-all duration-300 ease-in-out ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            <input
                ref={fileInputRef}
                type="file"
                accept=".apocaproject.json,.json"
                onChange={handleFileChange}
                className="hidden"
            />
            {isOpen && (
                <PopoverSurface className="absolute left-0 mt-2 w-56 z-20">
                    <ul>
                        <li>
                            <button
                                onClick={() => { setProjectPresetsOpen(true); setIsOpen(false); }}
                                className="w-full text-left px-4 py-2 text-xs uppercase tracking-widest text-slate-200 hover:bg-white/10"
                            >
                                New Project
                            </button>
                        </li>
                        <li>
                            <button
                                onClick={handleOpenFile}
                                className="w-full text-left px-4 py-2 text-xs uppercase tracking-widest text-slate-200 hover:bg-white/10"
                            >
                                Open File
                            </button>
                        </li>
                        <li>
                            <button
                                onClick={() => { downloadProjectFile(); setIsOpen(false); }}
                                className="w-full text-left px-4 py-2 text-xs uppercase tracking-widest text-slate-200 hover:bg-white/10"
                            >
                                Save Project
                            </button>
                        </li>
                        <li className="border-t border-white/10 mt-1 pt-1">
                            <button
                                onClick={() => { onImportDesignSpace(); setIsOpen(false); }}
                                className="w-full text-left px-4 py-2 text-xs uppercase tracking-widest text-slate-200 hover:bg-white/10"
                            >
                                Import to DesignSpace
                            </button>
                        </li>
                    </ul>
                </PopoverSurface>
            )}
        </div>
    );
};

interface NavStripProps {
  activeNav: NavId | null;
  onSelect: (id: NavId) => void;
}

const NavStrip: React.FC<NavStripProps> = ({ activeNav, onSelect }) => (
  <div className="flex flex-col gap-2 p-3">
    {NAV_ITEMS.map((item) => {
      const isActive = activeNav === item.id;
      return (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          className={`w-full rounded-xl border px-3 py-2 text-left transition-all duration-200 ${
            isActive
              ? 'border-[color:var(--brand-primary)]/50 bg-[color:var(--brand-primary)]/15 text-white'
              : 'border-transparent bg-white/5 text-slate-300 hover:border-white/10 hover:bg-white/10'
          }`}
        >
          <div className="flex items-center gap-2">
            {React.cloneElement(item.icon, { className: `${NAV_ICON} shrink-0` })}
            <span className="text-[11px] uppercase tracking-widest">{item.label}</span>
          </div>
          <p className="mt-1 text-[9px] uppercase tracking-widest text-slate-400">{item.description}</p>
        </button>
      );
    })}
  </div>
);

const ShapesPanel: React.FC = () => {
  const handleAddShape = (factory: (canvas: fabric.Canvas) => void) => {
    const canvas = useEditorStore.getState().canvas;
    if (!canvas) return;
    factory(canvas);
    useEditorStore.getState().setActiveTool('select');
  };

  return (
    <div className="p-4 space-y-3">
      <h3 className="text-[10px] uppercase tracking-widest text-slate-300">Shapes</h3>
      <div className="grid grid-cols-1 gap-2">
        <button onClick={() => handleAddShape(objectFactories.addRectangle)} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)] hover:border-[color:var(--brand-primary)]">
          <Square className={ICON_SMALL} /><span>Rectangle</span>
        </button>
        <button onClick={() => handleAddShape(objectFactories.addCircle)} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)] hover:border-[color:var(--brand-primary)]">
          <Circle className={ICON_SMALL} /><span>Circle</span>
        </button>
        <button onClick={() => handleAddShape(objectFactories.addTriangle)} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)] hover:border-[color:var(--brand-primary)]">
          <Triangle className={ICON_SMALL} /><span>Triangle</span>
        </button>
        <button onClick={() => handleAddShape(objectFactories.addStar)} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)] hover:border-[color:var(--brand-primary)]">
          <Star className={ICON_SMALL} /><span>Star</span>
        </button>
      </div>
    </div>
  );
};

const CanvasQuickBar: React.FC<{
  onSelectNav: (nav: NavId) => void;
  quickBarPinned: boolean;
  onTogglePinned: () => void;
}> = ({ onSelectNav, quickBarPinned, onTogglePinned }) => (
  <div className="canvas-quickbar absolute left-1/2 top-12 z-30 toolbar-section toolbar-compact -translate-x-1/2 rounded-full border border-[color:var(--ui-border)] bg-[color:var(--ui-panel-opaque)] backdrop-blur-[var(--ui-blur)] shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
    <button
      onClick={() => onSelectNav('layers')}
      className="group rounded-full px-3 py-2 text-slate-200 transition-all duration-300 ease-in-out hover:bg-white/10"
      aria-label="Layers"
      title="Layers"
    >
      <Layers className={NAV_ICON} />
    </button>
    <button
      onClick={() => onSelectNav('insert')}
      className="group rounded-full px-3 py-2 text-slate-200 transition-all duration-300 ease-in-out hover:bg-white/10"
      aria-label="Insert"
      title="Insert Elements"
    >
      <Square className={NAV_ICON} />
    </button>
    <button
      onClick={onTogglePinned}
      className={`group rounded-full px-3 py-2 transition-all duration-300 ease-in-out ${
        quickBarPinned
          ? 'bg-[color:var(--brand-primary)]/20 text-[color:var(--brand-primary)]'
          : 'text-slate-200 hover:bg-white/10'
      }`}
      aria-label={quickBarPinned ? 'Disable quick bar pin' : 'Enable quick bar pin'}
      title={quickBarPinned ? 'Quick bar pinned' : 'Pin quick bar'}
    >
      <Pin className={NAV_ICON} />
    </button>
  </div>
);

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
    showOnboarding,
    quickBarPinned,
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
    setQuickBarPinned,

    setShowHelpModal,
    undo,
    redo,
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
    showOnboarding: state.showOnboarding,
    quickBarPinned: state.quickBarPinned,
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
    setQuickBarPinned: state.setQuickBarPinned,

    setShowHelpModal: state.setShowHelpModal,
    undo: state.undo,
    redo: state.redo,
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

  const handleSelectNav = (id: NavId) => {
    setActiveNav((prev) => (prev === id ? null : id));
  };

  const showCanvasQuickBar = showOnboarding || activeNav === null || quickBarPinned;

  const renderPanel = () => {
    if (!activeNav) return null;
    switch (activeNav) {
      case 'shapes':
        return <ShapesPanel />;
      case 'insert':
        return <Inserter />;
      case 'layers':
        return <LayersPanel />;
      case 'assets':
        return <AssetLibrary />;
      default:
        return null;
    }
  };

  return (
    <div className="w-screen h-screen bg-[color:var(--ui-bg)] text-[color:var(--ui-text)] flex flex-col">
        <BrandModal isOpen={isBrandModalOpen} onClose={() => setIsBrandModalOpen(false)} />
        <ExportModal isOpen={showExportModal} onClose={() => setShowExportModal(false)} />
        <SettingsModal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} />
        <DesignSpaceImportModal isOpen={isDesignSpaceImportOpen} onClose={() => setIsDesignSpaceImportOpen(false)} />
        <ProjectPresetsModal />
        <ProjectQuickOpenModal />
        
        {activeToast && (
            <div
              className={`fixed bottom-4 right-4 z-50 w-[22rem] rounded-lg border px-4 py-3 text-sm shadow-[0_0_24px_rgba(0,0,0,0.35)] ${
                activeToast.variant === 'error'
                  ? 'border-rose-400/40 bg-rose-500/12 text-rose-100'
                  : activeToast.variant === 'warning'
                    ? 'border-amber-300/35 bg-amber-500/10 text-amber-100'
                    : activeToast.variant === 'success'
                      ? 'border-emerald-300/35 bg-emerald-500/10 text-emerald-100'
                      : 'border-[color:var(--ui-border)] bg-[color:var(--ui-panel-opaque)] text-[color:var(--ui-panel-text)]'
              }`}
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
                <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-white/15 bg-black/20 p-2 text-[10px] leading-relaxed text-slate-100 whitespace-pre-wrap">
{activeToast.details}
                </pre>
              )}
            </div>
        )}

      <header className="toolbar-section justify-between bg-[color:var(--ui-panel)] backdrop-blur-[var(--ui-blur)] border-b border-[color:var(--ui-border)] z-10">
        <div className="min-w-[22rem] flex items-center gap-3">
          <h1 className="font-semibold uppercase tracking-widest text-xs text-slate-200">DSGN Studio</h1>
          <FileDropdown onImportDesignSpace={() => setIsDesignSpaceImportOpen(true)} />
          <SaveStatusBadge status={saveStatus} />
        </div>
        <div className="flex-1 flex justify-center items-center gap-4">
            <div className="flex items-center gap-1 rounded-full border border-[color:var(--border-subtle)] bg-white/5 px-2 py-1.5">
                <Tooltip content="Undo (⌘Z)" side="bottom">
                  <button
                      onClick={() => void undo()}
                      disabled={!canUndo}
                      className={`rounded-lg p-2 transition-all duration-200 ${
                          canUndo
                            ? 'text-slate-300 hover:text-white hover:bg-white/10 hover:scale-105 active:scale-95'
                            : 'text-slate-500 cursor-not-allowed'
                      }`}
                  >
                      <Undo2 className="w-4 h-4 stroke-[1.5]" />
                  </button>
                </Tooltip>
                <Tooltip content="Redo (⌘⇧Z)" side="bottom">
                  <button
                      onClick={() => void redo()}
                      disabled={!canRedo}
                      className={`rounded-lg p-2 transition-all duration-200 ${
                          canRedo
                            ? 'text-slate-300 hover:text-white hover:bg-white/10 hover:scale-105 active:scale-95'
                            : 'text-slate-500 cursor-not-allowed'
                      }`}
                  >
                      <Redo2 className="w-4 h-4 stroke-[1.5]" />
                  </button>
                </Tooltip>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-[color:var(--border-subtle)] bg-white/5 px-3 py-1.5">
                <Tooltip content="Select (V)" side="bottom">
                  <button
                      onClick={() => setActiveTool('select')}
                      className={`rounded-lg p-2 transition-all duration-200 ${
                          activeTool === 'select'
                            ? 'bg-white/20 text-white shadow-[0_0_12px_rgba(255,255,255,0.3)]'
                            : 'text-slate-300 hover:text-white hover:bg-white/10 hover:scale-105 active:scale-95'
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
                            ? 'bg-white/20 text-white shadow-[0_0_12px_rgba(255,255,255,0.3)]'
                            : 'text-slate-300 hover:text-white hover:bg-white/10 hover:scale-105 active:scale-95'
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
                            ? 'bg-white/20 text-white shadow-[0_0_12px_rgba(255,255,255,0.3)]'
                            : 'text-slate-300 hover:text-white hover:bg-white/10 hover:scale-105 active:scale-95'
                      }`}
                  >
                      <Hand className="w-4 h-4 stroke-[1.5]" />
                  </button>
                </Tooltip>
                <Tooltip content="Text Box (T)" side="bottom">
                  <button
                      onClick={() => setActiveTool('textbox')}
                      className={`rounded-lg p-2 transition-all duration-200 ${
                          activeTool === 'textbox'
                            ? 'bg-white/20 text-white shadow-[0_0_12px_rgba(255,255,255,0.3)]'
                            : 'text-slate-300 hover:text-white hover:bg-white/10 hover:scale-105 active:scale-95'
                      }`}
                  >
                      <Type className="w-4 h-4 stroke-[1.5]" />
                  </button>
                </Tooltip>
                <div className="w-px h-5 bg-white/10 mx-1" />
                <Tooltip content={snapEnabled ? 'Snapping On' : 'Snapping Off'} side="bottom">
                  <button
                      onClick={() => setSnapEnabled(!snapEnabled)}
                      className={`rounded-lg p-2 transition-all duration-200 ${
                        snapEnabled
                          ? 'bg-[color:var(--brand-primary)]/20 text-[color:var(--brand-primary)]'
                          : 'text-slate-400 hover:text-white hover:bg-white/10 hover:scale-105 active:scale-95'
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
                          ? 'bg-[color:var(--brand-primary)]/20 text-[color:var(--brand-primary)]'
                          : 'text-slate-400 hover:text-white hover:bg-white/10 hover:scale-105 active:scale-95'
                      }`}
                  >
                      <Grid className="w-4 h-4 stroke-[1.5]" />
                  </button>
                </Tooltip>
            </div>
            <div className="relative flex items-center gap-2 rounded-full border border-[color:var(--border-subtle)] bg-white/5 px-3 py-1.5">
                <Tooltip content="Pencil (P)" side="bottom">
                  <button
                      onClick={() => {
                          setActiveTool('draw');
                          setBrushColor(themeData?.brand?.primary?.value || '#1f2933');
                      }}
                      className={`rounded-lg p-2 transition-all duration-200 ${
                          activeTool === 'draw'
                            ? 'bg-white/20 text-white shadow-[0_0_12px_rgba(255,255,255,0.3)]'
                            : 'text-slate-300 hover:text-white hover:bg-white/10 hover:scale-105 active:scale-95'
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
                          className="rounded-lg p-2 text-slate-300 transition-all duration-200 hover:text-white hover:bg-white/10 hover:scale-105 active:scale-95"
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
                            <span className="text-[10px] uppercase tracking-widest text-slate-300">Canvas</span>
                                <input
                                type="color"
                                value={safeCanvasBackgroundColor || DEFAULT_CANVAS_BACKGROUND}
                                onChange={(e) => {
                                  setCanvasBackgroundColor(e.target.value);
                                  setIsFillPopoverOpen(false);
                                }}
                                className="h-6 w-10 cursor-pointer rounded border border-white/10 bg-transparent"
                                aria-label="Canvas background color"
                            />
                        </div>
                    </div>
                </Popover>
            </div>
            <button
                onClick={() => {
                    if (!canvas) return;
                    objectFactories.addPlaceholder(canvas, {
                        width: 400,
                        height: 400,
                        tokenRole: 'surfaces.surface-plain',
                    });
                }}
                className="group flex items-center gap-2 px-4 py-2 bg-white/5 text-slate-200 rounded-full border border-[color:var(--border-subtle)] hover:bg-white/10 transition-all duration-300 ease-in-out text-[11px] uppercase tracking-widest"
            >
                <Square className="icon-muted w-4 h-4 stroke-[1.5]" />
                <span>Insert Placeholder</span>
            </button>
        </div>
        <div className="w-auto flex justify-end items-center gap-4">
            <CanvasSettingsPopover />
            <button
                onClick={() => setIsSettingsModalOpen(true)}
                className="group flex items-center gap-2 px-4 py-2 bg-white/5 text-slate-200 rounded-full border border-[color:var(--border-subtle)] hover:bg-white/10 transition-all duration-300 ease-in-out text-[11px] uppercase tracking-widest"
            >
                <SlidersHorizontal className={ICON_SMALL} />
                Vibe
            </button>
            {onBackToDashboard ? (
              <button
                onClick={onBackToDashboard}
                className="group flex items-center gap-2 px-4 py-2 bg-white/5 text-slate-200 rounded-full border border-[color:var(--border-subtle)] hover:bg-white/10 transition-all duration-300 ease-in-out text-[11px] uppercase tracking-widest"
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
                className="group flex items-center justify-center rounded-full border border-[color:var(--border-subtle)] bg-white/5 p-2 text-slate-200 hover:bg-white/10 transition-all duration-300 ease-in-out"
                aria-label="Quick Open Projects"
              >
                <Search className={ICON_SMALL} />
              </button>
            </Tooltip>
            <Tooltip content="Keyboard Shortcuts (⌘⇧/)" side="bottom">
              <button
                onClick={() => setShowHelpModal(true)}
                className="group flex items-center justify-center rounded-full border border-[color:var(--border-subtle)] bg-white/5 p-2 text-slate-200 hover:bg-white/10 transition-all duration-300 ease-in-out"
                aria-label="Keyboard Shortcuts"
              >
                <Keyboard className={ICON_SMALL} />
              </button>
            </Tooltip>
            {import.meta.env.DEV && (
              <Tooltip content="Download (⌘E)" side="bottom">
                <button
                  onClick={() => setShowExportModal(true)}
                  className="group flex items-center justify-center rounded-full border border-[color:var(--border-subtle)] bg-white/5 p-2 text-slate-200 hover:bg-white/10 transition-all duration-300 ease-in-out"
                  aria-label="Download"
                >
                  <Download className={ICON_SMALL} />
                </button>
              </Tooltip>
            )}
        </div>
      </header>
      <div className="flex-1 flex overflow-hidden">
        <aside className="w-[320px] bg-[color:var(--ui-panel)]/70 backdrop-blur-[var(--ui-blur)] border-r border-[color:var(--ui-border)] flex flex-col">
          <div className="px-4 py-3 border-b border-[color:var(--border-subtle)]">
            <p className="text-[10px] uppercase tracking-widest text-slate-300">Workspace</p>
            <p className="text-[9px] uppercase tracking-widest text-slate-500 mt-1">Choose a panel to work faster</p>
          </div>
          <div className="flex-1 min-h-0 flex overflow-hidden">
            <div className="w-[150px] border-r border-[color:var(--border-subtle)] overflow-y-auto">
              <NavStrip activeNav={activeNav} onSelect={handleSelectNav} />
            </div>
            <div className="flex-1 overflow-y-auto">
              {activeNav ? (
                <div>
                  <div className="px-4 py-3 border-b border-[color:var(--border-subtle)]">
                    <span className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">{NAV_ITEMS.find((item) => item.id === activeNav)?.label}</span>
                  </div>
                  <div className="max-h-[calc(100vh-220px)] overflow-y-auto">
                    {renderPanel()}
                  </div>
                </div>
              ) : (
                <div className="p-4 text-[10px] uppercase tracking-widest text-slate-400">Select Shapes, Insert, Layers, or Assets.</div>
              )}
            </div>
          </div>
        </aside>

        <main className="flex-1 relative overflow-hidden bg-[color:var(--ui-bg)]">
            <CanvasRuler />
            {showCanvasQuickBar && (
              <CanvasQuickBar
                onSelectNav={handleSelectNav}
                quickBarPinned={quickBarPinned}
                onTogglePinned={() => setQuickBarPinned(!quickBarPinned)}
              />
            )}
            <SelectionToolbar />
            <CanvasStage onSelectNav={handleSelectNav} />
        </main>

        <aside className={`bg-[color:var(--ui-panel)]/70 backdrop-blur-[var(--ui-blur)] transition-all duration-300 ease-in-out overflow-hidden w-80 border-l border-[color:var(--ui-border)]`}>
            <PropertiesPanel />
        </aside>
      </div>
      <PageStrip />
      <StatusBar />
      <KeyboardShortcutHelp />
    </div>
  );
};
