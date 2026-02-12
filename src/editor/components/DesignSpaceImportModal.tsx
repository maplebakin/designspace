import React, { useRef, useState, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import { v4 as uuidv4 } from 'uuid';
import {
  X,
  Upload,
  Loader2,
  AlertCircle,
  Plus,
  CheckCircle,
  Palette,
  Type,
  Square,
  Sparkles,
  AlertTriangle,
  Layers,
} from 'lucide-react';
import { useThemeStore, type ColorPalette } from '../state/useThemeStore';
import { importThemeFromFile, type ColorCategory } from '../services/designSpaceImporter';

interface DesignSpaceImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CATEGORY_CONFIG: Record<ColorCategory, { label: string; icon: React.ReactNode }> = {
  brand: { label: 'Brand', icon: <Palette className="w-3.5 h-3.5" /> },
  headers: { label: 'Headers', icon: <Type className="w-3.5 h-3.5" /> },
  surfaces: { label: 'Surfaces', icon: <Square className="w-3.5 h-3.5" /> },
  neutrals: { label: 'Neutrals', icon: <Layers className="w-3.5 h-3.5" /> },
  accents: { label: 'Accents', icon: <Sparkles className="w-3.5 h-3.5" /> },
  semantic: { label: 'Semantic', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
};

interface PaletteImport {
  palette: ColorPalette;
  categories: Partial<Record<ColorCategory, string[]>>;
}

const CategorySwatches: React.FC<{
  category: ColorCategory;
  colors: string[];
}> = ({ category, colors }) => {
  const config = CATEGORY_CONFIG[category];
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5 text-slate-400 min-w-[90px]">
        {config.icon}
        <span className="text-[10px] uppercase tracking-wider">{config.label}</span>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {colors.map((color, i) => (
          <div
            key={`${color}-${i}`}
            className="w-6 h-6 rounded border border-white/20 shadow-sm"
            style={{ backgroundColor: color }}
            title={color}
          />
        ))}
      </div>
    </div>
  );
};

const ImportedPaletteCard: React.FC<{
  result: PaletteImport;
  onAdd: () => void;
  isAdded: boolean;
}> = ({ result, onAdd, isAdded }) => {
  const orderedCategories: ColorCategory[] = [
    'brand',
    'headers',
    'surfaces',
    'neutrals',
    'accents',
    'semantic',
  ];

  return (
    <div className="rounded-lg border border-[color:var(--ui-border)] bg-black/20 overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b border-[color:var(--ui-border)]">
        <span className="text-sm font-medium text-slate-200">
          {result.palette.name}
        </span>
        <button
          onClick={onAdd}
          disabled={isAdded}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-all ${
            isAdded
              ? 'bg-green-500/20 text-green-300 cursor-default'
              : 'bg-[color:var(--ui-accent)] hover:brightness-110 text-white'
          }`}
        >
          {isAdded ? (
            <>
              <CheckCircle className="w-3.5 h-3.5" />
              Added
            </>
          ) : (
            <>
              <Plus className="w-3.5 h-3.5" />
              Add Palette
            </>
          )}
        </button>
      </div>
      <div className="p-3 space-y-2">
        {orderedCategories.map((cat) => {
          const colors = result.categories[cat];
          if (!colors || colors.length === 0) return null;
          return (
            <CategorySwatches
              key={cat}
              category={cat}
              colors={colors}
            />
          );
        })}
      </div>
    </div>
  );
};

export const DesignSpaceImportModal: React.FC<DesignSpaceImportModalProps> = ({
  isOpen,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingImports, setPendingImports] = useState<PaletteImport[]>([]);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  const { addPaletteToVault, addPalettesToVault } = useThemeStore(
    (state) => ({
      addPaletteToVault: state.addPaletteToVault,
      addPalettesToVault: state.addPalettesToVault,
    }),
    shallow
  );

  const resetState = useCallback(() => {
    setError(null);
    setPendingImports([]);
    setAddedIds(new Set());
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;

      setIsLoading(true);
      setError(null);

      const newImports: PaletteImport[] = [];
      const errors: string[] = [];

      for (const file of files) {
        try {
          if (!file.name.endsWith('.json')) {
            continue;
          }

          const text = await file.text();
          // Pass filename to extract palette name if not present in JSON
          const result = importThemeFromFile(text, file.name);

          if (result.success && result.collection && result.categories) {
            const colors = Array.from(
              new Set(
                Object.values(result.categories).flatMap((list) => list || [])
              )
            );
            newImports.push({
              palette: {
                id: uuidv4(),
                name: result.collection.name,
                categories: result.categories,
                colors,
              },
              categories: result.categories,
            });
          } else if (result.error) {
            errors.push(`${file.name}: ${result.error}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          errors.push(`${file.name}: ${msg}`);
          console.error('Failed to parse file:', file.name, err);
        }
      }

      if (newImports.length === 0) {
        const errorMsg = errors.length > 0
          ? `Import errors:\n${errors.join('\n')}`
          : 'No valid palette files found. Ensure files contain hex color values.';
        setError(errorMsg);
      } else {
        setPendingImports((prev) => [...prev, ...newImports]);
        if (errors.length > 0) {
          console.warn('Some files had errors:', errors);
        }
      }

      setIsLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    []
  );

  const handleAddToVault = useCallback(
    (result: PaletteImport) => {
      addPaletteToVault(result.palette);
      setAddedIds((prev) => new Set(prev).add(result.palette.id));
    },
    [addPaletteToVault]
  );

  const handleAddAllToVault = useCallback(() => {
    const toAdd = pendingImports.filter(
      (r) => !addedIds.has(r.palette.id)
    );
    if (toAdd.length === 0) return;

    const newPalettes = toAdd.map((r) => r.palette);
    addPalettesToVault(newPalettes);

    setAddedIds((prev) => {
      const next = new Set(prev);
      newPalettes.forEach((palette) => next.add(palette.id));
      return next;
    });
  }, [
    pendingImports,
    addedIds,
    addPalettesToVault,
  ]);

  if (!isOpen) return null;

  const pendingCount = pendingImports.filter(
    (r) => !addedIds.has(r.palette.id)
  ).length;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[color:var(--ui-panel)] rounded-lg shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col border border-[color:var(--ui-border)] backdrop-blur-[var(--ui-blur)] text-slate-100">
        {/* Header */}
        <header className="flex items-center justify-between p-4 border-b border-[color:var(--ui-border)]">
          <h2 className="text-[11px] uppercase tracking-widest text-slate-100">
            Import Palettes
          </h2>
          <button
            onClick={handleClose}
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5 stroke-[1.5]" />
          </button>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* File Input */}
          <div className="space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              multiple
              onChange={handleFileChange}
              className="hidden"
              disabled={isLoading}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 py-4 px-4 rounded-lg border border-dashed border-[color:var(--ui-border)] hover:border-[color:var(--ui-accent)] hover:bg-white/5 transition-colors disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Upload className="w-5 h-5" />
              )}
              <span className="text-sm">
                {isLoading ? 'Processing...' : 'Select Palette JSON Files'}
              </span>
            </button>
            <p className="text-[10px] text-slate-500 text-center">
              Colors are auto-organized into Brand, Headers, Surfaces, Neutrals, Accents
            </p>
          </div>

          {/* Error Display */}
          {error && (
            <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-200 flex-1">{error}</p>
              <button
                onClick={() => setError(null)}
                className="p-1 hover:bg-white/10 rounded"
              >
                <X className="w-3 h-3 text-red-300" />
              </button>
            </div>
          )}

          {/* Pending Imports */}
          {pendingImports.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-slate-400">
                  {pendingImports.length} Palette{pendingImports.length > 1 ? 's' : ''} Ready
                </span>
                {pendingCount > 1 && (
                  <button
                    onClick={handleAddAllToVault}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs bg-[color:var(--ui-accent)] hover:brightness-110 text-white transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add All ({pendingCount})
                  </button>
                )}
              </div>
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                {pendingImports.map((result) => (
                  <ImportedPaletteCard
                    key={result.palette.id}
                    result={result}
                    onAdd={() => handleAddToVault(result)}
                    isAdded={addedIds.has(result.palette.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {pendingImports.length === 0 && !error && (
            <div className="text-center py-8 text-slate-500">
              <Palette className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Import palette JSON files to get started</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DesignSpaceImportModal;
