import React from 'react';
import { shallow } from 'zustand/shallow';
import { useEditorStore } from '../state/editorStore';

export const SuggestionSidebar: React.FC = () => {
  const {
    layoutSuggestions,
    toggleSuggestionSidebar,
    dismissSuggestion,
    applySuggestion,
  } = useEditorStore(
    (state) => ({
      layoutSuggestions: state.layoutSuggestions,
      toggleSuggestionSidebar: state.toggleSuggestionSidebar,
      dismissSuggestion: state.dismissSuggestion,
      applySuggestion: state.applySuggestion,
    }),
    shallow
  );

  return (
    <aside
      className="rounded-2xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel-opaque)] p-4 shadow-lg backdrop-blur-[var(--ui-blur)]"
      aria-label="Layout suggestions"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-xs uppercase tracking-[0.25em] text-[color:var(--ui-panel-text)]/70">Suggestions</h3>
        <button
          type="button"
          onClick={toggleSuggestionSidebar}
          className="rounded-lg border border-white/10 px-2 py-1 text-[10px] uppercase tracking-widest"
        >
          Hide
        </button>
      </div>
      <div className="space-y-3">
        {layoutSuggestions.length === 0 && (
          <p className="text-xs text-[color:var(--ui-panel-text)]/60">No layout suggestions right now.</p>
        )}
        {layoutSuggestions.map((suggestion) => (
          <article key={suggestion.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-medium text-[color:var(--ui-text)]">{suggestion.name}</h4>
                <p className="mt-1 text-xs text-[color:var(--ui-panel-text)]/70">{suggestion.description}</p>
              </div>
              <span className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/50">
                {Math.round(suggestion.score * 100)}%
              </span>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => applySuggestion(suggestion.id)}
                className="rounded-lg bg-[color:var(--brand-primary)]/70 px-3 py-2 text-[10px] uppercase tracking-widest text-white"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => dismissSuggestion(suggestion.id)}
                className="rounded-lg border border-white/10 px-3 py-2 text-[10px] uppercase tracking-widest"
              >
                Dismiss
              </button>
            </div>
          </article>
        ))}
      </div>
    </aside>
  );
};
