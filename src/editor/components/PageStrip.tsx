import React, { useRef, useState } from 'react';
import { shallow } from 'zustand/shallow';
import { Plus, Trash2 } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';

export const PageStrip: React.FC = () => {
  const {
    pages,
    activePageIndex,
    switchToPage,
    addPage,
    deletePage,
    reorderPages,
  } = useEditorStore(
    (state) => ({
      pages: state.pages,
      activePageIndex: state.activePageIndex,
      switchToPage: state.switchToPage,
      addPage: state.addPage,
      deletePage: state.deletePage,
      reorderPages: state.reorderPages,
    }),
    shallow
  );

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  return (
    <div data-testid="page-strip" className="design-space-page-strip h-[72px] border-t border-[color:var(--ui-border)] bg-[color:var(--ui-panel)]/80 backdrop-blur-[var(--ui-blur)] px-3 py-1.5 flex items-center gap-2 overflow-x-auto" ref={listRef}>
      {pages.map((page: any, index: number) => (
        <div
          key={page.id}
          draggable
          onDragStart={() => setDragIndex(index)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragIndex == null || dragIndex === index) return;
            reorderPages(dragIndex, index);
            setDragIndex(null);
          }}
          onDragEnd={() => setDragIndex(null)}
          className="group relative shrink-0"
        >
          <button
            type="button"
            onClick={() => void switchToPage(index)}
            aria-current={activePageIndex === index ? 'page' : undefined}
            aria-label={`Open page ${index + 1}: ${page.name || `Page ${index + 1}`}`}
            className={`design-space-page-strip-item w-20 h-[56px] rounded-xl border p-1 text-left transition-all duration-200 ${
              activePageIndex === index
                ? 'border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)]/14 shadow-[var(--ui-shadow-soft)]'
                : 'border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)]/60 hover:bg-[color:var(--ui-surface-strong)]'
            }`}
          >
            <div className="w-full h-8 rounded-md overflow-hidden border border-[color:var(--ui-border)]">
              {page.thumbnail ? (
                <img src={page.thumbnail} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full" style={{ background: 'var(--warm-paper)' }} />
              )}
            </div>
            <div className={`mt-1 text-[9px] uppercase tracking-widest ${activePageIndex === index ? 'text-[color:var(--brand-primary)]' : 'text-[color:var(--ui-panel-text)]'}`}>Page {index + 1}</div>
          </button>
          {pages.length > 1 && (
            <button
              type="button"
              aria-label={`Delete page ${index + 1}: ${page.name || `Page ${index + 1}`}`}
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Delete ${page.name || `Page ${index + 1}`}? This cannot be undone.`)) {
                  void deletePage(index);
                }
              }}
              className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 focus:opacity-100 w-[18px] h-[18px] rounded-full flex items-center justify-center bg-[rgba(74,56,45,0.7)] text-[#fbf7f2]"
            >
              <Trash2 className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      ))}
      <button
        onClick={() => void addPage()}
        className="design-space-page-strip-add shrink-0 w-8 h-[56px] rounded-xl border border-dashed border-[color:var(--ui-border)] hover:border-[color:var(--brand-primary)] hover:text-[color:var(--brand-primary)] text-[color:var(--ui-panel-text)] flex items-center justify-center transition-all duration-200"
        aria-label="Add page"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
};
