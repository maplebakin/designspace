import React from 'react';
import {
  ChevronDown,
  Download,
  FileJson,
  Home,
  Printer,
  Save,
} from 'lucide-react';
import { CommittedInput } from '../../editor/components/Tooltip';

type DocumentTopBarProps = {
  projectName: string;
  pageCount: number;
  saveStatus: string;
  exportBusy: boolean;
  onBack: () => void;
  onRename: (name: string) => void;
  onRenameCommit?: (name: string, initialName: string) => void;
  onSave: () => void;
  onDownloadProject: () => void;
  onExport: (format: 'png' | 'pdf', scope?: 'current' | 'all') => void;
  onPrint: () => void;
  showProjectControls?: boolean;
};

const SAVE_STATUS_LABELS: Record<string, string> = {
  saved: 'Saved',
  unsaved: 'Unsaved',
  saving: 'Saving…',
  error: 'Save failed',
  exporting: 'Exporting…',
};

export const DocumentTopBar: React.FC<DocumentTopBarProps> = ({
  projectName,
  pageCount,
  saveStatus,
  exportBusy,
  onBack,
  onRename,
  onRenameCommit,
  onSave,
  onDownloadProject,
  onExport,
  onPrint,
  showProjectControls = true,
}) => (
  <header
    className={`document-top-bar${showProjectControls ? '' : ' document-top-bar--contextual'}`}
    data-document-editor-ui="true"
    data-testid="document-top-bar"
  >
    {showProjectControls && <button
      type="button"
      className="document-top-bar__home"
      onClick={onBack}
      aria-label="Back to projects"
    >
      <Home size={17} aria-hidden="true" />
      <span>Projects</span>
    </button>}

    {showProjectControls && <div className="document-top-bar__identity">
      <CommittedInput
        aria-label="Document project name"
        data-testid="document-project-name"
        value={projectName}
        onChange={(event) => onRename(event.target.value)}
        onCommit={(value, initialValue) => onRenameCommit?.(value, initialValue)}
        className="document-project-name-input"
      />
      <span
        className="document-save-status"
        data-state={saveStatus}
        data-testid="document-save-status"
        role="status"
        aria-live="polite"
      >
        {SAVE_STATUS_LABELS[saveStatus] || saveStatus}
      </span>
    </div>}

    <div className="document-top-bar__actions">
      {showProjectControls && <details className="document-action-menu">
        <summary>
          File
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <div className="document-action-menu__panel">
          <button type="button" onClick={onDownloadProject}>
            <FileJson size={16} aria-hidden="true" />
            Download project file
          </button>
        </div>
      </details>}

      {showProjectControls && <button
        type="button"
        className="document-top-action document-top-action--primary"
        onClick={onSave}
      >
        <Save size={16} aria-hidden="true" />
        Save
      </button>}

      <details className="document-action-menu document-action-menu--export">
        <summary>
          <Download size={16} aria-hidden="true" />
          Export
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <div className="document-action-menu__panel document-action-menu__panel--right">
          <button
            type="button"
            aria-label="PNG"
            disabled={exportBusy}
            onClick={() => onExport('png', 'current')}
          >
            PNG
            <span>Current page · 300 DPI</span>
          </button>
          <button
            type="button"
            aria-label="PNG all pages"
            disabled={exportBusy}
            onClick={() => onExport('png', 'all')}
          >
            PNG (all pages)
            <span>{pageCount} files · 300 DPI</span>
          </button>
          <button
            type="button"
            aria-label="PDF"
            disabled={exportBusy}
            onClick={() => onExport('pdf')}
          >
            PDF
            <span>All {pageCount} {pageCount === 1 ? 'page' : 'pages'}</span>
          </button>
        </div>
      </details>

      <button
        type="button"
        className="document-top-action document-top-action--quiet"
        onClick={onPrint}
      >
        <Printer size={16} aria-hidden="true" />
        Print
      </button>
    </div>
  </header>
);
