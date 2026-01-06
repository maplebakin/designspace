
import React, { useEffect, useState } from 'react';
import * as fabric from 'fabric';
import { CanvasSettingsPopover } from './CanvasSettingsPopover';
import { PanelRight, Palmtree, Briefcase, ChevronDown, LayoutTemplate, Sticker, Square } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';
import { BrandModal } from './BrandModal';
import { ExportModal } from './ExportModal';
import { LayersPanel } from './LayersPanel';
import { SidebarBlueprints } from './SidebarBlueprints';
import { Inserter } from './Inserter';
import { CanvasStage } from './CanvasStage';
import { Ruler } from './Ruler';
import { StatusBar } from './StatusBar';
import { ThemeSidebar } from './ThemeSidebar';
import { TemplateBrowser } from './TemplateBrowser';
import { StickerTab } from './StickerTab';
import { downloadPdf, downloadSvg } from '../fabric/exportUtils';
import * as objectFactories from '../fabric/objectFactories';

const ICON_SMALL = 'icon-muted w-4 h-4 stroke-[1.5]';

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

export const EditorShell: React.FC = () => {
  const { toastMessage, setToastMessage, canvas, saveState } = useEditorStore();
  const [isBrandModalOpen, setIsBrandModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'jpeg' | 'png'>('png');
  const [activeLeftTab, setActiveLeftTab] = useState<'inserter' | 'blueprints' | 'templates' | 'stickers'>('inserter');

  const openExportModal = (format: 'jpeg' | 'png') => {
      setExportFormat(format);
      setIsExportModalOpen(true);
  }

  useEffect(() => {
    if (!toastMessage) return;
    const timeout = window.setTimeout(() => setToastMessage(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [toastMessage, setToastMessage]);

  return (
    <div className="w-screen h-screen bg-[#1c0d0d] text-slate-100 flex flex-col">
        <BrandModal isOpen={isBrandModalOpen} onClose={() => setIsBrandModalOpen(false)} />
        <ExportModal isOpen={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} format={exportFormat} />
        
        {toastMessage && (
            <div className="fixed bottom-4 right-4 bg-[#0f0707] text-white text-sm px-4 py-2 rounded-lg shadow-[0_0_24px_rgba(0,0,0,0.35)] z-50">
                {toastMessage}
            </div>
        )}

      <header className="flex items-center justify-between p-4 bg-[#1c0d0d]/80 backdrop-blur-md border-b border-[color:var(--border-subtle)] z-10">
        <div className="w-48">
          <h1 className="font-semibold uppercase tracking-widest text-xs text-slate-200">DSGN Studio</h1>
        </div>
        <div className="flex-1 flex justify-center items-center gap-4">
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
            <ExportDropdown openModal={openExportModal} />
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-72 bg-[#1c0d0d]/80 backdrop-blur-md border-r border-[color:var(--border-subtle)] flex flex-col overflow-hidden">
            <div className="p-3 border-b border-[color:var(--border-subtle)]">
                <button
                    onClick={() => setIsBrandModalOpen(true)}
                    className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-slate-200 hover:text-[color:var(--brand-primary)]"
                >
                    <Briefcase className={ICON_SMALL} />
                    Brand Vault
                </button>
            </div>
            <div className="flex justify-center border-b border-[color:var(--border-subtle)]">
                <TabButton
                    label="Elements"
                    icon={<PanelRight />}
                    isActive={activeLeftTab === 'inserter'}
                    onClick={() => setActiveLeftTab('inserter')}
                />
                <TabButton
                    label="Blueprints"
                    icon={<LayoutTemplate />}
                    isActive={activeLeftTab === 'blueprints'}
                    onClick={() => setActiveLeftTab('blueprints')}
                />
                <TabButton
                    label="Templates"
                    icon={<LayoutTemplate />}
                    isActive={activeLeftTab === 'templates'}
                    onClick={() => setActiveLeftTab('templates')}
                />
                <TabButton
                    label="Stickers"
                    icon={<Sticker />}
                    isActive={activeLeftTab === 'stickers'}
                    onClick={() => setActiveLeftTab('stickers')}
                />
            </div>
            <div className="flex-1 overflow-y-auto">
                {activeLeftTab === 'inserter' && <Inserter />}
                {activeLeftTab === 'blueprints' && <SidebarBlueprints />}
                {activeLeftTab === 'templates' && <TemplateBrowser />}
                {activeLeftTab === 'stickers' && <StickerTab />}
            </div>
        </aside>

        <main className="flex-1 relative overflow-hidden bg-[#121212]">
            <Ruler orientation="horizontal" />
            <Ruler orientation="vertical" />
            <CanvasStage />
        </main>

        <aside className={`bg-[#1c0d0d]/80 backdrop-blur-md transition-all duration-300 ease-in-out overflow-hidden w-80 border-l border-[color:var(--border-subtle)]`}>
            <RightPanel />
        </aside>
      </div>
      <StatusBar />
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
        className={`flex-1 flex justify-center items-center gap-2 p-3 text-[11px] uppercase tracking-widest transition-all duration-300 ease-in-out disabled:text-slate-500 ${
            isActive ? 'text-[color:var(--brand-primary)] border-b-2 border-[color:var(--brand-primary)]' : 'text-slate-300 hover:bg-white/5'
        }`}
    >
        {React.cloneElement(icon as React.ReactElement, { className: ICON_SMALL })}
        <span>{label}</span>
    </button>
)
