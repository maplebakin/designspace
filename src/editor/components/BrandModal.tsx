
import React, { useRef } from 'react';
import { useEditorStore } from '../state/editorStore';
import { X, Plus, CheckCircle } from 'lucide-react';
import { VibeCard } from './VibeCard';
import { applyActiveThemeToCanvas } from '../fabric/themeUtils';

interface BrandModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BrandModal: React.FC<BrandModalProps> = ({ isOpen, onClose }) => {
  const { brandVault, activeBrandCollectionId, addThemeToVault, setActiveBrandCollectionId } = useEditorStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result;
        if (typeof text === 'string') {
          addThemeToVault(text);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };
  
  const handleSetActive = (id: string) => {
    setActiveBrandCollectionId(id);
    setTimeout(() => applyActiveThemeToCanvas(), 50);
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[color:var(--ui-panel)] rounded-lg shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-[color:var(--ui-border)] backdrop-blur-[var(--ui-blur)] text-slate-100">
        <header className="flex items-center justify-between p-4 border-b border-[color:var(--border-subtle)]">
          <h2 className="text-[11px] uppercase tracking-widest text-slate-200">Brand Vault</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-all duration-300 ease-in-out">
            <X className="w-5 h-5 stroke-[1.5] text-[color:var(--muted-icon)]" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          <section>
            <h3 className="text-sm uppercase tracking-widest text-slate-300 mb-4">Your Themes</h3>
            <div className="space-y-4">
              {brandVault.map((collection) => (
                <div key={collection.id} className="border border-[color:var(--border-subtle)] rounded-lg p-4 flex items-center justify-between bg-white/5">
                  <div className="w-2/3">
                    <VibeCard collection={collection} isActive={collection.id === activeBrandCollectionId} onClick={() => handleSetActive(collection.id)} />
                  </div>
                  <div className="flex items-center gap-2">
                    {collection.id === activeBrandCollectionId ? (
                        <span className="flex items-center gap-2 text-xs uppercase tracking-widest text-emerald-300">
                            <CheckCircle className="w-5 h-5 stroke-[1.5]" />
                            Active
                        </span>
                    ) : (
                        <button onClick={() => handleSetActive(collection.id)} className="text-xs uppercase tracking-widest px-3 py-1 rounded-md bg-white/10 hover:bg-white/20 transition-all">
                            Set Active
                        </button>
                    )}
                  </div>
                </div>
              ))}
                {brandVault.length === 0 && <p className="text-sm text-slate-500">No themes imported yet.</p>}
            </div>
          </section>

          <section>
             <hr className="my-6 border-[color:var(--border-subtle)]"/>
            <h3 className="text-sm uppercase tracking-widest text-slate-300 mb-4">Import Theme</h3>
            <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
               <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".json"
                className="hidden"
              />
              <button type="button" onClick={handleImportClick} className="group w-full flex items-center justify-center gap-2 px-4 py-2 bg-white/10 text-slate-100 rounded-lg hover:bg-white/20 text-xs uppercase tracking-widest">
                <Plus className="w-5 h-5 stroke-[1.5] text-[color:var(--muted-icon)] group-hover:text-[color:var(--brand-primary)]"/>
                Import Apocapalette JSON
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
};
