
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as fabric from 'fabric';
import { ThemeSidebar } from './ThemeSidebar';
import { CanvasSettingsPopover } from './CanvasSettingsPopover';
import { Upload, PanelRight, Palmtree, CaseUpper, Undo, Redo, Combine, Split, Briefcase, ChevronDown, Droplet, Lock, Unlock, AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, LayoutTemplate } from 'lucide-react';
const ICON_LARGE = 'icon-muted w-5 h-5 stroke-[1.5]';
const ICON_SMALL = 'icon-muted w-4 h-4 stroke-[1.5]';
import { useEditorStore } from '../state/editorStore';
import { BrandModal } from './BrandModal';
import { ExportModal } from './ExportModal';
import { LayersPanel } from './LayersPanel';
import { SidebarBlueprints } from './SidebarBlueprints';
import { Inserter } from './Inserter';
import { CanvasStage } from './CanvasStage';
import { Ruler } from './Ruler';
import { StatusBar } from './StatusBar';
import { downloadPdf, downloadSvg } from '../fabric/exportUtils';
import { resizeCanvas } from '../fabric/canvasUtils';
import { groupObjects, ungroupObjects } from '../fabric/grouping';
import { distributeHorizontally, distributeVertically } from '../fabric/alignment';
import { getContrastRatio } from '../utils/contrast';
import { loadGoogleFont } from '../utils/fonts';



const ExportDropdown: React.FC<{ openModal: (format: 'jpeg' | 'png') => void }> = ({ openModal }) => {
    const [isOpen, setIsOpen] = useState(false);
    const { canvas } = useEditorStore();

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
                        <li><button onClick={() => { openModal('png'); setIsOpen(false); }} className="w-full text-left px-4 py-2 text-xs uppercase tracking-widest text-slate-200 hover:bg-white/10 transition-all duration-300 ease-in-out">PNG</button></li>
                        <li><button onClick={() => { openModal('jpeg'); setIsOpen(false); }} className="w-full text-left px-4 py-2 text-xs uppercase tracking-widest text-slate-200 hover:bg-white/10 transition-all duration-300 ease-in-out">JPG</button></li>
                        <li><button onClick={() => handleDirectExport(downloadSvg)} className="w-full text-left px-4 py-2 text-xs uppercase tracking-widest text-slate-200 hover:bg-white/10 transition-all duration-300 ease-in-out">SVG</button></li>
                        <li><button onClick={() => handleDirectExport(downloadPdf)} className="w-full text-left px-4 py-2 text-xs uppercase tracking-widest text-slate-200 hover:bg-white/10 transition-all duration-300 ease-in-out">PDF</button></li>
                    </ul>
                </div>
            )}
        </div>
    )
}


// Main layout component for the editor
export const EditorShell: React.FC = () => {
  const { canvas, selectedObject, undo, redo, history, historyIndex, toastMessage, setToastMessage, themeData, customFonts, saveState, saveTemplate, isTemplateSaving } = useEditorStore();
  const [isBrandModalOpen, setIsBrandModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'jpeg' | 'png'>('png');
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');

  const themeVars = useMemo(() => ({
    '--brand-primary': themeData?.brand?.primary || '#e84a4a',
    '--brand-accent': themeData?.brand?.accent || '#d3828d',
    '--border-subtle': themeData?.borders?.subtle || themeData?.borderSubtle || themeData?.bordersubtle || '#582828',
    '--muted-icon': themeData?.typography?.textmuted || '#af9d9d',
  }) as React.CSSProperties, [themeData]);

  const openExportModal = (format: 'jpeg' | 'png') => {
      setExportFormat(format);
      setIsExportModalOpen(true);
  }

  const handleTemplateSave = async () => {
    await saveTemplate(templateName);
    setTemplateName('');
    setIsTemplateModalOpen(false);
  }

  const handleGroup = () => {
    if (canvas) {
        groupObjects(canvas);
    }
  }

  const handleUngroup = () => {
      if (canvas) {
          ungroupObjects(canvas);
      }
  }

  const handleDistributeHorizontal = () => {
      if (canvas) {
          distributeHorizontally(canvas);
      }
  }

  const handleDistributeVertical = () => {
      if (canvas) {
          distributeVertically(canvas);
      }
  }

  useEffect(() => {
    if (!toastMessage) return;
    const timeout = window.setTimeout(() => setToastMessage(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [toastMessage, setToastMessage]);

  const isMultiSelection = selectedObject && selectedObject.type === 'activeSelection' && (selectedObject as fabric.ActiveSelection).size() >= 2;
  const isTextSelected = selectedObject?.type === 'i-text' || selectedObject?.type === 'textbox' || selectedObject?.type === 'text';
  const isImageSelected = selectedObject?.type === 'image';
  const isInspectorOpen = !!selectedObject;

  const textObject = isTextSelected ? (selectedObject as fabric.IText) : null;
  const imageObject = isImageSelected ? (selectedObject as fabric.Image) : null;

  const textFontOptions = useMemo(() => Array.from(new Set([
    ...GOOGLE_FONTS,
    ...customFonts,
    textObject?.fontFamily,
  ].filter(Boolean))) as string[], [customFonts, textObject?.fontFamily]);

  const handleTextToolbarChange = (prop: string, value: any) => {
    if (!textObject || !canvas) return;
    if (prop === 'fontFamily') {
      loadGoogleFont(value);
    }
    textObject.set(prop, value);
    canvas.requestRenderAll();
    saveState();
  };

  const handleImageOpacityChange = (value: number) => {
    if (!imageObject || !canvas) return;
    imageObject.set('opacity', value);
    canvas.requestRenderAll();
    saveState();
  };

  const handleImageBlurChange = (value: number) => {
    if (!imageObject || !canvas) return;
    imageObject.filters = imageObject.filters?.filter((f: fabric.filters.BaseFilter<string, any>) => !(f instanceof fabric.filters.Blur)) || [];
    if (value > 0) {
      imageObject.filters.push(new fabric.filters.Blur({ blur: value }));
    }
    imageObject.applyFilters();
    canvas.requestRenderAll();
    saveState();
  };

  const handleImageCrop = () => {
    if (!imageObject || !canvas) return;
    const width = imageObject.width || 0;
    const height = imageObject.height || 0;
    if (width === 0 || height === 0) return;
    const size = Math.min(width, height);
    imageObject.set({
      cropX: (width - size) / 2,
      cropY: (height - size) / 2,
      width: size,
      height: size,
    });
    canvas.requestRenderAll();
    saveState();
  };

  const currentBlur = imageObject?.filters?.find((f: fabric.filters.BaseFilter<string, any>) => f instanceof fabric.filters.Blur) as fabric.filters.Blur | undefined;

  return (
    <div style={themeVars} className="w-screen h-screen bg-[#1c0d0d] text-slate-100 flex flex-col">
        <BrandModal isOpen={isBrandModalOpen} onClose={() => setIsBrandModalOpen(false)} />
        <ExportModal isOpen={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} format={exportFormat} />
        {isTemplateModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
                <div className="bg-[#120707] border border-[color:var(--border-subtle)] rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 text-slate-200">
                    <div className="flex items-center justify-between border-b border-white/10 pb-3">
                        <h2 className="text-sm uppercase tracking-widest">Save as Template</h2>
                        <button
                            onClick={() => {
                                setIsTemplateModalOpen(false);
                                setTemplateName('');
                            }}
                            className="text-xs uppercase tracking-widest text-slate-500 hover:text-slate-200 transition-colors duration-300 ease-in-out"
                        >
                            Close
                        </button>
                    </div>
                    <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest text-slate-500">Template Name</label>
                        <input
                            value={templateName}
                            onChange={(e) => setTemplateName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    if (!isTemplateSaving) {
                                        void handleTemplateSave();
                                    }
                                }
                            }}
                            className="w-full px-3 py-2 text-sm bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-primary)]"
                            placeholder="Daily Ritual Card"
                        />
                    </div>
                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            onClick={() => {
                                setIsTemplateModalOpen(false);
                                setTemplateName('');
                            }}
                            className="px-4 py-2 text-[11px] uppercase tracking-widest border border-white/10 rounded-full hover:bg-white/5 transition-all duration-300 ease-in-out"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => void handleTemplateSave()}
                            disabled={isTemplateSaving}
                            className="px-4 py-2 text-[11px] uppercase tracking-widest rounded-full bg-[color:var(--brand-primary)] text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 ease-in-out"
                        >
                            {isTemplateSaving ? 'Saving…' : 'Save Template'}
                        </button>
                    </div>
                </div>
            </div>
        )}
        {toastMessage && (
            <div className="fixed bottom-4 right-4 bg-[#0f0707] text-white text-sm px-4 py-2 rounded-lg shadow-[0_0_24px_rgba(0,0,0,0.35)] z-50">
                {toastMessage}
            </div>
        )}
      {/* Top Header */}
      <header className="flex items-center justify-between p-4 bg-[#1c0d0d]/80 backdrop-blur-md border-b border-[color:var(--border-subtle)] z-10">
        <div className="w-48">
          <h1 className="font-semibold uppercase tracking-widest text-xs text-slate-200">DSGN Studio</h1>
        </div>
        <div className="flex-1 flex justify-center items-center gap-4">
            <div className="flex items-center gap-2">
            <button 
                onClick={undo}
                disabled={historyIndex <= 0}
                className='p-2 rounded-full hover:bg-white/10 transition-all duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed'
                aria-label="Undo"
            >
                <Undo className={ICON_LARGE} />
            </button>
            <button 
                onClick={redo}
                disabled={historyIndex >= history.length - 1}
                className='p-2 rounded-full hover:bg-white/10 transition-all duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed'
                aria-label="Redo"
            >
                <Redo className={ICON_LARGE} />
            </button>
            </div>
            <div className="w-px h-6 bg-white/10"></div>
            <div className="flex items-center gap-4 transition-all duration-300 ease-in-out">
                {!selectedObject && (
                    <span className="text-[10px] uppercase tracking-widest text-slate-500">Select an object</span>
                )}
                {(isMultiSelection || selectedObject?.type === 'group') && (
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={handleGroup}
                            disabled={!isMultiSelection}
                            className='p-2 rounded-full hover:bg-white/10 transition-all duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed'
                            aria-label="Group"
                        >
                            <Combine className={ICON_LARGE} />
                        </button>
                        <button 
                            onClick={handleUngroup}
                            disabled={selectedObject?.type !== 'group'}
                            className='p-2 rounded-full hover:bg-white/10 transition-all duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed'
                            aria-label="Ungroup"
                        >
                            <Split className={ICON_LARGE} />
                        </button>
                        <button
                            onClick={handleDistributeHorizontal}
                            disabled={!isMultiSelection}
                            className='p-2 rounded-full hover:bg-white/10 transition-all duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed'
                            aria-label="Distribute Horizontally"
                        >
                            <AlignHorizontalDistributeCenter className={ICON_LARGE} />
                        </button>
                        <button
                            onClick={handleDistributeVertical}
                            disabled={!isMultiSelection}
                            className='p-2 rounded-full hover:bg-white/10 transition-all duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed'
                            aria-label="Distribute Vertically"
                        >
                            <AlignVerticalDistributeCenter className={ICON_LARGE} />
                        </button>
                    </div>
                )}
                {textObject && (
                    <div className="flex items-center gap-3">
                        <div className="flex flex-col gap-1">
                            <span className="text-[10px] uppercase tracking-widest text-slate-500">Font</span>
                            <select
                                value={textObject.fontFamily || ''}
                                onChange={(e) => handleTextToolbarChange('fontFamily', e.target.value)}
                                className="min-w-[160px] px-2 py-1 text-xs bg-white/10 border border-white/10 rounded-lg text-slate-100 focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-primary)]"
                            >
                                {textFontOptions.map(font => <option key={font} value={font}>{font}</option>)}
                            </select>
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-[10px] uppercase tracking-widest text-slate-500">Size</span>
                            <input
                                type="number"
                                value={textObject.fontSize || 16}
                                onChange={(e) => handleTextToolbarChange('fontSize', parseInt(e.target.value, 10))}
                                className="w-20 px-2 py-1 text-xs bg-white/10 border border-white/10 rounded-lg text-slate-100 focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-primary)]"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-[10px] uppercase tracking-widest text-slate-500">Spacing</span>
                            <input
                                type="number"
                                value={textObject.charSpacing || 0}
                                onChange={(e) => handleTextToolbarChange('charSpacing', parseInt(e.target.value, 10))}
                                className="w-24 px-2 py-1 text-xs bg-white/10 border border-white/10 rounded-lg text-slate-100 focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-primary)]"
                            />
                        </div>
                    </div>
                )}
                {imageObject && (
                    <div className="flex items-center gap-3">
                        <div className="flex flex-col gap-1">
                            <span className="text-[10px] uppercase tracking-widest text-slate-500">Opacity</span>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={imageObject.opacity ?? 1}
                                onChange={(e) => handleImageOpacityChange(parseFloat(e.target.value))}
                                className="w-24 accent-[color:var(--brand-primary)]"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-[10px] uppercase tracking-widest text-slate-500">Filter</span>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={currentBlur?.blur || 0}
                                onChange={(e) => handleImageBlurChange(parseFloat(e.target.value))}
                                className="w-24 accent-[color:var(--brand-primary)]"
                            />
                        </div>
                        <button
                            onClick={handleImageCrop}
                            className="group flex items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-widest rounded-full bg-white/5 text-slate-200 hover:bg-white/10 transition-all duration-300 ease-in-out"
                        >
                            <Crop className="icon-muted w-4 h-4 stroke-[1.5] transition-all duration-300 ease-in-out" />
                            Crop
                        </button>
                    </div>
                )}
            </div>
            <ThemeMetadataDisplay />
        </div>
        <div className="flex items-center gap-3">
            <button
                onClick={() => setIsTemplateModalOpen(true)}
                disabled={isTemplateSaving}
                className="group flex items-center gap-2 px-4 py-2 bg-white/5 text-slate-200 rounded-full border border-[color:var(--border-subtle)] hover:bg-white/10 transition-all duration-300 ease-in-out text-[11px] uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <LayoutTemplate className="icon-muted w-4 h-4 stroke-[1.5] transition-all duration-300 ease-in-out" />
                {isTemplateSaving ? 'Saving…' : 'Save as Template'}
            </button>
        </div>
        <div className="w-auto flex justify-end items-center gap-4">
            <CanvasSettingsPopover />
            <ExportDropdown openModal={openExportModal} />
        </div>
      </header>
      <div className="flex-1 flex overflow-hidden">
        <aside className="w-72 bg-[#1c0d0d]/80 backdrop-blur-md border-r border-[color:var(--border-subtle)] flex flex-col overflow-hidden transition-all duration-300 ease-in-out">
            <div className="p-3 border-b border-[color:var(--border-subtle)]">
                <button
                    onClick={() => setIsBrandModalOpen(true)}
                    className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-slate-200 hover:text-[color:var(--brand-primary)] transition-all duration-300 ease-in-out"
                >
                    <Briefcase className={ICON_SMALL} />
                    Brand Vault
                </button>
            </div>
            <div className="flex-1 overflow-y-auto">
                <SidebarBlueprints />
                <Inserter />
            </div>
        </aside>
        <main
            className="flex-1 relative overflow-hidden"
            style={{
                backgroundColor: '#1c0d0d',
                backgroundImage: 'radial-gradient(circle at top, rgba(255,255,255,0.08), rgba(28,13,13,0) 60%)',
            }}
        >
            <Ruler orientation="horizontal" />
            <Ruler orientation="vertical" />
            <CanvasStage />
        </main>
        <aside
            className={`bg-[#1c0d0d]/80 backdrop-blur-md transition-all duration-300 ease-in-out overflow-hidden ${isInspectorOpen ? 'w-80 opacity-100 translate-x-0 border-l border-[color:var(--border-subtle)]' : 'w-0 opacity-0 translate-x-8 pointer-events-none'}`}
        >
            <RightPanel />
        </aside>
      </div>
      <StatusBar />
    </div>
  );
};

const ThemeMetadataDisplay: React.FC = () => {
    const { themeName, generatedAt } = useEditorStore();

    if (!themeName) {
        return null;
    }

    return (
        <div className="ml-4 text-[11px] uppercase tracking-widest text-slate-300 flex items-center gap-2">
            <span>Theme: {themeName}</span>
            {generatedAt && (
                <span className="text-slate-500">({new Date(generatedAt).toLocaleDateString()})</span>
            )}
            <div className="w-px h-6 bg-white/10 mx-2"></div>
        </div>
    );
};

const RightPanel: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'layers' | 'theme'>('layers');

    return (
        <div className='h-full flex flex-col'>
            <div className="flex justify-center border-b border-[color:var(--border-subtle)]">
                <TabButton
                    label="Layers"
                    icon={<PanelRight />}
                    isActive={activeTab === 'layers'}
                    onClick={() => setActiveTab('layers')}
                />
                <TabButton
                    label="Theme"
                    icon={<Palmtree />}
                    isActive={activeTab === 'theme'}
                    onClick={() => setActiveTab('theme')}
                />
            </div>
            <div className='relative flex-1'>
                <div className={`absolute inset-0 overflow-y-auto transition-all duration-300 ease-in-out ${activeTab === 'layers' ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                    <LayersPanel />
                </div>
                <div className={`absolute inset-0 overflow-y-auto transition-all duration-300 ease-in-out ${activeTab === 'theme' ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                    <ThemeSidebar />
                </div>
            </div>
        </div>
    )
}

// --- Typography and Properties Panels ---

const GOOGLE_FONTS = ['Roboto', 'Montserrat', 'Playfair Display', 'Lato', 'Oswald'];


const PropertiesPanel: React.FC = () => {
    const { selectedObject } = useEditorStore();
    const objectType = selectedObject?.type;
    const isFrame = selectedObject && (selectedObject as any).isFrame && selectedObject.fill instanceof fabric.Pattern;

    
    if (!selectedObject) {
        return (
            <div className='p-4 text-sm text-slate-500'>
                <p>No object selected.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {isFrame ? <FramePanel /> : <ColorPanel />}
            <hr className="border-white/10"/>
            <StylePanel />
            {objectType === 'i-text' && (
                <>
                    <hr className="border-white/10"/>
                    <TypographyPanel />
                </>
            )}
            <hr className="border-white/10"/>
            <EffectsPanel />
        </div>
    )
}

const FramePanel: React.FC = () => {
    const { canvas, selectedObject, saveState } = useEditorStore();
    const frame = selectedObject as any;

    const handlePatternChange = (prop: string, value: number) => {
        if (!canvas || !frame || !frame.patternSourceUrl) return;

        const newProps = {
            patternZoom: frame.patternZoom,
            patternOffsetX: frame.patternOffsetX,
            patternOffsetY: frame.patternOffsetY,
            [prop]: value,
        };

        fabric.Image.fromURL(frame.patternSourceUrl, { crossOrigin: 'anonymous' }).then((img: fabric.FabricImage) => {
            // Apply zoom
            const scaledImg = new fabric.Image(img.getElement(), {
                width: img.width,
                height: img.height,
                scaleX: newProps.patternZoom,
                scaleY: newProps.patternZoom,
            });

            const pattern = new fabric.Pattern({
                source: scaledImg.getElement(),
                repeat: 'no-repeat',
                offsetX: newProps.patternOffsetX,
                offsetY: newProps.patternOffsetY,
            });
            
            frame.set({
                ...newProps,
                fill: pattern,
            });
            canvas.requestRenderAll();
            saveState();
        });
    };

    return (
        <div className="p-4 space-y-4">
            <h3 className="text-sm uppercase tracking-widest text-slate-300">Frame Fill</h3>
             <div className='space-y-2'>
                <label className="text-[10px] uppercase tracking-widest text-slate-500">Zoom</label>
                <input
                    type="range" min="0.1" max="3" step="0.05"
                    value={frame.patternZoom || 1}
                    onChange={e => handlePatternChange('patternZoom', parseFloat(e.target.value))}
                    className="w-full accent-[color:var(--brand-primary)]"
                />
            </div>
            <div className='space-y-2'>
                <label className="text-[10px] uppercase tracking-widest text-slate-500">Pan X</label>
                <input
                    type="range" min="-300" max="300" step="1"
                    value={frame.patternOffsetX || 0}
                     onChange={e => handlePatternChange('patternOffsetX', parseInt(e.target.value, 10))}
                    className="w-full accent-[color:var(--brand-primary)]"
                />
            </div>
             <div className='space-y-2'>
                <label className="text-[10px] uppercase tracking-widest text-slate-500">Pan Y</label>
                <input
                    type="range" min="-300" max="300" step="1"
                    value={frame.patternOffsetY || 0}
                     onChange={e => handlePatternChange('patternOffsetY', parseInt(e.target.value, 10))}
                    className="w-full accent-[color:var(--brand-primary)]"
                />
            </div>
        </div>
    )
};

const StylePanel: React.FC = () => {
    const { canvas, selectedObject, saveState, themeData, specialtyInks } = useEditorStore();
    const isRect = selectedObject?.type === 'rect';

    const handleStyleChange = (prop: string, value: any) => {
        if (selectedObject && canvas) {
            selectedObject.set(prop, value);
            canvas.requestRenderAll();
            saveState();
        }
    };

    const handleCornerRadiusChange = (value: number) => {
        if (selectedObject && canvas && isRect) {
            selectedObject.set({ rx: value, ry: value });
            canvas.requestRenderAll();
            saveState();
        }
    }

    const borderColorPalette = useMemo(() => {
        const cmykSafe = themeData?.print?.cmykSafe
            || themeData?.print?.cmyk_safe
            || themeData?.cmykSafe
            || themeData?.cmyk_safe
            || themeData?.brand?.cmykSafe
            || themeData?.brand?.cmyk_safe;
        const colors = [
            ...specialtyInks,
            cmykSafe?.primary,
            cmykSafe?.secondary,
            cmykSafe?.accent,
            themeData?.borders?.borderstrong,
            themeData?.borders?.bordersubtle,
            themeData?.borderSubtle,
            themeData?.bordersubtle,
        ].filter(Boolean) as string[];
        return Array.from(new Set(colors));
    }, [specialtyInks, themeData]);

    const updateShapeStroke = (updates: Partial<fabric.Object>) => {
        if (selectedObject && canvas) {
            selectedObject.set(updates);
            canvas.requestRenderAll();
            saveState();
        }
    };

    const borderColor = typeof selectedObject?.stroke === 'string' ? selectedObject.stroke : '#ffffff';
    const isShape = ['rect', 'circle', 'triangle', 'polygon'].includes(selectedObject?.type || '');
    const isDashed = Array.isArray(selectedObject?.strokeDashArray) && (selectedObject?.strokeDashArray ?? []).length > 0;

    const toggleDashedBorder = () => {
        const dash = isDashed ? [] : [10, 6];
        updateShapeStroke({ strokeDashArray: dash });
    };

    return (
        <div className="p-4 space-y-4">
            <h3 className="text-sm uppercase tracking-widest text-slate-300">Style</h3>
            {/* Stroke */}
            <div className='space-y-2'>
                <label className="text-[10px] uppercase tracking-widest text-slate-500">Stroke</label>
                <div className='flex items-center gap-2'>
                    <input
                        type="color"
                        value={typeof selectedObject?.stroke === 'string' ? selectedObject.stroke : ''}
                        onChange={(e) => handleStyleChange('stroke', e.target.value)}
                        className="w-8 h-8 rounded-md border border-white/20 cursor-pointer"
                    />
                    <input
                        type="number"
                        min="0"
                        value={selectedObject?.strokeWidth || 0}
                        onChange={(e) => handleStyleChange('strokeWidth', parseInt(e.target.value, 10))}
                        className="w-full p-2 text-sm bg-white/10 border border-white/10 rounded-lg text-slate-100 focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-primary)]"
                    />
                </div>
            </div>
            {isShape && (
                <div className='space-y-3'>
                    <div className='flex items-center justify-between'>
                        <label className="text-[10px] uppercase tracking-widest text-slate-500">Border Color</label>
                        <span className="text-[9px] uppercase tracking-widest text-slate-500">Print & Foil</span>
                    </div>
                    <div className='flex items-center gap-2'>
                        <input
                            type="color"
                            value={borderColor}
                            onChange={(e) => updateShapeStroke({ stroke: e.target.value })}
                            className="w-10 h-10 rounded-full border border-white/10"
                        />
                        <div className="flex flex-wrap gap-2">
                            {borderColorPalette.map((color) => (
                                <button
                                    key={`border-${color}`}
                                    onClick={() => updateShapeStroke({ stroke: color })}
                                    className="w-8 h-8 rounded-full border border-white/20"
                                    style={{ backgroundColor: color }}
                                />
                            ))}
                        </div>
                    </div>
                    <div className='space-y-2'>
                        <label className="text-[10px] uppercase tracking-widest text-slate-500">Thickness</label>
                        <input
                            type="range"
                            min="0"
                            max="50"
                            value={selectedObject?.strokeWidth || 0}
                            onChange={(e) => updateShapeStroke({ strokeWidth: parseInt(e.target.value, 10) })}
                            className="w-full accent-[color:var(--brand-primary)]"
                        />
                    </div>
                    <div className='flex items-center justify-between'>
                        <span className="text-[10px] uppercase tracking-widest text-slate-500">Dashed Border</span>
                        <button
                            onClick={toggleDashedBorder}
                            className={`px-3 py-1 text-[10px] uppercase tracking-widest rounded-full border transition-all duration-300 ease-in-out ${isDashed ? 'border-rose-500 text-rose-200' : 'border-white/10 text-slate-400'}`}
                        >
                            {isDashed ? 'On' : 'Off'}
                        </button>
                    </div>
                </div>
            )}
            {/* Corner Radius */}
            {isRect && (
                 <div className='space-y-2'>
                    <label className="text-[10px] uppercase tracking-widest text-slate-500">Corner Smoothing</label>
                    <input
                        type="range"
                        min="0"
                        max="50"
                        step="1"
                        value={(selectedObject as fabric.Rect).rx || 0}
                        onChange={(e) => handleCornerRadiusChange(parseInt(e.target.value, 10))}
                        className="w-full accent-[color:var(--brand-primary)]"
                    />
                </div>
            )}
        </div>
    );
}

const EffectsPanel: React.FC = () => {
    const { canvas, selectedObject, saveState } = useEditorStore();
    const isImage = selectedObject?.type === 'image';
    const shadow = selectedObject?.shadow as fabric.Shadow | null;

    const handleOpacityChange = (value: number) => {
        if (selectedObject && canvas) {
            selectedObject.set('opacity', value);
            canvas.requestRenderAll();
            saveState();
        }
    }

    const handleFlip = (axis: 'flipX' | 'flipY') => {
        if (selectedObject && canvas) {
            selectedObject.set(axis, !selectedObject[axis]);
            canvas.requestRenderAll();
            saveState();
        }
    }

    type ShadowOption = 'color' | 'blur' | 'offsetX' | 'offsetY';

    const toggleShadow = (enabled: boolean) => {
        if (selectedObject && canvas) {
            if (enabled) {
                selectedObject.set('shadow', new fabric.Shadow({
                    color: 'rgba(0,0,0,0.5)',
                    blur: 10,
                    offsetX: 5,
                    offsetY: 5,
                }));
            } else {
                selectedObject.set('shadow', null);
            }
            canvas.requestRenderAll();
            saveState();
        }
    }

    const handleShadowChange = (prop: ShadowOption, value: string | number) => {
        if (selectedObject && canvas && shadow) {
            switch (prop) {
                case 'color':
                    shadow.color = value as string;
                    break;
                case 'blur':
                    shadow.blur = Number(value);
                    break;
                case 'offsetX':
                    shadow.offsetX = Number(value);
                    break;
                case 'offsetY':
                    shadow.offsetY = Number(value);
                    break;
            }
            canvas.requestRenderAll();
            saveState();
        }
    }

    const handleBlurChange = (value: number) => {
        if (selectedObject && canvas && isImage) {
            const image = selectedObject as fabric.Image;
            // Remove existing blur filter
            image.filters = image.filters?.filter((f: fabric.filters.BaseFilter<string, any>) => !(f instanceof fabric.filters.Blur));
            if (value > 0) {
                image.filters?.push(new fabric.filters.Blur({ blur: value }));
            }
            image.applyFilters();
            canvas.requestRenderAll();
            saveState();
        }
    }
    const currentBlur = (selectedObject as fabric.Image)?.filters?.find((f: fabric.filters.BaseFilter<string, any>) => f instanceof fabric.filters.Blur) as fabric.filters.Blur | undefined;

    const toggleLock = () => {
        if (selectedObject && canvas) {
            const isLocked = !selectedObject.selectable; // If not selectable, it's currently locked
            selectedObject.set({
                selectable: isLocked,
                hasControls: isLocked,
                evented: isLocked,
            });
            canvas.requestRenderAll();
            saveState();
        }
    }


    return (
        <div className="p-4 space-y-4">
            <h3 className="text-sm uppercase tracking-widest text-slate-300">Effects</h3>
            {/* Opacity */}
            <div className='space-y-2'>
                <label className="text-[10px] uppercase tracking-widest text-slate-500">Opacity</label>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={selectedObject?.opacity || 1}
                    onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
                    className="w-full accent-[color:var(--brand-primary)]"
                />
            </div>
             {/* Flip */}
            <div className='space-y-2'>
                <label className="text-[10px] uppercase tracking-widest text-slate-500">Flip</label>
                 <div className='grid grid-cols-2 gap-2'>
                    <button onClick={() => handleFlip('flipX')} className="p-2 text-xs uppercase tracking-widest bg-white/5 rounded-lg hover:bg-white/10 transition-all duration-300 ease-in-out">Flip Horizontal</button>
                    <button onClick={() => handleFlip('flipY')} className="p-2 text-xs uppercase tracking-widest bg-white/5 rounded-lg hover:bg-white/10 transition-all duration-300 ease-in-out">Flip Vertical</button>
                </div>
            </div>
            {/* Lock/Unlock */}
            <div className='space-y-2'>
                <label className="text-[10px] uppercase tracking-widest text-slate-500">Lock Object</label>
                <button 
                    onClick={toggleLock} 
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-white/5 text-slate-200 rounded-lg hover:bg-white/10 transition-all duration-300 ease-in-out"
                >
                    {selectedObject?.selectable ? <Unlock className={ICON_SMALL} /> : <Lock className={ICON_SMALL} />}
                    {selectedObject?.selectable ? 'Unlock' : 'Lock'}
                </button>
            </div>
            {/* Shadow */}
            <div className='space-y-2'>
                 <div className='flex items-center justify-between'>
                    <label className="text-[10px] uppercase tracking-widest text-slate-500">Drop Shadow</label>
                    <input type="checkbox" checked={!!shadow} onChange={(e) => toggleShadow(e.target.checked)} className="toggle toggle-xs" />
                </div>
                {shadow && (
                    <div className='space-y-2 pl-2 border-l-2'>
                        <div className="flex items-center gap-2">
                             <input type="color" value={shadow.color} onChange={e => handleShadowChange('color', e.target.value)} className="w-8 h-8 p-0 border-none cursor-pointer" />
                             <div className='flex-1 space-y-1'>
                                <label className='text-[10px] uppercase tracking-widest text-slate-500'>Blur</label>
                                <input type="range" min="0" max="50" value={shadow.blur} onChange={e => handleShadowChange('blur', parseInt(e.target.value, 10))} className="w-full accent-[color:var(--brand-primary)]" />
                             </div>
                        </div>
                         <div className='flex-1 space-y-1'>
                            <label className='text-[10px] uppercase tracking-widest text-slate-500'>Offset X</label>
                            <input type="range" min="-50" max="50" value={shadow.offsetX} onChange={e => handleShadowChange('offsetX', parseInt(e.target.value, 10))} className="w-full accent-[color:var(--brand-primary)]" />
                         </div>
                         <div className='flex-1 space-y-1'>
                            <label className='text-[10px] uppercase tracking-widest text-slate-500'>Offset Y</label>
                            <input type="range" min="-50" max="50" value={shadow.offsetY} onChange={e => handleShadowChange('offsetY', parseInt(e.target.value, 10))} className="w-full accent-[color:var(--brand-primary)]" />
                         </div>
                    </div>
                )}
            </div>
            {/* Blur */}
            {isImage && (
                <div className='space-y-2'>
                    <label className="text-[10px] uppercase tracking-widest text-slate-500">Background Blur</label>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={currentBlur?.blur || 0}
                        onChange={(e) => handleBlurChange(parseFloat(e.target.value))}
                        className="w-full accent-[color:var(--brand-primary)]"
                    />
                </div>
            )}
        </div>
    )
}



import { PaletteSwatch } from './PaletteSwatch';
import { refreshCanvasThemes } from '../fabric/themeUtils';
import { Upload, PanelRight, Palmtree, CaseUpper, Undo, Redo, Combine, Split, Briefcase, ChevronDown, Droplet, Lock, Unlock, AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, LayoutTemplate } from 'lucide-react';
...
const TypographyPanel: React.FC = () => {
    const { canvas, selectedObject, saveState, customFonts, addCustomFont, themeData, setObjectThemedFill } = useEditorStore();
    const fontInputRef = useRef<HTMLInputElement>(null);

    const textObject = selectedObject as fabric.IText;
    const defaultTextFill = themeData?.typography?.body.value || '#ffffff';
    const fillColor = typeof textObject?.fill === 'string' ? textObject.fill : defaultTextFill;
    const backgroundColor = typeof textObject?.backgroundColor === 'string'
        ? textObject.backgroundColor
        : (typeof canvas?.backgroundColor === 'string' ? canvas.backgroundColor : themeData?.surfaces?.background.value || null);
    const contrastRatio = fillColor && backgroundColor ? getContrastRatio(fillColor, backgroundColor) : null;
    const passesContrast = contrastRatio !== null && contrastRatio >= 4.5;
    const fontOptions = Array.from(new Set([
        ...GOOGLE_FONTS,
        ...customFonts,
        textObject?.fontFamily,
    ].filter(Boolean))) as string[];

    const prioritizedPrintColors = useMemo(() => {
        if (!themeData) return [];
        const colors = [
            { role: 'brand.primary', value: themeData.brand?.primary?.value },
            { role: 'brand.secondary', value: themeData.brand?.secondary?.value },
            { role: 'brand.accent', value: themeData.brand?.accent?.value },
            { role: 'foundation.base', value: themeData.foundation?.base?.value },
        ];
        return colors.filter(c => c.value) as { role: string; value: string }[];
    }, [themeData]);

    const updateTextObject = useCallback((mutate: (obj: fabric.IText) => void) => {
        if (!canvas || !textObject) return;
        mutate(textObject);
        canvas.requestRenderAll();
        saveState();
    }, [canvas, textObject, saveState]);

    const handleTextFillChange = (role: string, value: string) => {
        setObjectThemedFill(role, value);
    };

    const hasTextStroke = (textObject?.strokeWidth ?? 0) > 0;
    const defaultStrokeColor = themeData?.typography?.muted.value || '#ffffff';
    const textStrokeColor = typeof textObject?.stroke === 'string' ? textObject.stroke : defaultStrokeColor;

    const handleTextStrokeColor = (color: string) => {
        updateTextObject((obj) => obj.set('stroke', color));
    };

    const handleTextStrokeWidth = (value: number) => {
        updateTextObject((obj) => obj.set('strokeWidth', value));
    };

    const toggleTextStroke = () => {
        updateTextObject((obj) => obj.set('strokeWidth', hasTextStroke ? 0 : 1));
    };

    const handleTypographyChange = (prop: string, value: any) => {
        if (textObject && canvas) {
            if (prop === 'fontFamily') {
                loadGoogleFont(value); // Ensure Google Font is loaded
            }
            textObject.set(prop, value);
            canvas.requestRenderAll();
            saveState();
        }
    };

    const handleFontFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async (f: ProgressEvent<FileReader>) => {
                const fontData = f.target?.result as ArrayBuffer;
                const fontName = file.name.split('.')[0]; // Simple name from filename

                try {
                    const fontFace = new FontFace(fontName, fontData);
                    await fontFace.load();
                    document.fonts.add(fontFace);
                    addCustomFont(fontName);
                    if (textObject && canvas) {
                        textObject.set('fontFamily', fontName);
                        canvas.requestRenderAll();
                        saveState();
                    }
                } catch (error) {
                    console.error('Error loading custom font:', error);
                    alert('Failed to load custom font.');
                }
            };
            reader.readAsArrayBuffer(file);
        }
        if(fontInputRef.current) fontInputRef.current.value = '';
    };
    
    return (
        <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm uppercase tracking-widest text-slate-300 flex items-center gap-2">
                    <CaseUpper className={ICON_SMALL} />
                    <span>Typography</span>
                </h3>
                {contrastRatio !== null && (
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${passesContrast ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {passesContrast ? 'AA' : 'Fail'}
                    </span>
                )}
            </div>
            <div className="space-y-3">
                <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest text-slate-500">Text Fill</label>
                    <div className="flex items-center gap-3">
                        <input
                            type="color"
                            value={fillColor ?? '#ffffff'}
                            onChange={(e) => setObjectThemedFill('', e.target.value)}
                            className="w-10 h-10 rounded-full border border-white/10"
                        />
                        <div className="flex gap-2 flex-wrap">
                            {prioritizedPrintColors.map((color) => (
                                <button
                                    key={`text-fill-${color.role}`}
                                    onClick={() => handleTextFillChange(color.role, color.value)}
                                    className="w-8 h-8 rounded-full border border-white/20 hover:scale-110 transition-transform"
                                    style={{ backgroundColor: color.value }}
                                    aria-label={`Set text fill to ${color.role}`}
                                />
                            ))}
                        </div>
                    </div>
                </div>
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-[10px] uppercase tracking-widest text-slate-500">Text Stroke (Outline)</label>
                        <button
                            onClick={toggleTextStroke}
                            className={`text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-full border transition-colors duration-300 ease-in-out ${hasTextStroke ? 'border-rose-500 text-rose-200' : 'border-white/10 text-slate-500'}`}
                        >
                            {hasTextStroke ? 'Stroke On' : 'Stroke Off'}
                        </button>
                    </div>
                    <div className="flex items-center gap-3">
                        <input
                            type="color"
                            value={textStrokeColor}
                            onChange={(e) => handleTextStrokeColor(e.target.value)}
                            className="w-10 h-10 rounded-full border border-white/10"
                        />
                        <input
                            type="range"
                            min="0"
                            max="10"
                            step="0.5"
                            value={textObject?.strokeWidth ?? 0}
                            onChange={(e) => handleTextStrokeWidth(parseFloat(e.target.value))}
                            className="accent-[color:var(--brand-primary)] flex-1"
                        />
                        <span className="text-[10px] uppercase tracking-widest text-slate-400">
                            {(textObject?.strokeWidth ?? 0).toFixed(1)}px
                        </span>
                    </div>
                </div>
            </div>
            {/* Font Family */}
            <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-500">Font Family</label>
                <select
                    value={textObject.fontFamily}
                    onChange={(e) => handleTypographyChange('fontFamily', e.target.value)}
                    className="w-full mt-1 p-2 text-sm bg-white/10 border border-white/10 rounded-lg text-slate-100 focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-primary)]"
                >
                    {fontOptions.map(font => <option key={font} value={font}>{font}</option>)}
                </select>
                <input type="file" accept=".ttf,.otf,.woff" ref={fontInputRef} onChange={handleFontFileChange} className="hidden" />
                <button 
                    onClick={() => fontInputRef.current?.click()}
                    className="w-full mt-2 flex items-center justify-center gap-2 text-xs uppercase tracking-widest px-3 py-2 text-slate-200 bg-white/5 rounded-lg hover:bg-white/10 transition-all duration-300 ease-in-out"
                >
                    <Upload className={ICON_SMALL} />
                    Upload Font
                </button>
            </div>
             {/* Font Size, Line Height */}
            <div className='grid grid-cols-2 gap-4'>
                 <div>
                    <label className="text-[10px] uppercase tracking-widest text-slate-500">Font Size</label>
                    <input
                        type="number"
                        value={textObject.fontSize}
                        onChange={(e) => handleTypographyChange('fontSize', parseInt(e.target.value, 10))}
                        className="w-full mt-1 p-2 text-sm bg-white/10 border border-white/10 rounded-lg text-slate-100 focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-primary)]"
                    />
                </div>
                 <div>
                    <label className="text-[10px] uppercase tracking-widest text-slate-500">Line Height</label>
                     <input
                        type="number"
                        step="0.1"
                        value={textObject.lineHeight}
                        onChange={(e) => handleTypographyChange('lineHeight', parseFloat(e.target.value))}
                        className="w-full mt-1 p-2 text-sm bg-white/10 border border-white/10 rounded-lg text-slate-100 focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-primary)]"
                    />
                </div>
            </div>
            {/* Letter Spacing */}
             <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-500">Letter Spacing</label>
                <input
                    type="number"
                    value={textObject.charSpacing}
                    onChange={(e) => handleTypographyChange('charSpacing', parseInt(e.target.value, 10))}
                    className="w-full mt-1 p-2 text-sm bg-white/10 border border-white/10 rounded-lg text-slate-100 focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-primary)]"
                />
            </div>
        </div>
    )
}



const ColorPanel: React.FC = () => {
    const { setObjectFill, setObjectThemedFill, themeData, brandVault, activeBrandCollectionId, setActiveBrandCollectionId } = useEditorStore();

    const handleColorPick = (hex: string) => {
        setObjectFill(hex);
    };

    const handleThemeSelect = (id: string) => {
        setActiveBrandCollectionId(id);
        // Add a small delay to allow state to update before refreshing canvas
        setTimeout(() => refreshCanvasThemes(), 50);
    }

    const paletteSections = useMemo(() => {
        if (!themeData) return [];
        return [
            {
                title: 'Brand',
                colors: [
                    { role: 'brand.primary', value: themeData.brand?.primary?.value },
                    { role: 'brand.secondary', value: themeData.brand?.secondary?.value },
                    { role: 'brand.accent', value: themeData.brand?.accent?.value },
                ].filter(c => c.value) as { role: string; value: string }[],
            },
            {
                title: 'Foundation',
                colors: [
                    { role: 'foundation.base', value: themeData.foundation?.base?.value },
                    { role: 'foundation.surface', value: themeData.foundation?.surface?.value },
                    { role: 'foundation.overlay', value: themeData.foundation?.overlay?.value },
                ].filter(c => c.value) as { role: string; value: string }[],
            },
            {
                title: 'Typography',
                colors: [
                    { role: 'typography.heading', value: themeData.typography?.heading?.value },
                    { role: 'typography.body', value: themeData.typography?.body?.value },
                    { role: 'typography.muted', value: themeData.typography?.muted?.value },
                ].filter(c => c.value) as { role: string; value: string }[],
            },
        ];
    }, [themeData]);

    const hasThemePalette = paletteSections.some((section) => section.colors.length > 0);

  return (
    <div className="p-4 space-y-6">
        <div>
            <h3 className="text-sm uppercase tracking-widest text-slate-300 mb-3">Brand Vault</h3>
            <div className="space-y-2">
                {brandVault.map(collection => (
                    <PaletteSwatch 
                        key={collection.id}
                        collection={collection}
                        isActive={collection.id === activeBrandCollectionId}
                        onClick={() => handleThemeSelect(collection.id)}
                    />
                ))}
            </div>
             {brandVault.length === 0 && (
                <p className="text-xs text-slate-500 p-2">No brand kits loaded. Import one from the Brand Vault modal.</p>
            )}
        </div>

      {hasThemePalette && (
        <div className="space-y-4">
             <hr className="border-white/10"/>
            <h3 className="text-sm uppercase tracking-widest text-slate-300">Active Palette Colors</h3>
            {paletteSections.map((section) => (
            section.colors.length > 0 && (
                <div key={section.title}>
                <h4 className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">{section.title}</h4>
                <div className="grid grid-cols-5 gap-2">
                    {section.colors.map((color) => (
                    <button
                        key={color.role}
                        onClick={() => setObjectThemedFill(color.role, color.value)}
                        className="w-9 h-9 rounded-full border border-white/20 transition-all duration-300 ease-in-out hover:scale-110"
                        style={{ backgroundColor: color.value }}
                        aria-label={`Set color to ${color.role}`}
                    />
                    ))}
                </div>
                </div>
            )
            ))}
        </div>
      )}
      
      <hr className="border-white/10"/>
      <EyeDropperButton onColorSelected={handleColorPick} />
    </div>
  );
};


// --- EyeDropper Button Component ---
interface EyeDropperButtonProps {
    onColorSelected: (hex: string) => void;
}

const EyeDropperButton: React.FC<EyeDropperButtonProps> = ({ onColorSelected }) => {
    const { canvas } = useEditorStore();
    const [isEyeDropperActive, setIsEyeDropperActive] = useState(false);

    const handleEyeDropperClick = async () => {
        if (!canvas) return;

        if ('EyeDropper' in window) {
            try {
                setIsEyeDropperActive(true);
                const eyeDropper = new (window as any).EyeDropper();
                const { sRGBHex } = await eyeDropper.open();
                onColorSelected(sRGBHex);
            } catch (e) {
                console.error('EyeDropper API cancelled or failed:', e);
            } finally {
                setIsEyeDropperActive(false);
            }
        } else {
            alert("Your browser does not support the EyeDropper API. Clicking on the canvas to sample color is not yet implemented as a fallback.");
            // Fallback: implement canvas-level click listener for color sampling
            // This would involve changing cursor, adding one-time canvas.on('mouse:down') listener
            // to get pixel data from canvas.contextTop.getImageData
        }
    };

    return (
        <button 
            onClick={handleEyeDropperClick}
            disabled={isEyeDropperActive}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white/5 text-slate-200 rounded-lg hover:bg-white/10 transition-all duration-300 ease-in-out text-xs uppercase tracking-widest"
        >
                    <Droplet className={ICON_SMALL} />
            Pick Color
        </button>
    );
};


// --- Generic Components ---

// Toolbar Button Component
interface TabButtonProps {
    label: string;
    icon: React.ReactNode;
    isActive: boolean;
    onClick: () => void;
    disabled?: boolean;
}

const TabButton: React.FC<TabButtonProps> = ({ label, icon, isActive, onClick, disabled }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        className={`flex-1 flex justify-center items-center gap-2 p-3 text-[11px] uppercase tracking-widest transition-all duration-300 ease-in-out disabled:text-slate-500 disabled:cursor-not-allowed ${
            isActive ? 'text-[color:var(--brand-primary)] border-b-2 border-[color:var(--brand-primary)]' : 'text-slate-300 hover:bg-white/5 hover:text-[color:var(--brand-primary)]'
        }`}
    >
        {React.cloneElement(icon as React.ReactElement, { className: ICON_SMALL })}
        <span>{label}</span>
    </button>
)
