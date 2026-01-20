import React, { useState, useEffect, useMemo } from 'react';
import { shallow } from 'zustand/shallow';
import { useEditorStore } from '../state/editorStore';
import { useCanvasStore } from '../state/useCanvasStore';
import { FileText, Plus, Trash2, Copy, Search, X } from 'lucide-react';

interface ProjectItem {
  id: string;
  name: string;
  lastModified: Date;
  thumbnail?: string;
}

const CanvasPresets = [
  {
    id: 'instagram-square',
    name: 'Instagram Square',
    width: 1080,
    height: 1080,
    description: '1080 x 1080',
  },
  {
    id: 'instagram-story',
    name: 'Instagram Story',
    width: 1080,
    height: 1920,
    description: '1080 x 1920',
  },
  {
    id: 'youtube-thumbnail',
    name: 'YouTube Thumbnail',
    width: 1280,
    height: 720,
    description: '1280 x 720',
  },
  {
    id: 'tiktok-vertical',
    name: 'TikTok Video',
    width: 1080,
    height: 1920,
    description: '1080 x 1920',
  },
  {
    id: 'pinterest-pin',
    name: 'Pinterest Pin',
    width: 1000,
    height: 1500,
    description: '1000 x 1500',
  },
  {
    id: 'desktop-wallpaper',
    name: 'Desktop Wallpaper',
    width: 1920,
    height: 1080,
    description: '1920 x 1080',
  },
];

interface ProjectDashboardProps {
  onProjectOpen?: () => void;
}

export const ProjectDashboard: React.FC<ProjectDashboardProps> = ({ onProjectOpen }) => {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isDuplicating, setIsDuplicating] = useState<string | null>(null);
  
  const {
    getAllProjects,
    loadProject,
    deleteProject,
    duplicateProject,
    startNewProject,
    setProjectPresetsOpen,
  } = useEditorStore((state) => ({
    getAllProjects: state.getAllProjects,
    loadProject: state.loadProject,
    deleteProject: state.deleteProject,
    duplicateProject: state.duplicateProject,
    startNewProject: state.startNewProject,
    setProjectPresetsOpen: state.setProjectPresetsOpen,
  }), shallow);

  const { setCanvasSize } = useCanvasStore((state) => ({
    setCanvasSize: state.setCanvasSize,
  }));

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    setIsLoading(true);
    try {
      const projectList = await getAllProjects();
      setProjects(projectList.map((proj: any) => ({
        ...proj,
        lastModified: new Date(proj.lastModified),
      })));
    } catch (error) {
      console.error('Failed to load projects:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadProject = async (projectId: string) => {
    await loadProject(projectId);
    onProjectOpen?.();
  };

  const handleDeleteProject = async (projectId: string, projectName: string) => {
    if (confirm(`Are you sure you want to delete "${projectName}"?`)) {
      setIsDeleting(projectId);
      try {
        await deleteProject(projectId);
        loadProjects(); // Refresh the list
      } catch (error) {
        console.error('Failed to delete project:', error);
      } finally {
        setIsDeleting(null);
      }
    }
  };

  const handleDuplicateProject = async (projectId: string, projectName: string) => {
    const newName = `${projectName} Copy`;
    setIsDuplicating(projectId);
    try {
      await duplicateProject(projectId, newName);
      loadProjects(); // Refresh the list
    } catch (error) {
      console.error('Failed to duplicate project:', error);
    } finally {
      setIsDuplicating(null);
    }
  };

  const handlePresetSelect = (preset: typeof CanvasPresets[number]) => {
    setCanvasSize(preset.width, preset.height);
    startNewProject();
    setProjectPresetsOpen(false);
    onProjectOpen?.();
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  // Filter projects based on search query
  const filteredProjects = useMemo(() => {
    if (!searchQuery) return projects;
    const query = searchQuery.toLowerCase();
    return projects.filter(project => 
      project.name.toLowerCase().includes(query) ||
      project.lastModified.toLocaleString().toLowerCase().includes(query)
    );
  }, [projects, searchQuery]);

  return (
    <div className="flex flex-col h-full bg-[color:var(--ui-bg)] text-[color:var(--ui-text)]">
      <div className="p-6 border-b border-[color:var(--ui-border)] bg-[color:var(--ui-panel)]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold uppercase tracking-widest">Project Dashboard</h1>
            <p className="text-slate-400 mt-1">Manage your design projects</p>
          </div>
          <button
            onClick={() => {
              startNewProject();
              onProjectOpen?.();
            }}
            className="flex items-center gap-2 px-4 py-2 bg-[color:var(--brand-primary)] rounded-lg hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            New Project
          </button>
        </div>
        
        <div className="mt-6 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 stroke-[1.5] text-[color:var(--ui-panel-text)] opacity-70" />
          <input
            type="text"
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 text-sm bg-white/10 border border-white/10 rounded-lg text-[color:var(--ui-panel-text)] placeholder:text-[color:var(--ui-panel-text)] placeholder:opacity-60 focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-primary)]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--ui-panel-text)] opacity-70 hover:opacity-100"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6">
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[11px] uppercase tracking-widest text-slate-300">Templates Gallery</h2>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mt-1">Start with a preset canvas size</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {CanvasPresets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handlePresetSelect(preset)}
                className="text-left p-4 rounded-xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] hover:border-[color:var(--brand-primary)] hover:bg-white/10 transition-all"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs uppercase tracking-widest text-[color:var(--ui-text)]">{preset.name}</span>
                  <span className="text-[10px] uppercase tracking-widest text-slate-400">{preset.width} x {preset.height}</span>
                </div>
                <span className="text-[10px] uppercase tracking-widest text-slate-500">{preset.description}</span>
              </button>
            ))}
          </div>
        </section>
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[color:var(--brand-primary)]"></div>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <FileText className="mx-auto h-16 w-16 mb-4 opacity-50" />
            <h3 className="text-lg font-medium">No projects found</h3>
            <p className="mt-1">
              {searchQuery 
                ? "No projects match your search." 
                : "Get started by creating a new project."}
            </p>
            {!searchQuery && (
              <button
                onClick={() => {
                  startNewProject();
                  onProjectOpen?.();
                }}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-[color:var(--brand-primary)] rounded-lg hover:opacity-90 transition-opacity"
              >
                <Plus className="w-4 h-4" />
                Create Project
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {filteredProjects.map((project) => (
              <div
                key={project.id}
                className="bg-[color:var(--ui-panel)] rounded-xl border border-[color:var(--ui-border)] overflow-hidden transition-transform hover:scale-[1.02] hover:shadow-lg"
              >
                <div className="relative">
                  {project.thumbnail ? (
                    <img 
                      src={project.thumbnail} 
                      alt={project.name} 
                      className="w-full h-40 object-cover"
                    />
                  ) : (
                    <div className="w-full h-40 bg-white/5 flex items-center justify-center">
                      <FileText className="w-12 h-12 opacity-30" />
                    </div>
                  )}
                  
                  <div className="absolute top-2 right-2 flex gap-1">
                    <button
                      onClick={() => handleDuplicateProject(project.id, project.name)}
                      disabled={isDuplicating === project.id}
                      className="p-1.5 rounded-full bg-black/50 hover:bg-black/70 transition-colors disabled:opacity-50"
                      title="Duplicate project"
                    >
                      {isDuplicating === project.id ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      ) : (
                        <Copy className="w-4 h-4 text-white" />
                      )}
                    </button>
                    <button
                      onClick={() => handleDeleteProject(project.id, project.name)}
                      disabled={isDeleting === project.id}
                      className="p-1.5 rounded-full bg-black/50 hover:bg-red-500/70 transition-colors disabled:opacity-50"
                      title="Delete project"
                    >
                      {isDeleting === project.id ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      ) : (
                        <Trash2 className="w-4 h-4 text-white" />
                      )}
                    </button>
                  </div>
                </div>
                
                <div className="p-4">
                  <h3 
                    className="font-semibold text-sm mb-1 truncate cursor-pointer hover:text-[color:var(--brand-primary)] transition-colors"
                    onClick={() => handleLoadProject(project.id)}
                    title={project.name}
                  >
                    {project.name}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Last edited: {formatDate(project.lastModified)}
                  </p>
                  
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => handleLoadProject(project.id)}
                      className="flex-1 py-1.5 text-xs bg-white/10 rounded-lg hover:bg-white/20 transition-colors"
                    >
                      Open
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
