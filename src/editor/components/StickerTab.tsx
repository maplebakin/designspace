import React, { useRef, useState } from 'react';
import { Search, Trash2, Upload } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useEditorStore, StickerData } from '../state/editorStore';

const resolveTokenValue = (obj: object | null, path: string): string | null => {
    if (!obj) return null;
    const getValueByPath = (target: object, keyPath: string): any =>
        keyPath.split('.').reduce((acc, part) => acc && (acc as any)[part], target);

    let value = getValueByPath(obj, path);
    if (!value && !path.endsWith('.value')) {
        value = getValueByPath(obj, `${path}.value`);
    }
    if (value && typeof value === 'object' && 'value' in value) {
        value = (value as { value: string }).value;
    }
    if (typeof value === 'number') return `${value}px`;
    return typeof value === 'string' ? value : null;
};

const buildAssetFromFile = (file: File, dataUrl: string): StickerData => {
    const baseName = file.name.split('.').slice(0, -1).join('.') || file.name;
    return {
        id: uuidv4(),
        url: dataUrl,
        label: baseName,
        format: 'png',
        tags: [baseName.toLowerCase(), 'upload'],
    };
};

export const StickerTab: React.FC = () => {
    const { assets, addAssetToLibrary, removeAssetFromLibrary, themeData } = useEditorStore();
    const [searchTerm, setSearchTerm] = useState('');
    const uploadInputRef = useRef<HTMLInputElement>(null);

    const searchValue = searchTerm.trim().toLowerCase();
    const filteredAssets = assets.filter((asset) => {
        if (!searchValue) return true;
        const matchesTags = asset.tags.some((tag) => tag.toLowerCase().includes(searchValue));
        const matchesLabel = asset.label?.toLowerCase().includes(searchValue);
        return Boolean(matchesTags || matchesLabel);
    });

    const glassSurface = resolveTokenValue(themeData, 'glass.glass-surface') || '#323135';
    const glassBlur = resolveTokenValue(themeData, 'glass.glass-blur') || '16px';
    const surfacePlain = resolveTokenValue(themeData, 'surfaces.surface-plain') || 'rgba(255, 255, 255, 0.08)';

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, stickerUrl: string) => {
        e.dataTransfer.setData('text/plain', stickerUrl);
        e.dataTransfer.setData('isSticker', 'true');
    };

    const handleUploadSticker = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || file.type !== 'image/png') return;

        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result as string;
            addAssetToLibrary(buildAssetFromFile(file, dataUrl));
        };
        reader.readAsDataURL(file);

        if (uploadInputRef.current) uploadInputRef.current.value = '';
    };

    return (
        <div
            className="p-4 flex flex-col h-full"
            style={{ backgroundColor: glassSurface, backdropFilter: `blur(${glassBlur})` }}
        >
            <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 stroke-[1.5] text-slate-400" />
                <input
                    type="text"
                    placeholder="Search assets..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 text-sm bg-white/10 border border-white/10 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-primary)]"
                />
            </div>

            <div className="flex-1 overflow-y-auto">
                {filteredAssets.length === 0 ? (
                    <div className="rounded-2xl border border-[color:var(--ui-border)] p-6 text-center text-sm text-slate-200 shadow-[0_16px_30px_rgba(0,0,0,0.25)]" style={{ backgroundColor: glassSurface, backdropFilter: `blur(${glassBlur})` }}>
                        No items in your library yet. Upload transparent PNGs to begin your collection.
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-3">
                        {filteredAssets.map((asset) => (
                            <div key={asset.id} className="relative group">
                                <div
                                    draggable
                                    onDragStart={(event) => handleDragStart(event, asset.url)}
                                    className="flex h-24 items-center justify-center rounded-xl border border-white/10 p-2 transition-all duration-300 ease-in-out hover:border-[color:var(--brand-primary)]"
                                    style={{ backgroundColor: surfacePlain }}
                                >
                                    <img
                                        src={asset.url}
                                        alt={asset.label ?? 'Asset'}
                                        className="max-h-full max-w-full object-contain"
                                    />
                                </div>
                                <button
                                    onClick={() => removeAssetFromLibrary(asset.id)}
                                    className="absolute top-1 right-1 p-1 bg-red-500/80 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all duration-300 ease-in-out"
                                    aria-label="Delete asset"
                                >
                                    <Trash2 className="w-3 h-3 stroke-[1.5]" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="mt-6 border-t border-white/10 pt-4">
                <input
                    type="file"
                    accept="image/png"
                    ref={uploadInputRef}
                    onChange={handleUploadSticker}
                    className="hidden"
                />
                <button
                    onClick={() => uploadInputRef.current?.click()}
                    className="group w-full flex items-center justify-center gap-2 px-4 py-2 bg-white/5 text-slate-200 rounded-lg hover:bg-white/10 transition-all duration-300 ease-in-out text-xs uppercase tracking-widest"
                >
                    <Upload className="w-5 h-5 stroke-[1.5] text-[color:var(--muted-icon)] group-hover:text-[color:var(--brand-primary)] transition-all duration-300 ease-in-out" />
                    Add Asset
                </button>
            </div>
        </div>
    );
};
