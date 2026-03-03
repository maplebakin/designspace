
import React, { useRef, useState } from 'react';
import { shallow } from 'zustand/shallow';
import { useEditorStore } from '../state/editorStore';
import { useThemeStore } from '../state/useThemeStore';
import { X, Plus, CheckCircle, Loader2, AlertCircle, FileJson } from 'lucide-react';
import { VibeCard } from './VibeCard';
import { validateThemeFile } from '../services/themeValidationService';

interface BrandModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BrandModal: React.FC<BrandModalProps> = ({ isOpen, onClose }) => {
  const { addThemeToVault, setActiveBrandCollectionId } = useEditorStore(
    (state) => ({
      addThemeToVault: state.addThemeToVault,
      setActiveBrandCollectionId: state.setActiveBrandCollectionId,
    }),
    shallow
  );
  const { brandVault, activeBrandCollectionId } = useThemeStore(
    (state) => ({
      brandVault: state.brandVault,
      activeBrandCollectionId: state.activeBrandCollectionId,
    }),
    shallow
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError(null);

    try {
      // Validate theme file using service
      const result = await validateThemeFile(file, {
        maxSizeBytes: 5 * 1024 * 1024, // 5MB
        requiredFields: ['name'],
        allowedExtensions: ['.json']
      });

      if (!result.success) {
        setError(result.error!.message);
        return;
      }

      // Add validated theme to vault
      addThemeToVault(result.data!.rawJson);

      // Reset file input on success
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to import theme.';
      setError(errorMessage);
      console.error('Theme import error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportClick = () => {
    if (!isLoading) {
      setError(null);
      fileInputRef.current?.click();
    }
  };

  const handleSetActive = (id: string) => {
    setActiveBrandCollectionId(id);
  }

  const handleDismissError = () => {
    setError(null);
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[color:var(--ui-panel)] rounded-lg shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-[color:var(--ui-border)] backdrop-blur-[var(--ui-blur)] text-[color:var(--ui-text)]">
        <header className="flex items-center justify-between p-4 border-b border-[color:var(--border-subtle)]">
          <h2 className="text-[11px] uppercase tracking-widest text-[color:var(--ui-text)]">Brand Vault</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-all duration-300 ease-in-out">
            <X className="w-5 h-5 stroke-[1.5] text-[color:var(--muted-icon)]" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Error Message */}
          {error && (
            <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 stroke-[1.5] text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-xs uppercase tracking-widest text-red-300 mb-1">Import Failed</h4>
                <p className="text-sm text-red-200">{error}</p>
              </div>
              <button
                onClick={handleDismissError}
                className="p-1 rounded-full hover:bg-red-500/20 transition-all"
                aria-label="Dismiss error"
              >
                <X className="w-4 h-4 stroke-[1.5] text-red-300" />
              </button>
            </div>
          )}

          <section>
            <h3 className="text-sm uppercase tracking-widest text-[color:var(--ui-text)] mb-4">Your Themes</h3>
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
              {brandVault.length === 0 && (
                <div className="rounded-2xl border border-[color:var(--border-subtle)] p-8 text-center bg-white/5">
                  <FileJson className="w-12 h-12 stroke-[1.5] text-[color:var(--muted-icon)] mx-auto mb-4 opacity-50" />
                  <p className="text-sm text-[color:var(--ui-panel-text)] mb-2">No themes imported yet</p>
                  <p className="text-xs text-[color:var(--ui-panel-text)]">Import a theme JSON file to get started</p>
                </div>
              )}
            </div>
          </section>

          <section>
             <hr className="my-6 border-[color:var(--border-subtle)]"/>
            <h3 className="text-sm uppercase tracking-widest text-[color:var(--ui-text)] mb-4">Import Theme</h3>
            <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
               <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".json"
                className="hidden"
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={handleImportClick}
                disabled={isLoading}
                className="group w-full flex items-center justify-center gap-2 px-4 py-2 bg-white/10 text-[color:var(--ui-text)] rounded-lg hover:bg-white/20 text-xs uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white/10 transition-all"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 stroke-[1.5] animate-spin text-[color:var(--brand-primary)]"/>
                    Importing...
                  </>
                ) : (
                  <>
                    <Plus className="w-5 h-5 stroke-[1.5] text-[color:var(--muted-icon)] group-hover:text-[color:var(--brand-primary)]"/>
                    Import Theme JSON
                  </>
                )}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
};
