import React, { useRef, useState } from 'react';
import { shallow } from 'zustand/shallow';
import { ChevronDown, FileText } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';
import { PopoverSurface } from './PopoverSurface';

const CHROME_BUTTON = 'ui-button-soft group flex items-center gap-2 px-4 py-2 rounded-full text-[11px] uppercase tracking-widest';

interface FileDropdownProps {
  onImportDesignSpace: () => void;
}

export const FileDropdown: React.FC<FileDropdownProps> = ({ onImportDesignSpace }) => {
  const [isOpen, setIsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { downloadProjectFile, loadProjectFile, projectName, saveProject, setProjectPresetsOpen } = useEditorStore(
    (state) => ({
      downloadProjectFile: state.downloadProjectFile,
      loadProjectFile: state.loadProjectFile,
      projectName: state.projectName,
      saveProject: state.saveProject,
      setProjectPresetsOpen: state.setProjectPresetsOpen,
    }),
    shallow
  );

  const handleOpenFile = () => {
    fileInputRef.current?.click();
    setIsOpen(false);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await loadProjectFile(file);
    event.target.value = '';
    setIsOpen(false);
  };

  const handleSaveToLibrary = async () => {
    const safeName = projectName?.trim() || 'Untitled Project';
    await saveProject(safeName);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={CHROME_BUTTON}
      >
        <FileText className="icon-muted w-4 h-4 stroke-[1.5]" />
        <span>File</span>
        <ChevronDown className={`icon-muted w-4 h-4 stroke-[1.5] transition-all duration-300 ease-in-out ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".apocaproject.json,.json"
        onChange={handleFileChange}
        className="hidden"
      />
      {isOpen && (
        <PopoverSurface className="ui-dropdown-surface absolute left-0 mt-2 w-56 z-20 p-2">
          <ul>
            <li>
              <button
                onClick={() => { setProjectPresetsOpen(true); setIsOpen(false); }}
                className="ui-menu-item text-left text-xs uppercase tracking-widest"
              >
                New Project
              </button>
            </li>
            <li>
              <button
                onClick={handleOpenFile}
                className="ui-menu-item text-left text-xs uppercase tracking-widest"
              >
                Open File
              </button>
            </li>
            <li>
              <button
                onClick={() => { void handleSaveToLibrary(); }}
                className="ui-menu-item text-left text-xs uppercase tracking-widest"
              >
                Save to Library
              </button>
            </li>
            <li>
              <button
                onClick={() => { downloadProjectFile(); setIsOpen(false); }}
                className="ui-menu-item text-left text-xs uppercase tracking-widest"
              >
                Download Project File
              </button>
            </li>
            <li className="border-t border-[color:var(--ui-border)] mt-1 pt-1">
              <button
                onClick={() => { onImportDesignSpace(); setIsOpen(false); }}
                className="ui-menu-item text-left text-xs uppercase tracking-widest"
              >
                Import to DesignSpace
              </button>
            </li>
          </ul>
        </PopoverSurface>
      )}
    </div>
  );
};
