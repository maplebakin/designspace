
import React from 'react';
import { useEditorStore } from '../state/editorStore';
import { VibeCard } from './VibeCard';
import { refreshCanvasThemes } from '../fabric/themeUtils';

export const ThemeSidebar: React.FC = () => {
    const { brandVault, activeBrandCollectionId, applyTheme, resetTheme } = useEditorStore();

    const handleThemeSelect = (collectionId: string) => {
        const selected = brandVault.find(c => c.id === collectionId);
        if (selected) {
            applyTheme(selected.themeData);
        }
    }

    return (
        <div className="p-4 space-y-6">
            <div>
                <h3 className="text-sm uppercase tracking-widest text-slate-300 mb-3">Theme Hub</h3>
                <div className="space-y-2">
                    {brandVault.map(collection => (
                        <VibeCard 
                            key={collection.id}
                            collection={collection}
                            isActive={collection.id === activeBrandCollectionId}
                            onClick={() => handleThemeSelect(collection.id)}
                        />
                    ))}
                </div>
                {brandVault.length === 0 && (
                    <p className="text-xs text-slate-500 p-2">No themes loaded. Import one from the Brand Vault modal.</p>
                )}
            </div>

            {brandVault.length > 0 && (
                 <hr className="border-white/10"/>
            )}

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
