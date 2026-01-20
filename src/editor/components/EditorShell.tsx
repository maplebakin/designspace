
import React, { useEffect, useRef, useState } from 'react';
import { shallow } from 'zustand/shallow';
import * as fabric from 'fabric';
import { CanvasSettingsPopover } from './CanvasSettingsPopover';
import {
  Briefcase,
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
  Download,
  Home,
} from 'lucide-react';
import { useEditorStore, DEFAULT_CANVAS_BACKGROUND } from '../state/editorStore';
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
import { Popover } from './Popover';
import { PopoverSurface } from './PopoverSurface';
import { cleanupAssets } from '../services/assetLoader';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { SelectionToolbar } from './SelectionToolbar';
import { ProjectBrowser } from './ProjectBrowser';
import { PropertiesPanel } from './PropertiesPanel';
import { Tooltip } from './Tooltip';
import { KeyboardShortcutHelp } from './KeyboardShortcutHelp';

const ICON_SMALL = 'icon-muted w-4 h-4 stroke-[1.5]';
const NAV_ICON = 'w-5 h-5 stroke-[1.5]';

type NavId = 'insert' | 'layers' | 'assets';

const NAV_ITEMS: Array<{ id: NavId; label: string; icon: React.ReactElement }> = [
  { id: 'insert', label: 'Insert', icon: <Square /> },
  { id: 'layers', label: 'Layers', icon: <Layers /> },
  { id: 'assets', label: 'Assets', icon: <ImageIcon /> },
];

const FileDropdown: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { startNewProject, downloadProjectFile, loadProjectFile } = useEditorStore(
        (state) => ({
            startNewProject: state.startNewProject,
            downloadProjectFile: state.downloadProjectFile,
            loadProjectFile: state.loadProjectFile,
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
                                onClick={() => { startNewProject(); setIsOpen(false); }}
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
  <div className="flex flex-col items-center gap-4 py-4">
    {NAV_ITEMS.map((item) => {
      const isActive = activeNav === item.id;
      return (
        <Tooltip key={item.id} content={item.label} side="right">
          <button
            onClick={() => onSelect(item.id)}
            className={`group w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-200 ${
              isActive
                ? 'bg-white/20 text-white shadow-[0_0_16px_rgba(255,255,255,0.3)]'
                : 'text-slate-400 hover:text-white hover:bg-white/10 hover:scale-105 active:scale-95'
            }`}
          >
            {React.cloneElement(item.icon, { className: `${NAV_ICON} transition-colors` })}
          </button>
        </Tooltip>
      );
    })}
  </div>
);

const ShapesPopover: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const handleAddShape = (factory: (canvas: fabric.Canvas) => void) => {
    const canvas = useEditorStore.getState().canvas;
    if (!canvas) return;
    factory(canvas);
    onClose();
  };

  return (
    <PopoverSurface className="min-w-[160px] w-fit z-50">
      <h3 className="text-[10px] uppercase tracking-widest mb-3">Shapes</h3>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => handleAddShape(objectFactories.addRectangle)}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)] transition-all duration-300 ease-in-out hover:border-[color:var(--brand-primary)]"
        >
          <Square className={ICON_SMALL} />
          <span className="shrink-0 whitespace-nowrap">Rectangle</span>
        </button>
        <button
          onClick={() => handleAddShape(objectFactories.addCircle)}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)] transition-all duration-300 ease-in-out hover:border-[color:var(--brand-primary)]"
        >
          <Circle className={ICON_SMALL} />
          <span className="shrink-0 whitespace-nowrap">Circle</span>
        </button>
        <button
          onClick={() => handleAddShape(objectFactories.addTriangle)}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)] transition-all duration-300 ease-in-out hover:border-[color:var(--brand-primary)]"
        >
          <Triangle className={ICON_SMALL} />
          <span className="shrink-0 whitespace-nowrap">Triangle</span>
        </button>
        <button
          onClick={() => handleAddShape(objectFactories.addStar)}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)] transition-all duration-300 ease-in-out hover:border-[color:var(--brand-primary)]"
        >
          <Star className={ICON_SMALL} />
          <span className="shrink-0 whitespace-nowrap">Star</span>
        </button>
      </div>
    </PopoverSurface>
  );
};

const CanvasQuickBar: React.FC<{ onSelectNav: (nav: NavId) => void }> = ({ onSelectNav }) => (
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
  </div>
);

interface EditorShellProps {
  onBackToDashboard?: () => void;
}

export const EditorShell: React.FC<EditorShellProps> = ({ onBackToDashboard }) => {
  useKeyboardShortcuts();
  const {
    toastMessage,
    setToastMessage,
    canvas,
    saveState,
    consumeHistoryDirty,
    activeTool,
    setActiveTool,
    setBrushColor,
    setCanvasBackgroundColor,
    snapEnabled,
    setSnapEnabled,
    gridEnabled,
    setGridEnabled,
    showExportModal,
    setShowExportModal,
  } = useEditorStore(
    (state) => ({
      toastMessage: state.toastMessage,
    setToastMessage: state.setToastMessage,
    canvas: state.canvas,
    saveState: state.saveState,
    consumeHistoryDirty: state.consumeHistoryDirty,
    activeTool: state.activeTool,
    setActiveTool: state.setActiveTool,
    setBrushColor: state.setBrushColor,
    setCanvasBackgroundColor: state.setCanvasBackgroundColor,
    snapEnabled: state.snapEnabled,
    setSnapEnabled: state.setSnapEnabled,
    gridEnabled: state.gridEnabled,
    setGridEnabled: state.setGridEnabled,
    showExportModal: state.showExportModal,
    setShowExportModal: state.setShowExportModal,
  }),
    shallow
  );
  const { themeData, canvasBackgroundColor } = useThemeStore(
    (state) => ({
      themeData: state.themeData,
      canvasBackgroundColor: state.canvasBackgroundColor,
    }),
    shallow
  );
  const [isBrandModalOpen, setIsBrandModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [activeNav, setActiveNav] = useState<NavId | null>(null);
  const [isShapesOpen, setIsShapesOpen] = useState(false);
  const [isFillPopoverOpen, setIsFillPopoverOpen] = useState(false);

  useEffect(() => {
    if (!toastMessage) return;
    const timeout = window.setTimeout(() => setToastMessage(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [toastMessage, setToastMessage]);

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
    setIsShapesOpen(false);
    setActiveNav((prev) => (prev === id ? null : id));
  };

  const toggleShapes = () => {
    setActiveNav(null);
    setIsShapesOpen((prev) => !prev);
  };

  const renderPanel = () => {
    if (!activeNav) return null;
    switch (activeNav) {
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
        <ProjectPresetsModal />
        
        {toastMessage && (
            <div className="fixed bottom-4 right-4 bg-[#0f0707] text-white text-sm px-4 py-2 rounded-lg shadow-[0_0_24px_rgba(0,0,0,0.35)] z-50">
                {toastMessage}
            </div>
        )}

      <header className="toolbar-section justify-between bg-[color:var(--ui-panel)] backdrop-blur-[var(--ui-blur)] border-b border-[color:var(--ui-border)] z-10">
        <div className="w-72 flex items-center gap-3">
          <h1 className="font-semibold uppercase tracking-widest text-xs text-slate-200">DSGN Studio</h1>
          <FileDropdown />
        </div>
        <div className="flex-1 flex justify-center items-center gap-4">
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
                <Tooltip content="Pan (Space)" side="bottom">
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
                                value={canvasBackgroundColor || DEFAULT_CANVAS_BACKGROUND}
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
            <Tooltip content="Download (⌘E)" side="bottom">
              <button
                onClick={() => setShowExportModal(true)}
                className="group flex items-center justify-center rounded-full border border-[color:var(--border-subtle)] bg-white/5 p-2 text-slate-200 hover:bg-white/10 transition-all duration-300 ease-in-out"
                aria-label="Download"
              >
                <Download className={ICON_SMALL} />
              </button>
            </Tooltip>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="relative flex h-full">
          <div className="relative flex h-full">
            <div className="flex flex-col items-center gap-6 py-5 px-1 bg-[color:var(--ui-panel)]/70 backdrop-blur-[var(--ui-blur)] border-r border-[color:var(--ui-border)]">
              <button
                onClick={toggleShapes}
                className={`group w-10 h-10 flex items-center justify-center rounded-2xl transition-all duration-300 ease-in-out ${
                  isShapesOpen ? 'bg-white/20 text-[color:var(--ui-panel-text)] shadow-[0_0_22px_rgba(248,249,250,0.5)]' : 'text-[color:var(--ui-panel-text)] hover:text-[color:var(--ui-panel-text)] hover:bg-white/10'
                }`}
                aria-label="Shapes"
                title="Shapes"
              >
                <Square className={NAV_ICON} />
              </button>
              <div className="h-px w-6 bg-white/10" />
              <NavStrip activeNav={activeNav} onSelect={handleSelectNav} />
              <div className="flex-1" />
              <button
                onClick={() => setIsBrandModalOpen(true)}
                className="group w-10 h-10 flex items-center justify-center rounded-2xl text-[color:var(--ui-panel-text)] transition-all duration-300 ease-in-out hover:text-[color:var(--ui-panel-text)] hover:bg-white/10"
                aria-label="Brand Vault"
                title="Brand Vault"
              >
                <Briefcase className={NAV_ICON} />
              </button>
            </div>
            {isShapesOpen && (
              <div className="absolute left-full top-4 z-50 ml-3">
                <ShapesPopover onClose={() => setIsShapesOpen(false)} />
              </div>
            )}
            {activeNav && (
              <div className="absolute left-full top-20 z-30 ml-3 w-[280px]">
                <div className="rounded-2xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel-opaque)] text-[color:var(--ui-panel-text)] shadow-[0_18px_40px_rgba(0,0,0,0.4)] backdrop-blur-[var(--ui-blur)] overflow-hidden">
                  <div className="px-4 py-3 border-b border-[color:var(--border-subtle)]">
                    <span className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">{NAV_ITEMS.find((item) => item.id === activeNav)?.label}</span>
                  </div>
                  <div className="max-h-[75vh] overflow-y-auto">
                    {renderPanel()}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <main className="flex-1 relative overflow-hidden bg-[color:var(--ui-bg)]">
            <CanvasRuler />
            <CanvasQuickBar onSelectNav={handleSelectNav} />
            <SelectionToolbar />
            <CanvasStage onSelectNav={handleSelectNav} />
        </main>

        <aside className={`bg-[color:var(--ui-panel)]/70 backdrop-blur-[var(--ui-blur)] transition-all duration-300 ease-in-out overflow-hidden w-80 border-l border-[color:var(--ui-border)]`}>
            <PropertiesPanel />
        </aside>
      </div>
      <StatusBar />
      <KeyboardShortcutHelp />
    </div>
  );
};
