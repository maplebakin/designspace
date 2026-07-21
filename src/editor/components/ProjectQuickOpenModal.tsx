import React, { useEffect, useMemo, useState } from 'react';
import { shallow } from 'zustand/shallow';
import { Search, FileText } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';

type ProjectItem = {
  id: string;
  name: string;
  lastModified: Date;
  thumbnail?: string;
  editorMode: 'canvas' | 'document';
};

const toProjectItem = (project: any): ProjectItem | null => {
  if (!project || typeof project.id !== 'string') return null;
  const name = typeof project.name === 'string' && project.name.trim().length > 0
    ? project.name
    : 'Untitled Project';
  const timestamp = project.lastModified ? new Date(project.lastModified) : new Date(0);
  return {
    id: project.id,
    name,
    lastModified: timestamp,
    thumbnail: typeof project.thumbnail === 'string' ? project.thumbnail : undefined,
    editorMode: project.editorMode === 'document' ? 'document' : 'canvas',
  };
};

export const ProjectQuickOpenModal: React.FC = () => {
  const { isOpen, setOpen, getAllProjects, loadProject } = useEditorStore(
    (state) => ({
      isOpen: state.isProjectQuickOpenOpen,
      setOpen: state.setProjectQuickOpenOpen,
      getAllProjects: state.getAllProjects,
      loadProject: state.loadProject,
    }),
    shallow
  );
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpening, setIsOpening] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const fetchProjects = async () => {
      setIsLoading(true);
      try {
        const allProjects = await getAllProjects();
        if (cancelled) return;
        const normalized = allProjects
          .map(toProjectItem)
          .filter((project): project is ProjectItem => project !== null)
          .filter((project) => project.editorMode === 'canvas')
          .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
        setProjects(normalized);
        setSelectedIndex(0);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void fetchProjects();
    return () => {
      cancelled = true;
    };
  }, [getAllProjects, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setIsOpening(false);
    }
  }, [isOpen]);

  const filteredProjects = useMemo(() => {
    if (!query.trim()) return projects;
    const lowered = query.toLowerCase();
    return projects.filter((project) => project.name.toLowerCase().includes(lowered));
  }, [projects, query]);

  useEffect(() => {
    if (selectedIndex >= filteredProjects.length) {
      setSelectedIndex(0);
    }
  }, [filteredProjects.length, selectedIndex]);

  const selectedProject = filteredProjects[selectedIndex] ?? null;

  const handleOpenProject = async (project: ProjectItem | null) => {
    if (!project || isOpening) return;
    setIsOpening(true);
    try {
      await loadProject(project.id);
      setOpen(false);
    } finally {
      setIsOpening(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (filteredProjects.length === 0) return;
      setSelectedIndex((prev) => (prev + 1) % filteredProjects.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (filteredProjects.length === 0) return;
      setSelectedIndex((prev) => (prev - 1 + filteredProjects.length) % filteredProjects.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void handleOpenProject(selectedProject);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  const formatDate = (date: Date) => new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div
        className="mx-auto mt-24 w-full max-w-2xl rounded-2xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] text-[color:var(--ui-panel-text)] shadow-[0_24px_48px_rgba(0,0,0,0.45)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-[color:var(--ui-border)] p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--ui-panel-text)]" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Quick Open projects..."
              className="ui-input-surface w-full rounded-lg py-2 pl-9 pr-3 text-sm"
              aria-label="Search recent projects"
            />
          </div>
          <p className="mt-2 text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">Enter to open · Esc to close · Cmd/Ctrl+K</p>
        </div>
        <div className="max-h-[420px] overflow-y-auto p-2">
          {isLoading ? (
            <div className="px-3 py-8 text-center text-xs uppercase tracking-widest text-[color:var(--ui-panel-text)]">Loading projects...</div>
          ) : filteredProjects.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs uppercase tracking-widest text-[color:var(--ui-panel-text)]">No matching projects</div>
          ) : (
            filteredProjects.map((project, index) => {
              const isSelected = index === selectedIndex;
              return (
                <button
                  key={project.id}
                  onClick={() => void handleOpenProject(project)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-all duration-150 ${
                    isSelected
                      ? 'border border-[color:var(--brand-primary)]/45 bg-[color:var(--brand-primary)]/12 shadow-[0_10px_22px_rgba(var(--brand-primary-rgb),0.12)]'
                      : 'border border-transparent hover:bg-[color:var(--ui-hover-soft)]'
                  }`}
                >
                  {project.thumbnail ? (
                    <img src={project.thumbnail} alt="" className="h-10 w-14 rounded-md object-cover" />
                  ) : (
                    <div className="flex h-10 w-14 items-center justify-center rounded-md bg-[color:var(--ui-surface-soft)]">
                      <FileText className="h-4 w-4 text-[color:var(--ui-panel-text)]/60" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs uppercase tracking-widest text-[color:var(--ui-text)]">{project.name}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">{formatDate(project.lastModified)}</div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
