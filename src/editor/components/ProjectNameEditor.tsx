import React, { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';

export type ProjectNameEditorProps = {
  name: string;
  onRename: (newName: string) => void;
};

/**
 * The Canvas shell and the unified shell use the same lightweight rename
 * interaction. Persistence remains owned by the active renderer adapter.
 */
export const ProjectNameEditor: React.FC<ProjectNameEditorProps> = ({
  name,
  onRename,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const beginEdit = () => {
    setDraft(name);
    setEditing(true);
  };

  const commitEdit = () => {
    const trimmed = draft.trim() || 'Untitled Project';
    setEditing(false);
    if (trimmed !== name) onRename(trimmed);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        data-testid="project-name-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitEdit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitEdit();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            cancelEdit();
          }
        }}
        aria-label="Project name"
        className="max-w-[180px] rounded border border-[color:var(--brand-primary)]/50 bg-[color:var(--ui-bg)] px-2 py-0.5 text-[11px] uppercase tracking-widest text-[color:var(--ui-text)] outline-none focus:ring-1 focus:ring-[color:var(--brand-primary)]"
      />
    );
  }

  return (
    <button
      data-testid="project-name-display"
      onClick={beginEdit}
      title="Click to rename project"
      className="group flex max-w-[180px] items-center gap-1.5 rounded px-2 py-0.5 text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)] transition-colors hover:bg-white/5 hover:text-[color:var(--ui-text)]"
    >
      <span className="truncate">{name}</span>
      <Pencil className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
    </button>
  );
};
