import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Editor, JSONContent } from '@tiptap/core';
import { v4 as uuidv4 } from 'uuid';
import { useDocumentStore } from '../state/documentStore';
import type {
  DocumentFlowImageWrap,
  DocumentOverlayImage,
  ScanReference,
} from '../types/documentProject';
import {
  ingestDocumentImage,
  isSafeDocumentImageSource,
  type DocumentAsset,
} from '../services/documentAssetService';
import { ingestImageFromClipboardEvent } from '../services/documentClipboardService';
import { ingestDocumentReference } from '../services/documentReferenceService';
import { documentExportService } from '../services/documentExportService';
import {
  canMoveSelectedStructuredImage,
  type DocumentImageAttributes,
  type DocumentImageMoveDirection,
  type DocumentImageReplaceRequest,
} from '../extensions/DocumentImageExtension';
import {
  documentPixelsToPoints,
  documentPointsToPixels,
  normalizeDocumentFontSize,
} from '../extensions/DocumentTextStyleExtension';
import {
  normalizeDocumentBlockStyleId,
  type DocumentBlockStyleId,
} from '../extensions/DocumentBlockStyleExtension';
import {
  FlowEditor,
  type DocumentDropContext,
  type SelectedDocumentImage,
} from './FlowEditor';
import {
  TitleEditor,
  type DocumentEditorRegion,
} from './TitleEditor';
import { DocumentPageView } from './DocumentPageView';
import { DocumentPageNavigation } from './DocumentPageNavigation';
import {
  mountCommittedDocumentExportPages,
} from './DocumentProjectExportRenderer';
import {
  DocumentToolbar,
  type DocumentImageLayoutMode,
  type DocumentImageInspectorValue,
  type DocumentTextFormatState,
} from './DocumentToolbar';
import { DocumentTopBar } from './DocumentTopBar';
import { DocumentSidebar } from './DocumentSidebar';
import { DocumentZoomControls } from './DocumentZoomControls';
import { calculateFitPageZoom } from '../utils/documentViewport';
import {
  constrainDocumentPageMargins,
  updateDocumentPagePaper,
  type DocumentPageOrientation,
} from '../utils/documentPageOrientation';
import { DEFAULT_DOCUMENT_PAPER_COLOR } from '../utils/documentColor';
import {
  getDocumentFolioNumber,
  resolveDocumentPhysicalMargins,
} from '../layout/pageGeometry';
import {
  getDocumentTypographyCssVariables,
} from '../typography/documentTypographyCss';
import type {
  DocumentNamedStyleRegistry,
} from '../typography/documentTypography';
import '../styles/document-page.css';
import '../styles/document-print.css';

type DocumentEditorShellProps = {
  onBackToDashboard?: () => void;
};

const isImageClipboardPaste = (event: ClipboardEvent) => {
  const data = event.clipboardData;
  if (!data) return false;
  if (Array.from(data.items || []).some(
    (item) => item.kind === 'file' && item.type.startsWith('image/')
  )) {
    return true;
  }
  const html = data.getData('text/html');
  if (!html || typeof DOMParser === 'undefined') return false;
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(parsed.querySelectorAll('img[src]')).some((image) =>
    isSafeDocumentImageSource(image.getAttribute('src')?.trim() || '')
  );
};

const getInitialImageWidth = (
  asset: DocumentAsset,
  availableColumnWidth: number
) => Math.max(80, Math.min(asset.naturalWidth, availableColumnWidth * 0.82, 340));

const DEFAULT_TEXT_FORMAT_STATE: DocumentTextFormatState = {
  bold: false,
  italic: false,
  underline: false,
  alignment: 'left',
  fontSizePt: documentPixelsToPoints(14),
  blockStyleId: 'body',
};

const readSelectionFontSize = (
  editor: Editor,
  defaultFontSizePx: number
): number | 'mixed' => {
  const { selection, storedMarks } = editor.state;
  if (selection.empty) {
    const activeAttributes = editor.getAttributes('documentTextStyle');
    const activeFontSizePx = normalizeDocumentFontSize(
      activeAttributes.fontSizePx
    );
    if (activeFontSizePx !== null) {
      return documentPixelsToPoints(activeFontSizePx);
    }
    const cursorMark = (storedMarks || selection.$from.marks())
      .find((mark) => mark.type.name === 'documentTextStyle');
    const cursorFontSizePx = normalizeDocumentFontSize(
      cursorMark?.attrs.fontSizePx
    );
    return documentPixelsToPoints(cursorFontSizePx ?? defaultFontSizePx);
  }

  const fontSizes = new Set<number>();
  editor.state.doc.nodesBetween(selection.from, selection.to, (node) => {
    if (!node.isText) return;
    const mark = node.marks.find(
      (candidate) => candidate.type.name === 'documentTextStyle'
    );
    const fontSizePx = normalizeDocumentFontSize(mark?.attrs.fontSizePx);
    fontSizes.add(documentPixelsToPoints(fontSizePx ?? defaultFontSizePx));
  });
  if (fontSizes.size > 1) return 'mixed';
  return fontSizes.values().next().value
    ?? documentPixelsToPoints(defaultFontSizePx);
};

const readTextFormatState = (
  editor: Editor,
  styles: DocumentNamedStyleRegistry,
  defaultBlockStyleId: DocumentBlockStyleId
): DocumentTextFormatState => {
  const paragraphAttributes = editor.getAttributes('paragraph');
  const blockStyleId = normalizeDocumentBlockStyleId(
    paragraphAttributes.documentStyleId,
    defaultBlockStyleId
  );
  const paragraphAlignment = paragraphAttributes.textAlign;
  const alignment =
    paragraphAlignment === 'left'
    || paragraphAlignment === 'center'
    || paragraphAlignment === 'right'
    || paragraphAlignment === 'justify'
      ? paragraphAlignment
      : styles[blockStyleId].alignment;
  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    underline: editor.isActive('underline'),
    alignment,
    fontSizePt: readSelectionFontSize(
      editor,
      styles[blockStyleId].fontSizePx
    ),
    blockStyleId,
  };
};

export const DocumentEditorShell: React.FC<DocumentEditorShellProps> = ({
  onBackToDashboard,
}) => {
  const project = useDocumentStore((state) => state.project);
  const saveStatus = useDocumentStore((state) => state.saveStatus);
  const zoom = useDocumentStore((state) => state.zoom);
  const isReferenceAdjustMode = useDocumentStore((state) => state.isReferenceAdjustMode);
  const selectedOverlayId = useDocumentStore((state) => state.selectedOverlayId);
  const isOverflowing = useDocumentStore((state) => state.isOverflowing);
  const toastMessage = useDocumentStore((state) => state.toastMessage);
  const updatePage = useDocumentStore((state) => state.updatePage);
  const updateDocumentBackground = useDocumentStore(
    (state) => state.updateDocumentBackground
  );
  const updateDocumentLanguage = useDocumentStore(
    (state) => state.updateDocumentLanguage
  );
  const updateDocumentStyle = useDocumentStore(
    (state) => state.updateDocumentStyle
  );
  const updatePageLanguage = useDocumentStore(
    (state) => state.updatePageLanguage
  );
  const updateDropCap = useDocumentStore((state) => state.updateDropCap);
  const updateFolioSettings = useDocumentStore(
    (state) => state.updateFolioSettings
  );
  const selectPage = useDocumentStore((state) => state.selectPage);
  const addPage = useDocumentStore((state) => state.addPage);
  const duplicatePage = useDocumentStore((state) => state.duplicatePage);
  const removePage = useDocumentStore((state) => state.removePage);
  const reorderPages = useDocumentStore((state) => state.reorderPages);
  const updateTitleContent = useDocumentStore((state) => state.updateTitleContent);
  const updateBodyContent = useDocumentStore((state) => state.updateBodyContent);
  const addAsset = useDocumentStore((state) => state.addAsset);
  const addOverlay = useDocumentStore((state) => state.addOverlay);
  const updateOverlay = useDocumentStore((state) => state.updateOverlay);
  const removeOverlay = useDocumentStore((state) => state.removeOverlay);
  const setReference = useDocumentStore((state) => state.setReference);
  const setZoom = useDocumentStore((state) => state.setZoom);
  const setReferenceAdjustMode = useDocumentStore((state) => state.setReferenceAdjustMode);
  const setSelectedOverlayId = useDocumentStore((state) => state.setSelectedOverlayId);
  const setSelectedFlowImageId = useDocumentStore((state) => state.setSelectedFlowImageId);
  const setOverflowing = useDocumentStore((state) => state.setOverflowing);
  const setToastMessage = useDocumentStore((state) => state.setToastMessage);
  const renameProject = useDocumentStore((state) => state.renameProject);
  const saveProject = useDocumentStore((state) => state.saveProject);
  const downloadProjectFile = useDocumentStore((state) => state.downloadProjectFile);

  const titleEditorRef = useRef<Editor | null>(null);
  const bodyEditorRef = useRef<Editor | null>(null);
  const exportRootRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const nodeReplaceInputRef = useRef<HTMLInputElement | null>(null);
  const pendingNodeReplaceRef = useRef<DocumentImageReplaceRequest | null>(null);
  const [activeTextRegion, setActiveTextRegion] =
    useState<DocumentEditorRegion>('body');
  const [selectedFlowImage, setSelectedFlowImage] =
    useState<SelectedDocumentImage | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [fitMode, setFitMode] = useState(true);
  const [textFormatState, setTextFormatState] =
    useState<DocumentTextFormatState>(DEFAULT_TEXT_FORMAT_STATE);

  const activePageIndex = project
    ? Math.max(
        0,
        Math.min(
          project.pages.length - 1,
          Math.trunc(project.activePageIndex ?? 0)
        )
      )
    : 0;
  const page = project?.pages[activePageIndex];
  const paperColor = project?.document.background?.value
    || DEFAULT_DOCUMENT_PAPER_COLOR;
  const folios = project?.document.folios;
  const folioNumber = folios
    ? getDocumentFolioNumber(folios.startingNumber, activePageIndex)
    : activePageIndex + 1;
  const physicalMargins = page
    ? resolveDocumentPhysicalMargins(page.margins, folioNumber)
    : null;
  const previousPageIdRef = useRef(page?.id);
  const assetSources = useMemo(() => project?.assets || {}, [project?.assets]);
  const typographyStyle = useMemo(
    () => (
      project && page
        ? getDocumentTypographyCssVariables(
            project.document.styles,
            page.dropCap
          )
        : {}
    ),
    [page, project]
  );

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(null), 4500);
    return () => window.clearTimeout(timer);
  }, [setToastMessage, toastMessage]);

  useEffect(() => {
    if (previousPageIdRef.current === page?.id) return;
    previousPageIdRef.current = page?.id;
    titleEditorRef.current = null;
    bodyEditorRef.current = null;
    setSelectedFlowImage(null);
    setSelectedFlowImageId(null);
    setSelectedOverlayId(null);
    setReferenceAdjustMode(false);
    setTextFormatState(DEFAULT_TEXT_FORMAT_STATE);
  }, [
    page?.id,
    setReferenceAdjustMode,
    setSelectedFlowImageId,
    setSelectedOverlayId,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editable = target instanceof HTMLElement
        && (
          target.isContentEditable
          || target.tagName === 'INPUT'
          || target.tagName === 'TEXTAREA'
          || target.tagName === 'SELECT'
        );
      const isMeta = event.metaKey || event.ctrlKey;
      if (isMeta && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveProject();
        return;
      }
      if (editable) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedOverlayId) {
        event.preventDefault();
        removeOverlay(selectedOverlayId);
        return;
      }
      if (event.key === 'Escape') {
        setSelectedOverlayId(null);
        setSelectedFlowImage(null);
        setSelectedFlowImageId(null);
        setReferenceAdjustMode(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    removeOverlay,
    saveProject,
    selectedOverlayId,
    setReferenceAdjustMode,
    setSelectedFlowImageId,
    setSelectedOverlayId,
  ]);

  const availableColumnWidth = useMemo(() => {
    if (!page || !physicalMargins) return 320;
    const bodyWidth = (
      page.size.widthIn
      - physicalMargins.leftIn
      - physicalMargins.rightIn
    ) * 96;
    return (
      bodyWidth - page.columnGapPx * (page.columnCount - 1)
    ) / page.columnCount;
  }, [page, physicalMargins]);

  const insertAssetIntoBody = useCallback((
    asset: DocumentAsset,
    position?: number,
    wrap: DocumentFlowImageWrap = 'float-left'
  ) => {
    const editor = bodyEditorRef.current;
    if (!editor || editor.isDestroyed) {
      setToastMessage('The document body is still initializing.');
      return;
    }
    addAsset(asset.id, asset.source);
    const widthPx = getInitialImageWidth(asset, availableColumnWidth);
    const heightPx = widthPx * asset.naturalHeight / asset.naturalWidth;
    editor.commands.insertDocumentImage({
      id: uuidv4(),
      assetId: asset.id,
      altText: '',
      widthPx,
      heightPx,
      naturalWidth: asset.naturalWidth,
      naturalHeight: asset.naturalHeight,
      wrap,
      wrapPaddingPx: 12,
      caption: '',
      captionAlignment: 'inherit',
      captionItalic: 'inherit',
      captionSpacingPx: 'inherit',
    }, position);
    editor.commands.focus();
  }, [addAsset, availableColumnWidth, setToastMessage]);

  const importImages = useCallback(async (
    files: File[],
    position?: number
  ) => {
    let nextPosition = position;
    for (const file of files) {
      try {
        const asset = await ingestDocumentImage(file);
        insertAssetIntoBody(asset, nextPosition);
        nextPosition = undefined;
      } catch (error) {
        setToastMessage(error instanceof Error ? error.message : 'Could not import that image.');
      }
    }
  }, [insertAssetIntoBody, setToastMessage]);

  const handlePasteDispatch = useCallback((
    event: ClipboardEvent,
    _editor: Editor,
    _region: DocumentEditorRegion
  ) => {
    if (!isImageClipboardPaste(event)) return false;
    void ingestImageFromClipboardEvent(event)
      .then((result) => {
        if (result.handled) {
          insertAssetIntoBody(result.asset);
        } else if (result.reason !== 'duplicate') {
          setToastMessage('That clipboard image format is not supported.');
        }
      })
      .catch((error) => {
        setToastMessage(error instanceof Error ? error.message : 'Could not paste that image.');
      });
    return true;
  }, [insertAssetIntoBody, setToastMessage]);

  const handleDropDispatch = useCallback((
    event: DragEvent,
    _editor: Editor,
    context: DocumentDropContext
  ) => {
    if (context.moved) return false;
    const files = Array.from(event.dataTransfer?.files || [])
      .filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) return false;
    void importImages(files, context.position);
    return true;
  }, [importImages]);

  const handleReferenceImport = useCallback(async (file: File) => {
    try {
      const asset = await ingestDocumentReference(file);
      addAsset(asset.id, asset.source);
      setReference({
        assetId: asset.id,
        sourceType: file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
          ? 'pdf'
          : 'image',
        opacity: 0.35,
        fit: 'contain',
        scale: 1,
        offsetXPx: 0,
        offsetYPx: 0,
        visible: true,
        locked: true,
      });
      setReferenceAdjustMode(false);
      setToastMessage('Reference page added. It will never be included in exports.');
    } catch (error) {
      setToastMessage(error instanceof Error ? error.message : 'Could not import the reference.');
    }
  }, [
    addAsset,
    setReference,
    setReferenceAdjustMode,
    setToastMessage,
  ]);

  const updateActiveTextFormatState = useCallback((
    editor: Editor,
    region: DocumentEditorRegion
  ) => {
    setActiveTextRegion(region);
    if (!project) return;
    setTextFormatState(readTextFormatState(
      editor,
      project.document.styles,
      region === 'title' ? 'article-title' : 'body'
    ));
  }, [project]);

  const handleFormat = useCallback((
    command:
      | 'bold'
      | 'italic'
      | 'underline'
      | 'undo'
      | 'redo'
      | 'align-left'
      | 'align-center'
      | 'align-right'
      | 'align-justify'
  ) => {
    const editor = activeTextRegion === 'title'
      ? titleEditorRef.current
      : bodyEditorRef.current;
    if (!editor || editor.isDestroyed) return;
    const chain = editor.chain().focus();
    if (command === 'bold') chain.toggleBold().run();
    if (command === 'italic') chain.toggleItalic().run();
    if (command === 'underline') chain.toggleUnderline().run();
    if (command === 'undo') chain.undo().run();
    if (command === 'redo') chain.redo().run();
    if (command === 'align-left') chain.setDocumentTextAlign('left').run();
    if (command === 'align-center') chain.setDocumentTextAlign('center').run();
    if (command === 'align-right') chain.setDocumentTextAlign('right').run();
    if (command === 'align-justify') chain.setDocumentTextAlign('justify').run();
    if (project) {
      setTextFormatState(readTextFormatState(
        editor,
        project.document.styles,
        activeTextRegion === 'title' ? 'article-title' : 'body'
      ));
    }
  }, [activeTextRegion, project]);

  const handleFontSizeChange = useCallback((fontSizePt: number) => {
    const editor = activeTextRegion === 'title'
      ? titleEditorRef.current
      : bodyEditorRef.current;
    if (!editor || editor.isDestroyed) return;
    editor.chain()
      .focus()
      .setDocumentFontSize(documentPointsToPixels(fontSizePt))
      .run();
    if (project) {
      setTextFormatState(readTextFormatState(
        editor,
        project.document.styles,
        activeTextRegion === 'title' ? 'article-title' : 'body'
      ));
    }
  }, [activeTextRegion, project]);

  const handleBlockStyleChange = useCallback((
    styleId: DocumentBlockStyleId
  ) => {
    const editor = bodyEditorRef.current;
    if (!editor || editor.isDestroyed) return;
    editor.chain().focus().setDocumentBlockStyle(styleId).run();
    if (project) {
      setTextFormatState(readTextFormatState(
        editor,
        project.document.styles,
        styleId
      ));
    }
  }, [project]);

  const selectedOverlay = page?.overlayObjects.find(
    (object) => object.id === selectedOverlayId
  ) || null;
  const canSelectedImageSpan = (() => {
    const editor = bodyEditorRef.current;
    if (!editor) return true;
    let otherSpanExists = false;
    editor.state.doc.descendants((node) => {
      if (
        node.type.name === 'documentFlowImage'
        && node.attrs.wrap === 'span-columns'
        && node.attrs.id !== selectedFlowImage?.attributes.id
      ) {
        otherSpanExists = true;
        return false;
      }
      return !otherSpanExists;
    });
    return !otherSpanExists;
  })();
  const selectedInspector: DocumentImageInspectorValue | null =
    selectedFlowImage
      ? {
          id: selectedFlowImage.attributes.id,
          kind: 'flow',
          widthPx: selectedFlowImage.attributes.widthPx,
          heightPx: selectedFlowImage.attributes.heightPx,
          wrap: selectedFlowImage.attributes.wrap,
          wrapPaddingPx: selectedFlowImage.attributes.wrapPaddingPx,
          verticalSpacingPx: selectedFlowImage.attributes.verticalSpacingPx,
          verticalAnchor: selectedFlowImage.attributes.verticalAnchor,
          yPx: selectedFlowImage.attributes.yPx,
          horizontalPlacement:
            selectedFlowImage.attributes.horizontalPlacement,
          xOffsetPx: selectedFlowImage.attributes.xOffsetPx,
          spanCount: selectedFlowImage.attributes.spanCount,
          spanStartColumn: selectedFlowImage.attributes.spanStartColumn,
          caption: selectedFlowImage.attributes.caption,
          captionAlignment:
            selectedFlowImage.attributes.captionAlignment,
          captionItalic: selectedFlowImage.attributes.captionItalic,
          captionSpacingPx:
            selectedFlowImage.attributes.captionSpacingPx,
          altText: selectedFlowImage.attributes.altText,
          naturalWidth: selectedFlowImage.attributes.naturalWidth,
          naturalHeight: selectedFlowImage.attributes.naturalHeight,
          canSpanColumns: canSelectedImageSpan,
          canMoveEarlier:
            selectedFlowImage.attributes.wrap === 'span-columns'
            && !!bodyEditorRef.current
            && canMoveSelectedStructuredImage(
              bodyEditorRef.current.state,
              'earlier'
            ),
          canMoveLater:
            selectedFlowImage.attributes.wrap === 'span-columns'
            && !!bodyEditorRef.current
            && canMoveSelectedStructuredImage(
              bodyEditorRef.current.state,
              'later'
            ),
        }
      : selectedOverlay
        ? {
            id: selectedOverlay.id,
            kind: 'overlay',
            widthPx: selectedOverlay.widthPx,
            heightPx: selectedOverlay.heightPx,
            xPx: selectedOverlay.xPx,
            yPx: selectedOverlay.yPx,
            wrap: selectedOverlay.placement,
            caption: selectedOverlay.caption || '',
            captionAlignment:
              selectedOverlay.captionAlignment === 'inherit'
              || selectedOverlay.captionAlignment === 'left'
              || selectedOverlay.captionAlignment === 'center'
              || selectedOverlay.captionAlignment === 'right'
                ? selectedOverlay.captionAlignment
                : 'inherit',
            captionItalic:
              typeof selectedOverlay.captionItalic === 'boolean'
              || selectedOverlay.captionItalic === 'inherit'
                ? selectedOverlay.captionItalic
                : 'inherit',
            captionSpacingPx:
              selectedOverlay.captionSpacingPx === 'inherit'
                ? 'inherit'
                : Number.isFinite(selectedOverlay.captionSpacingPx)
                  ? Math.min(
                      96,
                      Math.max(0, Number(selectedOverlay.captionSpacingPx))
                    )
                  : 'inherit',
            altText: selectedOverlay.altText,
            naturalWidth: selectedOverlay.naturalWidth,
            naturalHeight: selectedOverlay.naturalHeight,
            canSpanColumns: canSelectedImageSpan,
          }
        : null;

  const updateSelectedImage = useCallback((
    update: Partial<DocumentImageInspectorValue>
  ) => {
    if (selectedFlowImage) {
      const editor = bodyEditorRef.current;
      if (!editor) return;
      const next: Partial<DocumentImageAttributes> = {
        ...(typeof update.caption === 'string' ? { caption: update.caption } : {}),
        ...(update.captionAlignment === 'inherit'
          || update.captionAlignment === 'left'
          || update.captionAlignment === 'center'
          || update.captionAlignment === 'right'
          ? { captionAlignment: update.captionAlignment }
          : {}),
        ...(typeof update.captionItalic === 'boolean'
          || update.captionItalic === 'inherit'
          ? { captionItalic: update.captionItalic }
          : {}),
        ...(update.captionSpacingPx === 'inherit'
          ? { captionSpacingPx: 'inherit' }
          : typeof update.captionSpacingPx === 'number'
          ? {
              captionSpacingPx: Math.min(
                96,
                Math.max(0, update.captionSpacingPx)
              ),
            }
          : {}),
        ...(typeof update.altText === 'string' ? { altText: update.altText } : {}),
        ...(typeof update.wrapPaddingPx === 'number'
          ? { wrapPaddingPx: update.wrapPaddingPx }
          : {}),
        ...(typeof update.verticalSpacingPx === 'number'
          ? { verticalSpacingPx: update.verticalSpacingPx }
          : {}),
        ...(update.verticalAnchor === 'flow'
          || update.verticalAnchor === 'page-position'
          ? { verticalAnchor: update.verticalAnchor }
          : {}),
        ...(typeof update.yPx === 'number' ? { yPx: update.yPx } : {}),
        ...(update.horizontalPlacement === 'left'
          || update.horizontalPlacement === 'center'
          || update.horizontalPlacement === 'right'
          || update.horizontalPlacement === 'custom'
          ? { horizontalPlacement: update.horizontalPlacement }
          : {}),
        ...(typeof update.xOffsetPx === 'number'
          ? { xOffsetPx: update.xOffsetPx }
          : {}),
        ...(typeof update.spanStartColumn === 'number'
          ? { spanStartColumn: update.spanStartColumn }
          : {}),
      };
      if (typeof update.widthPx === 'number') {
        const maximumWidth =
          selectedFlowImage.attributes.wrap === 'span-columns' && page
            ? (
                availableColumnWidth * selectedFlowImage.attributes.spanCount
                + page.columnGapPx
                  * (selectedFlowImage.attributes.spanCount - 1)
              )
            : Number.POSITIVE_INFINITY;
        const widthPx = Math.min(update.widthPx, maximumWidth);
        const ratio =
          selectedFlowImage.attributes.naturalHeight
          / Math.max(1, selectedFlowImage.attributes.naturalWidth);
        next.widthPx = widthPx;
        next.heightPx = widthPx * ratio;
      }
      editor.chain()
        .focus()
        .setNodeSelection(selectedFlowImage.position)
        .updateSelectedDocumentImage(next)
        .run();
      return;
    }
    if (!selectedOverlay) return;
    const next: Partial<DocumentOverlayImage> = {
      ...(typeof update.caption === 'string' ? { caption: update.caption } : {}),
        ...(update.captionAlignment === 'inherit'
          || update.captionAlignment === 'left'
        || update.captionAlignment === 'center'
        || update.captionAlignment === 'right'
        ? { captionAlignment: update.captionAlignment }
        : {}),
      ...(typeof update.captionItalic === 'boolean'
        || update.captionItalic === 'inherit'
        ? { captionItalic: update.captionItalic }
        : {}),
      ...(update.captionSpacingPx === 'inherit'
        ? { captionSpacingPx: 'inherit' }
        : typeof update.captionSpacingPx === 'number'
        ? {
            captionSpacingPx: Math.min(
              96,
              Math.max(0, update.captionSpacingPx)
            ),
          }
        : {}),
      ...(typeof update.altText === 'string' ? { altText: update.altText } : {}),
      ...(typeof update.xPx === 'number' ? { xPx: update.xPx } : {}),
      ...(typeof update.yPx === 'number' ? { yPx: update.yPx } : {}),
    };
    if (typeof update.widthPx === 'number') {
      const ratio = selectedOverlay.heightPx / Math.max(1, selectedOverlay.widthPx);
      next.widthPx = update.widthPx;
      next.heightPx = update.widthPx * ratio;
    }
    updateOverlay(selectedOverlay.id, next);
  }, [
    availableColumnWidth,
    page,
    selectedFlowImage,
    selectedOverlay,
    updateOverlay,
  ]);

  const convertSelectedFlowToOverlay = useCallback((
    placement: 'front' | 'behind'
  ) => {
    const editor = bodyEditorRef.current;
    if (!selectedFlowImage || !editor || !page) return;
    const attributes = selectedFlowImage.attributes;
    editor.chain()
      .focus()
      .setNodeSelection(selectedFlowImage.position)
      .deleteSelection()
      .run();
    const overlayId = attributes.id || uuidv4();
    addOverlay({
      id: overlayId,
      assetId: attributes.assetId,
      altText: attributes.altText,
      xPx: (physicalMargins?.leftIn ?? page.margins.innerIn) * 96 + 24,
      yPx: page.margins.topIn * 96 + 140,
      widthPx: attributes.widthPx,
      heightPx: attributes.heightPx,
      placement,
      caption: attributes.caption,
      captionAlignment: attributes.captionAlignment,
      captionItalic: attributes.captionItalic,
      captionSpacingPx: attributes.captionSpacingPx,
      naturalWidth: attributes.naturalWidth,
      naturalHeight: attributes.naturalHeight,
      locked: false,
    });
    setSelectedOverlayId(overlayId);
    setSelectedFlowImage(null);
    setSelectedFlowImageId(null);
  }, [
    addOverlay,
    page,
    physicalMargins,
    selectedFlowImage,
    setSelectedFlowImageId,
    setSelectedOverlayId,
  ]);

  const convertOverlayToFlow = useCallback((
    overlay: DocumentOverlayImage,
    wrap: DocumentFlowImageWrap
  ) => {
    const editor = bodyEditorRef.current;
    if (!editor) return;
    removeOverlay(overlay.id);
    editor.commands.insertDocumentImage({
      id: overlay.id,
      assetId: overlay.assetId,
      altText: overlay.altText,
      widthPx: overlay.widthPx,
      heightPx: overlay.heightPx,
      naturalWidth: overlay.naturalWidth || overlay.widthPx,
      naturalHeight: overlay.naturalHeight || overlay.heightPx,
      wrap,
      wrapPaddingPx: 12,
      caption: overlay.caption || '',
      captionAlignment: overlay.captionAlignment,
      captionItalic: overlay.captionItalic,
      captionSpacingPx: overlay.captionSpacingPx,
    });
    editor.commands.focus();
  }, [removeOverlay]);

  const handleLayoutChange = useCallback((
    layout: DocumentImageLayoutMode
  ) => {
    const isSpan = layout === 'span-2' || layout === 'span-3';
    const spanCount = layout === 'span-3' ? 3 : 2;
    const wrap = isSpan ? 'span-columns' : layout;
    if (selectedFlowImage) {
      if (wrap === 'front' || wrap === 'behind') {
        convertSelectedFlowToOverlay(wrap);
        return;
      }
      const editor = bodyEditorRef.current;
      if (isSpan && editor && page) {
        const spanStartColumn =
          spanCount === 2
          && page.columnCount === 3
          && selectedFlowImage.attributes.spanStartColumn === 2
            ? 2
            : 1;
        const spanWidth = (
          availableColumnWidth * spanCount
          + page.columnGapPx * (spanCount - 1)
        );
        const ratio =
          selectedFlowImage.attributes.naturalHeight
          / Math.max(1, selectedFlowImage.attributes.naturalWidth);
        editor.chain()
          .focus()
          .setNodeSelection(selectedFlowImage.position)
          .updateSelectedDocumentImage({
            wrap: 'span-columns',
            spanCount,
            spanStartColumn,
            widthPx: spanWidth,
            heightPx: spanWidth * ratio,
            verticalAnchor:
              selectedFlowImage.attributes.verticalAnchor || 'flow',
          })
          .run();
        return;
      }
      editor?.chain()
        .focus()
        .setNodeSelection(selectedFlowImage.position)
        .setDocumentImageWrap(wrap as DocumentFlowImageWrap)
        .run();
      return;
    }
    if (!selectedOverlay) return;
    if (wrap === 'front' || wrap === 'behind') {
      updateOverlay(selectedOverlay.id, { placement: wrap });
    } else if (isSpan && page) {
      const widthPx = (
        availableColumnWidth * spanCount
        + page.columnGapPx * (spanCount - 1)
      );
      removeOverlay(selectedOverlay.id);
      bodyEditorRef.current?.commands.insertDocumentImage({
        id: selectedOverlay.id,
        assetId: selectedOverlay.assetId,
        altText: selectedOverlay.altText,
        widthPx,
        heightPx:
          widthPx * selectedOverlay.heightPx / Math.max(1, selectedOverlay.widthPx),
        naturalWidth: selectedOverlay.naturalWidth || selectedOverlay.widthPx,
        naturalHeight: selectedOverlay.naturalHeight || selectedOverlay.heightPx,
        wrap: 'span-columns',
        spanCount,
        spanStartColumn: 1,
        wrapPaddingPx: 12,
        verticalSpacingPx: 12,
        verticalAnchor: 'page-position',
        yPx: Math.max(
          0,
          selectedOverlay.yPx
            - (physicalMargins?.topIn ?? page.margins.topIn) * 96
        ),
        caption: selectedOverlay.caption || '',
        captionAlignment: selectedOverlay.captionAlignment,
        captionItalic: selectedOverlay.captionItalic,
        captionSpacingPx: selectedOverlay.captionSpacingPx,
      });
      bodyEditorRef.current?.commands.focus();
    } else {
      convertOverlayToFlow(selectedOverlay, wrap as DocumentFlowImageWrap);
    }
  }, [
    availableColumnWidth,
    convertOverlayToFlow,
    convertSelectedFlowToOverlay,
    page,
    physicalMargins,
    removeOverlay,
    selectedFlowImage,
    selectedOverlay,
    updateOverlay,
  ]);

  const handleSpanStartChange = useCallback((spanStartColumn: 1 | 2) => {
    const editor = bodyEditorRef.current;
    if (!selectedFlowImage || !editor) return;
    editor.chain()
      .focus()
      .setNodeSelection(selectedFlowImage.position)
      .updateSelectedDocumentImage({ spanStartColumn })
      .run();
  }, [selectedFlowImage]);

  const moveSelectedSpanImage = useCallback((
    direction: DocumentImageMoveDirection
  ) => {
    const editor = bodyEditorRef.current;
    if (
      !selectedFlowImage
      || selectedFlowImage.attributes.wrap !== 'span-columns'
      || !editor
    ) {
      return;
    }
    editor.chain()
      .focus()
      .setNodeSelection(selectedFlowImage.position)
      .moveSelectedDocumentImage(direction)
      .run();
  }, [selectedFlowImage]);

  const replaceSelectedImage = useCallback(async (file: File) => {
    try {
      const asset = await ingestDocumentImage(file);
      addAsset(asset.id, asset.source);
      if (selectedFlowImage) {
        const widthPx = selectedFlowImage.attributes.widthPx;
        bodyEditorRef.current?.chain()
          .focus()
          .setNodeSelection(selectedFlowImage.position)
          .updateSelectedDocumentImage({
            assetId: asset.id,
            naturalWidth: asset.naturalWidth,
            naturalHeight: asset.naturalHeight,
            heightPx: widthPx * asset.naturalHeight / asset.naturalWidth,
          })
          .run();
      } else if (selectedOverlay) {
        updateOverlay(selectedOverlay.id, {
          assetId: asset.id,
          naturalWidth: asset.naturalWidth,
          naturalHeight: asset.naturalHeight,
          heightPx: selectedOverlay.widthPx * asset.naturalHeight / asset.naturalWidth,
        });
      }
    } catch (error) {
      setToastMessage(error instanceof Error ? error.message : 'Could not replace the image.');
    }
  }, [
    addAsset,
    selectedFlowImage,
    selectedOverlay,
    setToastMessage,
    updateOverlay,
  ]);

  const deleteSelectedImage = useCallback(() => {
    if (selectedFlowImage) {
      bodyEditorRef.current?.chain()
        .focus()
        .setNodeSelection(selectedFlowImage.position)
        .deleteSelection()
        .run();
      setSelectedFlowImage(null);
      setSelectedFlowImageId(null);
    } else if (selectedOverlay) {
      removeOverlay(selectedOverlay.id);
    }
  }, [removeOverlay, selectedFlowImage, selectedOverlay, setSelectedFlowImageId]);

  const resetSelectedImageSize = useCallback(() => {
    const selected = selectedInspector;
    if (!selected?.naturalWidth || !selected.naturalHeight) return;
    const maximumWidth =
      selected.wrap === 'span-columns' && page
        ? (
            availableColumnWidth * (selected.spanCount || 2)
            + page.columnGapPx * ((selected.spanCount || 2) - 1)
          )
        : availableColumnWidth * 0.9;
    updateSelectedImage({
      widthPx: Math.min(selected.naturalWidth, maximumWidth),
    });
  }, [availableColumnWidth, page, selectedInspector, updateSelectedImage]);

  const handleNodeReplaceRequest = useCallback((
    request: DocumentImageReplaceRequest
  ) => {
    pendingNodeReplaceRef.current = request;
    nodeReplaceInputRef.current?.click();
  }, []);

  const handleReferenceAdjustModeChange = useCallback((enabled: boolean) => {
    if (enabled) {
      setSelectedFlowImage(null);
      setSelectedFlowImageId(null);
      setSelectedOverlayId(null);
    }
    setReferenceAdjustMode(enabled);
  }, [
    setReferenceAdjustMode,
    setSelectedFlowImageId,
    setSelectedOverlayId,
  ]);

  const pageWidthIn = page?.size.widthIn || 8.5;
  const pageHeightIn = page?.size.heightIn || 11;

  const applyFitPage = useCallback(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const style = window.getComputedStyle(workspace);
    const fit = calculateFitPageZoom({
      viewportWidth: workspace.clientWidth,
      viewportHeight: workspace.clientHeight,
      pageWidth: pageWidthIn * 96,
      pageHeight: pageHeightIn * 96,
      paddingLeft: Number.parseFloat(style.paddingLeft) || 0,
      paddingRight: Number.parseFloat(style.paddingRight) || 0,
      paddingTop: Number.parseFloat(style.paddingTop) || 0,
      paddingBottom: Number.parseFloat(style.paddingBottom) || 0,
    });
    if (fit === null) return;
    const currentZoom = useDocumentStore.getState().zoom;
    if (Math.abs(currentZoom - fit) > 0.005) setZoom(fit);
  }, [pageHeightIn, pageWidthIn, setZoom]);

  const scheduleFitPage = useCallback(() => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(applyFitPage);
    } else {
      window.setTimeout(applyFitPage, 0);
    }
  }, [applyFitPage]);

  const fitPage = useCallback(() => {
    setFitMode(true);
    scheduleFitPage();
  }, [scheduleFitPage]);

  const handleManualZoomChange = useCallback((nextZoom: number) => {
    setFitMode(false);
    setZoom(nextZoom);
  }, [setZoom]);

  useLayoutEffect(() => {
    if (!fitMode) return;
    const workspace = workspaceRef.current;
    if (!workspace) return;
    scheduleFitPage();

    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleFitPage)
      : null;
    observer?.observe(workspace);
    window.addEventListener('resize', scheduleFitPage);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', scheduleFitPage);
    };
  }, [
    fitMode,
    pageHeightIn,
    pageWidthIn,
    scheduleFitPage,
    sidebarCollapsed,
  ]);

  const exportDocument = useCallback(async (format: 'png' | 'pdf') => {
    if (!exportRootRef.current || !page || !project || isExporting) return;
    setIsExporting(true);
    setToastMessage(`Preparing ${format.toUpperCase()} export…`);
    let cleanupExportPages: (() => void) | undefined;
    try {
      const options = {
        widthIn: page.size.widthIn,
        heightIn: page.size.heightIn,
        dpi: page.size.dpi,
        fileName: format === 'png'
          ? `${project.projectName}-${folioNumber}`
          : project.projectName,
        backgroundColor: paperColor,
      };
      if (format === 'png') {
        await documentExportService.downloadPng(exportRootRef.current, options);
      } else {
        const mounted = await mountCommittedDocumentExportPages(project);
        cleanupExportPages = mounted.cleanup;
        await documentExportService.downloadPdfPages(
          mounted.sources,
          project.projectName
        );
      }
      setToastMessage(`${format.toUpperCase()} export downloaded.`);
    } catch (error) {
      setToastMessage(error instanceof Error ? error.message : 'Document export failed.');
    } finally {
      cleanupExportPages?.();
      setIsExporting(false);
    }
  }, [isExporting, page, paperColor, project, setToastMessage]);

  if (!project || !page) {
    return (
      <div data-testid="document-editor-shell" className="document-editor-shell">
        <p>Document project could not be loaded.</p>
        <button type="button" onClick={onBackToDashboard}>Back to Projects</button>
      </div>
    );
  }

  return (
    <div
      className="document-editor-shell"
      data-testid="document-editor-shell"
      data-editor-mode="document"
    >
      <DocumentTopBar
        projectName={project.projectName}
        pageCount={project.pages.length}
        saveStatus={isExporting ? 'exporting' : saveStatus}
        exportBusy={isExporting}
        onBack={() => onBackToDashboard?.()}
        onRename={renameProject}
        onSave={() => void saveProject()}
        onDownloadProject={() => void downloadProjectFile()}
        onExport={(format) => void exportDocument(format)}
        onPrint={() => {
          if (!exportRootRef.current) return;
          void documentExportService.print(exportRootRef.current, {
            widthIn: page.size.widthIn,
            heightIn: page.size.heightIn,
            dpi: page.size.dpi,
            fileName: project.projectName,
            backgroundColor: paperColor,
          }).catch((error) => {
            setToastMessage(error instanceof Error ? error.message : 'Printing failed.');
          });
        }}
      />

      <div className="document-editor-layout">
        <DocumentSidebar
          page={page}
          folios={project.document.folios}
          documentLanguage={project.document.language}
          styles={project.document.styles}
          paperColor={paperColor}
          isOverflowing={isOverflowing}
          collapsed={sidebarCollapsed}
          selectedOverlayId={selectedOverlayId}
          onCollapsedChange={setSidebarCollapsed}
          onPresetChange={(preset) => {
            updatePage(updateDocumentPagePaper(page, { preset }));
          }}
          onOrientationChange={(orientation: DocumentPageOrientation) => {
            setFitMode(true);
            updatePage(updateDocumentPagePaper(page, { orientation }));
          }}
          onCustomSizeChange={(update) => {
            setFitMode(true);
            updatePage(updateDocumentPagePaper(page, {
              preset: 'custom',
              ...update,
            }));
          }}
          onPaperColorChange={updateDocumentBackground}
          onFolioSettingsChange={updateFolioSettings}
          onSuppressFolioChange={(suppressFolio) =>
            updatePage({ suppressFolio })}
          onMarginChange={(side, value) => updatePage({
            margins: constrainDocumentPageMargins(
              { ...page.margins, [side]: value },
              page.size.widthIn,
              page.size.heightIn
            ),
          })}
          onColumnCountChange={(columnCount) => updatePage({ columnCount })}
          onColumnGapChange={(columnGapPx) => updatePage({ columnGapPx })}
          onDocumentLanguageChange={updateDocumentLanguage}
          onPageLanguageChange={(language) =>
            updatePageLanguage(language, page.id)}
          onStyleChange={updateDocumentStyle}
          onDropCapChange={(update) => updateDropCap(update, page.id)}
          onImportImages={(files) => void importImages(files)}
          onImportReference={(file) => void handleReferenceImport(file)}
          onToggleReferenceVisibility={() => {
            if (page.reference) {
              setReference({ ...page.reference, visible: !page.reference.visible });
            }
          }}
          referenceAdjustMode={isReferenceAdjustMode}
          onReferenceAdjustModeChange={handleReferenceAdjustModeChange}
          onReferenceChange={(update) => {
            if (page.reference) {
              setReference({ ...page.reference, ...update, locked: true });
            }
          }}
          onResetReference={() => {
            if (page.reference) {
              setReference({
                ...page.reference,
                offsetXPx: 0,
                offsetYPx: 0,
                scale: 1,
                locked: true,
              });
            }
          }}
          onSelectOverlay={(id) => {
            setSelectedOverlayId(id);
            setSelectedFlowImage(null);
            setSelectedFlowImageId(null);
          }}
        />

        <section className="document-editor-stage" data-testid="document-editor-stage">
          <DocumentToolbar
            page={page}
            activeTextRegion={activeTextRegion}
            selectedImage={selectedInspector}
            referenceAdjustMode={isReferenceAdjustMode}
            textFormatState={textFormatState}
            onFormat={handleFormat}
            onFontSizeChange={handleFontSizeChange}
            onBlockStyleChange={handleBlockStyleChange}
            onImportImages={(files) => void importImages(files)}
            onReferenceAdjustModeChange={handleReferenceAdjustModeChange}
            onReferenceChange={(update) => {
              if (page.reference) {
                setReference({ ...page.reference, ...update, locked: true });
              }
            }}
            onResetReference={() => {
              if (page.reference) {
                setReference({
                  ...page.reference,
                  offsetXPx: 0,
                  offsetYPx: 0,
                  scale: 1,
                  locked: true,
                });
              }
            }}
            onSelectedImageChange={updateSelectedImage}
            onSelectedImageLayoutChange={handleLayoutChange}
            onSelectedImageSpanStartChange={handleSpanStartChange}
            onMoveSelectedImage={moveSelectedSpanImage}
            onReplaceSelectedImage={(file) => void replaceSelectedImage(file)}
            onDeleteSelectedImage={deleteSelectedImage}
            onResetSelectedImageSize={resetSelectedImageSize}
          />

          <DocumentPageNavigation
            pages={project.pages}
            activePageIndex={activePageIndex}
            startingFolio={project.document.folios.startingNumber}
            onSelectPage={selectPage}
            onAddPage={addPage}
            onDuplicatePage={() => duplicatePage()}
            onRemovePage={() => {
              if (
                project.pages.length > 1
                && window.confirm(`Remove ${page.name}? This cannot be undone.`)
              ) {
                removePage();
              }
            }}
            onMovePage={(direction) => {
              reorderPages(
                activePageIndex,
                direction === 'left'
                  ? activePageIndex - 1
                  : activePageIndex + 1
              );
            }}
          />

          <main
            ref={workspaceRef}
            className="document-workspace"
            data-testid="document-workspace"
            data-fit-mode={fitMode ? 'true' : 'false'}
          >
            <DocumentPageView
              page={page}
              assetSources={assetSources}
              paperColor={paperColor}
              folioNumber={folioNumber}
              showFolio={project.document.folios.visible}
              documentLanguage={project.document.language}
              typographyStyles={project.document.styles}
              zoom={zoom}
              exportRootRef={exportRootRef}
              referenceAdjustMode={isReferenceAdjustMode}
              selectedOverlayId={selectedOverlayId}
              isOverflowing={isOverflowing}
              onReferenceChange={(update: Partial<ScanReference>) => {
                if (page.reference) {
                  setReference({ ...page.reference, ...update, locked: true });
                }
              }}
              onSelectOverlay={(id) => {
                setSelectedOverlayId(id);
                if (id) {
                  setSelectedFlowImage(null);
                  setSelectedFlowImageId(null);
                }
              }}
              onUpdateOverlay={updateOverlay}
              titleEditor={(
                <TitleEditor
                  key={`title-${page.id}`}
                  content={page.titleContent as JSONContent}
                  baseFontSizePx={
                    project.document.styles['article-title'].fontSizePx
                  }
                  language={page.language || project.document.language}
                  onEditorReady={(editor) => {
                    titleEditorRef.current = editor;
                  }}
                  onFocusChange={(focused, editor) => {
                    if (!focused) return;
                    updateActiveTextFormatState(editor, 'title');
                    setSelectedFlowImage(null);
                    setSelectedFlowImageId(null);
                    setSelectedOverlayId(null);
                  }}
                  onSelectionChange={(editor) => {
                    if (editor.isFocused) updateActiveTextFormatState(editor, 'title');
                  }}
                  onUpdate={(content, editor) => {
                    updateTitleContent(content, page.id);
                    if (editor.isFocused) updateActiveTextFormatState(editor, 'title');
                  }}
                  onPasteDispatch={handlePasteDispatch}
                />
              )}
              bodyEditor={(
                <FlowEditor
                  key={`body-${page.id}`}
                  content={page.bodyContent as JSONContent}
                  columnCount={page.columnCount}
                  columnGapPx={page.columnGapPx}
                  dropCap={page.dropCap}
                  language={page.language || project.document.language}
                  typographyStyle={typographyStyle}
                  viewScale={zoom}
                  maxImageWidthPx={Math.max(180, availableColumnWidth)}
                  maxSpanImageWidthPx={
                    availableColumnWidth * page.columnCount
                    + page.columnGapPx * (page.columnCount - 1)
                  }
                  resolveAssetSource={(assetId) => assetSources[assetId]}
                  onEditorReady={(editor) => {
                    bodyEditorRef.current = editor;
                  }}
                  onFocusChange={(focused, editor) => {
                    if (!focused) return;
                    updateActiveTextFormatState(editor, 'body');
                  }}
                  onSelectionChange={(editor) => {
                    if (editor.isFocused) updateActiveTextFormatState(editor, 'body');
                  }}
                  onUpdate={(content, editor) => {
                    updateBodyContent(content, page.id);
                    if (editor.isFocused) updateActiveTextFormatState(editor, 'body');
                  }}
                  onImageSelectionChange={(selection, editor) => {
                    setSelectedFlowImage(selection);
                    setSelectedFlowImageId(selection?.attributes.id || null);
                    if (selection || editor.isFocused) setSelectedOverlayId(null);
                  }}
                  onRequestImageReplace={handleNodeReplaceRequest}
                  onPasteDispatch={handlePasteDispatch}
                  onDropDispatch={handleDropDispatch}
                  onOverflowChange={setOverflowing}
                />
              )}
            />
          </main>

          <DocumentZoomControls
            zoom={zoom}
            fitMode={fitMode}
            onZoomChange={handleManualZoomChange}
            onFitPage={fitPage}
          />
        </section>
      </div>

      <input
        ref={nodeReplaceInputRef}
        className="hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0];
          const request = pendingNodeReplaceRef.current;
          if (file && request) {
            request.editor.commands.setNodeSelection(request.position || 0);
            setSelectedFlowImage({
              position: request.position || 0,
              nodeType: request.nodeType,
              attributes: request.attributes,
            });
            void replaceSelectedImage(file);
          }
          pendingNodeReplaceRef.current = null;
          event.target.value = '';
        }}
      />

      {toastMessage && (
        <div
          className="document-toast"
          data-document-export-exclude="true"
          role="status"
          data-testid="document-toast"
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
};
