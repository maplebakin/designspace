
import React from 'react';
import { shallow } from 'zustand/shallow';
import { DEFAULT_CANVAS_BACKGROUND, useEditorStore, Template } from '../state/editorStore';
import { useCanvasStore } from '../state/useCanvasStore';
import { useThemeStore } from '../state/useThemeStore';
import { resizeCanvas } from '../fabric/canvasUtils';
import type { ApocapaletteTheme } from '../types/apocapalette';
import { PRINT_DPI } from '../utils/units';
import { toSerializableObject } from '../utils/serialization';
import { isPersistableCanvasObject, isUserObject } from '../utils/objectUtils';
import { renderCanvasToPngBlob } from '../utils/renderToPng';
import {
    listTemplates,
    saveTemplate,
    deleteTemplate,
} from '../services/templateService';
import type { TemplateRecord } from '../db';

type TemplateThumbnailProps = {
    name: string;
    themeData: ApocapaletteTheme | null;
};

const resolveTokenValue = (obj: object | null, path: string): string | null => {
    if (!obj) return null;
    const getValueByPath = (target: object, keyPath: string): any =>
        keyPath.split('.').reduce((acc, part) => acc && (acc as any)[part], target);

    let value = getValueByPath(obj, path);
    if (!value && !path.endsWith('.value')) {
        value = getValueByPath(obj, `${path}.value`);
    }
    if (value && typeof value === 'object' && 'value' in value) {
        return (value as { value: string }).value;
    }
    return typeof value === 'string' ? value : null;
};

const hashString = (value: string) => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
        hash = (hash << 5) - hash + value.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
};

const isExternalUrl = (value: string) => /^https?:\/\//i.test(value);

const toTestSlug = (value: string) =>
    value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
        if (typeof reader.result === 'string') {
            resolve(reader.result);
            return;
        }
        reject(new Error('Failed to convert blob to data URL.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob.'));
    reader.readAsDataURL(blob);
});

const DynamicSvgThumbnail: React.FC<TemplateThumbnailProps> = ({ name, themeData }) => {
    const label = name.toUpperCase();
    const seed = React.useMemo(() => hashString(name), [name]);
    const uid = React.useId().replace(/:/g, '');
    const gradientId = `thumb-gradient-${uid}`;
    const accentId = `thumb-accent-${uid}`;
    const palette = React.useMemo(() => {
        const surface = resolveTokenValue(themeData, 'surfaces.surface-plain') || 'var(--ui-panel)';
        const border = resolveTokenValue(themeData, 'borders.border-subtle') || 'var(--ui-border)';
        const primary = resolveTokenValue(themeData, 'brand.primary') || 'var(--ui-accent)';
        const accent = resolveTokenValue(themeData, 'brand.accent') || primary;
        const secondary = resolveTokenValue(themeData, 'brand.secondary') || 'var(--ui-text)';
        const text = resolveTokenValue(themeData, 'typography.text-body') || 'var(--ui-text)';
        return {
            surface,
            border,
            primary,
            accent,
            secondary,
            text,
        };
    }, [themeData]);
    const shiftX = (seed % 18) - 9;
    const shiftY = ((seed >> 4) % 14) - 7;
    const barWidth = 64 + (seed % 40);
    const circleRadius = 10 + (seed % 6);
    const title = label.length > 18 ? `${label.slice(0, 18)}...` : label;

    return (
        <svg
            viewBox="0 0 150 100"
            role="img"
            aria-label={`${name} thumbnail`}
            className="w-full h-full"
        >
            <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={palette.primary} stopOpacity="0.8" />
                    <stop offset="100%" stopColor={palette.accent} stopOpacity="0.7" />
                </linearGradient>
                <radialGradient id={accentId} cx="0.5" cy="0.5" r="0.7">
                    <stop offset="0%" stopColor={palette.accent} stopOpacity="0.5" />
                    <stop offset="100%" stopColor={palette.surface} stopOpacity="0" />
                </radialGradient>
            </defs>
            <rect
                x="0.5"
                y="0.5"
                width="149"
                height="99"
                rx="10"
                fill={palette.surface}
                stroke={palette.border}
            />
            <rect
                x="8"
                y="8"
                width="134"
                height="84"
                rx="10"
                fill={`url(#${gradientId})`}
                opacity="0.18"
            />
            <text
                x="75"
                y="88"
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="9"
                letterSpacing="2"
                fill={palette.text}
            >
                {title}
            </text>
            <rect
                x={12 + shiftX}
                y="16"
                width={barWidth}
                height="8"
                rx="4"
                fill={palette.primary}
                opacity="0.75"
            />
            <rect x="12" y="30" width="92" height="6" rx="3" fill={palette.secondary} opacity="0.35" />
            <rect x="12" y="42" width="110" height="6" rx="3" fill={palette.secondary} opacity="0.25" />
            <rect x="12" y="54" width="84" height="6" rx="3" fill={palette.secondary} opacity="0.2" />
            <circle
                cx={110 + shiftX}
                cy={68 + shiftY}
                r={circleRadius}
                fill={`url(#${accentId})`}
            />
            <circle
                cx={128 + shiftX}
                cy={76 + shiftY}
                r="5"
                fill={palette.primary}
                opacity="0.6"
            />
        </svg>
    );
};

type BlankPreset = {
    name: string;
    description: string;
    unit: 'in' | 'px';
    width: number;
    height: number;
    dpi: number;
};

const blankPresets: BlankPreset[] = [
    { name: 'US Letter', description: '8.5" × 11" @ 300 DPI', unit: 'in', width: 8.5, height: 11, dpi: PRINT_DPI },
    { name: 'A4', description: '8.27" × 11.69" @ 300 DPI', unit: 'in', width: 8.27, height: 11.69, dpi: PRINT_DPI },
    { name: 'Ritual Card', description: '5" × 7" @ 300 DPI', unit: 'in', width: 5, height: 7, dpi: PRINT_DPI },
    { name: 'Instagram Square', description: '1080 × 1080 px', unit: 'px', width: 1080, height: 1080, dpi: 96 },
    { name: 'Instagram Story', description: '1080 × 1920 px', unit: 'px', width: 1080, height: 1920, dpi: 96 },
    { name: 'Desktop Wallpaper', description: '1920 × 1080 px', unit: 'px', width: 1920, height: 1080, dpi: 96 },
];

export const TemplateBrowser: React.FC = () => {
    const {
        loadTemplate,
        setToastMessage,
        canvas,
        requestLayerSync,
        setUnitMode,
        setCanvasBackgroundColor,
        unitMode,
    } = useEditorStore(
        (state) => ({
            loadTemplate: state.loadTemplate,
            setToastMessage: state.setToastMessage,
            canvas: state.canvas,
            requestLayerSync: state.requestLayerSync,
            setUnitMode: state.setUnitMode,
            setCanvasBackgroundColor: state.setCanvasBackgroundColor,
            unitMode: state.unitMode,
        }),
        shallow
    );
    const { themeData, activeBrandCollectionId, canvasBackgroundColor } = useThemeStore(
        (state) => ({
            themeData: state.themeData,
            activeBrandCollectionId: state.activeBrandCollectionId,
            canvasBackgroundColor: state.canvasBackgroundColor,
        }),
        shallow
    );
    const [myTemplates, setMyTemplates] = React.useState<TemplateRecord[]>([]);

    const normalizeUnitMode = (value?: string): 'in' | 'px' | undefined =>
        value === 'in' || value === 'px' ? value : undefined;

    const toEditorTemplate = (template: TemplateRecord): Template => ({
        id: String(template.id ?? ''),
        name: template.name,
        canvasData: JSON.stringify(template.canvasData ?? { objects: [] }),
        defaultThemeId: template.defaultThemeId ?? '',
        thumbnail: template.thumbnail,
        canvasSize: template.canvasSize,
        unitMode: normalizeUnitMode(template.unitMode),
    });

    const communityTemplates: Template[] = [
        {
            id: 'daily-ritual',
            name: 'Daily Ritual',
            canvasData: JSON.stringify({
                version: '5.0.0',
                objects: [
                    // Heading
                    {
                        type: 'i-text',
                        left: 100, top: 50,
                        text: 'Daily Ritual',
                        fontSize: 40,
                        fontFamily: 'serif',
                        fill: '#333',
                        id: 'text-heading',
                        tokenRole: 'typography.heading.value'
                    },
                    // Body text
                    {
                        type: 'i-text',
                        left: 100, top: 120,
                        text: 'Intentions & Affirmations:',
                        fontSize: 20,
                        fontFamily: 'sans-serif',
                        fill: '#666',
                        id: 'text-body-1',
                        tokenRole: 'typography.body.value'
                    },
                    // Sigil slots (placeholders)
                    {
                        type: 'rect',
                        left: 100, top: 200,
                        width: 150, height: 150,
                        fill: '#e2e8f0',
                        stroke: '#cbd5e1',
                        strokeWidth: 1,
                        rx: 12,
                        ry: 12,
                        id: 'sigil-slot-1',
                        tokenRole: 'surfaces.surface-plain',
                        isPlaceholder: true
                    },
                    {
                        type: 'rect',
                        left: 300, top: 200,
                        width: 150, height: 150,
                        fill: '#e2e8f0',
                        stroke: '#cbd5e1',
                        strokeWidth: 1,
                        rx: 12,
                        ry: 12,
                        id: 'sigil-slot-2',
                        tokenRole: 'surfaces.surface-plain',
                        isPlaceholder: true
                    }
                ]
            }),
            defaultThemeId: 'witchy-theme-id-1', // Placeholder ID
        },
        {
            id: 'herb-profile',
            name: 'Herb Profile',
            canvasData: JSON.stringify({
                version: '5.0.0',
                objects: [
                    // Image slot
                    {
                        type: 'rect',
                        left: 100, top: 50,
                        width: 200, height: 200,
                        fill: '#e2e8f0',
                        stroke: '#cbd5e1',
                        strokeWidth: 1,
                        rx: 16,
                        ry: 16,
                        id: 'herb-image-slot',
                        tokenRole: 'surfaces.surface-plain',
                        isPlaceholder: true
                    },
                    // Muted text slots
                    {
                        type: 'i-text',
                        left: 350, top: 50,
                        text: 'Name: Belladonna',
                        fontSize: 24,
                        fontFamily: 'sans-serif',
                        fill: '#888',
                        id: 'herb-name',
                        tokenRole: 'typography.body.value'
                    },
                    {
                        type: 'i-text',
                        left: 350, top: 90,
                        text: 'Uses: Divination, Protection',
                        fontSize: 18,
                        fontFamily: 'sans-serif',
                        fill: '#AAA',
                        id: 'herb-uses',
                        tokenRole: 'typography.body.value'
                    },
                    // Border accent (simple rectangle for now)
                    {
                        type: 'rect',
                        left: 50, top: 30,
                        width: 500, height: 300,
                        fill: 'transparent',
                        stroke: '#B45F06',
                        strokeWidth: 5,
                        id: 'border-accent',
                        tokenRole: 'brand.accent.value'
                    }
                ]
            }),
            defaultThemeId: 'witchy-theme-id-2', // Placeholder ID
        },
        {
            id: 'moon-phase-tracker',
            name: 'Moon Phase Tracker',
            canvasData: JSON.stringify({
                version: '5.0.0',
                objects: [
                    // Title
                    {
                        type: 'i-text',
                        left: 50, top: 30,
                        text: 'Moon Phase Tracker',
                        fontSize: 36,
                        fontFamily: 'serif',
                        fill: '#333',
                        id: 'moon-title',
                        tokenRole: 'typography.heading.value'
                    },
                    // Celestial grid slots (circles for moon phases)
                    {
                        type: 'circle',
                        left: 100, top: 120,
                        radius: 30,
                        fill: '#F0F0F0',
                        stroke: '#888',
                        strokeWidth: 1,
                        id: 'moon-phase-1',
                        tokenRole: 'brand.secondary.value'
                    },
                    {
                        type: 'circle',
                        left: 200, top: 120,
                        radius: 30,
                        fill: '#E0E0E0',
                        stroke: '#888',
                        strokeWidth: 1,
                        id: 'moon-phase-2',
                        tokenRole: 'brand.secondary.value'
                    },
                    {
                        type: 'circle',
                        left: 300, top: 120,
                        radius: 30,
                        fill: '#D0D0D0',
                        stroke: '#888',
                        strokeWidth: 1,
                        id: 'moon-phase-3',
                        tokenRole: 'brand.secondary.value'
                    },
                    {
                        type: 'i-text',
                        left: 100, top: 200,
                        text: 'New Moon',
                        fontSize: 14,
                        fontFamily: 'sans-serif',
                        fill: '#666',
                        id: 'moon-label-1',
                        tokenRole: 'typography.body.value'
                    }
                    // ... more moon phases can be added
                ]
            }),
            defaultThemeId: 'witchy-theme-id-3', // Placeholder ID
        },
    ];

    const refreshMyTemplates = React.useCallback(async () => {
        try {
            const records = await listTemplates();
            setMyTemplates(records);
        } catch {
            setToastMessage('Failed to load saved templates.');
        }
    }, [setToastMessage]);

    React.useEffect(() => {
        void refreshMyTemplates();
    }, [refreshMyTemplates]);

    const handleLoadTemplate = (template: Template) => {
        const confirmLoad = window.confirm(
            'Loading a new template will clear your current canvas. Are you sure?'
        );
        if (confirmLoad) {
            loadTemplate(template);
        } else {
            setToastMessage('Template loading cancelled.');
        }
    };

    const handleLoadMyTemplate = (template: TemplateRecord) => {
        handleLoadTemplate(toEditorTemplate(template));
    };

    const handleSaveAsTemplate = async () => {
        if (!canvas) {
            setToastMessage('Canvas not ready.');
            return;
        }

        const pageBackground = canvasBackgroundColor || DEFAULT_CANVAS_BACKGROUND;
        const serializedObjects = canvas.getObjects().filter(isPersistableCanvasObject).map(toSerializableObject);
        const canvasData = {
            objects: serializedObjects,
            background: pageBackground,
        };
        const templateName = `Template ${new Date().toISOString()}`;

        try {
            const thumbnailBlob = await renderCanvasToPngBlob(canvas, {
                scale: 0.2,
                includeBackground: true,
                backgroundColor: pageBackground,
            });
            const thumbnail = await blobToDataUrl(thumbnailBlob);
            const { width, height } = useCanvasStore.getState();
            await saveTemplate(
                templateName,
                canvasData,
                {
                    width: Math.max(1, Math.round(width)),
                    height: Math.max(1, Math.round(height)),
                },
                thumbnail,
                {
                    unitMode,
                    defaultThemeId: activeBrandCollectionId || undefined,
                }
            );
            await refreshMyTemplates();
            setToastMessage(`Saved template: ${templateName}`);
        } catch {
            try {
                const fallbackThumbnail = canvas.toDataURL({ multiplier: 0.1 });
                const { width, height } = useCanvasStore.getState();
                await saveTemplate(
                    templateName,
                    canvasData,
                    {
                        width: Math.max(1, Math.round(width)),
                        height: Math.max(1, Math.round(height)),
                    },
                    fallbackThumbnail,
                    {
                        unitMode,
                        defaultThemeId: activeBrandCollectionId || undefined,
                    }
                );
                await refreshMyTemplates();
                setToastMessage(`Saved template: ${templateName}`);
            } catch {
                setToastMessage('Failed to save template.');
            }
        }
    };

    const handleDeleteMyTemplate = async (template: TemplateRecord) => {
        const templateId = template.id;
        if (typeof templateId !== 'number') {
            setToastMessage('Unable to delete template.');
            return;
        }
        const shouldDelete = window.confirm(`Delete template "${template.name}"?`);
        if (!shouldDelete) return;
        try {
            await deleteTemplate(templateId);
            setMyTemplates((current) => current.filter((item) => item.id !== templateId));
            setToastMessage(`Deleted template: ${template.name}`);
        } catch {
            setToastMessage('Failed to delete template.');
        }
    };

    const handleBlankPreset = (preset: BlankPreset) => {
        if (!canvas) return;
        const hasContent = canvas.getObjects().some(isUserObject);
        if (hasContent) {
            const proceed = window.confirm(
                'Starting a new blank canvas will clear your current design. Continue?'
            );
            if (!proceed) {
                setToastMessage('Blank canvas cancelled.');
                return;
            }
        }

        useEditorStore.getState().clearSelection();
        canvas.clear();
        requestLayerSync();
        setUnitMode(preset.unit);

        const widthPx = preset.unit === 'in' ? Math.round(preset.width * preset.dpi) : preset.width;
        const heightPx = preset.unit === 'in' ? Math.round(preset.height * preset.dpi) : preset.height;
        setCanvasBackgroundColor('#ffffff');
        canvas.requestRenderAll();
        resizeCanvas(widthPx, heightPx);
        setToastMessage(`Blank canvas: ${preset.name}`);
    };

    return (
        <div className="py-4 space-y-6 text-[color:var(--ui-panel-text)]">
            <div className="px-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
                    <h3 className="text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)] mb-3">Blank Canvas</h3>
                    <div className="grid grid-cols-2 gap-2">
                        {blankPresets.map((preset) => (
                            <button
                                key={`${preset.name}-${preset.width}-${preset.height}`}
                                onClick={() => handleBlankPreset(preset)}
                                className="w-full text-left px-3 py-2 rounded-xl border border-transparent bg-white/5 hover:border-[color:var(--brand-primary)] transition-all duration-300 ease-in-out"
                            >
                                <span className="block text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">{preset.name}</span>
                                <span className="block text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">{preset.description}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
            <div className="px-4">
                <button
                    onClick={() => void handleSaveAsTemplate()}
                    className="w-full mb-4 text-left px-4 py-3 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all duration-300 ease-in-out text-xs uppercase tracking-widest text-[color:var(--ui-panel-text)]"
                >
                    Save as Template
                </button>
            </div>
            <div className="px-4">
                <h3 className="text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)] mb-3">My Templates</h3>
                {myTemplates.length === 0 ? (
                    <p className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/70 mb-4">
                        No saved templates yet.
                    </p>
                ) : (
                    <div className="grid grid-cols-2 gap-2">
                        {myTemplates.map((template) => {
                            const safeThumbnailSrc =
                                template.thumbnail && !isExternalUrl(template.thumbnail)
                                    ? template.thumbnail
                                    : null;

                            return (
                                <div
                                    key={template.id}
                                    className="p-3 bg-white/5 rounded-lg border border-transparent hover:border-[color:var(--brand-primary)] transition-all duration-300 ease-in-out backdrop-blur-[var(--ui-blur)]"
                                >
                                    <button
                                        data-testid={`template-my-${toTestSlug(template.name)}`}
                                        onClick={() => handleLoadMyTemplate(template)}
                                        className="w-full text-left"
                                    >
                                        <div className="w-full aspect-[3/2] rounded-md overflow-hidden mb-2">
                                            {safeThumbnailSrc ? (
                                                <img
                                                    src={safeThumbnailSrc}
                                                    alt={template.name}
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <DynamicSvgThumbnail name={template.name} themeData={themeData} />
                                            )}
                                        </div>
                                        <span className="text-xs uppercase tracking-widest text-[color:var(--ui-panel-text)]">
                                            {template.name}
                                        </span>
                                    </button>
                                    <button
                                        onClick={() => void handleDeleteMyTemplate(template)}
                                        className="mt-2 w-full text-[9px] uppercase tracking-widest text-red-300 hover:text-red-200 border border-red-300/40 rounded-md px-2 py-1"
                                    >
                                        Delete
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            <div className="px-4">
                <div className="h-px w-full bg-white/10" />
            </div>
            <div className="px-4">
                <h3 className="text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)] mb-3">Community Templates</h3>
                <p className="text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/70 mb-3">
                    Built-in starter layouts
                </p>
                <div className="grid grid-cols-2 gap-2">
                    {communityTemplates.map((template) => {
                        const thumbnailSrc =
                            template.thumbnail || (template as { thumbnailUrl?: string }).thumbnailUrl;
                        const safeThumbnailSrc =
                            thumbnailSrc && !isExternalUrl(thumbnailSrc) ? thumbnailSrc : null;

                        return (
                        <button 
                            key={template.id}
                            data-testid={`template-community-${template.id}`}
                            onClick={() => handleLoadTemplate(template)}
                            className="w-full text-left p-3 bg-white/5 rounded-lg border border-transparent hover:border-[color:var(--brand-primary)] transition-all duration-300 ease-in-out backdrop-blur-[var(--ui-blur)]"
                        >
                            <div className="w-full aspect-[3/2] rounded-md overflow-hidden mb-2">
                                {safeThumbnailSrc ? (
                                    <img 
                                        src={safeThumbnailSrc}
                                        alt={template.name}
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <DynamicSvgThumbnail name={template.name} themeData={themeData} />
                                )}
                            </div>
                            <span className="text-xs uppercase tracking-widest text-[color:var(--ui-panel-text)]">{template.name}</span>
                            {/* Optionally show theme info or description */}
                            {/* <p className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/60">{template.defaultThemeId}</p> */}
                        </button>
                    )})}
                </div>
            </div>
            {/* Additional sections for saved templates, etc. */}
        </div>
    );
};
