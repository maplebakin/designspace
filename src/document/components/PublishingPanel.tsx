import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { DocumentProjectPayload } from '../../editor/project/projectSchema';
import { useDocumentStore } from '../state/documentStore';
import { flushDocumentLiveDrafts } from '../services/documentLiveDraft';
import { publishingPageDesign, publishingTypography, type PublishingPageDesign } from '../model/publishing';
import { getDocumentPaperDimensions } from '../utils/documentPageOrientation';
import { hasMeaningfulDocumentContent } from './DocumentPageView';
import { DOCUMENT_STYLE_IDS } from '../typography/documentTypography';
import { normalizeWritingAttributes } from '../model/documentWriting';
import {
  createDocumentLayout, deleteDocumentLayout, listDocumentLayouts, saveDocumentLayout,
  type DocumentLayoutRecord,
} from '../services/documentLayoutService';

type Props = {
  project: DocumentProjectPayload;
  getBodyEditor: () => Editor | null;
  getTextEditor: () => Editor | null;
  onCommit: (action: 'modify-document-style-metadata' | 'modify-page-metadata' | 'add-page', pageId: string) => void;
  onReview: () => void;
  grayscale: boolean;
  onGrayscaleChange: (value: boolean) => void;
};

export const PublishingPanel = ({ project, getBodyEditor, getTextEditor, onCommit, onReview, grayscale, onGrayscaleChange }: Props) => {
  const page = project.pages[project.activePageIndex || 0];
  const [paper, setPaper] = useState<'letter' | 'a4'>(page.size.presetId === 'a4' ? 'a4' : 'letter');
  const [margin, setMargin] = useState(0.65);
  const [accent, setAccent] = useState('#713B59');
  const [headingFont, setHeadingFont] = useState<'cinzel' | 'cormorant-garamond'>('cinzel');
  const [bodyFont, setBodyFont] = useState<'cinzel' | 'cormorant-garamond'>('cormorant-garamond');
  const [rows, setRows] = useState(12);
  const [spacing, setSpacing] = useState(32);
  const [ruleColor, setRuleColor] = useState('#9A8B94');
  const [spaceBefore, setSpaceBefore] = useState(0);
  const [spaceAfter, setSpaceAfter] = useState(0);
  const [layoutName, setLayoutName] = useState('My page design');
  const [layouts, setLayouts] = useState<DocumentLayoutRecord[]>([]);
  const [selectedLayout, setSelectedLayout] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listDocumentLayouts().then((records) => { if (!cancelled) setLayouts(records); })
      .catch(() => { if (!cancelled) setStatus('Saved layouts are unavailable. Page duplication still works.'); });
    return () => { cancelled = true; };
  }, []);

  const addDesign = (design: PublishingPageDesign) => {
    flushDocumentLiveDrafts();
    const store = useDocumentStore.getState();
    const current = store.project;
    if (!current) return;
    const active = current.pages[current.activePageIndex || 0];
    const empty = !hasMeaningfulDocumentContent(active.titleContent)
      && !hasMeaningfulDocumentContent(active.bodyContent) && active.overlayObjects.length === 0;
    if (!empty) store.addPage();
    const next = useDocumentStore.getState();
    const target = next.project?.pages[next.project.activePageIndex || 0];
    if (!target) return;
    next.updatePage(publishingPageDesign(design), target.id);
    onCommit(empty ? 'modify-page-metadata' : 'add-page', target.id);
    setStatus('Page design added. Edit its title and text directly on the page.');
  };

  const applySetup = () => {
    flushDocumentLiveDrafts();
    const store = useDocumentStore.getState();
    const current = store.project;
    if (!current || !Number.isFinite(margin) || margin < 0.25 || margin > 2) {
      setStatus('Choose a margin between 0.25 and 2 inches.');
      return;
    }
    for (const target of current.pages) {
      const size = getDocumentPaperDimensions(paper, target.size.orientation);
      store.updatePage({
        size: { ...target.size, ...size, presetId: paper },
        margins: { topIn: margin, bottomIn: margin, innerIn: margin, outerIn: margin },
      }, target.id);
    }
    store.updateDocumentBackground('#FFFFFF');
    onCommit('modify-page-metadata', page.id);
    setStatus('Paper and margins applied to every page. Review wrapping before exporting this edition.');
  };

  const applyTypography = () => {
    flushDocumentLiveDrafts();
    const store = useDocumentStore.getState();
    if (!store.project) return;
    const styles = publishingTypography(store.project.document.styles, headingFont, bodyFont, accent);
    for (const id of DOCUMENT_STYLE_IDS) store.updateDocumentStyle(id, styles[id]);
    onCommit('modify-document-style-metadata', page.id);
    setStatus('Document styles updated. Individual text overrides remain editable in the toolbar.');
  };

  const writingAttrs = () => normalizeWritingAttributes({ documentWritingRows: rows, documentWritingSpacing: spacing, documentRuleColor: ruleColor });
  const insertBlock = (divider: boolean) => {
    const editor = getBodyEditor();
    if (!editor || editor.isDestroyed) return;
    if (!divider && (!Number.isFinite(rows) || rows < 1 || rows > 30 || !Number.isFinite(spacing) || spacing < 20 || spacing > 64)) {
      setStatus('Choose 1–30 lines and spacing between 20 and 64 pixels.'); return;
    }
    const attrs = divider ? { documentDivider: true, documentRuleColor: accent } : writingAttrs();
    editor.chain().focus().insertContent([
      { type: 'paragraph', attrs }, { type: 'paragraph' },
    ]).run();
    flushDocumentLiveDrafts();
    setStatus(divider ? 'Divider inserted in the body.' : 'Writing area inserted. Click inside it to edit or update its rules.');
  };

  const saveLayout = async () => {
    flushDocumentLiveDrafts();
    const store = useDocumentStore.getState();
    if (!store.project) return;
    setBusy(true);
    try {
      await saveDocumentLayout(createDocumentLayout(store.project, store.project.activePageIndex || 0, layoutName));
      setLayouts(await listDocumentLayouts());
      setStatus('Layout saved to this device. It includes editable content and imported artwork; inserted copies use the destination document styles.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Layout could not be saved.');
    } finally { setBusy(false); }
  };

  return <details className="publishing-panel" data-document-editor-ui="true">
    <summary>Publishing <span>Paper · styles · page designs · writing areas · review</span></summary>
    <div className="publishing-panel__grid">
      <fieldset>
        <legend>Document setup</legend>
        <label>Paper <select aria-label="Publishing paper" value={paper} onChange={(e) => setPaper(e.target.value as typeof paper)}>
          <option value="letter">US Letter</option><option value="a4">A4</option>
        </select></label>
        <label>Margins (inches) <input aria-label="Publishing margins" type="number" min="0.25" max="2" step="0.05" value={margin} onChange={(e) => setMargin(Number(e.target.value))} /></label>
        <button type="button" onClick={applySetup}>Apply paper to all pages</button>
        <label>Headings <select aria-label="Publishing heading font" value={headingFont} onChange={(e) => setHeadingFont(e.target.value as typeof headingFont)}><option value="cinzel">Cinzel</option><option value="cormorant-garamond">Cormorant Garamond</option></select></label>
        <label>Body <select aria-label="Publishing body font" value={bodyFont} onChange={(e) => setBodyFont(e.target.value as typeof bodyFont)}><option value="cormorant-garamond">Cormorant Garamond</option><option value="cinzel">Cinzel</option></select></label>
        <label>Accent <input aria-label="Publishing accent" type="color" value={accent} onChange={(e) => setAccent(e.target.value)} /></label>
        <button type="button" onClick={applyTypography}>Apply document typography</button>
      </fieldset>
      <fieldset>
        <legend>Reusable page designs</legend>
        <div className="publishing-panel__buttons">{(['cover', 'guide', 'worksheet'] as const).map((design) => <button key={design} type="button" onClick={() => addDesign(design)}>Add {design} design</button>)}</div>
        <label>Page name <input aria-label="Publishing page name" value={page.name} onChange={(e) => {
          useDocumentStore.getState().updatePage({ name: e.target.value }, page.id);
        }} onBlur={() => onCommit('modify-page-metadata', page.id)} /></label>
        <button type="button" onClick={() => {
          useDocumentStore.getState().duplicatePage();
          const state = useDocumentStore.getState();
          const copy = state.project?.pages[state.project.activePageIndex || 0];
          if (copy) onCommit('add-page', copy.id);
        }}>Duplicate current design</button>
        <label>Layout name <input aria-label="Saved layout name" value={layoutName} onChange={(e) => setLayoutName(e.target.value)} /></label>
        <button type="button" disabled={busy} onClick={() => void saveLayout()}>Save current page as layout</button>
        <label>Saved layouts <select aria-label="Saved page layouts" value={selectedLayout} onChange={(e) => setSelectedLayout(e.target.value)}><option value="">Choose a layout</option>{layouts.map((layout) => <option key={layout.id} value={layout.id}>{layout.name}</option>)}</select></label>
        <div className="publishing-panel__buttons">
          <button type="button" disabled={!selectedLayout} onClick={() => {
            const layout = layouts.find((item) => String(item.id) === selectedLayout);
            if (!layout) return;
            useDocumentStore.getState().insertPageLayout(layout.payload);
            const store = useDocumentStore.getState();
            const added = store.project?.pages[store.project.activePageIndex || 0];
            if (added) onCommit('add-page', added.id);
          }}>Insert saved layout</button>
          <button type="button" disabled={!selectedLayout || busy} onClick={async () => {
            setBusy(true);
            try {
              await deleteDocumentLayout(Number(selectedLayout));
              setLayouts(await listDocumentLayouts()); setSelectedLayout('');
            } catch { setStatus('The layout could not be removed.'); }
            finally { setBusy(false); }
          }}>Remove saved layout</button>
        </div>
      </fieldset>
      <fieldset>
        <legend>Worksheet elements</legend>
        <label>Writing lines <input aria-label="Writing line count" type="number" min="1" max="30" value={rows} onChange={(e) => setRows(Number(e.target.value))} /></label>
        <label>Line spacing (px) <input aria-label="Writing line spacing" type="number" min="20" max="64" value={spacing} onChange={(e) => setSpacing(Number(e.target.value))} /></label>
        <label>Rule colour <input aria-label="Writing rule colour" type="color" value={ruleColor} onChange={(e) => setRuleColor(e.target.value)} /></label>
        <button type="button" onClick={() => insertBlock(false)}>Insert ruled writing area</button>
        <button type="button" onClick={() => {
          const editor = getBodyEditor();
          if (!editor?.getAttributes('paragraph').documentWritingRows) {
            setStatus('Click inside a writing area first.'); return;
          }
          editor.chain().focus().updateAttributes('paragraph', writingAttrs()).run();
          flushDocumentLiveDrafts();
          setStatus('Selected writing area updated.');
        }}>Update selected writing area</button>
        <button type="button" onClick={() => insertBlock(true)}>Insert decorative divider</button>
        <label>Space before block (px) <input aria-label="Space before text block" type="number" min="0" max="720" value={spaceBefore} onChange={(e) => setSpaceBefore(Number(e.target.value))} /></label>
        <label>Space after block (px) <input aria-label="Space after text block" type="number" min="0" max="720" value={spaceAfter} onChange={(e) => setSpaceAfter(Number(e.target.value))} /></label>
        <button type="button" onClick={() => {
          getTextEditor()?.chain().focus().updateAttributes('paragraph', {
            documentSpaceBeforePx: spaceBefore, documentSpaceAfterPx: spaceAfter,
          }).run();
          flushDocumentLiveDrafts();
          setStatus('Selected text block spacing updated.');
        }}>Set selected block spacing</button>
        <p>Import botanical artwork with the image tools. Use the image inspector for position, size and placement.</p>
        <button type="button" onClick={onReview}>Review all pages</button>
        <label><input type="checkbox" checked={grayscale} onChange={(e) => onGrayscaleChange(e.target.checked)} /> Export in grayscale</label>
        <p>Paper changes reflow text. Review each edition. PDFs export in reading order; folded booklet imposition is separate.</p>
      </fieldset>
    </div>
    <p className="publishing-panel__status" role="status">{status}</p>
  </details>;
};
