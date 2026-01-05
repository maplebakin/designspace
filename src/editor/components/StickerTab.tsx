
import React, { useState, useRef } from 'react';
import { useEditorStore, StickerData } from '../state/editorStore';
import { Search, Upload, Trash2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

const STICKER_CATEGORIES: { name: string; stickers: StickerData[] }[] = [
    {
        name: 'Celestial',
        stickers: [
            { id: 'cel-1', imageUrl: 'https://via.placeholder.com/150/FFD700/000000?text=Sun', tags: ['sun', 'star', 'celestial'], category: 'Celestial', name: 'Sun' },
            { id: 'cel-2', imageUrl: 'https://via.placeholder.com/150/A020F0/FFFFFF?text=Moon', tags: ['moon', 'night', 'celestial'], category: 'Celestial', name: 'Moon' },
            { id: 'cel-3', imageUrl: 'https://via.placeholder.com/150/ADD8E6/000000?text=Cloud', tags: ['cloud', 'weather', 'celestial'], category: 'Celestial', name: 'Cloud' },
        ]
    },
    {
        name: 'Boho',
        stickers: [
            { id: 'boho-1', imageUrl: 'https://via.placeholder.com/150/D2B48C/000000?text=Feather', tags: ['feather', 'boho', 'hippie'], category: 'Boho', name: 'Feather' },
            { id: 'boho-2', imageUrl: 'https://via.placeholder.com/150/8B4513/FFFFFF?text=Dreamcatcher', tags: ['dreamcatcher', 'boho', 'native'], category: 'Boho', name: 'Dreamcatcher' },
        ]
    },
    {
        name: 'Frames',
        stickers: [
            { id: 'frame-1', imageUrl: 'https://via.placeholder.com/150/F0F8FF/000000?text=Polaroid', tags: ['polaroid', 'frame', 'vintage'], category: 'Frames', name: 'Polaroid' },
            { id: 'frame-2', imageUrl: 'https://via.placeholder.com/150/FFFAF0/000000?text=Floral', tags: ['floral', 'frame', 'nature'], category: 'Frames', name: 'Floral' },
        ]
    }
];

export const StickerTab: React.FC = () => {
    const { customStickers, addCustomSticker, removeCustomSticker } = useEditorStore();
    const [searchTerm, setSearchTerm] = useState('');
    const uploadInputRef = useRef<HTMLInputElement>(null);

    // Combine predefined and custom stickers
    const allStickers = [...STICKER_CATEGORIES.flatMap(cat => cat.stickers), ...customStickers];

    const filteredStickers = allStickers.filter(sticker =>
        sticker.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase())) ||
        sticker.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
        sticker.name?.toLowerCase().includes(searchTerm.toLowerCase()) // assuming custom stickers might have names
    );

    const categorizedStickers: { [key: string]: StickerData[] } = {};
    STICKER_CATEGORIES.forEach(cat => categorizedStickers[cat.name] = []);
    categorizedStickers['My Stickers'] = []; // Ensure 'My Stickers' category exists

    filteredStickers.forEach(sticker => {
        const categoryName = sticker.category || 'Other'; // Default category if not specified
        if (!categorizedStickers[categoryName]) {
            categorizedStickers[categoryName] = [];
        }
        categorizedStickers[categoryName].push(sticker);
    });

    const handleDragStart = (e: React.DragEvent<HTMLImageElement>, stickerUrl: string) => {
        e.dataTransfer.setData('text/plain', stickerUrl);
        e.dataTransfer.setData('isSticker', 'true'); // Flag to identify as sticker
    };

    const handleUploadSticker = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async (f) => {
                const imageUrl = f.target?.result as string;
                const newSticker: StickerData = {
                    id: uuidv4(),
                    imageUrl: imageUrl,
                    name: file.name.split('.')[0],
                    tags: [file.name.split('.')[0].toLowerCase(), 'custom', 'upload'],
                    category: 'My Stickers',
                };
                await addCustomSticker(newSticker);
            };
            reader.readAsDataURL(file);
        }
        if (uploadInputRef.current) uploadInputRef.current.value = '';
    };

    return (
        <div className="p-4 flex flex-col h-full">
            <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 stroke-[1.5] text-slate-400" />
                <input
                    type="text"
                    placeholder="Search stickers..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 text-sm bg-white/10 border border-white/10 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-primary)]"
                />
            </div>

            <div className="flex-1 overflow-y-auto space-y-6">
                {Object.entries(categorizedStickers).map(([categoryName, stickers]) => (
                    stickers.length > 0 && (
                        <div key={categoryName}>
                            <h4 className="text-[11px] uppercase tracking-widest text-slate-400 mb-3 border-b border-white/10 pb-1">{categoryName}</h4>
                            <div className="grid grid-cols-2 gap-3">
                                {stickers.map((sticker) => (
                                    <div key={sticker.id} className="relative group">
                                        <img
                                            src={sticker.imageUrl}
                                            alt={sticker.name || 'Sticker'}
                                            draggable="true"
                                            onDragStart={(e) => handleDragStart(e, sticker.imageUrl)}
                                            className="w-full h-full object-contain rounded-lg border border-white/10 cursor-grab bg-white/5 p-1 transition-all duration-300 ease-in-out group-hover:border-[color:var(--brand-primary)]"
                                        />
                                        {categoryName === 'My Stickers' && (
                                            <button 
                                                onClick={() => removeCustomSticker(sticker.id)}
                                                className="absolute top-1 right-1 p-1 bg-red-500/80 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all duration-300 ease-in-out"
                                                aria-label="Delete sticker"
                                            >
                                                <Trash2 className="w-3 h-3 stroke-[1.5]"/>
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )
                ))}
            </div>

            <div className="mt-6 border-t pt-4">
                <input
                    type="file"
                    accept="image/png, image/jpeg"
                    ref={uploadInputRef}
                    onChange={handleUploadSticker}
                    className="hidden"
                />
                <button
                    onClick={() => uploadInputRef.current?.click()}
                    className="group w-full flex items-center justify-center gap-2 px-4 py-2 bg-white/5 text-slate-200 rounded-lg hover:bg-white/10 transition-all duration-300 ease-in-out text-xs uppercase tracking-widest"
                >
                    <Upload className="w-5 h-5 stroke-[1.5] text-[color:var(--muted-icon)] group-hover:text-[color:var(--brand-primary)] transition-all duration-300 ease-in-out" />
                    Upload New Sticker
                </button>
            </div>
        </div>
    );
};
