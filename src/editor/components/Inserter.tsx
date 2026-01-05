
import React, { useState, useRef, useEffect } from 'react';
import { useEditorStore } from '../state/editorStore';
import * as objectFactories from '../fabric/objectFactories';
import * as frameFactories from '../fabric/frameFactories';
import { loadPdfAsBackground } from '../fabric/pdfUtils';
import { StickerTab } from './StickerTab';
import { ChevronDown, Square, Circle, Triangle, Star, Heading1, Heading2, Pilcrow, Upload, Hexagon, FileImage, FileUp, FileText, LayoutTemplate, Sticker, Trash2 } from 'lucide-react';
import * as fabric from 'fabric';
import { loadApocapalette } from '../fabric/themeUtils';
import { TemplateData } from '../utils/indexedDb';
const INSERT_ICON = 'icon-muted w-4 h-4 stroke-[1.5]';

// --- Main Inserter Panel ---
export const Inserter: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'design' | 'stickers' | 'templates'>('design');

    return (
    <div className='flex flex-col h-full bg-[#1c0d0d]/80 backdrop-blur-md border border-[color:var(--border-subtle)] rounded-xl overflow-hidden transition-all duration-300 ease-in-out'>
            <div className="flex justify-center border-b">
                <TabButton
                    label="Design"
                    icon={<Square />}
                    isActive={activeTab === 'design'}
                    onClick={() => setActiveTab('design')}
                />
                <TabButton
                    label="Stickers"
                    icon={<Sticker />}
                    isActive={activeTab === 'stickers'}
                    onClick={() => setActiveTab('stickers')}
                />
                <TabButton
                    label="Templates"
                    icon={<LayoutTemplate />}
                    isActive={activeTab === 'templates'}
                    onClick={() => setActiveTab('templates')}
                />
            </div>
            <div className='flex-1 overflow-y-auto'>
                {activeTab === 'design' && <DesignTab />}
                {activeTab === 'stickers' && <StickerTab />}
                {activeTab === 'templates' && <TemplatesTab />}
            </div>
        </div>
    )
}

const DesignTab: React.FC = () => {
    const { canvas, saveState } = useEditorStore();
    const jsonInputRef = useRef<HTMLInputElement>(null);

    const handleAddItem = (factory: (canvas: fabric.Canvas) => void) => {
        if (canvas) {
            factory(canvas);
            saveState();
        }
    };
     const handleAddText = (options: any) => {
        if (canvas) {
            objectFactories.addIText(canvas, options);
            saveState();
        }
    };

    const handleJsonFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && canvas) {
            const reader = new FileReader();
            reader.onload = (f: ProgressEvent<FileReader>) => {
                try {
                    const jsonString = f.target?.result as string;
                    const apocapaletteData = JSON.parse(jsonString);
                    loadApocapalette(apocapaletteData, canvas);
                } catch (error) {
                    console.error('Error parsing Apocapalette JSON:', error);
                    alert('Invalid Apocapalette JSON file.');
                }
            };
            reader.readAsText(file);
        }
        if(jsonInputRef.current) jsonInputRef.current.value = '';
    };

    return (
        <div className="p-4 space-y-2">
            <Dropdown
                label="Shapes"
                items={[
                    { label: 'Rectangle', icon: <Square className={INSERT_ICON} />, onClick: () => handleAddItem(objectFactories.addRectangle) },
                    { label: 'Circle', icon: <Circle className={INSERT_ICON} />, onClick: () => handleAddItem(objectFactories.addCircle) },
                    { label: 'Triangle', icon: <Triangle className={INSERT_ICON} />, onClick: () => handleAddItem(objectFactories.addTriangle) },
                    { label: 'Star', icon: <Star className={INSERT_ICON} />, onClick: () => handleAddItem(objectFactories.addStar) },
                ]}
            />
            <Dropdown
                label="Frames"
                items={[
                    { label: 'Circle', icon: <Circle className={INSERT_ICON} />, onClick: () => handleAddItem(frameFactories.addCircleFrame) },
                    { label: 'Star', icon: <Star className={INSERT_ICON} />, onClick: () => handleAddItem(frameFactories.addStarFrame) },
                    { label: 'Hexagon', icon: <Hexagon className={INSERT_ICON} />, onClick: () => handleAddItem(frameFactories.addHexagonFrame) },
                ]}
            />
            <Dropdown
                label="Text"
                items={[
                    { label: 'Heading', icon: <Heading1 className={INSERT_ICON} />, onClick: () => handleAddText({ text: 'Heading', fontSize: 80, fontWeight: 'bold', role: 'heading' }) },
                    { label: 'Subheading', icon: <Heading2 className={INSERT_ICON} />, onClick: () => handleAddText({ text: 'Subheading', fontSize: 50, fontWeight: 'normal', role: 'subheading' }) },
                    { label: 'Body', icon: <Pilcrow className={INSERT_ICON} />, onClick: () => handleAddText({ text: 'Some body text...', fontSize: 24, fontWeight: 'normal', role: 'body' }) },
                    { label: 'Fixed Textbox', icon: <FileText className={INSERT_ICON} />, onClick: () => handleAddItem(objectFactories.addFixedTextbox) },
                ]}
            />
            <UploadsDropdown />
            <div className='p-4 border-t border-[color:var(--border-subtle)]'>
                <input type="file" accept=".json" ref={jsonInputRef} onChange={handleJsonFileChange} className="hidden" />
                <button onClick={() => jsonInputRef.current?.click()} className='group w-full flex items-center justify-center gap-2 text-xs uppercase tracking-widest text-slate-200 hover:text-[color:var(--brand-primary)] p-2 rounded-lg hover:bg-white/5 transition-all duration-300 ease-in-out'>
                    <Upload className={INSERT_ICON} />
                    Load Brand JSON
                </button>
            </div>
        </div>
    );
};

const UploadsDropdown: React.FC = () => {
    const { canvas, saveState } = useEditorStore();
    const imageInputRef = useRef<HTMLInputElement>(null);
    const svgInputRef = useRef<HTMLInputElement>(null);
    const pdfInputRef = useRef<HTMLInputElement>(null);

    const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && canvas) {
            const reader = new FileReader();
                reader.onload = (f: ProgressEvent<FileReader>) => {
                    const data = f.target?.result;
                    fabric.Image.fromURL(data as string, { crossOrigin: 'anonymous' }).then((img: fabric.FabricImage) => {
                        canvas.add(img);
                        canvas.centerObject(img);
                        canvas.requestRenderAll();
                        saveState();
                    });
                };
            reader.readAsDataURL(file);
        }
        if(imageInputRef.current) imageInputRef.current.value = '';
    };

    const handleSvgFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && canvas) {
            const reader = new FileReader();
                reader.onload = (f: ProgressEvent<FileReader>) => {
                    const svgString = f.target?.result as string;
                    fabric.loadSVGFromString(svgString).then(({ objects, options }) => {
                        const validObjects = objects.filter(
                            (obj): obj is fabric.FabricObject => obj !== null,
                        );
                        const group = new fabric.Group(validObjects, options);
                    canvas.add(group);
                    canvas.centerObject(group);
                    canvas.requestRenderAll();
                    saveState();
                });
            };
            reader.readAsText(file);
        }
        if(svgInputRef.current) svgInputRef.current.value = '';
    }

    const handlePdfFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && canvas) {
            loadPdfAsBackground(file, canvas);
        }
        if(pdfInputRef.current) pdfInputRef.current.value = '';
    }

    return (
        <div>
            <input type="file" accept="image/png, image/jpeg" ref={imageInputRef} onChange={handleImageFileChange} className="hidden" />
            <input type="file" accept=".svg" ref={svgInputRef} onChange={handleSvgFileChange} className="hidden" />
            <input type="file" accept=".pdf" ref={pdfInputRef} onChange={handlePdfFileChange} className="hidden" />
            <Dropdown
                label="Uploads"
                items={[
                    { label: 'Upload Image', icon: <FileImage className={INSERT_ICON} />, onClick: () => imageInputRef.current?.click() },
                    { label: 'Import SVG', icon: <FileUp className={INSERT_ICON} />, onClick: () => svgInputRef.current?.click() },
                    { label: 'PDF Background', icon: <FileText className={INSERT_ICON} />, onClick: () => pdfInputRef.current?.click() },
                ]}
            />
        </div>
    );
}

// --- Generic Dropdown Component ---
interface DropdownItem {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
}

interface DropdownProps {
    label: string;
    items: DropdownItem[];
}

const Dropdown: React.FC<DropdownProps> = ({ label, items }) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="relative">
            <button 
                onClick={() => setIsOpen(!isOpen)}
                className="group w-full flex items-center justify-between px-3 py-2 text-xs uppercase tracking-widest text-slate-200 bg-white/5 rounded-lg border border-[color:var(--border-subtle)] hover:bg-white/10 transition-all duration-300 ease-in-out"
            >
                {label}
                <ChevronDown className={`w-4 h-4 stroke-[1.5] text-[color:var(--muted-icon)] group-hover:text-[color:var(--brand-primary)] transition-all duration-300 ease-in-out ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
                <div className="mt-1 p-1 bg-[#120707] rounded-lg shadow-lg border border-[color:var(--border-subtle)] absolute w-full z-20 backdrop-blur-md">
                    <ul className="space-y-1">
                        {items.map(item => (
                             <li key={item.label}>
                                <button onClick={() => { item.onClick(); setIsOpen(false); }} className="group w-full flex items-center gap-3 px-3 py-2 text-left text-xs uppercase tracking-widest rounded-md text-slate-200 hover:bg-white/10 transition-all duration-300 ease-in-out">
                                    <span className="text-[color:var(--muted-icon)] group-hover:text-[color:var(--brand-primary)] transition-all duration-300 ease-in-out">{item.icon}</span>
                                    <span>{item.label}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

const TemplatesTab: React.FC = () => {
    const { templates, loadTemplates, loadTemplate, deleteTemplate, isTemplateLoading, isLoading: isEditorBusy } = useEditorStore((state) => ({
        templates: state.templates,
        loadTemplates: state.loadTemplates,
        loadTemplate: state.loadTemplate,
        deleteTemplate: state.deleteTemplate,
        isTemplateLoading: state.isTemplateLoading,
        isLoading: state.isLoading,
    }));

    useEffect(() => {
        void loadTemplates();
    }, [loadTemplates]);

    const handleLoad = async (template: TemplateData) => {
        if (isEditorBusy) return;
        const confirmed = window.confirm('Loading a template will clear your current work. Proceed?');
        if (!confirmed) return;
        await loadTemplate(template);
    };

    const handleDelete = async (template: TemplateData) => {
        const confirmed = window.confirm(`Delete ${template.name}? This cannot be undone.`);
        if (!confirmed) return;
        await deleteTemplate(template.id);
    };

    if (isTemplateLoading) {
        return (
            <div className="p-4 text-[11px] uppercase tracking-widest text-slate-400">
                Loading templates...
            </div>
        );
    }

    if (templates.length === 0) {
        return (
            <div className="p-4 text-[11px] uppercase tracking-widest text-slate-500">
                Save your current design as a template to view it here.
            </div>
        );
    }

    return (
        <div className="p-4 space-y-3">
            {templates.map((template) => (
                <div key={template.id} className="flex gap-3 p-3 bg-white/5 border border-white/10 rounded-2xl items-start">
                    <div className="w-24 h-20 bg-[#120707] border border-white/10 rounded-xl overflow-hidden">
                        {template.thumbnail ? (
                            <img src={template.thumbnail} alt={template.name} className="w-full h-full object-cover" />
                        ) : (
                            <span className="text-[9px] uppercase tracking-widest text-slate-500 flex items-center justify-center h-full">
                                Preview
                            </span>
                        )}
                    </div>
                    <div className="flex-1 flex flex-col gap-2">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-[11px] uppercase tracking-widest text-slate-200">{template.name}</p>
                                {template.themeName && (
                                    <p className="text-[9px] uppercase tracking-widest text-slate-400">{template.themeName}</p>
                                )}
                            </div>
                            <span className="text-[10px] uppercase tracking-widest text-slate-500">
                                {new Date(template.createdAt).toLocaleDateString()}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => void handleLoad(template)}
                                disabled={isEditorBusy}
                                className="px-3 py-1 text-[10px] uppercase tracking-widest rounded-full border border-[color:var(--brand-primary)] text-[color:var(--brand-primary)] hover:bg-[color:var(--brand-primary)] hover:text-white transition-all duration-300 ease-in-out disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Load
                            </button>
                            <button
                                onClick={() => void handleDelete(template)}
                                className="p-2 rounded-full border border-white/10 text-slate-400 hover:border-rose-400 hover:text-rose-200 transition-all duration-300 ease-in-out"
                                aria-label={`Delete ${template.name}`}
                            >
                                <Trash2 className="w-4 h-4 stroke-[1.5]" />
                            </button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

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
        {React.cloneElement(icon as React.ReactElement, { className: 'w-4 h-4 stroke-[1.5]' })}
        <span>{label}</span>
    </button>
)
