
import React from 'react';
import { shallow } from 'zustand/shallow';

import { useEditorStore } from '../state/editorStore';

import { VibeCard } from './VibeCard';

import { Link, Wand2 } from 'lucide-react';

import { getDominantColor } from '../utils/color';

import { findBestThemeMatch } from '../fabric/themeUtils';



export const ThemeSidebar: React.FC = () => {

    const {

        brandVault,

        activeBrandCollectionId,

        applyTheme,

        resetTheme,

        selectedLayerIds,

        selectedObject,

        themeData,

        setObjectThemedFill,

        resetObjectToDefaultTheme

    } = useEditorStore(
        (state) => ({
            brandVault: state.brandVault,
            activeBrandCollectionId: state.activeBrandCollectionId,
            applyTheme: state.applyTheme,
            resetTheme: state.resetTheme,
            selectedLayerIds: state.selectedLayerIds,
            selectedObject: state.selectedObject,
            themeData: state.themeData,
            setObjectThemedFill: state.setObjectThemedFill,
            resetObjectToDefaultTheme: state.resetObjectToDefaultTheme,
        }),
        shallow
    );



    const handleThemeSelect = (collectionId: string) => {

        const selected = brandVault.find(c => c.id === collectionId);

        if (selected) {

            applyTheme(selected.themeData);

        }

    }



    const handleMagicMatch = async () => {

        if (selectedObject && selectedObject.type === 'image') {

            const dominantColor = getDominantColor(selectedObject as any as fabric.Image);

            const bestMatch = findBestThemeMatch(dominantColor);

            if (bestMatch) {

                applyTheme(bestMatch.themeData);

            }

        }

    }



    const coreTokens = themeData ? [

        { name: 'Primary', role: 'brand.primary.value', value: themeData.brand?.primary?.value },

        { name: 'Accent', role: 'brand.accent.value', value: themeData.brand?.accent?.value },

        { name: 'Heading', role: 'typography.heading.value', value: themeData.typography?.heading?.value },

        { name: 'Body', role: 'typography.body.value', value: themeData.typography?.body?.value },

    ].filter(t => t.value) : [];



    return (

        <div className="p-4 space-y-6">

            {selectedLayerIds.length > 0 && themeData && (

                 <div>

                    <h3 className="text-sm uppercase tracking-widest text-slate-300 mb-3 flex items-center gap-2">

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
