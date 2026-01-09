
import React, { useEffect, useRef, useState } from 'react';
import { shallow } from 'zustand/shallow';
import * as fabric from 'fabric';
import { CanvasSettingsPopover } from './CanvasSettingsPopover';
import {
  Briefcase,
  ChevronDown,
  FileImage,
  FileText,
  FileUp,
  Heading1,
  Heading2,
  LayoutTemplate,
  Layers,
  MousePointer2,
  Pencil,
  Eraser,
  Hand,
  PaintBucket,
  Magnet,
  Grid,
  Pilcrow,
  SlidersHorizontal,
  Square,
  Circle,
  Triangle,
  Star,
  Sticker,
  Type,
  Upload,
} from 'lucide-react';
import { sanityCheckCanvas, useEditorStore } from '../state/editorStore';
import { BrandModal } from './BrandModal';
import { ExportModal } from './ExportModal';
import { LayersPanel } from './LayersPanel';
import { CanvasStage } from './CanvasStage';
import { CanvasRuler } from './CanvasRuler';
import { StatusBar } from './StatusBar';
import { ThemeSidebar } from './ThemeSidebar';
import { TemplateBrowser } from './TemplateBrowser';
import { StickerTab } from './StickerTab';
import { downloadPdf, downloadSvg } from '../fabric/exportUtils';
import * as objectFactories from '../fabric/objectFactories';
import { loadPdfAsBackground } from '../fabric/pdfUtils';
import { SettingsModal } from './SettingsModal';
import { ProjectPresetsModal } from './ProjectPresetsModal';
import { v4 as uuidv4 } from 'uuid';
import { Popover } from './Popover';

const ICON_SMALL = 'icon-muted w-4 h-4 stroke-[1.5]';
const NAV_ICON = 'w-5 h-5 stroke-[1.5]';

type NavId = 'design' | 'blueprints' | 'stickers' | 'text' | 'uploads';

const NAV_ITEMS: Array<{ id: NavId; label: string; icon: React.ReactElement }> = [
  { id: 'design', label: 'Layers', icon: <Layers /> },
  { id: 'blueprints', label: 'Blueprints', icon: <LayoutTemplate /> },
  { id: 'stickers', label: 'Stickers', icon: <Sticker /> },
  { id: 'text', label: 'Text', icon: <Type /> },
  { id: 'uploads', label: 'Uploads', icon: <Upload /> },
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
                <div className="absolute left-0 mt-2 w-56 bg-[color:var(--ui-panel)] rounded-lg shadow-xl z-20 border border-[color:var(--ui-border)] backdrop-blur-[var(--ui-blur)]">
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
                </div>
            )}
        </div>
    );
};

const ExportDropdown: React.FC<{ openModal: (format: 'jpeg' | 'png') => void }> = ({ openModal }) => {
    const [isOpen, setIsOpen] = useState(false);
    const canvas = useEditorStore((state) => state.canvas);

    const handleDirectExport = async (handler: (canvas: fabric.Canvas) => Promise<void> | void) => {
        if (canvas) await handler(canvas);
        setIsOpen(false);
    }

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="group flex items-center gap-2 px-4 py-2 bg-white/5 text-slate-200 rounded-full border border-[color:var(--border-subtle)] hover:bg-white/10 transition-all duration-300 ease-in-out text-[11px] uppercase tracking-widest"
            >
                <span>Export</span>
                <ChevronDown className={`icon-muted w-4 h-4 stroke-[1.5] transition-all duration-300 ease-in-out ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
                 <div className="absolute right-0 mt-2 w-48 bg-[#120707] rounded-lg shadow-xl z-20 border border-[color:var(--border-subtle)] backdrop-blur-md">
                    <ul>
                        <li><button onClick={() => { openModal('png'); setIsOpen(false); }} className="w-full text-left px-4 py-2 text-xs uppercase tracking-widest text-slate-200 hover:bg-white/10">PNG</button></li>
                        <li><button onClick={() => { openModal('jpeg'); setIsOpen(false); }} className="w-full text-left px-4 py-2 text-xs uppercase tracking-widest text-slate-200 hover:bg-white/10">JPG</button></li>
                        <li><button onClick={() => handleDirectExport(downloadSvg)} className="w-full text-left px-4 py-2 text-xs uppercase tracking-widest text-slate-200 hover:bg-white/10">SVG</button></li>
                        <li><button onClick={() => handleDirectExport(downloadPdf)} className="w-full text-left px-4 py-2 text-xs uppercase tracking-widest text-slate-200 hover:bg-white/10">PDF</button></li>
                    </ul>
                </div>
            )}
        </div>
    )
}

interface NavStripProps {
  activeNav: NavId | null;
  onSelect: (id: NavId) => void;
}

const NavStrip: React.FC<NavStripProps> = ({ activeNav, onSelect }) => (
  <div className="flex flex-col items-center gap-6 py-5">
    {NAV_ITEMS.map((item) => {
      const isActive = activeNav === item.id;
      return (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          className={`group w-10 h-10 flex items-center justify-center rounded-2xl transition-all duration-300 ease-in-out ${
            isActive
              ? 'bg-white/20 text-[color:var(--ui-panel-text)] shadow-[0_0_22px_rgba(248,249,250,0.5)]'
              : 'text-[color:var(--ui-panel-text)] hover:text-[color:var(--ui-panel-text)] hover:bg-white/10'
          }`}
          aria-label={item.label}
          title={item.label}
        >
          {React.cloneElement(item.icon, { className: `${NAV_ICON} transition-colors` })}
        </button>
      );
    })}
  </div>
);

const ShapesPopover: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const handleAddShape = (factory: (canvas: fabric.Canvas) => void) => {
    const { canvas, saveState, themeData } = useEditorStore.getState();
    if (!canvas) return;
    factory(canvas);
    sanityCheckCanvas(canvas, themeData);
    saveState();
    onClose();
  };

  return (
    <div className="rounded-2xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel-opaque)] p-4 text-[color:var(--ui-panel-text)] shadow-[0_18px_40px_rgba(0,0,0,0.4)] backdrop-blur-[var(--ui-blur)] min-w-[160px] w-fit z-50">
      <h3 className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)] mb-3">Shapes</h3>
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
    </div>
  );
};

const CanvasQuickBar: React.FC<{ onSelectNav: (nav: NavId) => void }> = ({ onSelectNav }) => (
  <div className="canvas-quickbar absolute left-1/2 top-12 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full border border-[color:var(--ui-border)] bg-[color:var(--ui-panel-opaque)] px-2 py-1 backdrop-blur-[var(--ui-blur)] shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
    <button
      onClick={() => onSelectNav('design')}
      className="group rounded-full px-3 py-2 text-slate-200 transition-all duration-300 ease-in-out hover:bg-white/10"
      aria-label="Select"
      title="Select"
    >
      <MousePointer2 className={NAV_ICON} />
    </button>
    <button
      onClick={() => onSelectNav('text')}
      className="group rounded-full px-3 py-2 text-slate-200 transition-all duration-300 ease-in-out hover:bg-white/10"
      aria-label="Text"
      title="Text"
    >
      <Type className={NAV_ICON} />
    </button>
    <button
      onClick={() => onSelectNav('design')}
      className="group rounded-full px-3 py-2 text-slate-200 transition-all duration-300 ease-in-out hover:bg-white/10"
      aria-label="Shape"
      title="Shape"
    >
      <Square className={NAV_ICON} />
    </button>
    <button
      onClick={() => onSelectNav('uploads')}
      className="group rounded-full px-3 py-2 text-slate-200 transition-all duration-300 ease-in-out hover:bg-white/10"
      aria-label="Upload"
      title="Upload"
    >
      <Upload className={NAV_ICON} />
    </button>
  </div>
);

const TextPanel: React.FC = () => {
  const { canvas, saveState } = useEditorStore(
    (state) => ({
      canvas: state.canvas,
      saveState: state.saveState,
    }),
    shallow
  );

  const addText = (options: { text: string; fontSize: number; fontWeight?: string; role?: 'heading' | 'subheading' | 'body' }) => {
    if (!canvas) return;
    objectFactories.addIText(canvas, options);
    saveState();
  };

  const addFixedTextbox = () => {
    if (!canvas) return;
    objectFactories.addFixedTextbox(canvas);
    saveState();
  };

  return (
    <div className="p-5 space-y-3 text-[color:var(--ui-panel-text)]">
      <h3 className="text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">Text Rituals</h3>
      <button
        onClick={() => addText({ text: 'Heading', fontSize: 80, fontWeight: 'bold', role: 'heading' })}
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-xs uppercase tracking-widest text-[color:var(--ui-panel-text)] transition-all duration-300 ease-in-out hover:border-[color:var(--brand-primary)]"
      >
        <div className="flex items-center gap-3">
          <Heading1 className={ICON_SMALL} />
          Heading
        </div>
      </button>
      <button
        onClick={() => addText({ text: 'Subheading', fontSize: 50, fontWeight: 'normal', role: 'subheading' })}
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-xs uppercase tracking-widest text-[color:var(--ui-panel-text)] transition-all duration-300 ease-in-out hover:border-[color:var(--brand-primary)]"
      >
        <div className="flex items-center gap-3">
          <Heading2 className={ICON_SMALL} />
          Subheading
        </div>
      </button>
      <button
        onClick={() => addText({ text: 'Body text', fontSize: 24, fontWeight: 'normal', role: 'body' })}
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-xs uppercase tracking-widest text-[color:var(--ui-panel-text)] transition-all duration-300 ease-in-out hover:border-[color:var(--brand-primary)]"
      >
        <div className="flex items-center gap-3">
          <Pilcrow className={ICON_SMALL} />
          Body Text
        </div>
      </button>
      <button
        onClick={addFixedTextbox}
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-xs uppercase tracking-widest text-[color:var(--ui-panel-text)] transition-all duration-300 ease-in-out hover:border-[color:var(--brand-primary)]"
      >
        <div className="flex items-center gap-3">
          <FileText className={ICON_SMALL} />
          Fixed Textbox
        </div>
      </button>
    </div>
  );
};

const UploadsPanel: React.FC = () => {
  const { canvas, saveState, addAssetToLibrary } = useEditorStore(
    (state) => ({
      canvas: state.canvas,
      saveState: state.saveState,
      addAssetToLibrary: state.addAssetToLibrary,
    }),
    shallow
  );
  const imageInputRef = useRef<HTMLInputElement>(null);
  const svgInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && canvas) { // Add canvas check here for early exit
      const objectURL = URL.createObjectURL(file);
      const baseName = file.name.split('.').slice(0, -1).join('.') || file.name;
      const format = file.type === 'image/png' ? 'png' : (file.type === 'image/jpeg' ? 'jpeg' : undefined);

      // Add asset to library with blob URL
      addAssetToLibrary({
        id: uuidv4(),
        url: objectURL, // Store blob URL
        label: baseName,
        format: format, // Use derived format
        tags: [baseName.toLowerCase(), 'upload'],
      });

      // Load image onto canvas with blob URL
      fabric.Image.fromURL(objectURL, { crossOrigin: 'anonymous' }).then((img: fabric.FabricImage) => {
        canvas.add(img);
        canvas.centerObject(img);
        canvas.requestRenderAll();
        saveState();
        // The objectURL will be managed by imageAssets and revoked when the asset is removed.
      }).catch((error) => {
        console.error("Error loading image:", error);
        URL.revokeObjectURL(objectURL); // Revoke if loading fails
      });
    }
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const handleSvgFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && canvas) {
      const reader = new FileReader();
      reader.onload = (f: ProgressEvent<FileReader>) => {
        const svgString = f.target?.result as string;
        objectFactories.addSvgFromUrl(canvas, svgString);
      };
      reader.readAsText(file);
    }
    if (svgInputRef.current) svgInputRef.current.value = '';
  };

  const handlePdfFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && canvas) {
      loadPdfAsBackground(file, canvas);
    }
    if (pdfInputRef.current) pdfInputRef.current.value = '';
  };

  return (
    <div className="p-4 space-y-3 text-[color:var(--ui-panel-text)]">
      <input type="file" accept="image/png, image/jpeg" ref={imageInputRef} onChange={handleImageFileChange} className="hidden" />
      <input type="file" accept=".svg" ref={svgInputRef} onChange={handleSvgFileChange} className="hidden" />
      <input type="file" accept=".pdf" ref={pdfInputRef} onChange={handlePdfFileChange} className="hidden" />

      <h3 className="text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">Uploads</h3>
      <button
        onClick={() => imageInputRef.current?.click()}
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-xs uppercase tracking-widest text-[color:var(--ui-panel-text)] transition-all duration-300 ease-in-out hover:border-[color:var(--brand-primary)]"
      >
        <div className="flex items-center gap-3">
          <FileImage className={ICON_SMALL} />
          Upload Image
        </div>
      </button>
      <button
        onClick={() => svgInputRef.current?.click()}
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-xs uppercase tracking-widest text-[color:var(--ui-panel-text)] transition-all duration-300 ease-in-out hover:border-[color:var(--brand-primary)]"
      >
        <div className="flex items-center gap-3">
          <FileUp className={ICON_SMALL} />
          Import SVG
        </div>
      </button>
      <button
        onClick={() => pdfInputRef.current?.click()}
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-xs uppercase tracking-widest text-[color:var(--ui-panel-text)] transition-all duration-300 ease-in-out hover:border-[color:var(--brand-primary)]"
      >
        <div className="flex items-center gap-3">
          <FileText className={ICON_SMALL} />
          PDF Background
        </div>
      </button>
    </div>
  );
};

export const EditorShell: React.FC = () => {
  const {
    toastMessage,
    setToastMessage,
    canvas,
    saveState,
    consumeHistoryDirty,
    activeTool,
    setActiveTool,
    setBrushColor,
    themeData,
    canvasBackgroundColor,
    setCanvasBackgroundColor,
    snapEnabled,
    setSnapEnabled,
    gridEnabled,
    setGridEnabled,
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
      themeData: state.themeData,
      canvasBackgroundColor: state.canvasBackgroundColor,
      setCanvasBackgroundColor: state.setCanvasBackgroundColor,
      snapEnabled: state.snapEnabled,
      setSnapEnabled: state.setSnapEnabled,
      gridEnabled: state.gridEnabled,
      setGridEnabled: state.setGridEnabled,
    }),
    shallow
  );
  const [isBrandModalOpen, setIsBrandModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'jpeg' | 'png'>('png');
  const [activeNav, setActiveNav] = useState<NavId | null>(null);
  const [isShapesOpen, setIsShapesOpen] = useState(false);
  const [isFillPopoverOpen, setIsFillPopoverOpen] = useState(false);

  const openExportModal = (format: 'jpeg' | 'png') => {
      setExportFormat(format);
      setIsExportModalOpen(true);
  }

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
      case 'design':
        return <LayersPanel />;
      case 'blueprints':
        return <TemplateBrowser />;
      case 'stickers':
        return <StickerTab />;
      case 'text':
        return <TextPanel />;
      case 'uploads':
        return <UploadsPanel />;
      default:
        return null;
    }
  };

  return (
    <div className="w-screen h-screen bg-[color:var(--ui-bg)] text-[color:var(--ui-text)] flex flex-col">
        <BrandModal isOpen={isBrandModalOpen} onClose={() => setIsBrandModalOpen(false)} />
        <ExportModal isOpen={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} format={exportFormat} />
        <SettingsModal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} />
        <ProjectPresetsModal />
        
        {toastMessage && (
            <div className="fixed bottom-4 right-4 bg-[#0f0707] text-white text-sm px-4 py-2 rounded-lg shadow-[0_0_24px_rgba(0,0,0,0.35)] z-50">
                {toastMessage}
            </div>
        )}

      <header className="flex items-center justify-between p-4 bg-[color:var(--ui-panel)] backdrop-blur-[var(--ui-blur)] border-b border-[color:var(--ui-border)] z-10">
        <div className="w-72 flex items-center gap-3">
          <h1 className="font-semibold uppercase tracking-widest text-xs text-slate-200">DSGN Studio</h1>
          <FileDropdown />
        </div>
        <div className="flex-1 flex justify-center items-center gap-4">
            <div className="flex items-center gap-4 rounded-full border border-[color:var(--border-subtle)] bg-white/5 px-4 py-2">
                <button
                    onClick={() => setActiveTool('select')}
                    className={`rounded-full p-2 transition-all duration-300 ease-in-out ${
                        activeTool === 'select'
                          ? 'bg-[#F8F9FA]/25 text-[#F8F9FA] shadow-[0_0_22px_rgba(248,249,250,0.7)]'
                          : 'text-[#F8F9FA] hover:text-white hover:bg-white/10'
                    }`}
                    aria-label="Select tool"
                    title="Select"
                >
                    <MousePointer2 className="w-4 h-4 stroke-[1.5]" />
                </button>
                <button
                    onClick={() => setActiveTool('erase')}
                    className={`rounded-full p-2 transition-all duration-300 ease-in-out ${
                        activeTool === 'erase'
                          ? 'bg-[#F8F9FA]/25 text-[#F8F9FA] shadow-[0_0_22px_rgba(248,249,250,0.7)]'
                          : 'text-[#F8F9FA] hover:text-white hover:bg-white/10'
                    }`}
                    aria-label="Eraser tool"
                    title="Eraser"
                >
                    <Eraser className="w-4 h-4 stroke-[1.5]" />
                </button>
                <button
                    onClick={() => setActiveTool('pan')}
                    className={`rounded-full p-2 transition-all duration-300 ease-in-out ${
                        activeTool === 'pan'
                          ? 'bg-[#F8F9FA]/25 text-[#F8F9FA] shadow-[0_0_22px_rgba(248,249,250,0.7)]'
                          : 'text-[#F8F9FA] hover:text-white hover:bg-white/10'
                    }`}
                    aria-label="Hand tool"
                    title="Hand"
                >
                    <Hand className="w-4 h-4 stroke-[1.5]" />
                </button>
                <button
                    onClick={() => setSnapEnabled(!snapEnabled)}
                    className={`rounded-full p-2 transition-all duration-300 ease-in-out ${
                      snapEnabled
                        ? 'bg-[#F8F9FA]/25 text-[#F8F9FA] shadow-[0_0_22px_rgba(248,249,250,0.7)]'
                        : 'text-[#F8F9FA] hover:text-white hover:bg-white/10'
                    }`}
                    aria-label="Toggle snapping"
                    title="Snap to grid"
                >
                    <Magnet className="w-4 h-4 stroke-[1.5]" />
                </button>
                <button
                    onClick={() => setGridEnabled(!gridEnabled)}
                    className={`rounded-full p-2 transition-all duration-300 ease-in-out ${
                      gridEnabled
                        ? 'bg-[#F8F9FA]/25 text-[#F8F9FA] shadow-[0_0_22px_rgba(248,249,250,0.7)]'
                        : 'text-[#F8F9FA] hover:text-white hover:bg-white/10'
                    }`}
                    aria-label="Toggle grid"
                    title="Toggle grid"
                >
                    <Grid className="w-4 h-4 stroke-[1.5]" />
                </button>
            </div>
            <div className="relative flex items-center gap-4 rounded-full border border-[color:var(--border-subtle)] bg-white/5 px-4 py-2">
                <button
                    onClick={() => {
                        setActiveTool('draw');
                        setBrushColor(themeData?.brand?.primary?.value || '#1f2933');
                    }}
                    className={`rounded-full p-2 transition-all duration-300 ease-in-out ${
                        activeTool === 'draw'
                          ? 'bg-[#F8F9FA]/25 text-[#F8F9FA] shadow-[0_0_22px_rgba(248,249,250,0.7)]'
                          : 'text-[#F8F9FA] hover:text-white hover:bg-white/10'
                    }`}
                    aria-label="Pencil tool"
                    title="Pencil"
                >
                    <Pencil className="w-4 h-4 stroke-[1.5]" />
                </button>
                <Popover
                  isOpen={isFillPopoverOpen}
                  onOpenChange={setIsFillPopoverOpen}
                  ariaLabel="Paint bucket"
                  trigger={
                    <button
                        className="rounded-full p-2 text-[#F8F9FA] transition-all duration-300 ease-in-out hover:text-white hover:bg-white/10"
                        title="Canvas fill"
                    >
                        <PaintBucket className="w-4 h-4 stroke-[1.5]" />
                    </button>
                  }
                >
                    <div
                        className="absolute left-1/2 top-full z-30 mt-3 w-40 -translate-x-1/2 rounded-xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel-opaque)] p-3 shadow-[0_16px_30px_rgba(0,0,0,0.4)] backdrop-blur-[var(--ui-blur)]"
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase tracking-widest text-slate-300">Canvas</span>
                            <input
                                type="color"
                                value={canvasBackgroundColor || '#ffffff'}
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
                    saveState();
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
            <ExportDropdown openModal={openExportModal} />
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
            <CanvasStage onSelectNav={handleSelectNav} />
        </main>

        <aside className={`bg-[color:var(--ui-panel)]/70 backdrop-blur-[var(--ui-blur)] transition-all duration-300 ease-in-out overflow-hidden w-80 border-l border-[color:var(--ui-border)]`}>
            <PropertiesPanel />
        </aside>
      </div>
      <StatusBar />
    </div>
  );
};

const PropertiesPanel: React.FC = () => {
  const { selectedObject, canvas, saveState, requestLayerSync } = useEditorStore(
    (state) => ({
      selectedObject: state.selectedObject,
      canvas: state.canvas,
      saveState: state.saveState,
      requestLayerSync: state.requestLayerSync,
    }),
    shallow
  );

  const isText = selectedObject?.type === 'i-text' || selectedObject?.type === 'textbox';
  const isRect = selectedObject?.type === 'rect';
  const isShape = selectedObject?.type === 'rect'
    || selectedObject?.type === 'circle'
    || selectedObject?.type === 'triangle'
    || selectedObject?.type === 'polygon';

  const fillValue =
    typeof (selectedObject as any)?.fill === 'string'
      ? ((selectedObject as any).fill as string)
      : '#ffffff';

  const updateSelectedObject = (updates: Record<string, any>) => {
    if (!selectedObject || !canvas) return;
    selectedObject.set(updates);
    selectedObject.setCoords();
    canvas.requestRenderAll();
    requestLayerSync();
    saveState();
  };

  const handleCornerRadius = (value: number) => {
    if (!selectedObject || selectedObject.type !== 'rect' || !canvas) return;
    const rect = selectedObject as fabric.Rect;
    rect.set({ rx: value, ry: value });
    (rect as any).__baseRx = value * (rect.scaleX ?? 1);
    (rect as any).__baseRy = value * (rect.scaleY ?? 1);
    rect.setCoords();
    canvas.requestRenderAll();
    requestLayerSync();
    saveState();
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between border-b border-[color:var(--border-subtle)] px-4 py-3">
        <span className="text-[11px] uppercase tracking-widest text-slate-300">Properties</span>
      </div>
      <div className="relative flex-1 overflow-y-auto p-4 space-y-6">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-slate-400">Selection</span>
            <span className="text-[10px] uppercase tracking-widest text-slate-500">
              {selectedObject ? selectedObject.type : 'None'}
            </span>
          </div>

          {!selectedObject && (
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-4 text-xs text-slate-400">
              Select an object to edit its properties.
            </div>
          )}

          {selectedObject && isShape && (
            <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 px-4 py-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-slate-400">Fill</span>
                <input
                  type="color"
                  value={fillValue}
                  onChange={(e) => updateSelectedObject({ fill: e.target.value, tokenRole: null })}
                  className="h-6 w-10 cursor-pointer rounded border border-white/10 bg-transparent"
                  aria-label="Fill color"
                />
              </div>
              {isRect && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-widest text-slate-400">Corner Radius</span>
                    <span className="text-[10px] uppercase tracking-widest text-slate-300">
                      {Math.round((selectedObject as fabric.Rect).rx ?? 0)}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="80"
                    value={(selectedObject as fabric.Rect).rx ?? 0}
                    onChange={(e) => handleCornerRadius(Number(e.target.value))}
                    className="w-full accent-[color:var(--brand-primary)]"
                  />
                </div>
              )}
            </div>
          )}

          {selectedObject && isText && (
            <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 px-4 py-4">
              <label className="flex flex-col gap-2 text-[10px] uppercase tracking-widest text-slate-400">
                Font Family
                <input
                  type="text"
                  value={(selectedObject as any).fontFamily || ''}
                  onChange={(e) => updateSelectedObject({ fontFamily: e.target.value })}
                  className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-slate-200"
                />
              </label>
              <label className="flex flex-col gap-2 text-[10px] uppercase tracking-widest text-slate-400">
                Font Size
                <input
                  type="number"
                  min="6"
                  max="300"
                  value={(selectedObject as any).fontSize || 16}
                  onChange={(e) => updateSelectedObject({ fontSize: Number(e.target.value) })}
                  className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-slate-200"
                />
              </label>
              <label className="flex flex-col gap-2 text-[10px] uppercase tracking-widest text-slate-400">
                Weight
                <select
                  value={(selectedObject as any).fontWeight || 'normal'}
                  onChange={(e) => updateSelectedObject({ fontWeight: e.target.value })}
                  className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-slate-200"
                >
                  <option value="normal">Normal</option>
                  <option value="bold">Bold</option>
                  <option value="lighter">Light</option>
                </select>
              </label>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-slate-400">Theme Hub</span>
          </div>
          <ThemeSidebar />
        </section>
      </div>
    </div>
  );
};
