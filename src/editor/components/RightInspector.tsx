import React, { useEffect } from 'react';
import { shallow } from 'zustand/shallow';
import {
  BoxSelect,
  FileText,
  Frame,
  Layers,
  PackageCheck,
  Palette,
} from 'lucide-react';
import { useCanvasStore } from '../state/useCanvasStore';
import { useEditorStore } from '../state/editorStore';
import { BrandKit } from './BrandKit';
import { LayersPanel } from './LayersPanel';
import { PageBorderPopover } from './PageBorderPopover';
import { PropertiesPanel } from './PropertiesPanel';
import { ThemeSidebar } from './ThemeSidebar';

export type InspectorTab = 'product' | 'page' | 'object' | 'theme' | 'layers';

interface RightInspectorProps {
  activeTab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  onOpenBrandKit: () => void;
  onOpenVibeSettings: () => void;
}

const TAB_BUTTON_BASE = 'flex min-w-[3.75rem] flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-[10px] uppercase tracking-widest transition-all duration-200';
const PANEL_ACTION_BUTTON = 'ui-button-soft w-full flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] uppercase tracking-widest';

const DetailRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="design-space-detail-row rounded-lg border border-white/10 bg-white/5 px-3 py-2">
    <div className="text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/70">{label}</div>
    <div className="mt-1 break-words text-[11px] uppercase tracking-widest text-[color:var(--ui-text)]">{value}</div>
  </div>
);

const ProductPanel: React.FC = () => {
  const {
    projectName,
    productProjectFields,
    pages,
  } = useEditorStore(
    (state) => ({
      projectName: state.projectName,
      productProjectFields: state.productProjectFields,
      pages: state.pages,
    }),
    shallow
  );
  const productTitle = productProjectFields?.productMetadata?.title || projectName || 'Untitled Product';
  const recipe = productProjectFields?.recipe;
  const exportSettings = productProjectFields?.exportSettings;
  const zipReady = recipe && pages.length > 0 && exportSettings?.pdfFileName
    ? 'Ready to package from Export / ZIP'
    : 'Available after product recipe/export settings exist';

  return (
    <div className="design-space-inspector-panel h-full overflow-y-auto p-4" data-testid="right-inspector-product-panel">
      <div className="design-space-inspector-hero mb-4 rounded-2xl border border-[color:var(--brand-primary)]/30 bg-[color:var(--brand-primary)]/10 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color:var(--brand-primary)]/20 text-[color:var(--brand-primary)]">
            <PackageCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xs uppercase tracking-widest text-[color:var(--ui-text)]">Product</h2>
            <p className="mt-1 text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/75">
              Product metadata and packaging readiness.
            </p>
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <DetailRow label="Title" value={productTitle} />
        <DetailRow label="Recipe" value={recipe ? `${recipe.id} v${recipe.version}` : 'Custom product'} />
        <DetailRow label="Pages" value={`${pages.length} page${pages.length === 1 ? '' : 's'}`} />
        <DetailRow label="Product Forge" value={zipReady} />
      </div>
    </div>
  );
};

const PagePanel: React.FC = () => {
  const {
    pages,
    activePageIndex,
    unitMode,
    productProjectFields,
  } = useEditorStore(
    (state) => ({
      pages: state.pages,
      activePageIndex: state.activePageIndex,
      unitMode: state.unitMode,
      productProjectFields: state.productProjectFields,
    }),
    shallow
  );
  const { width, height } = useCanvasStore(
    (state) => ({ width: state.width, height: state.height }),
    shallow
  );
  const page = pages[activePageIndex];
  const documentPageSize = productProjectFields?.document?.pageSize;
  const displayedWidth = page?.canvasSize?.width ?? width;
  const displayedHeight = page?.canvasSize?.height ?? height;
  const dpi = documentPageSize?.dpi;

  return (
    <div className="design-space-inspector-panel h-full overflow-y-auto p-4" data-testid="right-inspector-page-panel">
      <div className="design-space-inspector-hero mb-4 rounded-2xl border border-white/10 bg-white/5 p-4">
        <h2 className="text-xs uppercase tracking-widest text-[color:var(--ui-text)]">Page</h2>
        <p className="mt-1 text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/75">
          Current page and document setup.
        </p>
      </div>
      <div className="space-y-2">
        <DetailRow label="Current page" value={`${activePageIndex + 1} ${page?.name || `Page ${activePageIndex + 1}`}`} />
        <DetailRow label="Page count" value={`${pages.length} total`} />
        <DetailRow label="Document size" value={`${displayedWidth} × ${displayedHeight} px`} />
        <DetailRow label="Units" value={unitMode || documentPageSize?.unitMode || 'px'} />
        {dpi && <DetailRow label="DPI" value={dpi} />}
      </div>
      <div className="design-space-inspector-card mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
        <p className="mb-3 text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">Page Style</p>
        <PageBorderPopover />
      </div>
    </div>
  );
};

const ObjectPanel: React.FC = () => {
  const { selectedObjectId, selectedLayerIds } = useEditorStore(
    (state) => ({
      selectedObjectId: state.selectedObjectId,
      selectedLayerIds: state.selectedLayerIds,
    }),
    shallow
  );
  const hasSelection = Boolean(selectedObjectId || selectedLayerIds.length > 0);

  return (
    <div className="design-space-inspector-panel h-full" data-testid="right-inspector-object-panel">
      {!hasSelection && (
        <div className="border-b border-[color:var(--border-subtle)] px-4 py-3 text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">
          Select an object to edit it.
        </div>
      )}
      <PropertiesPanel />
    </div>
  );
};

const ThemePanel: React.FC<Pick<RightInspectorProps, 'onOpenBrandKit' | 'onOpenVibeSettings'>> = ({
  onOpenBrandKit,
  onOpenVibeSettings,
}) => (
  <div className="design-space-inspector-panel h-full overflow-y-auto" data-testid="right-inspector-theme-panel">
    <div className="space-y-4 p-4">
      <div className="design-space-inspector-hero rounded-2xl border border-white/10 bg-white/5 p-4">
        <h2 className="text-xs uppercase tracking-widest text-[color:var(--ui-text)]">Theme</h2>
        <p className="mt-1 text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/75">
          Palette links, brand colors, and page styling.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onOpenBrandKit}
          className={PANEL_ACTION_BUTTON}
        >
          <FileText className="h-3.5 w-3.5" />
          Brand Kit
        </button>
        <button
          type="button"
          onClick={onOpenVibeSettings}
          className={PANEL_ACTION_BUTTON}
        >
          <Palette className="h-3.5 w-3.5" />
          Vibe Settings
        </button>
      </div>
      <div className="design-space-inspector-card rounded-xl border border-white/10 bg-white/5 p-3">
        <p className="mb-3 text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">Brand Kit</p>
        <BrandKit />
      </div>
    </div>
    <div className="border-t border-[color:var(--ui-border)]">
      <ThemeSidebar />
    </div>
  </div>
);

export const RightInspector: React.FC<RightInspectorProps> = ({
  activeTab,
  onTabChange,
  onOpenBrandKit,
  onOpenVibeSettings,
}) => {
  const selectedObjectId = useEditorStore((state) => state.selectedObjectId);

  useEffect(() => {
    if (selectedObjectId) onTabChange('object');
  }, [onTabChange, selectedObjectId]);

  const tabs: Array<{ id: InspectorTab; label: string; icon: React.ReactElement; testId: string }> = [
    { id: 'product', label: 'Product', icon: <PackageCheck className="h-3.5 w-3.5" />, testId: 'right-tab-product' },
    { id: 'page', label: 'Page', icon: <Frame className="h-3.5 w-3.5" />, testId: 'right-tab-page' },
    { id: 'object', label: 'Object', icon: <BoxSelect className="h-3.5 w-3.5" />, testId: 'right-tab-object' },
    { id: 'theme', label: 'Theme', icon: <Palette className="h-3.5 w-3.5" />, testId: 'right-tab-theme' },
    { id: 'layers', label: 'Layers', icon: <Layers className="h-3.5 w-3.5" />, testId: 'right-tab-layers' },
  ];

  return (
    <aside data-testid="right-panel" className="design-space-inspector editor-side-panel-right flex-col overflow-hidden border-l border-[color:var(--ui-border)] bg-[color:var(--ui-panel)]/70 backdrop-blur-[var(--ui-blur)] transition-all duration-300 ease-in-out w-[360px]">
      <div className="design-space-inspector-tabs flex shrink-0 overflow-x-auto border-b border-[color:var(--ui-border)]">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              data-testid={tab.testId}
              className={`design-space-inspector-tab ${TAB_BUTTON_BASE} ${
                isActive
                  ? 'border-b-2 border-[color:var(--brand-primary)] bg-[color:var(--ui-active-soft)] text-[color:var(--brand-primary)]'
                  : 'border-b-2 border-transparent text-[color:var(--ui-panel-text)] hover:bg-[color:var(--ui-hover-soft)] hover:text-[color:var(--ui-text)]'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className="design-space-inspector-content min-h-0 flex-1 overflow-hidden">
        {activeTab === 'product' && <ProductPanel />}
        {activeTab === 'page' && <PagePanel />}
        {activeTab === 'object' && <ObjectPanel />}
        {activeTab === 'theme' && (
          <ThemePanel
            onOpenBrandKit={onOpenBrandKit}
            onOpenVibeSettings={onOpenVibeSettings}
          />
        )}
        {activeTab === 'layers' && (
          <div className="design-space-inspector-panel h-full overflow-y-auto" data-testid="right-inspector-layers-panel">
            <LayersPanel />
          </div>
        )}
      </div>
    </aside>
  );
};
