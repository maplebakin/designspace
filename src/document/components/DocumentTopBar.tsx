import React from 'react';
import {
  ChevronDown,
  Download,
  FileJson,
  Home,
  Printer,
  Save,
} from 'lucide-react';

type DocumentTopBarProps = {
  projectName: string;
  saveStatus: string;
  exportBusy: boolean;
  onBack: () => void;
  onRename: (name: string) => void;
  onSave: () => void;
  onDownloadProject: () => void;
  onExport: (format: 'png' | 'pdf') => void;
  onPrint: () => void;
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
  saveStatus,
  exportBusy,
  onBack,
  onRename,
  onSave,
  onDownloadProject,
  onExport,
  onPrint,
}) => (
  <header
    className="document-top-bar"
    data-document-editor-ui="true"
    data-testid="document-top-bar"
  >
    <button
      type="button"
      className="document-top-bar__home"
      onClick={onBack}
      aria-label="Back to projects"
    >
      <Home size={17} aria-hidden="true" />
      <span>Projects</span>
    </button>

    <div className="document-top-bar__identity">
      <input
        aria-label="Document project name"
        data-testid="document-project-name"
        value={projectName}
        onChange={(event) => onRename(event.target.value)}
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
    </div>

    <div className="document-top-bar__actions">
      <details className="document-action-menu">
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
      </details>

      <button
        type="button"
        className="document-top-action document-top-action--primary"
        onClick={onSave}
      >
        <Save size={16} aria-hidden="true" />
        Save
      </button>

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
            onClick={() => onExport('png')}
          >
            PNG
            <span>300 DPI image</span>
          </button>
          <button
            type="button"
            aria-label="PDF"
            disabled={exportBusy}
            onClick={() => onExport('pdf')}
          >
            PDF
            <span>Print-sized page</span>
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
