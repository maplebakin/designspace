import { useEffect, useRef, useState } from 'react';
import type { DocumentProjectPayload } from '../../editor/project/projectSchema';
import { mountCommittedDocumentExportPages } from './DocumentProjectExportRenderer';
import { documentExportService } from '../services/documentExportService';

export const DocumentReview = ({ project, onClose, onSelect }: {
  project: DocumentProjectPayload;
  onClose: () => void;
  onSelect: (index: number) => void;
}) => {
  const preview = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState('Preparing page previews…');
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    close.current?.focus();
    let cancelled = false;
    const urls: string[] = [];
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const buttons = [...(preview.current?.parentElement?.querySelectorAll<HTMLButtonElement>('button') || [])];
        const first = buttons[0]; const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    void (async () => {
      const mounted = await mountCommittedDocumentExportPages(project);
      try {
        for (let index = 0; index < mounted.sources.length; index += 1) {
          const source = mounted.sources[index];
          // Bitmap previews downsample thin writing rules consistently. CSS
          // transforms can make subpixel gradient rules vanish in thumbnails.
          const bitmap = await documentExportService.exportPngBlob(source.element, { ...source.options, dpi: 96 });
          if (cancelled) return;
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'document-review__page';
          button.setAttribute('aria-label', `Edit page ${index + 1}: ${project.pages[index].name}`);
          const sheet = document.createElement('img');
          const url = URL.createObjectURL(bitmap);
          urls.push(url);
          sheet.src = url;
          sheet.alt = '';
          sheet.width = Math.round(source.options.widthIn * 96 * 0.32);
          sheet.height = Math.round(source.options.heightIn * 96 * 0.32);
          button.append(sheet, document.createTextNode(`${index + 1}. ${project.pages[index].name}`));
          button.onclick = () => onSelect(index);
          preview.current?.append(button);
        }
        if (!cancelled) setStatus('Select a page to continue editing. Check wrapping, margins and writing space in both paper sizes.');
      } finally { mounted.cleanup(); }
    })().catch((error) => { if (!cancelled) setStatus(error instanceof Error ? error.message : 'Preview failed.'); });
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
      document.removeEventListener('keydown', keydown);
      previousFocus?.focus();
    };
    // Freeze this review at opening; editor changes resume after closing it.
  }, []);
  return <div className="document-review" role="dialog" aria-modal="true" aria-label="Review document" data-document-editor-ui="true">
    <div className="document-review__content">
      <button ref={close} type="button" onClick={onClose}>Close review</button>
      <h2>{project.projectName}</h2>
      <p role="status">{status}</p>
      <div ref={preview} className="document-review__grid" />
    </div>
  </div>;
};
