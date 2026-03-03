import React, { useState, useRef } from 'react';
import { shallow } from 'zustand/shallow';
import { useEditorStore } from '../state/editorStore';
import { useThemeStore } from '../state/useThemeStore';
import * as objectFactories from '../fabric/objectFactories';
import { MaskFrame } from './MaskFrame';
import { loadPdfAsBackground } from '../fabric/pdfUtils';
import { StickerTab } from './StickerTab';
import { TemplateBrowser } from './TemplateBrowser';
import { ChevronDown, Square, Circle, Triangle, Star, Heading1, Heading2, Pilcrow, FileImage, FileUp, FileText, LayoutTemplate, Sticker, LayoutGrid } from 'lucide-react';
import * as fabric from 'fabric';
import { SAFE_MARGIN_PX } from '../utils/units';
import { resolveThemeValue } from '../utils/themeResolver';
import { loadImageFromFile, loadSvgFromFile, extractFileMetadata } from '../services/assetLoader';
import { toSerializableObject } from '../utils/serialization';
import { withManifestZIndex, ZIndexLayer } from '../fabric/zIndexManifest';

const INSERT_ICON = 'icon-muted w-4 h-4 stroke-[1.5]';

// --- Main Inserter Panel ---
export const Inserter: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'design' | 'stickers' | 'templates'>('design');

    return (
    <div className='flex flex-col h-full bg-[color:var(--ui-panel)] backdrop-blur-[var(--ui-blur)]'>
            <div className="flex justify-center border-b border-[color:var(--border-subtle)]">
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
    const { canvas, setActiveTool, setToastMessage } = useEditorStore(
        (state) => ({
            canvas: state.canvas,
            setActiveTool: state.setActiveTool,
            setToastMessage: state.setToastMessage,
        }),
        shallow
    );

    const handleAddItem = (factory: (canvas: fabric.Canvas) => void) => {
        if (canvas) {
            factory(canvas);
            // Automatically switch to selection tool after inserting a shape
            setActiveTool('select');
        } else {
            setToastMessage('Canvas is still loading.');
        }
    };
    const handleAddText = (options: any) => {
        if (canvas) {
            objectFactories.addIText(canvas, options);
            // Automatically switch to selection tool after inserting text
            setActiveTool('select');
        } else {
            setToastMessage('Canvas is still loading.');
        }
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
            <MaskFrame />
            <Dropdown
                label="Text"
                items={[
                    { label: 'Heading', icon: <Heading1 className={INSERT_ICON} />, onClick: () => handleAddText({ text: 'Heading', fontSize: 80, fontWeight: 'bold', role: 'heading' }) },
                    { label: 'Subheading', icon: <Heading2 className={INSERT_ICON} />, onClick: () => handleAddText({ text: 'Subheading', fontSize: 50, fontWeight: 'normal', role: 'subheading' }) },
                    { label: 'Body', icon: <Pilcrow className={INSERT_ICON} />, onClick: () => handleAddText({ text: 'Some body text...', fontSize: 24, fontWeight: 'normal', role: 'body' }) },
                    { label: 'Draw Text Box', icon: <FileText className={INSERT_ICON} />, onClick: () => {
                        setActiveTool('textbox');
                        setToastMessage('Draw a rectangle to create a text box');
                    }},
                ]}
            />
            <LayoutsDropdown />
            <UploadsDropdown />
        </div>
    );
};

const UploadsDropdown: React.FC = () => {
    const { canvas, addAssetToLibrary } = useEditorStore(
        (state) => ({
            canvas: state.canvas,
            addAssetToLibrary: state.addAssetToLibrary,
        }),
        shallow
    );
    const imageInputRef = useRef<HTMLInputElement>(null);
    const svgInputRef = useRef<HTMLInputElement>(null);
    const pdfInputRef = useRef<HTMLInputElement>(null);

    const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !canvas) {
            if (imageInputRef.current) imageInputRef.current.value = '';
            return;
        }

        // Load image using asset loader service
        const result = await loadImageFromFile(file);

        if (!result.success) {
            console.error('Failed to load image:', result.errorMessage);
            if (imageInputRef.current) imageInputRef.current.value = '';
            return;
        }

        // Extract metadata and add to library
        const metadata = extractFileMetadata(file);
        addAssetToLibrary({
            id: result.id,
            url: result.blobUrl!,
            label: metadata.baseName,
            format: metadata.format,
            tags: metadata.tags,
        });

        canvas.centerObject(result.asset);
        const serialized = withManifestZIndex(
            toSerializableObject(result.asset),
            ZIndexLayer.Content
        );
        useEditorStore.getState().addObject(serialized, { save: true, select: true });

        if (imageInputRef.current) imageInputRef.current.value = '';
    };

    const handleSvgFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !canvas) {
            if (svgInputRef.current) svgInputRef.current.value = '';
            return;
        }

        // Load SVG using asset loader service
        const result = await loadSvgFromFile(file);

        if (!result.success) {
            console.error('Failed to load SVG:', result.errorMessage);
            if (svgInputRef.current) svgInputRef.current.value = '';
            return;
        }

        // Add SVG to canvas
        objectFactories.addSvgFromUrl(canvas, result.asset);

        if (svgInputRef.current) svgInputRef.current.value = '';
    };

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

const LayoutsDropdown: React.FC = () => {
    const { canvas, bleedPx, setActiveTool } = useEditorStore(
        (state) => ({
            canvas: state.canvas,
            bleedPx: state.bleedPx,
            setActiveTool: state.setActiveTool,
        }),
        shallow
    );
    const { themeData } = useThemeStore(
        (state) => ({ themeData: state.themeData }),
        shallow
    );
    const [isOpen, setIsOpen] = useState(false);
    const [showCustomGrid, setShowCustomGrid] = useState(false);
    const [rows, setRows] = useState(2);
    const [cols, setCols] = useState(2);
    const gutter = 20;

    const toRgba = (color: string, alpha: number) => {
        if (color.startsWith('#')) {
            const hex = color.replace('#', '');
            const normalized = hex.length === 3
                ? hex.split('').map((c) => c + c).join('')
                : hex;
            const r = parseInt(normalized.slice(0, 2), 16);
            const g = parseInt(normalized.slice(2, 4), 16);
            const b = parseInt(normalized.slice(4, 6), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
        const rgbMatch = color.match(/rgba?\(([^)]+)\)/i);
        if (rgbMatch) {
            const parts = rgbMatch[1].split(',').map((v) => Number.parseFloat(v.trim()));
            if (parts.length >= 3) {
                return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
            }
        }
        return `rgba(148, 163, 184, ${alpha})`;
    };

    const drawGhostGrid = (gridRows: number, gridCols: number) => {
        if (!canvas) return;
        const ctx = canvas.contextTop;
        canvas.clearContext(ctx);
        if (gridRows <= 0 || gridCols <= 0) return;

        const safeInset = bleedPx + SAFE_MARGIN_PX;
        const safeWidth = canvas.getWidth() - safeInset * 2;
        const safeHeight = canvas.getHeight() - safeInset * 2;
        if (safeWidth <= 0 || safeHeight <= 0) return;

        const cellWidth = (safeWidth - gutter * (gridCols - 1)) / gridCols;
        const cellHeight = (safeHeight - gutter * (gridRows - 1)) / gridRows;
        if (cellWidth <= 0 || cellHeight <= 0) return;

        const strokeColor = toRgba(
            resolveThemeValue(themeData, 'borders.border-subtle') || '#94a3b8',
            0.5
        );
        const vpt = canvas.viewportTransform;

        ctx.save();
        if (vpt) {
            ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
        }
        ctx.strokeStyle = strokeColor;
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1 / (canvas.getZoom() || 1);

        for (let row = 0; row < gridRows; row += 1) {
            for (let col = 0; col < gridCols; col += 1) {
                const left = safeInset + col * (cellWidth + gutter);
                const top = safeInset + row * (cellHeight + gutter);
                ctx.strokeRect(left, top, cellWidth, cellHeight);
            }
        }

        ctx.restore();
    };

    const clearGhostGrid = () => {
        if (!canvas) return;
        canvas.clearContext(canvas.contextTop);
    };

    const handleGenerateGrid = (gridRows: number, gridCols: number) => {
        if (!canvas) return;
        objectFactories.generateGrid(canvas, gridRows, gridCols);
        // Automatically switch to selection tool after inserting grid
        setActiveTool('select');
        setIsOpen(false);
        setShowCustomGrid(false);
        clearGhostGrid();
    };

    const handleNumberInput =
        (setter: React.Dispatch<React.SetStateAction<number>>) =>
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const parsed = Number.parseInt(e.target.value, 10);
            const clamped = Number.isFinite(parsed) ? Math.min(12, Math.max(1, parsed)) : 1;
            const next = Number.isFinite(clamped) ? clamped : 1;
            setter(next);
        };

    React.useEffect(() => {
        if (!canvas) return;
        const shouldPreview = isOpen && showCustomGrid;
        const draw = () => drawGhostGrid(rows, cols);
        if (shouldPreview) {
            draw();
            canvas.on('after:render', draw);
        } else {
            canvas.off('after:render', draw);
            clearGhostGrid();
        }
        return () => {
            canvas.off('after:render', draw);
            clearGhostGrid();
        };
    }, [canvas, isOpen, showCustomGrid, rows, cols, themeData, bleedPx]);

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="group w-full flex items-center justify-between px-3 py-2 text-xs uppercase tracking-widest text-[color:var(--ui-text)] bg-white/5 rounded-lg border border-[color:var(--border-subtle)] hover:bg-white/10"
            >
                Layouts
                <ChevronDown className={`w-4 h-4 stroke-[1.5] text-[color:var(--muted-icon)] transition-all ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
                <div className="mt-1 p-1 bg-[color:var(--ui-panel)] rounded-lg shadow-lg border border-[color:var(--ui-border)] absolute w-full z-20 backdrop-blur-[var(--ui-blur)]">
                    <ul className="space-y-1">
                        <li>
                            <button
                                onClick={() => handleGenerateGrid(1, 3)}
                                className="group w-full flex items-center gap-3 px-3 py-2 text-left text-xs uppercase tracking-widest rounded-md text-[color:var(--ui-text)] hover:bg-white/10"
                            >
                                <span className="text-[color:var(--muted-icon)] group-hover:text-[color:var(--brand-primary)]">
                                    <LayoutGrid className={INSERT_ICON} />
                                </span>
                                <span>Triptych</span>
                            </button>
                        </li>
                        <li>
                            <button
                                onClick={() => handleGenerateGrid(1, 7)}
                                className="group w-full flex items-center gap-3 px-3 py-2 text-left text-xs uppercase tracking-widest rounded-md text-[color:var(--ui-text)] hover:bg-white/10"
                            >
                                <span className="text-[color:var(--muted-icon)] group-hover:text-[color:var(--brand-primary)]">
                                    <LayoutGrid className={INSERT_ICON} />
                                </span>
                                <span>Weekly Tracker</span>
                            </button>
                        </li>
                        <li>
                            <button
                                onClick={() => {
                                    if (!canvas) return;
                                    objectFactories.addHerbProfileLayout(canvas);
                                    // Automatically switch to selection tool after inserting layout
                                    setActiveTool('select');
                                    setIsOpen(false);
                                    setShowCustomGrid(false);
                                }}
                                className="group w-full flex items-center gap-3 px-3 py-2 text-left text-xs uppercase tracking-widest rounded-md text-[color:var(--ui-text)] hover:bg-white/10"
                            >
                                <span className="text-[color:var(--muted-icon)] group-hover:text-[color:var(--brand-primary)]">
                                    <LayoutGrid className={INSERT_ICON} />
                                </span>
                                <span>Herb Profile</span>
                            </button>
                        </li>
                        <li>
                            <button
                                onClick={() => setShowCustomGrid((prev) => !prev)}
                                className="group w-full flex items-center gap-3 px-3 py-2 text-left text-xs uppercase tracking-widest rounded-md text-[color:var(--ui-text)] hover:bg-white/10"
                            >
                                <span className="text-[color:var(--muted-icon)] group-hover:text-[color:var(--brand-primary)]">
                                    <LayoutGrid className={INSERT_ICON} />
                                </span>
                                <span>Custom Grid</span>
                            </button>
                        </li>
                    </ul>
                    {showCustomGrid && (
                        <div className="mt-2 rounded-md border border-[color:var(--border-subtle)] bg-black/40 p-3 text-xs uppercase tracking-widest text-[color:var(--ui-panel-text)] space-y-3">
                            <div className="flex items-center gap-2">
                                <label className="w-16 text-[10px] text-[color:var(--ui-panel-text)]">Rows</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={12}
                                    value={rows}
                                    onChange={handleNumberInput(setRows)}
                                    className="w-full rounded-md bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-[color:var(--ui-text)] focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-primary)]"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <label className="w-16 text-[10px] text-[color:var(--ui-panel-text)]">Columns</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={12}
                                    value={cols}
                                    onChange={handleNumberInput(setCols)}
                                    className="w-full rounded-md bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-[color:var(--ui-text)] focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-primary)]"
                                />
                            </div>
                            <button
                                onClick={() => handleGenerateGrid(rows, cols)}
                                className="w-full rounded-md bg-white/10 px-3 py-2 text-[10px] uppercase tracking-widest text-[color:var(--ui-text)] hover:bg-white/20"
                            >
                                Generate
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

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
                className="group w-full flex items-center justify-between px-3 py-2 text-xs uppercase tracking-widest text-[color:var(--ui-text)] bg-white/5 rounded-lg border border-[color:var(--border-subtle)] hover:bg-white/10"
            >
                {label}
                <ChevronDown className={`w-4 h-4 stroke-[1.5] text-[color:var(--muted-icon)] transition-all ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
                <div className="mt-1 p-1 bg-[color:var(--ui-panel)] rounded-lg shadow-lg border border-[color:var(--ui-border)] absolute w-full z-20 backdrop-blur-[var(--ui-blur)]">
                    <ul className="space-y-1">
                        {items.map(item => (
                             <li key={item.label}>
                                <button onClick={() => { item.onClick(); setIsOpen(false); }} className="group w-full flex items-center gap-3 px-3 py-2 text-left text-xs uppercase tracking-widest rounded-md text-[color:var(--ui-text)] hover:bg-white/10">
                                    <span className="text-[color:var(--muted-icon)] group-hover:text-[color:var(--brand-primary)]">{item.icon}</span>
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
    return (
        <div className="h-full overflow-y-auto">
            <TemplateBrowser />
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
        className={`flex-1 flex justify-center items-center gap-2 p-3 text-[11px] uppercase tracking-widest transition-all disabled:text-[color:var(--ui-panel-text)]/60 ${
            isActive ? 'text-[color:var(--brand-primary)] border-b-2 border-[color:var(--brand-primary)]' : 'text-[color:var(--ui-panel-text)] hover:bg-white/5'
        }`}
    >
        {React.cloneElement(icon as React.ReactElement<any>, { className: 'w-4 h-4 stroke-[1.5]' })}
        <span>{label}</span>
    </button>
)
