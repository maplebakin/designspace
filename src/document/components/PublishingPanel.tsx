import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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
  const [activeTab, setActiveTab] = useState<'document' | 'pages' | 'writing'>('pages');
  const [collapsed, setCollapsed] = useState(false);
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

  const applyPageSetupToAll = () => {
    flushDocumentLiveDrafts();
    const store = useDocumentStore.getState();
    if (!store.project) return;
    for (const target of store.project.pages) {
      const size = page.size.presetId === 'custom'
        ? { ...page.size }
        : {
            ...target.size,
            ...getDocumentPaperDimensions(page.size.presetId, target.size.orientation),
            presetId: page.size.presetId,
          };
      store.updatePage({ size, margins: { ...page.margins } }, target.id);
    }
    onCommit('modify-page-metadata', page.id);
    setStatus('This page’s paper size and margins were applied to every page. Review text wrapping before exporting.');
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

  const tabs = [
    { id: 'document', label: 'Document' },
    { id: 'pages', label: 'Pages' },
    { id: 'writing', label: 'Writing' },
  ] as const;

  return <aside
    className={`publishing-inspector${collapsed ? ' is-collapsed' : ''}`}
    data-document-editor-ui="true"
    data-testid="document-publishing-inspector"
    data-collapsed={collapsed ? 'true' : 'false'}
    aria-label="Publishing tools"
  >
    <header className="publishing-inspector__heading">
      {!collapsed && <div><strong>Publishing</strong><span>Document, pages and writing</span></div>}
      <button
        type="button"
        aria-label={collapsed ? 'Expand publishing tools' : 'Collapse publishing tools'}
        aria-controls="document-publishing-content"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((value) => !value)}
      >
        {collapsed ? <ChevronLeft size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
      </button>
      {collapsed && <span className="publishing-inspector__collapsed-label">Publishing</span>}
    </header>
    {!collapsed && <div id="document-publishing-content" className="publishing-inspector__content">
      <div className="publishing-inspector__tabs" role="tablist" aria-label="Publishing sections">
        {tabs.map((tab) => <button
          key={tab.id}
          type="button"
          role="tab"
          id={`publishing-tab-${tab.id}`}
          aria-selected={activeTab === tab.id}
          aria-controls="publishing-tabpanel"
          tabIndex={activeTab === tab.id ? 0 : -1}
          onClick={() => setActiveTab(tab.id)}
          onKeyDown={(event) => {
            const currentIndex = tabs.findIndex((item) => item.id === tab.id);
            const nextIndex = event.key === 'ArrowRight'
              ? (currentIndex + 1) % tabs.length
              : event.key === 'ArrowLeft'
                ? (currentIndex + tabs.length - 1) % tabs.length
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : -1;
            if (nextIndex < 0) return;
            event.preventDefault();
            const nextTab = tabs[nextIndex];
            setActiveTab(nextTab.id);
            window.requestAnimationFrame(() => {
              document.getElementById(`publishing-tab-${nextTab.id}`)?.focus();
            });
          }}
        >{tab.label}</button>)}
      </div>
      <div
        id="publishing-tabpanel"
        className="publishing-inspector__panel"
        role="tabpanel"
        aria-labelledby={`publishing-tab-${activeTab}`}
        data-testid={`publishing-tabpanel-${activeTab}`}
      >
        {activeTab === 'document' && <>
          <fieldset>
            <legend>Document styles</legend>
            <label>Headings <select aria-label="Publishing heading font" value={headingFont} onChange={(e) => setHeadingFont(e.target.value as typeof headingFont)}><option value="cinzel">Cinzel</option><option value="cormorant-garamond">Cormorant Garamond</option></select></label>
            <label>Body <select aria-label="Publishing body font" value={bodyFont} onChange={(e) => setBodyFont(e.target.value as typeof bodyFont)}><option value="cormorant-garamond">Cormorant Garamond</option><option value="cinzel">Cinzel</option></select></label>
            <label>Accent <input aria-label="Publishing accent" type="color" value={accent} onChange={(e) => setAccent(e.target.value)} /></label>
            <button type="button" onClick={applyTypography}>Apply document typography</button>
          </fieldset>
          <fieldset>
            <legend>Page setup</legend>
            <p>Choose paper size and margins in Page settings. Apply the current page setup across this document when you are ready to make an edition.</p>
            <button type="button" onClick={applyPageSetupToAll}>Apply current page setup to all pages</button>
          </fieldset>
          <fieldset>
            <legend>Proofing and export</legend>
            <button type="button" onClick={onReview}>Review all pages</button>
            <label className="publishing-inspector__checkbox"><input type="checkbox" checked={grayscale} onChange={(e) => onGrayscaleChange(e.target.checked)} /> Export in grayscale</label>
            <p>PDFs export in reading order. Folded booklet imposition is separate.</p>
          </fieldset>
        </>}
        {activeTab === 'pages' && <>
          <fieldset>
            <legend>Start with a page design</legend>
            <div className="publishing-inspector__buttons">{(['cover', 'guide', 'worksheet'] as const).map((design) => <button key={design} type="button" onClick={() => addDesign(design)}>Add {design} design</button>)}</div>
            <label>Page name <input aria-label="Publishing page name" value={page.name} onChange={(e) => {
              useDocumentStore.getState().updatePage({ name: e.target.value }, page.id);
            }} onBlur={() => onCommit('modify-page-metadata', page.id)} /></label>
            <button type="button" onClick={() => {
              useDocumentStore.getState().duplicatePage();
              const state = useDocumentStore.getState();
              const copy = state.project?.pages[state.project.activePageIndex || 0];
              if (copy) onCommit('add-page', copy.id);
            }}>Duplicate current page</button>
          </fieldset>
          <fieldset>
            <legend>Reusable layouts</legend>
            <label>Layout name <input aria-label="Saved layout name" value={layoutName} onChange={(e) => setLayoutName(e.target.value)} /></label>
            <button type="button" disabled={busy} onClick={() => void saveLayout()}>Save current page as layout</button>
            <label>Saved layouts <select aria-label="Saved page layouts" value={selectedLayout} onChange={(e) => setSelectedLayout(e.target.value)}><option value="">Choose a layout</option>{layouts.map((layout) => <option key={layout.id} value={layout.id}>{layout.name}</option>)}</select></label>
            <div className="publishing-inspector__buttons">
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
        </>}
        {activeTab === 'writing' && <>
          <fieldset>
            <legend>Writing area</legend>
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
          </fieldset>
          <fieldset>
            <legend>Selected text block</legend>
            <label>Space before block (px) <input aria-label="Space before text block" type="number" min="0" max="720" value={spaceBefore} onChange={(e) => setSpaceBefore(Number(e.target.value))} /></label>
            <label>Space after block (px) <input aria-label="Space after text block" type="number" min="0" max="720" value={spaceAfter} onChange={(e) => setSpaceAfter(Number(e.target.value))} /></label>
            <button type="button" onClick={() => {
              getTextEditor()?.chain().focus().updateAttributes('paragraph', {
                documentSpaceBeforePx: spaceBefore, documentSpaceAfterPx: spaceAfter,
              }).run();
              flushDocumentLiveDrafts();
              setStatus('Selected text block spacing updated.');
            }}>Set selected block spacing</button>
            <p>Import botanical artwork with Add photo. Select it on the page to use its position, size and placement controls.</p>
          </fieldset>
        </>}
        <p className="publishing-inspector__status" role="status">{status}</p>
      </div>
    </div>}
  </aside>;
};
