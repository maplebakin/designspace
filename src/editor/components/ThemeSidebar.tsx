
import React, { useRef, useState } from 'react';
import { shallow } from 'zustand/shallow';

import { useEditorStore } from '../state/editorStore';
import { useThemeStore } from '../state/useThemeStore';

import { Link, Wand2, Palette as PaletteIcon } from 'lucide-react';

import { getDominantColor } from '../utils/color';

import { findBestThemeMatch } from '../fabric/themeUtils';
import type { ColorCategory } from '../services/designSpaceImporter';

import { ingestApocapalette } from '../../utils/paletteIngest';


const HEX_COLOR_RE = /^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6})$/;

export const ThemeSidebar: React.FC = () => {

    const {
        applyTheme,
        resetTheme,
        selectedLayerIds,
        selectedObjectId,
        layersById,
        canvas,
        setObjectThemedFill,
        setObjectFill,
        resetObjectToDefaultTheme
    } = useEditorStore(
        (state) => ({
            applyTheme: state.applyTheme,
            resetTheme: state.resetTheme,
            selectedLayerIds: state.selectedLayerIds,
            selectedObjectId: state.selectedObjectId,
            layersById: state.layersById,
            canvas: state.canvas,
            setObjectThemedFill: state.setObjectThemedFill,
            setObjectFill: state.setObjectFill,
            resetObjectToDefaultTheme: state.resetObjectToDefaultTheme,
        }),
        shallow
    );
    const {
        themeData,
        paletteVault,
        activePaletteId,
        setActivePaletteId,
        setBrushColor,
        addRecentColor,
        importedPalette,
        setImportedPalette,
    } = useThemeStore(
        (state) => ({
            themeData: state.themeData,
            paletteVault: state.paletteVault,
            activePaletteId: state.activePaletteId,
            setActivePaletteId: state.setActivePaletteId,
            setBrushColor: state.setBrushColor,
            addRecentColor: state.addRecentColor,
            importedPalette: state.importedPalette,
            setImportedPalette: state.setImportedPalette,
        }),
        shallow
    );

    const [importError, setImportError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const selectedObject =
        (selectedObjectId && layersById[selectedObjectId])
            ? layersById[selectedObjectId]
            : (canvas?.getActiveObject() ?? null);

    const hasObjectSelection = Boolean(selectedLayerIds.length > 0 || selectedObjectId || selectedObject);

    const activePalette =
        paletteVault.find((palette) => palette.id === activePaletteId)
        || paletteVault[0]
        || null;

    const orderedCategories: ColorCategory[] = [
        'brand',
        'headers',
        'surfaces',
        'neutrals',
        'accents',
        'semantic',
    ];

    const categoryLabels: Record<ColorCategory, string> = {
        brand: 'Brand',
        headers: 'Headers',
        surfaces: 'Surfaces',
        neutrals: 'Neutrals',
        accents: 'Accents',
        semantic: 'Semantic',
    };

    const handlePaletteColorSelect = (color: string) => {
        if (selectedLayerIds.length > 0 || selectedObjectId) {
            setObjectFill(color);
        } else {
            setBrushColor(color);
        }
        addRecentColor(color);
    };

    const handleImportedSwatchClick = async (color: string) => {
        if (hasObjectSelection) {
            handlePaletteColorSelect(color);
            return;
        }

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(color);
            }
        } catch {
            // no-op fallback for restricted clipboard contexts
        }
        addRecentColor(color);
    };

    const handleImportPaletteClick = () => {
        fileInputRef.current?.click();
    };

    const handlePaletteFileChange: React.ChangeEventHandler<HTMLInputElement> = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        try {
            setImportError(null);
            const rawText = await file.text();
            const json = JSON.parse(rawText);
            const ingested = ingestApocapalette(json);
            setImportedPalette(ingested);
        } catch (err) {
            console.error('Failed to import Apocapalette JSON', err);
            setImportedPalette(null);
            setImportError('Could not import palette JSON.');
        }
    };

    const handleMagicMatch = async () => {

        if (selectedObject && selectedObject.type === 'image') {

            const dominantColor = getDominantColor(selectedObject as any as fabric.Image);

            const bestMatch = findBestThemeMatch(dominantColor);

            if (bestMatch) {

                applyTheme(bestMatch.themeData);

            }

        }

    };



    const coreTokens = themeData ? [

        { name: 'Primary', role: 'brand.primary.value', value: themeData.brand?.primary?.value },

        { name: 'Accent', role: 'brand.accent.value', value: themeData.brand?.accent?.value },

        { name: 'Heading', role: 'typography.heading.value', value: themeData.typography?.heading?.value },

        { name: 'Body', role: 'typography.body.value', value: themeData.typography?.body?.value },

    ].filter(t => t.value) : [];

    const importedCategoryOrder = [
        'backgrounds',
        'brand',
        'interactive',
        'status',
        'neutrals',
        'text',
    ] as const;

    const importedCategoryLabels: Record<(typeof importedCategoryOrder)[number], string> = {
        backgrounds: 'Backgrounds',
        brand: 'Brand',
        interactive: 'Interactive',
        status: 'Status',
        neutrals: 'Neutrals',
        text: 'Text',
    };



    return (

        <div className="p-4 space-y-6">

            {selectedLayerIds.length > 0 && themeData && (

                 <div>

                    <h3 className="text-sm uppercase tracking-widest text-[color:var(--ui-panel-text)] mb-3 flex items-center gap-2">

                        <Link className="w-4 h-4" />

                        Re-link Object

                    </h3>

                    <div className="grid grid-cols-2 gap-2">

                       {coreTokens.map(token => (

                           <button

                             key={token.role}

                             onClick={() => setObjectThemedFill(token.role)}

                             className="flex items-center gap-2 p-2 text-xs rounded-lg bg-white/5 hover:bg-white/10"

                           >

                               <div className="w-5 h-5 rounded" style={{ backgroundColor: token.value }} />

                               <span>{token.name}</span>

                           </button>

                       ))}

                    </div>

                    {selectedObject?.type === 'image' && (

                        <button

                            onClick={handleMagicMatch}

                            className="w-full mt-3 px-4 py-2 text-xs uppercase tracking-widest border border-white/10 rounded-full hover:bg-white/5 transition-all flex items-center justify-center gap-2"

                        >

                            <Wand2 className="w-4 h-4" />

                            <span>Magic Match Theme</span>

                        </button>

                    )}

                    <button

                        onClick={() => resetObjectToDefaultTheme()}

                        className="w-full mt-3 px-4 py-2 text-[10px] uppercase tracking-widest border border-white/10 rounded-full hover:bg-white/5 transition-all"


                    >
                        Reset to Default
                    </button>
                    <hr className="border-white/10 my-6"/>
                </div>
            )}

            <div>
                <h3 className="text-sm uppercase tracking-widest text-[color:var(--ui-panel-text)] mb-3 flex items-center gap-2">
                    <PaletteIcon className="w-4 h-4" />
                    Color Palettes
                </h3>

                <div className="mb-4 space-y-2">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json,application/json"
                        className="hidden"
                        onChange={handlePaletteFileChange}
                    />
                    <button
                        onClick={handleImportPaletteClick}
                        className="w-full px-3 py-2 text-[11px] uppercase tracking-widest border border-white/10 rounded-full hover:bg-white/5 transition-all"
                    >
                        Import Apocapalette
                    </button>
                    {importError && (
                        <p className="text-[11px] text-rose-300">{importError}</p>
                    )}

                    {importedPalette && (
                        <div className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-3">
                            <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="text-xs uppercase tracking-widest text-[color:var(--ui-text)] truncate">
                                        {importedPalette.name || 'Imported Palette'}
                                    </p>
                                    <p className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">
                                        {importedPalette.mode || 'unknown mode'}
                                    </p>
                                </div>
                                <button
                                    onClick={() => setImportedPalette(null)}
                                    className="px-2 py-1 text-[10px] uppercase tracking-widest border border-white/10 rounded-full hover:bg-white/10"
                                >
                                    Clear
                                </button>
                            </div>

                            <div className="space-y-2">
                                {importedCategoryOrder.map((categoryKey) => {
                                    const category = importedPalette.categories?.[categoryKey];
                                    if (!category) return null;

                                    const entries = Object.entries(category).filter(([, value]) => HEX_COLOR_RE.test(String(value)));
                                    if (entries.length === 0) return null;

                                    return (
                                        <div key={categoryKey} className="space-y-1">
                                            <div className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">
                                                {importedCategoryLabels[categoryKey]}
                                            </div>
                                            <div className="grid grid-cols-1 gap-1.5">
                                                {entries.map(([tokenName, value]) => (
                                                    <button
                                                        key={`${categoryKey}-${tokenName}`}
                                                        onClick={() => handleImportedSwatchClick(value)}
                                                        className="w-full flex items-center gap-2 p-1.5 rounded border border-white/10 hover:bg-white/10 text-left"
                                                        title={hasObjectSelection ? `Apply ${value}` : `Copy ${value}`}
                                                    >
                                                        <span
                                                            className="w-4 h-4 rounded-sm border border-white/20"
                                                            style={{ backgroundColor: value }}
                                                        />
                                                        <span className="text-[11px] text-[color:var(--ui-text)]">{tokenName}</span>
                                                        <span className="ml-auto text-[10px] font-mono text-[color:var(--ui-panel-text)]">{value}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {paletteVault.length > 0 ? (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            {paletteVault.map((palette) => {
                                const preview = palette.colors.slice(0, 6);
                                const isActive = palette.id === activePalette?.id;
                                return (
                                    <button
                                        key={palette.id}
                                        onClick={() => setActivePaletteId(palette.id)}
                                        className={`w-full text-left p-2 rounded-lg border transition-all ${
                                            isActive
                                                ? 'border-[color:var(--brand-primary)]/50 bg-white/10'
                                                : 'border-white/10 bg-white/5 hover:bg-white/10'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-xs uppercase tracking-widest text-[color:var(--ui-text)] truncate">
                                                {palette.name}
                                            </span>
                                            <div className="flex items-center gap-1">
                                                {preview.map((color, index) => (
                                                    <span
                                                        key={`${palette.id}-preview-${index}`}
                                                        className="w-3 h-3 rounded border border-white/20"
                                                        style={{ backgroundColor: color }}
                                                        title={color}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                        {activePalette && (
                            <div className="space-y-2">
                                <p className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/60">
                                    Click a color to apply
                                </p>
                                {orderedCategories.map((category) => {
                                    const colors = activePalette.categories[category] || [];
                                    if (colors.length === 0) return null;
                                    return (
                                        <div key={category} className="space-y-1">
                                            <div className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">
                                                {categoryLabels[category]}
                                            </div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {colors.map((color, index) => (
                                                    <button
                                                        key={`${category}-${color}-${index}`}
                                                        onClick={() => handlePaletteColorSelect(color)}
                                                        className="w-6 h-6 rounded border border-white/20 shadow-sm hover:scale-105 transition-transform"
                                                        style={{ backgroundColor: color }}
                                                        title={`Apply ${color}`}
                                                        aria-label={`Apply ${color}`}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ) : (
                    <p className="text-xs text-[color:var(--ui-panel-text)]/60 p-2">
                        No palettes loaded. Import one from the DesignSpace importer.
                    </p>
                )}
            </div>

            <div>
                 <button
                    onClick={resetTheme}
                    className="w-full px-4 py-2 text-[11px] uppercase tracking-widest border border-white/10 rounded-full hover:bg-white/5 transition-all duration-300 ease-in-out"
                >
                    Reset All Theme Links
                </button>
            </div>
        </div>
    );
};
