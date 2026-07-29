import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Plus,
  Trash2,
} from 'lucide-react';
import type { DocumentPage } from '../types/documentProject';
import { getDocumentFolioNumber } from '../layout/pageGeometry';

type DocumentPageNavigationProps = {
  pages: DocumentPage[];
  activePageIndex: number;
  startingFolio: number;
  onSelectPage: (index: number) => void;
  onAddPage: () => void;
  onDuplicatePage: () => void;
  onRemovePage: () => void;
  onMovePage: (direction: 'left' | 'right') => void;
};

export const DocumentPageNavigation = ({
  pages,
  activePageIndex,
  startingFolio,
  onSelectPage,
  onAddPage,
  onDuplicatePage,
  onRemovePage,
  onMovePage,
}: DocumentPageNavigationProps) => (
  <nav
    className="document-page-navigation"
    data-document-editor-ui="true"
    data-testid="document-page-navigation"
    aria-label="Document pages"
  >
    <div className="document-page-navigation__tabs" role="tablist">
      {pages.map((page, index) => {
        const folio = getDocumentFolioNumber(startingFolio, index);
        const selected = index === activePageIndex;
        return (
          <button
            key={page.id}
            type="button"
            role="tab"
            className={selected ? 'is-selected' : ''}
            aria-selected={selected}
            aria-label={`Open ${page.name}, folio ${folio}`}
            data-testid={`document-page-tab-${index}`}
            onClick={() => onSelectPage(index)}
          >
            <span>{folio}</span>
            <small>{page.name}</small>
          </button>
        );
      })}
    </div>

    <div className="document-page-navigation__actions">
      <button
        type="button"
        data-testid="document-move-page-left"
        aria-label="Move page left"
        disabled={activePageIndex <= 0}
        onClick={() => onMovePage('left')}
      >
        <ChevronLeft size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        data-testid="document-move-page-right"
        aria-label="Move page right"
        disabled={activePageIndex >= pages.length - 1}
        onClick={() => onMovePage('right')}
      >
        <ChevronRight size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        data-testid="document-duplicate-page"
        onClick={onDuplicatePage}
      >
        <Copy size={14} aria-hidden="true" />
        Duplicate
      </button>
      <button
        type="button"
        data-testid="document-add-page"
        onClick={onAddPage}
      >
        <Plus size={14} aria-hidden="true" />
        Add page
      </button>
      <button
        type="button"
        data-testid="document-remove-page"
        aria-label="Remove current page"
        disabled={pages.length <= 1}
        onClick={onRemovePage}
      >
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </div>
  </nav>
);
