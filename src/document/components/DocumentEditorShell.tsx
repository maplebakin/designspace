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
  DocumentImageGroup,
  DocumentFlowImageWrap,
  DocumentOverlayImage,
  ScanReference,
} from '../types/documentProject';
import {
  findDocumentImageGroupForImage,
  normalizeDocumentImageGroupGapPx,
  removeDocumentImageIdsFromGroups,
  removeDocumentImageGroup,
} from '../model/documentImageGroups';
import { findMissingDocumentAssetIds } from '../model/documentAssets';
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
  clampDocumentImageXOffset,
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
  commitStructuredDocumentImagePosition,
  commitStructuredDocumentImageBatch,
  DOCUMENT_IMAGE_GROUPS_TRANSACTION_META,
  FlowEditor,
  type DocumentDropContext,
  type SelectedDocumentImage,
} from './FlowEditor';
import {
  buildMultiDocumentSpanLayoutModel,
  moveRectangleWithoutCollisions,
} from './StructuredDocumentSpanLayout';
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
  const commitPageImageState = useDocumentStore(
    (state) => state.commitPageImageState
  );
  const updateImageGroups = useDocumentStore((state) => state.updateImageGroups);
  const addAsset = useDocumentStore((state) => state.addAsset);
  const addOverlay = useDocumentStore((state) => state.addOverlay);
  const updateOverlay = useDocumentStore((state) => state.updateOverlay);
  const commitOverlayGeometry = useDocumentStore(
    (state) => state.commitOverlayGeometry
  );
  const nudgeOverlay = useDocumentStore((state) => state.nudgeOverlay);
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
  const [selectedStructuredImageIds, setSelectedStructuredImageIds] =
    useState<string[]>([]);
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
  const missingAssetIds = useMemo(
    () => project
      ? findMissingDocumentAssetIds(project.pages, project.assets)
      : [],
    [project]
  );
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
    setSelectedStructuredImageIds([]);
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
        removeOverlay(selectedOverlayId, page?.id);
        return;
      }
      if (
        selectedOverlayId
        && page
        && (
          event.key === 'ArrowLeft'
          || event.key === 'ArrowRight'
          || event.key === 'ArrowUp'
          || event.key === 'ArrowDown'
        )
      ) {
        const distance = event.shiftKey ? 10 : 1;
        const deltaXPx = event.key === 'ArrowLeft'
          ? -distance
          : event.key === 'ArrowRight' ? distance : 0;
        const deltaYPx = event.key === 'ArrowUp'
          ? -distance
          : event.key === 'ArrowDown' ? distance : 0;
        event.preventDefault();
        nudgeOverlay(
          page.id,
          selectedOverlayId,
          deltaXPx,
          deltaYPx
        );
        return;
      }
      if (
        selectedFlowImage
        && selectedFlowImage.attributes.wrap === 'span-columns'
        && selectedFlowImage.attributes.verticalAnchor === 'page-position'
        && page
        && physicalMargins
        && (
          event.key === 'ArrowLeft'
          || event.key === 'ArrowRight'
          || event.key === 'ArrowUp'
          || event.key === 'ArrowDown'
        )
      ) {
        const editor = bodyEditorRef.current;
        if (!editor || editor.isDestroyed) return;
        const bodyWidthPx = Math.max(
          1,
          (
            page.size.widthIn
            - physicalMargins.leftIn
            - physicalMargins.rightIn
          ) * 96
        );
        const editorRoot = editor.view.dom.closest<HTMLElement>(
          '.document-flow-editor'
        );
        const bodyHeightPx = Math.max(
          1,
          editorRoot?.clientHeight
          || (
            page.size.heightIn
            - physicalMargins.topIn
            - physicalMargins.bottomIn
          ) * 96
        );
        const model = buildMultiDocumentSpanLayoutModel(
          editor,
          page.columnCount,
          page.columnGapPx,
          bodyWidthPx,
          bodyHeightPx,
          {},
          {
            typographyStyle,
            dropCap: page.dropCap,
            language: page.language || project?.document.language,
          }
        );
        const image = model?.images.find(
          (candidate) =>
            candidate.imageId === selectedFlowImage.attributes.id
        );
        const start = model?.collisionRectangles.find(
          (candidate) =>
            candidate.imageId === selectedFlowImage.attributes.id
        );
        if (!model || !image || !start) return;
        const distance = event.shiftKey ? 10 : 1;
        const deltaXPx = event.key === 'ArrowLeft'
          ? -distance
          : event.key === 'ArrowRight' ? distance : 0;
        const deltaYPx = event.key === 'ArrowUp'
          ? -distance
          : event.key === 'ArrowDown' ? distance : 0;
        const moved = moveRectangleWithoutCollisions({
          start,
          desiredLeftPx: start.leftPx + deltaXPx,
          desiredTopPx: start.topPx + deltaYPx,
          obstacles: model.collisionRectangles.filter(
            (candidate) => candidate.imageId !== image.imageId
          ),
          bounds: {
            imageId: 'span-bounds',
            leftPx: image.spanLeftPx,
            topPx: image.attributes.wrapPaddingTopPx,
            widthPx: image.spanWidthPx,
            heightPx: Math.max(
              0,
              model.availableHeightPx
                - image.attributes.wrapPaddingTopPx
                - image.attributes.wrapPaddingBottomPx
            ),
          },
        });
        event.preventDefault();
        commitStructuredDocumentImagePosition(
          editor,
          image.imagePosition,
          image.imageId,
          clampDocumentImageXOffset(
            moved.leftPx - image.spanLeftPx,
            image.spanWidthPx,
            image.renderedImageWidthPx
          ),
          moved.topPx
        );
        return;
      }
      if (event.key === 'Escape') {
        setSelectedOverlayId(null);
        setSelectedFlowImage(null);
        setSelectedFlowImageId(null);
        setSelectedStructuredImageIds([]);
        setReferenceAdjustMode(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    nudgeOverlay,
    page,
    physicalMargins,
    project?.document.language,
    removeOverlay,
    saveProject,
    selectedFlowImage,
    selectedOverlayId,
    setReferenceAdjustMode,
    setSelectedFlowImageId,
    setSelectedOverlayId,
    setSelectedStructuredImageIds,
    typographyStyle,
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
    const assetId = addAsset(asset.id, asset.source, {
      mimeType: asset.mimeType,
      naturalWidth: asset.naturalWidth,
      naturalHeight: asset.naturalHeight,
      fileName: asset.fileName,
    });
    const widthPx = getInitialImageWidth(asset, availableColumnWidth);
    const heightPx = widthPx * asset.naturalHeight / asset.naturalWidth;
    const imageId = uuidv4();
    const inserted = editor.commands.insertDocumentImage({
      id: imageId,
      assetId,
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
    if (!inserted) return;
    let imagePosition = -1;
    editor.state.doc.descendants((node, nodePosition) => {
      if (
        imagePosition < 0
        && (
          node.type.name === 'documentFlowImage'
          || node.type.name === 'documentInlineImage'
        )
        && node.attrs.id === imageId
      ) {
        imagePosition = nodePosition;
        return false;
      }
      return true;
    });
    if (imagePosition >= 0) {
      editor.chain().focus().setNodeSelection(imagePosition).run();
    } else {
      editor.commands.focus();
    }
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
      const assetId = addAsset(asset.id, asset.source, {
        mimeType: asset.mimeType,
        naturalWidth: asset.naturalWidth,
        naturalHeight: asset.naturalHeight,
        fileName: asset.fileName,
      });
      setReference({
        assetId,
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
  const selectedImageGroup = useMemo(() => {
    if (!page || selectedStructuredImageIds.length < 2) return null;
    const selected = new Set(selectedStructuredImageIds);
    return page.imageGroups.find((group) => (
      group.childImageIds.length === selected.size
      && group.childImageIds.every((imageId) => selected.has(imageId))
    )) || null;
  }, [page, selectedStructuredImageIds]);

  const handleStructuredImageSelectionRequest = useCallback((
    imageId: string,
    additive: boolean
  ): string | null => {
    if (!page) return imageId;
    const group = findDocumentImageGroupForImage(page.imageGroups, imageId);
    if (group && !additive) {
      setSelectedStructuredImageIds([...group.childImageIds]);
      return imageId;
    }
    if (!additive) {
      setSelectedStructuredImageIds([imageId]);
      return imageId;
    }
    const current = selectedStructuredImageIds;
    if (current.includes(imageId)) {
      const remaining = current.filter((candidate) => candidate !== imageId);
      setSelectedStructuredImageIds(remaining);
      return remaining[0] || imageId;
    }
    const next = [...current, imageId];
    setSelectedStructuredImageIds(next);
    return imageId;
  }, [page, selectedStructuredImageIds]);

  const getStructuredLayoutModel = useCallback(() => {
    const editor = bodyEditorRef.current;
    if (!editor || editor.isDestroyed || !page || !physicalMargins) return null;
    const bodyWidthPx = Math.max(
      1,
      (
        page.size.widthIn
        - physicalMargins.leftIn
        - physicalMargins.rightIn
      ) * 96
    );
    const editorRoot = editor.view.dom.closest<HTMLElement>(
      '.document-flow-editor'
    );
    const bodyHeightPx = Math.max(
      1,
      editorRoot?.clientHeight
      || (
        page.size.heightIn
        - physicalMargins.topIn
        - physicalMargins.bottomIn
      ) * 96
    );
    return buildMultiDocumentSpanLayoutModel(
      editor,
      page.columnCount,
      page.columnGapPx,
      bodyWidthPx,
      bodyHeightPx,
      {},
      {
        typographyStyle,
        dropCap: page.dropCap,
        language: page.language || project?.document.language,
      },
      page.imageGroups
    );
  }, [page, physicalMargins, project?.document.language, typographyStyle]);

  const arrangeSelectedImages = useCallback((
    kind: DocumentImageGroup['kind']
  ) => {
    if (!page || selectedStructuredImageIds.length < 2) return;
    const editor = bodyEditorRef.current;
    if (!editor || editor.isDestroyed) return;
    const selected = new Set(selectedStructuredImageIds);
    const ordered: string[] = [];
    editor.state.doc.descendants((node) => {
      if (
        node.type.name === 'documentFlowImage'
        && node.attrs.wrap === 'span-columns'
        && node.attrs.verticalAnchor === 'page-position'
        && selected.has(String(node.attrs.id))
      ) ordered.push(String(node.attrs.id));
      return true;
    });
    if (ordered.length < 2 || ordered.some((id) => (
      findDocumentImageGroupForImage(page.imageGroups, id)
    ))) {
      setToastMessage('Select two or more ungrouped positioned images.');
      return;
    }
    const group: DocumentImageGroup = {
      id: uuidv4(),
      kind,
      childImageIds: ordered,
      gapPx: 16,
      sharedWidth: false,
    };
    updateImageGroups(page.id, [...page.imageGroups, group]);
  }, [page, selectedStructuredImageIds, setToastMessage, updateImageGroups]);

  const updateSelectedImageGroup = useCallback((
    update: Partial<Pick<DocumentImageGroup, 'kind' | 'gapPx' | 'sharedWidth'>>
  ) => {
    if (!page || !selectedImageGroup) return;
    const next = page.imageGroups.map((group) => (
      group.id === selectedImageGroup.id
        ? {
            ...group,
            ...(update.kind ? { kind: update.kind } : {}),
            ...(update.gapPx === undefined
              ? {}
              : { gapPx: normalizeDocumentImageGroupGapPx(
                  update.gapPx,
                  group.gapPx
                ) }),
            ...(update.sharedWidth === undefined
              ? {}
              : { sharedWidth: update.sharedWidth }),
          }
        : group
    ));
    updateImageGroups(page.id, next);
  }, [page, selectedImageGroup, updateImageGroups]);

  const ungroupSelectedImages = useCallback(() => {
    if (!page || !selectedImageGroup) return;
    const editor = bodyEditorRef.current;
    const model = getStructuredLayoutModel();
    if (!editor || !model) return;
    const updatesByImageId: Record<string, Partial<DocumentImageAttributes>> = {};
    model.images
      .filter((image) => selectedImageGroup.childImageIds.includes(image.imageId))
      .forEach((image) => {
        updatesByImageId[image.imageId] = {
          widthPx: image.renderedImageWidthPx,
          heightPx: image.renderedImageHeightPx,
          horizontalPlacement: 'custom',
          verticalAnchor: 'page-position',
          xOffsetPx: image.imageLeftPx - image.spanLeftPx,
          yPx: image.imageTopPx,
        };
      });
    const nextGroups = removeDocumentImageGroup(
      page.imageGroups,
      selectedImageGroup.id
    );
    commitStructuredDocumentImageBatch(editor, {
      updatesByImageId,
      selectedImageId: selectedFlowImage?.attributes.id || null,
      imageGroupsMeta: nextGroups,
    });
  }, [
    commitStructuredDocumentImageBatch,
    getStructuredLayoutModel,
    page,
    selectedFlowImage,
    selectedImageGroup,
  ]);
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
          wrapPaddingTopPx:
            selectedFlowImage.attributes.wrapPaddingTopPx,
          wrapPaddingRightPx:
            selectedFlowImage.attributes.wrapPaddingRightPx,
          wrapPaddingBottomPx:
            selectedFlowImage.attributes.wrapPaddingBottomPx,
          wrapPaddingLeftPx:
            selectedFlowImage.attributes.wrapPaddingLeftPx,
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
        ...(typeof update.wrapPaddingTopPx === 'number'
          ? { wrapPaddingTopPx: update.wrapPaddingTopPx }
          : {}),
        ...(typeof update.wrapPaddingRightPx === 'number'
          ? { wrapPaddingRightPx: update.wrapPaddingRightPx }
          : {}),
        ...(typeof update.wrapPaddingBottomPx === 'number'
          ? { wrapPaddingBottomPx: update.wrapPaddingBottomPx }
          : {}),
        ...(typeof update.wrapPaddingLeftPx === 'number'
          ? { wrapPaddingLeftPx: update.wrapPaddingLeftPx }
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
      } else if (typeof update.heightPx === 'number') {
        const aspectRatio =
          selectedFlowImage.attributes.naturalWidth
          / Math.max(1, selectedFlowImage.attributes.naturalHeight);
        const desiredWidthPx = update.heightPx * aspectRatio;
        const maximumWidth =
          selectedFlowImage.attributes.wrap === 'span-columns' && page
            ? (
                availableColumnWidth * selectedFlowImage.attributes.spanCount
                + page.columnGapPx
                  * (selectedFlowImage.attributes.spanCount - 1)
              )
            : Number.POSITIVE_INFINITY;
        const widthPx = Math.min(desiredWidthPx, maximumWidth);
        next.widthPx = widthPx;
        next.heightPx = widthPx / Math.max(0.0001, aspectRatio);
      }
      editor.chain()
        .setNodeSelection(selectedFlowImage.position)
        .updateSelectedDocumentImage(next)
        .run();
      return;
    }
    if (!selectedOverlay || !page) return;
    const metadata: Partial<DocumentOverlayImage> = {
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
    };
    const geometry: Partial<Pick<
      DocumentOverlayImage,
      'xPx' | 'yPx' | 'widthPx' | 'heightPx'
    >> = {
      ...(typeof update.xPx === 'number' ? { xPx: update.xPx } : {}),
      ...(typeof update.yPx === 'number' ? { yPx: update.yPx } : {}),
    };
    if (typeof update.widthPx === 'number') {
      const ratio = selectedOverlay.heightPx / Math.max(1, selectedOverlay.widthPx);
      geometry.widthPx = update.widthPx;
      geometry.heightPx = update.widthPx * ratio;
    } else if (typeof update.heightPx === 'number') {
      const ratio = selectedOverlay.widthPx / Math.max(1, selectedOverlay.heightPx);
      geometry.widthPx = update.heightPx * ratio;
      geometry.heightPx = update.heightPx;
    }
    if (Object.keys(metadata).length > 0) {
      updateOverlay(selectedOverlay.id, metadata, page.id);
    }
    if (Object.keys(geometry).length > 0) {
      commitOverlayGeometry(page.id, selectedOverlay.id, geometry);
    }
  }, [
    availableColumnWidth,
    commitOverlayGeometry,
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
    }, page.id);
    setSelectedOverlayId(overlayId);
    setSelectedFlowImage(null);
    setSelectedStructuredImageIds([]);
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
    removeOverlay(overlay.id, page?.id);
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
  }, [page?.id, removeOverlay]);

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
      updateOverlay(selectedOverlay.id, { placement: wrap }, page?.id);
    } else if (isSpan && page) {
      const widthPx = (
        availableColumnWidth * spanCount
        + page.columnGapPx * (spanCount - 1)
      );
      removeOverlay(selectedOverlay.id, page.id);
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
      const assetId = addAsset(asset.id, asset.source, {
        mimeType: asset.mimeType,
        naturalWidth: asset.naturalWidth,
        naturalHeight: asset.naturalHeight,
        fileName: asset.fileName,
      });
      if (selectedFlowImage) {
        const widthPx = selectedFlowImage.attributes.widthPx;
        bodyEditorRef.current?.chain()
          .focus()
          .setNodeSelection(selectedFlowImage.position)
          .updateSelectedDocumentImage({
            assetId,
            naturalWidth: asset.naturalWidth,
            naturalHeight: asset.naturalHeight,
            heightPx: widthPx * asset.naturalHeight / asset.naturalWidth,
          })
          .run();
      } else if (selectedOverlay) {
        updateOverlay(selectedOverlay.id, {
          assetId,
          naturalWidth: asset.naturalWidth,
          naturalHeight: asset.naturalHeight,
          heightPx: selectedOverlay.widthPx * asset.naturalHeight / asset.naturalWidth,
        }, page?.id);
      }
    } catch (error) {
      setToastMessage(error instanceof Error ? error.message : 'Could not replace the image.');
    }
  }, [
    addAsset,
    page?.id,
    selectedFlowImage,
    selectedOverlay,
    setToastMessage,
    updateOverlay,
  ]);

  const deleteSelectedImage = useCallback(() => {
    if (selectedFlowImage) {
      const editor = bodyEditorRef.current;
      const group = page
        ? findDocumentImageGroupForImage(
            page.imageGroups,
            selectedFlowImage.attributes.id
        )
        : null;
      const selectedPage = page;
      if (editor && selectedPage && group) {
        const model = getStructuredLayoutModel();
        const updatesByImageId: Record<string, Partial<DocumentImageAttributes>> = {};
        model?.images
          .filter((image) => (
            group.childImageIds.includes(image.imageId)
            && image.imageId !== selectedFlowImage.attributes.id
          ))
          .forEach((image) => {
            updatesByImageId[image.imageId] = {
              widthPx: image.renderedImageWidthPx,
              heightPx: image.renderedImageHeightPx,
              horizontalPlacement: 'custom',
              verticalAnchor: 'page-position',
              xOffsetPx: image.imageLeftPx - image.spanLeftPx,
              yPx: image.imageTopPx,
            };
          });
        const nextGroups = removeDocumentImageIdsFromGroups(
          selectedPage.imageGroups,
          [selectedFlowImage.attributes.id]
        );
        const nextPrimary = group.childImageIds.find(
          (imageId) => imageId !== selectedFlowImage.attributes.id
        ) || null;
        commitStructuredDocumentImageBatch(editor, {
          updatesByImageId,
          deleteImageIds: [selectedFlowImage.attributes.id],
          selectedImageId: nextPrimary,
          imageGroupsMeta: nextGroups,
        });
      } else {
        editor?.chain()
          .focus()
          .setNodeSelection(selectedFlowImage.position)
          .deleteSelection()
          .run();
      }
      setSelectedFlowImage(null);
      setSelectedStructuredImageIds([]);
      setSelectedFlowImageId(null);
    } else if (selectedOverlay) {
      removeOverlay(selectedOverlay.id, page?.id);
    }
  }, [
    getStructuredLayoutModel,
    page?.id,
    page,
    removeOverlay,
    selectedFlowImage,
    selectedOverlay,
    setSelectedFlowImageId,
  ]);

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
      setSelectedStructuredImageIds([]);
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

  const exportDocument = useCallback(async (
    format: 'png' | 'pdf',
    scope: 'current' | 'all' = 'current'
  ) => {
    if (!page || !project || isExporting) return;
    setIsExporting(true);
    setToastMessage(`Preparing ${format.toUpperCase()} export…`);
    let cleanupExportPages: (() => void) | undefined;
    try {
      const mounted = await mountCommittedDocumentExportPages(project);
      cleanupExportPages = mounted.cleanup;
      if (format === 'png') {
        if (scope === 'all') {
          await documentExportService.downloadPngPages(
            mounted.sources,
            project.projectName
          );
        } else {
          const source = mounted.sources[activePageIndex];
          if (!source) throw new Error('The selected page is unavailable for export.');
          await documentExportService.downloadPng(source.element, {
            ...source.options,
            fileName: `${project.projectName}-${folioNumber}`,
            onWarning: (warnings) => {
              if (warnings.length > 0) setToastMessage(warnings[0]);
            },
          });
        }
      } else {
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
  }, [
    activePageIndex,
    folioNumber,
    isExporting,
    page,
    project,
    setToastMessage,
  ]);

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
        onExport={(format, scope) => void exportDocument(format, scope)}
        onPrint={() => {
          void mountCommittedDocumentExportPages(project).then((mounted) => (
            documentExportService.printPages(mounted.sources).finally(
              mounted.cleanup
            )
          )).catch((error) => {
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
          missingAssetIds={missingAssetIds}
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
            setSelectedStructuredImageIds([]);
            setSelectedFlowImageId(null);
          }}
        />

        <section className="document-editor-stage" data-testid="document-editor-stage">
          <DocumentToolbar
            page={page}
            activeTextRegion={activeTextRegion}
            selectedImage={selectedInspector}
            selectedImageIds={selectedStructuredImageIds}
            selectedImageGroup={selectedImageGroup
              ? {
                  id: selectedImageGroup.id,
                  kind: selectedImageGroup.kind,
                  childImageIds: selectedImageGroup.childImageIds,
                  gapPx: selectedImageGroup.gapPx,
                  sharedWidth: selectedImageGroup.sharedWidth,
                }
              : null}
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
            onArrangeSelectedImages={arrangeSelectedImages}
            onSelectedImageGroupChange={updateSelectedImageGroup}
            onUngroupSelectedImages={ungroupSelectedImages}
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
                  setSelectedStructuredImageIds([]);
                  setSelectedFlowImageId(null);
                }
              }}
              onUpdateOverlay={(id, geometry) => {
                commitOverlayGeometry(page.id, id, geometry);
              }}
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
                    setSelectedStructuredImageIds([]);
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
                  imageGroups={page.imageGroups}
                  selectedStructuredImageIds={selectedStructuredImageIds}
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
                  onUpdate={(content, editor, transaction) => {
                    const imageGroupsMeta = transaction.getMeta(
                      DOCUMENT_IMAGE_GROUPS_TRANSACTION_META
                    );
                    if (imageGroupsMeta !== undefined) {
                      commitPageImageState(page.id, content, imageGroupsMeta);
                    } else {
                      updateBodyContent(content, page.id);
                    }
                    if (editor.isFocused) updateActiveTextFormatState(editor, 'body');
                  }}
                  onImageSelectionChange={(selection, editor) => {
                    setSelectedFlowImage(selection);
                    setSelectedFlowImageId(selection?.attributes.id || null);
                    if (selection) {
                      setSelectedStructuredImageIds((current) => (
                        current.length > 1 && current.includes(selection.attributes.id)
                          ? current
                          : [selection.attributes.id]
                      ));
                    } else if (editor.isFocused) {
                      setSelectedStructuredImageIds([]);
                    }
                    if (selection || editor.isFocused) setSelectedOverlayId(null);
                  }}
                  onStructuredImageSelectionRequest={
                    handleStructuredImageSelectionRequest
                  }
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
