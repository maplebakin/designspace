import React from 'react';
import { shallow } from 'zustand/shallow';
import { Plus } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';

const formatPageLabel = (pageName: string | undefined, index: number) => {
  const fallback = `Page ${index + 1}`;
  const safeName = pageName?.trim() || fallback;
  return `${index + 1} ${safeName}`;
};

export const ProductPageNavigator: React.FC = () => {
  const {
    pages,
    activePageIndex,
    switchToPage,
    addPage,
  } = useEditorStore(
    (state) => ({
      pages: state.pages,
      activePageIndex: state.activePageIndex,
      switchToPage: state.switchToPage,
      addPage: state.addPage,
    }),
    shallow
  );

  return (
    <div className="design-space-page-navigator flex h-full flex-col" data-testid="product-page-navigator">
      <div className="design-space-page-navigator-header border-b border-[color:var(--border-subtle)] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">
            Product Pages
          </span>
          <span className="text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/70">
            {pages.length} total
          </span>
        </div>
      </div>

      <div className="design-space-page-list min-h-0 flex-1 overflow-y-auto p-2">
        <div className="space-y-1.5">
          {pages.map((page, index) => {
            const isActive = activePageIndex === index;
            const label = formatPageLabel(page.name, index);
            return (
              <button
                key={page.id}
                type="button"
                onClick={() => void switchToPage(index)}
                aria-current={isActive ? 'page' : undefined}
                aria-label={`Go to page ${label}`}
                data-testid={`product-page-nav-item-${index + 1}`}
                className={`design-space-page-item w-full rounded-xl border px-3 py-2 text-left transition-all duration-200 ${
                  isActive
                    ? 'border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)]/14 text-[color:var(--brand-primary)] shadow-[var(--ui-shadow-soft)]'
                    : 'border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)]/50 text-[color:var(--ui-panel-text)] hover:bg-[color:var(--ui-surface-strong)] hover:text-[color:var(--ui-text)]'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] uppercase tracking-widest ${
                    isActive
                      ? 'border-[color:var(--brand-primary)]/50 bg-[color:var(--brand-primary)]/20'
                      : 'border-white/10 bg-white/5'
                  }`}>
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] uppercase tracking-widest">
                      {page.name?.trim() || `Page ${index + 1}`}
                    </span>
                    <span className="mt-0.5 block text-[9px] uppercase tracking-widest opacity-70">
                      {isActive ? 'Current page' : 'Open page'}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="design-space-page-navigator-footer border-t border-[color:var(--border-subtle)] p-2">
        <button
          type="button"
          onClick={() => void addPage()}
          className="design-space-add-page flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[color:var(--ui-border)] px-3 py-2 text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)] transition-all duration-200 hover:border-[color:var(--brand-primary)] hover:text-[color:var(--brand-primary)]"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Page
        </button>
        <p className="mt-2 text-center text-[8px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/60">
          Drag, delete, and reorder remain in the page strip.
        </p>
      </div>
    </div>
  );
};
