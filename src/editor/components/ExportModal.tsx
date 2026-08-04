import React, { useEffect, useState } from 'react';
import { shallow } from 'zustand/shallow';
import { DEFAULT_CANVAS_BACKGROUND, useEditorStore } from '../state/editorStore';
import { useThemeStore } from '../state/useThemeStore';
import { advancedExportManager, type AdvancedExportFormat } from '../export/advancedExportManager';
import { INTERNAL_PRODUCT_FORGE_ENABLED } from '../config/internalCapabilities';
import { deliverFile, type FileBatchDeliveryResult, type FileDeliveryResult } from '../services/fileDeliveryService';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose }) => {
  const { canvas, imageAssets, pages, productProjectFields, projectName, syncActivePageFromCanvas, unitMode } = useEditorStore(
    (state) => ({
      canvas: state.canvas,
      imageAssets: state.imageAssets,
      pages: state.pages,
      productProjectFields: state.productProjectFields,
      projectName: state.projectName,
      syncActivePageFromCanvas: state.syncActivePageFromCanvas,
      unitMode: state.unitMode,
    }),
    shallow
  );
  const { canvasBackgroundColor } = useThemeStore(
    (state) => ({ canvasBackgroundColor: state.canvasBackgroundColor }),
    shallow
  );

  const [includeBackground, setIncludeBackground] = useState(true);
  const [isExportLoading, setIsExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isProductZipLoading, setIsProductZipLoading] = useState(false);
  const [productZipError, setProductZipError] = useState<string | null>(null);
  const fileName = projectName;
  const sourceDpi = productProjectFields?.document?.pageSize?.dpi
    || (unitMode === 'px' ? 96 : 300);
  const canPackageProductZip = INTERNAL_PRODUCT_FORGE_ENABLED
    && !!canvas
    && pages.length > 0
    && !isProductZipLoading;
  const productTitle = productProjectFields?.productMetadata?.title || projectName || 'Untitled Product';
  const recipe = productProjectFields?.recipe;
  const readinessSummary = pages.length > 0
    ? `${pages.length} page${pages.length === 1 ? '' : 's'} ready for PDF, previews, metadata, and ZIP packaging.`
    : 'No pages are available to package yet.';
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const runExport = async (
    job: () => Promise<FileDeliveryResult | FileBatchDeliveryResult | void>
  ) => {
    if (isExportLoading) return;
    setExportError(null);
    setIsExportLoading(true);
    try {
      const result = await job();
      if (result?.status === 'cancelled') return;
      onClose();
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed. Please try again.');
    } finally {
      setIsExportLoading(false);
    }
  };

  const handleExport = async (format: AdvancedExportFormat) => {
    if (!canvas) return;
    const background = canvasBackgroundColor || DEFAULT_CANVAS_BACKGROUND;
    await runExport(async () => {
      await advancedExportManager.export(canvas, format, {
        includeBackground,
        backgroundColor: background,
        dpi: unitMode === 'px' ? sourceDpi * 2 : 300,
        sourceDpi,
        fileName,
      });
    });
  };
  const handleDownloadProductZip = async () => {
    if (
      !INTERNAL_PRODUCT_FORGE_ENABLED
      || !canvas
      || pages.length === 0
      || isProductZipLoading
    ) return;
    setProductZipError(null);
    setIsProductZipLoading(true);

    try {
      const [artifactModule, packageModule] = await Promise.all([
        import('../productForge/generateProductForgeArtifacts'),
        import('../productForge/packageProductForgeZip'),
      ]);
      syncActivePageFromCanvas();
      const state = useEditorStore.getState();
      const pagesForExport = state.pages.length > 0 ? state.pages : pages;
      const safeActiveIndex = Math.max(0, Math.min(state.activePageIndex, Math.max(0, pagesForExport.length - 1)));
      const activePage = pagesForExport[safeActiveIndex];
      const artifactResult = await artifactModule.generateProductForgeArtifacts({
        projectName: state.projectName || projectName,
        pages: pagesForExport,
        activePageIndex: safeActiveIndex,
        imageAssets: state.imageAssets,
        productProjectFields: state.productProjectFields || productProjectFields,
        unitMode: state.unitMode || unitMode,
        canvasSize: activePage?.canvasSize,
        lastUpdated: new Date().toISOString(),
      });
      const zipResult = await packageModule.packageProductForgeZip(artifactResult, {
        productMetadata: state.productProjectFields?.productMetadata || productProjectFields?.productMetadata,
        recipe: state.productProjectFields?.recipe || productProjectFields?.recipe,
        theme: state.productProjectFields?.theme || productProjectFields?.theme,
        exportSettings: state.productProjectFields?.exportSettings || productProjectFields?.exportSettings,
      });

      if (zipResult.status !== 'generated' || !zipResult.blob) {
        const details = zipResult.errors?.join('; ') || 'Product ZIP packaging failed.';
        throw new Error(details);
      }

      const delivery = await deliverFile({
        content: zipResult.blob,
        fileName: zipResult.fileName,
        extension: 'zip',
        dialogTitle: 'Save Product ZIP',
        filterName: 'ZIP archive',
      });
      if (delivery.status === 'saved') onClose();
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : 'Failed to generate Product ZIP.';
      console.error('[ExportModal] Product ZIP generation failed:', error);
      setProductZipError(message);
    } finally {
      setIsProductZipLoading(false);
    }
  };
  const handleExportAllPagesPdf = async () => {
    if (!canvas) return;
    syncActivePageFromCanvas();
    const nextPages = useEditorStore.getState().pages;
    const nextImageAssets = useEditorStore.getState().imageAssets;
    const background = canvasBackgroundColor || DEFAULT_CANVAS_BACKGROUND;
    await runExport(async () => {
      await advancedExportManager.exportPagesPdf(nextPages.length > 0 ? nextPages : pages, {
        includeBackground,
        backgroundColor: background,
        dpi: unitMode === 'px' ? sourceDpi * 2 : 300,
        sourceDpi,
        fileName,
        imageAssets: Object.keys(nextImageAssets).length > 0 ? nextImageAssets : imageAssets,
      });
    });
  };
  const handleExportAllPages = async (format: Exclude<AdvancedExportFormat, 'pdf'>) => {
    if (!canvas) return;
    syncActivePageFromCanvas();
    const nextPages = useEditorStore.getState().pages;
    const nextImageAssets = useEditorStore.getState().imageAssets;
    const background = canvasBackgroundColor || DEFAULT_CANVAS_BACKGROUND;
    const pagesForExport = nextPages.length > 0 ? nextPages : pages;
    await runExport(async () => {
      await advancedExportManager.exportPages(pagesForExport, format, {
        includeBackground,
        backgroundColor: background,
        dpi: unitMode === 'px' ? sourceDpi * 2 : 300,
        sourceDpi,
        fileName,
        imageAssets: Object.keys(nextImageAssets).length > 0 ? nextImageAssets : imageAssets,
      });
    });
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-white/10 bg-[color:var(--ui-panel)] p-6 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        aria-busy={isExportLoading || isProductZipLoading}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 id="export-dialog-title" className="text-xl font-semibold text-[color:var(--ui-text)]">
              {INTERNAL_PRODUCT_FORGE_ENABLED ? 'Export / Product Forge' : 'Export'}
            </h2>
            <p className="mt-1 text-xs text-[color:var(--ui-panel-text)]">
              {INTERNAL_PRODUCT_FORGE_ENABLED
                ? 'Download product-ready files or advanced page exports.'
                : 'Download current-page or multi-page project exports.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-[color:var(--ui-panel-text)]" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="space-y-5">
          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <span className="text-xs uppercase tracking-widest text-[color:var(--ui-panel-text)]">
              Include Background Color
            </span>
            <button
              type="button"
              onClick={() => setIncludeBackground((prev) => !prev)}
              className={`h-6 w-11 rounded-full border transition-colors ${
                includeBackground
                  ? 'border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)]/50'
                  : 'border-white/10 bg-black/30'
              }`}
              aria-pressed={includeBackground}
            >
              <span
                className={`block h-5 w-5 rounded-full bg-white transition-transform ${
                  includeBackground ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {INTERNAL_PRODUCT_FORGE_ENABLED && (
          <section className="space-y-4 rounded-2xl border border-[color:var(--brand-primary)]/35 bg-[color:var(--brand-primary)]/10 p-4" aria-labelledby="product-bundle-heading">
            <div>
              <p id="product-bundle-heading" className="text-xs uppercase tracking-widest text-[color:var(--ui-text)]">
                Product Bundle / Product Forge ZIP
              </p>
              <p className="mt-1 text-[10px] uppercase tracking-widest text-[color:var(--brand-primary)]">
                Internal seller production only
              </p>
              <p className="mt-1 text-xs text-[color:var(--ui-panel-text)]">
                Packages the printable PDF, preview PNGs, metadata, manifest, README, and listing copy.
              </p>
            </div>
            <div className="grid gap-2 rounded-xl border border-white/10 bg-black/10 p-3 text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)] md:grid-cols-2">
              <div>
                <span className="block text-[color:var(--ui-panel-text)]/70">Product</span>
                <span className="mt-1 block text-[color:var(--ui-text)]">{productTitle}</span>
              </div>
              <div>
                <span className="block text-[color:var(--ui-panel-text)]/70">Recipe</span>
                <span className="mt-1 block text-[color:var(--ui-text)]">
                  {recipe ? `${recipe.id} v${recipe.version}` : 'Custom project'}
                </span>
              </div>
              <div className="md:col-span-2">
                <span className="block text-[color:var(--ui-panel-text)]/70">Readiness</span>
                <span className="mt-1 block text-[color:var(--ui-text)]">{readinessSummary}</span>
              </div>
            </div>
            <button
              type="button"
              data-testid="download-product-zip"
              onClick={() => void handleDownloadProductZip()}
              disabled={!canPackageProductZip}
              className="w-full rounded-xl border border-[color:var(--brand-primary)]/50 bg-[color:var(--brand-primary)]/25 px-4 py-3 text-sm uppercase tracking-widest text-[color:var(--ui-text)] transition-colors hover:bg-[color:var(--brand-primary)]/35 disabled:opacity-50"
            >
              {isProductZipLoading ? 'Generating Product ZIP...' : 'Download Product ZIP'}
            </button>
            {productZipError && (
              <p role="alert" className="text-xs text-red-300">
                {productZipError}
              </p>
            )}
          </section>
          )}

          {exportError && <p role="alert" className="text-xs text-red-300">{exportError}</p>}

          <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4" aria-labelledby="quick-exports-heading">
            <div>
              <p id="quick-exports-heading" className="text-xs uppercase tracking-widest text-[color:var(--ui-text)]">
                Quick Exports
              </p>
              <p className="mt-1 text-xs text-[color:var(--ui-panel-text)]">
                Common current-page downloads for previews and proofing.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <button
                type="button"
                data-testid="export-png"
                onClick={() => void handleExport('png')}
                disabled={!canvas || isExportLoading}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm uppercase tracking-widest text-[color:var(--ui-text)] hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                {unitMode === 'px' ? 'Download PNG (2x)' : 'Download PNG (300 DPI)'}
              </button>
              <button
                type="button"
                onClick={() => void handleExport('pdf')}
                disabled={!canvas || isExportLoading}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm uppercase tracking-widest text-[color:var(--ui-text)] hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                Download PDF
              </button>
              <button
                type="button"
                onClick={() => void handleExportAllPagesPdf()}
                disabled={!canvas || isExportLoading}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm uppercase tracking-widest text-[color:var(--ui-text)] hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                Download PDF (All Pages)
              </button>
              <button
                type="button"
                onClick={() => void handleExportAllPages('png')}
                disabled={!canvas || isExportLoading}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm uppercase tracking-widest text-[color:var(--ui-text)] hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                Download PNG (All Pages)
              </button>
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4" aria-labelledby="advanced-exports-heading">
            <div>
              <p id="advanced-exports-heading" className="text-xs uppercase tracking-widest text-[color:var(--ui-text)]">
                Advanced Exports
              </p>
              <p className="mt-1 text-xs text-[color:var(--ui-panel-text)]">
                Lower-level formats for testing, assets, and manual workflows.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <button
                type="button"
                data-testid="export-jpeg"
                onClick={() => void handleExport('jpeg')}
                disabled={!canvas || isExportLoading}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm uppercase tracking-widest text-[color:var(--ui-text)] hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                Download JPEG
              </button>
              <button
                type="button"
                onClick={() => void handleExport('svg')}
                disabled={!canvas || isExportLoading}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm uppercase tracking-widest text-[color:var(--ui-text)] hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                Download SVG
              </button>
              <button
                type="button"
                onClick={() => void handleExportAllPages('jpeg')}
                disabled={!canvas || isExportLoading}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm uppercase tracking-widest text-[color:var(--ui-text)] hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                Download JPEG (All Pages)
              </button>
              <button
                type="button"
                onClick={() => void handleExportAllPages('svg')}
                disabled={!canvas || isExportLoading}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm uppercase tracking-widest text-[color:var(--ui-text)] hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                Download SVG (All Pages)
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
