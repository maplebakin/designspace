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
    <div className="h-24 border-t border-[color:var(--ui-border)] bg-[color:var(--ui-panel)]/80 backdrop-blur-[var(--ui-blur)] px-3 py-2 flex items-center gap-2 overflow-x-auto" ref={listRef}>
      {pages.map((page: any, index: number) => (
        <button
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
          onClick={() => void switchToPage(index)}
          className={`group relative shrink-0 w-28 h-20 rounded-lg border p-1 text-left transition-all ${
            activePageIndex === index
              ? 'border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)]/10'
              : 'border-white/10 bg-white/5 hover:bg-white/10'
          }`}
        >
          <div className="w-full h-12 rounded bg-black/20 overflow-hidden border border-white/10">
            {page.thumbnail ? (
              <img src={page.thumbnail} alt={page.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-black/20" />
            )}
          </div>
          <div className="mt-1 text-[9px] uppercase tracking-widest text-slate-200">Page {index + 1}</div>
          {pages.length > 1 && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                void deletePage(index);
              }}
              className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-1 rounded bg-black/60 text-rose-300"
            >
              <Trash2 className="w-3 h-3" />
            </span>
          )}
        </button>
      ))}
      <button
        onClick={() => void addPage()}
        className="shrink-0 w-10 h-20 rounded-lg border border-dashed border-white/20 hover:border-[color:var(--brand-primary)] text-slate-300 flex items-center justify-center"
        aria-label="Add page"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
};