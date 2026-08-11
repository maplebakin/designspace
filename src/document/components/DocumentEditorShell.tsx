import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Editor, JSONContent } from '@tiptap/core';
import { NodeSelection, TextSelection } from 'prosemirror-state';
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
import {
  documentExportService,
  type DocumentExportDiagnostics,
} from '../services/documentExportService';
import {
  getDeliverySuccessLocation,
  type FileBatchDeliveryResult,
  type FileDeliveryResult,
} from '../../editor/services/fileDeliveryService';
import { isTauriRecoveryAvailable } from '../../editor/recovery/recoveryClient';
import {
  canMoveSelectedStructuredImage,
  clampDocumentImageXOffset,
  calculateDocumentImageFrameHeight,
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
import type {
  DocumentFlowControl,
} from '../extensions/DocumentFlowControlExtension';
import {
  commitStructuredDocumentImagePosition,
  commitStructuredDocumentImageBatch,
  DOCUMENT_IMAGE_GROUPS_TRANSACTION_META,
  FlowEditor,
  getSelectedDocumentImage,
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
import type { SelectionEvent } from '../../editor/session/projectSession';
import type { PageAssetEffect } from '../../editor/session/projectMutation';
import '../styles/document-page.css';
import '../styles/document-print.css';

type DocumentEditorShellProps = {
  onBackToDashboard?: () => void;
  onSelectionEvent?: (event: SelectionEvent) => void;
  useSharedChrome?: boolean;
  onRegisterFitPage?: (fitPage: (() => void) | null) => void;
  onCommittedMutation?: (mutation: DocumentCommittedMutation) => void;
};

export type DocumentCommittedMutation =
  | Readonly<{
      action: 'modify-structured-geometry';
      overlayId: string;
    }>
  | Readonly<{
      action: 'modify-page-metadata';
      pageId: string;
    }>
  | Readonly<{
      action: 'add-structured-overlay' | 'remove-structured-overlay';
      overlayId: string;
      assetEffect: PageAssetEffect;
    }>
  | Readonly<{
      action: 'add-structured-flow-image' | 'remove-structured-flow-image';
      pageId: string;
      flowImageId: string;
      assetEffect: PageAssetEffect;
    }>;

const notifyCommittedMutation = (
  callback: DocumentEditorShellProps['onCommittedMutation'],
  mutation: DocumentCommittedMutation
) => {
  try {
    callback?.(mutation);
  } catch {
    // Optional diagnostics must never interrupt the legacy document action.
  }
};

const notifyCommittedOverlayGeometry = (
  callback: DocumentEditorShellProps['onCommittedMutation'],
  overlayId: string
) => {
  notifyCommittedMutation(callback, {
    action: 'modify-structured-geometry',
    overlayId,
  });
};

const notifyCommittedOverlayLifecycle = (
  callback: DocumentEditorShellProps['onCommittedMutation'],
  action: 'add-structured-overlay' | 'remove-structured-overlay',
  overlayId: string,
  assetEffect: PageAssetEffect
) => {
  notifyCommittedMutation(callback, {
    action,
    overlayId,
    assetEffect,
  });
};

const notifyCommittedPageMetadata = (
  callback: DocumentEditorShellProps['onCommittedMutation'],
  pageId: string
) => {
  notifyCommittedMutation(callback, {
    action: 'modify-page-metadata',
    pageId,
  });
};

const findDocumentFlowImagePositions = (
  editor: Editor,
  imageId: string
) => {
  const positions: number[] = [];
  editor.state.doc.descendants((node, position) => {
    if (
      node.type.name === 'documentFlowImage'
      && node.attrs.id === imageId
    ) {
      positions.push(position);
    }
    return true;
  });
  return positions;
};

const getActiveDocumentPageId = () => {
  const project = useDocumentStore.getState().project;
  return project?.pages.find(
    (_page, index) => index === project.activePageIndex
  )?.id;
};

const notifyCommittedFlowImageLifecycle = (
  callback: DocumentEditorShellProps['onCommittedMutation'],
  action: 'add-structured-flow-image' | 'remove-structured-flow-image',
  pageId: string,
  flowImageId: string,
  assetEffect: PageAssetEffect
) => {
  notifyCommittedMutation(callback, {
    action,
    pageId,
    flowImageId,
    assetEffect,
  });
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
  columnBreakBefore: false,
  keepWithNext: false,
  keepLinesTogether: false,
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
    columnBreakBefore: paragraphAttributes.documentColumnBreakBefore === true,
    keepWithNext: paragraphAttributes.documentKeepWithNext === true,
    keepLinesTogether: paragraphAttributes.documentKeepLinesTogether === true,
  };
};

export const DocumentEditorShell: React.FC<DocumentEditorShellProps> = ({
  onBackToDashboard,
  onSelectionEvent,
  useSharedChrome = false,
  onRegisterFitPage,
  onCommittedMutation,
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
  const [selectedImageGroupId, setSelectedImageGroupId] =
    useState<string | null>(null);
  const [focusedTextRegion, setFocusedTextRegion] =
    useState<DocumentEditorRegion | null>(null);
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
    setSelectedImageGroupId(null);
    setSelectedFlowImageId(null);
    setSelectedOverlayId(null);
    setReferenceAdjustMode(false);
    setFocusedTextRegion(null);
    setTextFormatState(DEFAULT_TEXT_FORMAT_STATE);
  }, [
    page?.id,
    setReferenceAdjustMode,
    setSelectedFlowImageId,
    setSelectedOverlayId,
  ]);

  useEffect(() => {
    if (!page || !onSelectionEvent) return;
    if (focusedTextRegion) {
      onSelectionEvent({
        source: 'document',
        pageId: page.id,
        target: {
          kind: 'structured-text',
          pageId: page.id,
          editor: focusedTextRegion,
        },
        isFocused: true,
        isEditing: true,
      });
      return;
    }
    if (selectedImageGroupId) {
      onSelectionEvent({
        source: 'document',
        pageId: page.id,
        target: {
          kind: 'structured-group',
          pageId: page.id,
          groupId: selectedImageGroupId,
        },
        isFocused: true,
        isEditing: false,
      });
      return;
    }
    const selectedImageId = selectedFlowImage?.attributes.id
      || selectedStructuredImageIds[0]
      || selectedOverlayId;
    if (selectedImageId) {
      onSelectionEvent({
        source: 'document',
        pageId: page.id,
        target: {
          kind: 'structured-image',
          pageId: page.id,
          imageId: selectedImageId,
        },
        isFocused: true,
        isEditing: false,
      });
      return;
    }
    onSelectionEvent({
      source: 'document',
      pageId: page.id,
      target: { kind: 'none' },
      isFocused: false,
      isEditing: false,
    });
  }, [
    focusedTextRegion,
    onSelectionEvent,
    page,
    selectedFlowImage,
    selectedImageGroupId,
    selectedOverlayId,
    selectedStructuredImageIds,
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
      if (
        event.key === 'Escape'
        && (
          selectedFlowImage
          || selectedImageGroupId
          || selectedStructuredImageIds.length > 0
          || selectedOverlayId
          || isReferenceAdjustMode
        )
      ) {
        event.preventDefault();
        if (selectedFlowImage && page) {
          const childGroup = findDocumentImageGroupForImage(
            page.imageGroups,
            selectedFlowImage.attributes.id
          );
          if (childGroup && !selectedImageGroupId) {
            setSelectedImageGroupId(childGroup.id);
            setSelectedStructuredImageIds([...childGroup.childImageIds]);
            return;
          }
        }
        if (selectedImageGroupId) {
          const editor = bodyEditorRef.current;
          if (
            editor
            && !editor.isDestroyed
            && editor.state.selection instanceof NodeSelection
          ) {
            editor.view.dispatch(
              editor.state.tr.setSelection(
                TextSelection.near(
                  editor.state.doc.resolve(editor.state.selection.from),
                  -1
                )
              )
            );
          }
          setSelectedImageGroupId(null);
          setSelectedStructuredImageIds([]);
          setSelectedFlowImage(null);
          setSelectedFlowImageId(null);
          return;
        }
        setSelectedOverlayId(null);
        setSelectedFlowImage(null);
        setSelectedFlowImageId(null);
        setSelectedStructuredImageIds([]);
        setSelectedImageGroupId(null);
        setReferenceAdjustMode(false);
        return;
      }
      if (editable) return;
      if (
        event.shiftKey
        && !isMeta
        && event.key.toLowerCase() === 'r'
        && page?.reference
      ) {
        event.preventDefault();
        setReference({
          ...page.reference,
          visible: !page.reference.visible,
        });
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedOverlayId) {
        event.preventDefault();
        const committed = removeOverlay(selectedOverlayId, page?.id);
        if (committed) {
          notifyCommittedOverlayLifecycle(
            onCommittedMutation,
            'remove-structured-overlay',
            selectedOverlayId,
            'cleanup-delegated'
          );
        }
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
        const committed = nudgeOverlay(
          page.id,
          selectedOverlayId,
          deltaXPx,
          deltaYPx
        );
        if (committed) {
          notifyCommittedOverlayGeometry(onCommittedMutation, selectedOverlayId);
        }
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
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    nudgeOverlay,
    onCommittedMutation,
    page,
    physicalMargins,
    project?.document.language,
    removeOverlay,
    saveProject,
    selectedFlowImage,
    selectedImageGroupId,
    selectedStructuredImageIds,
    selectedOverlayId,
    isReferenceAdjustMode,
    setReferenceAdjustMode,
    setSelectedFlowImageId,
    setSelectedOverlayId,
    setSelectedStructuredImageIds,
    setReference,
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
  ): boolean => {
    const pageId = getActiveDocumentPageId();
    const editor = bodyEditorRef.current;
    if (!pageId || !editor || editor.isDestroyed) {
      setToastMessage('The document body is still initializing.');
      return false;
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
    if (!inserted) return false;
    const imagePositions = findDocumentFlowImagePositions(editor, imageId);
    if (imagePositions.length !== 1) return false;
    editor.chain().focus().setNodeSelection(imagePositions[0]).run();
    notifyCommittedFlowImageLifecycle(
      onCommittedMutation,
      'add-structured-flow-image',
      pageId,
      imageId,
      'retained-reference'
    );
    return true;
  }, [
    addAsset,
    availableColumnWidth,
    onCommittedMutation,
    setToastMessage,
  ]);

  const importImages = useCallback(async (
    files: File[],
    position?: number
  ) => {
    let nextPosition = position;
    for (const file of files) {
      try {
        const asset = await ingestDocumentImage(file);
        if (insertAssetIntoBody(asset, nextPosition)) {
          nextPosition = undefined;
        }
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

  const handleFlowControl = useCallback((control: DocumentFlowControl) => {
    const editor = bodyEditorRef.current;
    if (!editor || editor.isDestroyed) return;
    const chain = editor.chain().focus();
    if (control === 'column-break') chain.toggleDocumentColumnBreak().run();
    if (control === 'keep-with-next') chain.toggleDocumentKeepWithNext().run();
    if (control === 'keep-lines-together') {
      chain.toggleDocumentKeepLinesTogether().run();
    }
    if (project) updateActiveTextFormatState(editor, 'body');
  }, [project, updateActiveTextFormatState]);

  const selectedOverlay = page?.overlayObjects.find(
    (object) => object.id === selectedOverlayId
  ) || null;
  const selectedImageGroup = useMemo(() => {
    if (!page || selectedStructuredImageIds.length < 2) return null;
    const selected = new Set(selectedStructuredImageIds);
    return page.imageGroups.find((group) => (
      (!selectedImageGroupId || group.id === selectedImageGroupId)
      && group.childImageIds.length === selected.size
      && group.childImageIds.every((imageId) => selected.has(imageId))
    )) || null;
  }, [page, selectedImageGroupId, selectedStructuredImageIds]);

  const handleStructuredImageSelectionRequest = useCallback((
    imageId: string,
    additive: boolean
  ): string | null => {
    if (!page) return imageId;
    const group = findDocumentImageGroupForImage(page.imageGroups, imageId);
    if (group && !additive) {
      if (selectedImageGroupId === group.id) {
        setSelectedImageGroupId(null);
        setSelectedStructuredImageIds([imageId]);
        return imageId;
      }
      setSelectedImageGroupId(group.id);
      setSelectedStructuredImageIds([...group.childImageIds]);
      return imageId;
    }
    if (!additive) {
      setSelectedImageGroupId(null);
      setSelectedStructuredImageIds([imageId]);
      return imageId;
    }
    setSelectedImageGroupId(null);
    const current = selectedStructuredImageIds;
    if (current.includes(imageId)) {
      const remaining = current.filter((candidate) => candidate !== imageId);
      setSelectedStructuredImageIds(remaining);
      return remaining[0] || imageId;
    }
    const next = [...current, imageId];
    setSelectedStructuredImageIds(next);
    return imageId;
  }, [page, selectedImageGroupId, selectedStructuredImageIds]);

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
    const updatesByImageId: Record<string, Partial<DocumentImageAttributes>> = {};
    editor.state.doc.descendants((node) => {
        if (
          node.type.name === 'documentFlowImage'
        && selected.has(String(node.attrs.id))
      ) {
        const imageId = String(node.attrs.id);
        ordered.push(imageId);
        updatesByImageId[imageId] = {
          wrap: 'span-columns',
          spanCount: 1,
          spanStartColumn: 1,
          verticalAnchor: 'page-position',
          horizontalPlacement: 'custom',
          xOffsetPx: 0,
          yPx: Number.isFinite(Number(node.attrs.yPx))
            ? Math.max(0, Number(node.attrs.yPx))
            : 24,
        };
      }
      return true;
    });
    if (
      ordered.length < 2
      || ordered.length !== selected.size
      || ordered.some((id) => findDocumentImageGroupForImage(
        page.imageGroups,
        id
      ))
    ) {
      setToastMessage('Select two or more ungrouped flow images.');
      return;
    }
    const group: DocumentImageGroup = {
      id: uuidv4(),
      kind,
      childImageIds: ordered,
      gapPx: 16,
      sharedWidth: false,
    };
    if (!commitStructuredDocumentImageBatch(editor, {
      updatesByImageId,
      selectedImageId: ordered[0],
      imageGroupsMeta: [...page.imageGroups, group],
    })) return;
    setSelectedStructuredImageIds(ordered);
    setSelectedImageGroupId(group.id);
  }, [
    commitStructuredDocumentImageBatch,
    page,
    selectedStructuredImageIds,
    setToastMessage,
  ]);

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
    setSelectedImageGroupId(null);
  }, [
    commitStructuredDocumentImageBatch,
    getStructuredLayoutModel,
    page,
    selectedFlowImage,
    selectedImageGroup,
  ]);

  type SelectedImageAlignment =
    'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

  const commitStructuredSelectionGeometry = useCallback((
    alignment?: SelectedImageAlignment,
    distribution?: 'horizontal' | 'vertical'
  ) => {
    const editor = bodyEditorRef.current;
    const model = getStructuredLayoutModel();
    if (!editor || !model || !page) return;
    const ids = selectedImageGroup
      ? selectedImageGroup.childImageIds
      : selectedStructuredImageIds;
    const images = model.images.filter((image) => ids.includes(image.imageId));
    if (images.length < 2) return;
    if (distribution && selectedImageGroup) {
      setToastMessage('Distribute works on separate selected images.');
      return;
    }
    const bounds = images.reduce((current, image) => ({
      leftPx: Math.min(current.leftPx, image.imageLeftPx),
      topPx: Math.min(current.topPx, image.imageTopPx),
      rightPx: Math.max(
        current.rightPx,
        image.imageLeftPx + image.renderedImageWidthPx
      ),
      bottomPx: Math.max(
        current.bottomPx,
        image.imageTopPx + image.imageRegionHeightPx
      ),
    }), {
      leftPx: Number.POSITIVE_INFINITY,
      topPx: Number.POSITIVE_INFINITY,
      rightPx: Number.NEGATIVE_INFINITY,
      bottomPx: Number.NEGATIVE_INFINITY,
    });
    const offsets = new Map<string, { xPx: number; yPx: number }>();
    if (alignment) {
      const targetX = alignment === 'left'
        ? 0
        : alignment === 'right'
          ? model.availableWidthPx
          : alignment === 'center'
            ? model.availableWidthPx / 2
            : null;
      const targetY = alignment === 'top'
        ? 0
        : alignment === 'bottom'
          ? model.availableHeightPx
          : alignment === 'middle'
            ? model.availableHeightPx / 2
            : null;
      const deltaX = targetX === null
        ? 0
        : alignment === 'left'
          ? targetX - bounds.leftPx
          : alignment === 'right'
            ? targetX - bounds.rightPx
            : targetX - (bounds.leftPx + bounds.rightPx) / 2;
      const deltaY = targetY === null
        ? 0
        : alignment === 'top'
          ? targetY - bounds.topPx
          : alignment === 'bottom'
            ? targetY - bounds.bottomPx
            : targetY - (bounds.topPx + bounds.bottomPx) / 2;
      images.forEach((image) => offsets.set(image.imageId, {
        xPx: image.imageLeftPx + deltaX,
        yPx: image.imageTopPx + deltaY,
      }));
    } else if (distribution) {
      const ordered = [...images].sort((left, right) => (
        distribution === 'horizontal'
          ? left.imageLeftPx - right.imageLeftPx
          : left.imageTopPx - right.imageTopPx
      ));
      const totalSize = ordered.reduce((sum, image) => sum + (
        distribution === 'horizontal'
          ? image.renderedImageWidthPx
          : image.imageRegionHeightPx
      ), 0);
      const available = (distribution === 'horizontal'
        ? bounds.rightPx - bounds.leftPx
        : bounds.bottomPx - bounds.topPx) - totalSize;
      const gap = Math.max(0, available / Math.max(1, ordered.length - 1));
      let cursor = distribution === 'horizontal' ? bounds.leftPx : bounds.topPx;
      ordered.forEach((image) => {
        offsets.set(image.imageId, {
          xPx: distribution === 'horizontal' ? cursor : image.imageLeftPx,
          yPx: distribution === 'vertical' ? cursor : image.imageTopPx,
        });
        cursor += (distribution === 'horizontal'
          ? image.renderedImageWidthPx
          : image.imageRegionHeightPx) + gap;
      });
    }
    const updatesByImageId: Record<string, Partial<DocumentImageAttributes>> = {};
    images.forEach((image) => {
      const offset = offsets.get(image.imageId);
      if (!offset) return;
      updatesByImageId[image.imageId] = {
        horizontalPlacement: 'custom',
        verticalAnchor: 'page-position',
        xOffsetPx: clampDocumentImageXOffset(
          offset.xPx - image.spanLeftPx,
          image.spanWidthPx,
          image.renderedImageWidthPx
        ),
        yPx: Math.max(0, offset.yPx),
      };
    });
    commitStructuredDocumentImageBatch(editor, {
      updatesByImageId,
      selectedImageId: selectedFlowImage?.attributes.id || images[0].imageId,
      imageGroupsMeta: page.imageGroups,
    });
  }, [
    commitStructuredDocumentImageBatch,
    getStructuredLayoutModel,
    page,
    selectedFlowImage,
    selectedImageGroup,
    selectedStructuredImageIds,
    setToastMessage,
  ]);

  const alignSelectedImages = useCallback((alignment: SelectedImageAlignment) => {
    commitStructuredSelectionGeometry(alignment);
  }, [commitStructuredSelectionGeometry]);

  const distributeSelectedImages = useCallback((axis: 'horizontal' | 'vertical') => {
    commitStructuredSelectionGeometry(undefined, axis);
  }, [commitStructuredSelectionGeometry]);
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
          cropMode: selectedFlowImage.attributes.cropMode,
          cropFocalX: selectedFlowImage.attributes.cropFocalX,
          cropFocalY: selectedFlowImage.attributes.cropFocalY,
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
            cropMode: selectedOverlay.cropMode || 'fit',
            cropFocalX: selectedOverlay.cropFocalX ?? 0.5,
            cropFocalY: selectedOverlay.cropFocalY ?? 0.5,
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
        ...(update.cropMode === 'fit' || update.cropMode === 'fill'
          ? { cropMode: update.cropMode }
          : {}),
        ...(typeof update.cropFocalX === 'number'
          ? { cropFocalX: Math.min(1, Math.max(0, update.cropFocalX)) }
          : {}),
        ...(typeof update.cropFocalY === 'number'
          ? { cropFocalY: Math.min(1, Math.max(0, update.cropFocalY)) }
          : {}),
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
        const cropMode = update.cropMode === 'fill'
          || (update.cropMode === undefined
            && selectedFlowImage.attributes.cropMode === 'fill')
          ? 'fill'
          : 'fit';
        if (cropMode === 'fit') next.heightPx = widthPx * ratio;
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
        const cropMode = update.cropMode === 'fill'
          || (update.cropMode === undefined
            && selectedFlowImage.attributes.cropMode === 'fill')
          ? 'fill'
          : 'fit';
        if (cropMode === 'fill') {
          next.heightPx = Math.max(1, update.heightPx);
        } else {
          const widthPx = Math.min(desiredWidthPx, maximumWidth);
          next.widthPx = widthPx;
          next.heightPx = widthPx / Math.max(0.0001, aspectRatio);
        }
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
      ...(update.cropMode === 'fit' || update.cropMode === 'fill'
        ? { cropMode: update.cropMode }
        : {}),
      ...(typeof update.cropFocalX === 'number'
        ? { cropFocalX: Math.min(1, Math.max(0, update.cropFocalX)) }
        : {}),
      ...(typeof update.cropFocalY === 'number'
        ? { cropFocalY: Math.min(1, Math.max(0, update.cropFocalY)) }
        : {}),
    };
    const geometry: Partial<Pick<
      DocumentOverlayImage,
      'xPx' | 'yPx' | 'widthPx' | 'heightPx'
    >> = {
      ...(typeof update.xPx === 'number' ? { xPx: update.xPx } : {}),
      ...(typeof update.yPx === 'number' ? { yPx: update.yPx } : {}),
    };
    const cropMode = update.cropMode === 'fill'
      || (update.cropMode === undefined && selectedOverlay.cropMode === 'fill')
      ? 'fill'
      : 'fit';
    if (typeof update.widthPx === 'number') {
      const ratio = selectedOverlay.heightPx / Math.max(1, selectedOverlay.widthPx);
      geometry.widthPx = update.widthPx;
      if (cropMode === 'fit') geometry.heightPx = update.widthPx * ratio;
    } else if (typeof update.heightPx === 'number') {
      const ratio = selectedOverlay.widthPx / Math.max(1, selectedOverlay.heightPx);
      if (cropMode === 'fill') {
        geometry.heightPx = update.heightPx;
      } else {
        geometry.widthPx = update.heightPx * ratio;
        geometry.heightPx = update.heightPx;
      }
    }
    if (Object.keys(metadata).length > 0) {
      updateOverlay(selectedOverlay.id, metadata, page.id);
    }
    if (Object.keys(geometry).length > 0) {
      const committed = commitOverlayGeometry(page.id, selectedOverlay.id, geometry);
      if (committed) {
        notifyCommittedOverlayGeometry(onCommittedMutation, selectedOverlay.id);
      }
    }
  }, [
    availableColumnWidth,
    commitOverlayGeometry,
    onCommittedMutation,
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
    const committed = addOverlay({
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
      cropMode: attributes.cropMode,
      cropFocalX: attributes.cropFocalX,
      cropFocalY: attributes.cropFocalY,
      locked: false,
    }, page.id);
    if (!committed) return;
    notifyCommittedOverlayLifecycle(
      onCommittedMutation,
      'add-structured-overlay',
      overlayId,
      'retained-reference'
    );
    setSelectedOverlayId(overlayId);
    setSelectedFlowImage(null);
    setSelectedStructuredImageIds([]);
    setSelectedFlowImageId(null);
  }, [
    addOverlay,
    onCommittedMutation,
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
      cropMode: overlay.cropMode,
      cropFocalX: overlay.cropFocalX,
      cropFocalY: overlay.cropFocalY,
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
        editor.chain()
          .focus()
          .setNodeSelection(selectedFlowImage.position)
          .updateSelectedDocumentImage({
            wrap: 'span-columns',
            spanCount,
            spanStartColumn,
            widthPx: spanWidth,
            heightPx: calculateDocumentImageFrameHeight(
              selectedFlowImage.attributes,
              spanWidth
            ),
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
        cropMode: selectedOverlay.cropMode,
        cropFocalX: selectedOverlay.cropFocalX,
        cropFocalY: selectedOverlay.cropFocalY,
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

  const commitFlowImageRemoval = useCallback((
    editor: Editor,
    flowImageId: string
  ) => {
    const pageId = getActiveDocumentPageId();
    if (!pageId || editor.isDestroyed || !flowImageId) return false;
    const imagePositions = findDocumentFlowImagePositions(editor, flowImageId);
    if (imagePositions.length !== 1) return false;

    const currentPage = useDocumentStore.getState().project?.pages.find(
      (candidate) => candidate.id === pageId
    );
    const group = findDocumentImageGroupForImage(
      currentPage?.imageGroups || [],
      flowImageId
    );
    let committed = false;
    if (group) {
      const model = getStructuredLayoutModel();
      const updatesByImageId: Record<string, Partial<DocumentImageAttributes>> = {};
      model?.images
        .filter((image) => (
          group.childImageIds.includes(image.imageId)
          && image.imageId !== flowImageId
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
        currentPage?.imageGroups || [],
        [flowImageId]
      );
      const nextPrimary = group.childImageIds.find(
        (imageId) => imageId !== flowImageId
      ) || null;
      committed = commitStructuredDocumentImageBatch(editor, {
        updatesByImageId,
        deleteImageIds: [flowImageId],
        selectedImageId: nextPrimary,
        imageGroupsMeta: nextGroups,
      });
    } else {
      committed = editor.chain()
        .focus()
        .setNodeSelection(imagePositions[0])
        .deleteSelection()
        .run();
    }
    if (!committed || findDocumentFlowImagePositions(editor, flowImageId).length > 0) {
      return false;
    }
    notifyCommittedFlowImageLifecycle(
      onCommittedMutation,
      'remove-structured-flow-image',
      pageId,
      flowImageId,
      'cleanup-delegated'
    );
    return true;
  }, [
    getStructuredLayoutModel,
    onCommittedMutation,
    page,
  ]);

  const deleteSelectedImage = useCallback(() => {
    if (selectedFlowImage) {
      const editor = bodyEditorRef.current;
      if (
        editor
        && selectedFlowImage.nodeType === 'documentFlowImage'
      ) {
        commitFlowImageRemoval(editor, selectedFlowImage.attributes.id);
      } else if (editor) {
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
      const committed = removeOverlay(selectedOverlay.id, page?.id);
      if (committed) {
        notifyCommittedOverlayLifecycle(
          onCommittedMutation,
          'remove-structured-overlay',
          selectedOverlay.id,
          'cleanup-delegated'
        );
      }
    }
  }, [
    commitFlowImageRemoval,
    onCommittedMutation,
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

  const resetSelectedImageCrop = useCallback(() => {
    updateSelectedImage({
      cropMode: 'fit',
      cropFocalX: 0.5,
      cropFocalY: 0.5,
    });
  }, [updateSelectedImage]);

  const handleNodeReplaceRequest = useCallback((
    request: DocumentImageReplaceRequest
  ) => {
    pendingNodeReplaceRef.current = request;
    nodeReplaceInputRef.current?.click();
  }, []);

  const handleReferenceAdjustModeChange = useCallback((enabled: boolean) => {
    if (enabled) {
      if (page?.reference?.locked) {
        setReference({ ...page.reference, locked: false });
      }
      setSelectedFlowImage(null);
      setSelectedStructuredImageIds([]);
      setSelectedFlowImageId(null);
      setSelectedOverlayId(null);
    }
    setReferenceAdjustMode(enabled);
  }, [
    setReferenceAdjustMode,
    page,
    setReference,
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

  useEffect(() => {
    if (!onRegisterFitPage) return;
    onRegisterFitPage(fitPage);
    return () => onRegisterFitPage(null);
  }, [fitPage, onRegisterFitPage]);

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

  const fitReferenceToPage = useCallback(() => {
    if (!page?.reference) return;
    setReference({
      ...page.reference,
      fit: 'contain',
      scale: 1,
      offsetXPx: 0,
      offsetYPx: 0,
    });
  }, [page, setReference]);

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
      const exportSources = mounted.sources.map((source) => ({
        ...source,
        options: {
          ...source.options,
          onWarning: (warnings: readonly string[]) => {
            if (warnings.length > 0) setToastMessage(warnings[0]);
          },
          onDiagnostics: (diagnostics: DocumentExportDiagnostics) => {
            if (isTauriRecoveryAvailable() && import.meta.env.DEV) {
              console.info('[Design Space export diagnostics]', diagnostics);
            }
          },
        },
      }));
      let delivery: FileDeliveryResult | FileBatchDeliveryResult | undefined;
      if (format === 'png') {
        if (scope === 'all') {
          const result = await documentExportService.downloadPngPages(
            exportSources,
            project.projectName
          );
          delivery = result.delivery;
        } else {
          const source = exportSources[activePageIndex];
          if (!source) throw new Error('The selected page is unavailable for export.');
          const result = await documentExportService.downloadPng(source.element, {
            ...source.options,
            fileName: `${project.projectName}-${folioNumber}`,
          });
          delivery = result.delivery;
        }
      } else {
        const result = await documentExportService.downloadPdfPages(
          exportSources,
          project.projectName
        );
        delivery = result.delivery;
      }
      if (delivery?.status === 'cancelled') {
        setToastMessage(`${format.toUpperCase()} export cancelled.`);
        return;
      }
      const location = delivery ? getDeliverySuccessLocation(delivery) : null;
      setToastMessage(location
        ? `${format.toUpperCase()} export saved to ${location}.`
        : `${format.toUpperCase()} export downloaded.`);
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

  const shellClassName = `document-editor-shell${useSharedChrome ? ' document-editor-shell--embedded' : ''}`;

  if (!project || !page) {
    return (
      <div data-testid="document-editor-shell" className={shellClassName}>
        <p>Document project could not be loaded.</p>
        <button type="button" onClick={onBackToDashboard}>Back to Projects</button>
      </div>
    );
  }

  return (
    <div
      className={shellClassName}
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
        showProjectControls={!useSharedChrome}
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
            if (orientation === page.size.orientation) return;
            updatePage(updateDocumentPagePaper(page, { orientation }));
            const committedPage = useDocumentStore.getState().project?.pages.find(
              (candidate) => candidate.id === page.id
            );
            if (committedPage?.size.orientation === orientation) {
              notifyCommittedPageMetadata(onCommittedMutation, page.id);
            }
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
          onSuppressTitleChange={(suppressTitle) =>
            updatePage({ suppressTitle })}
          onMarginChange={(side, value) => updatePage({
            margins: constrainDocumentPageMargins(
              { ...page.margins, [side]: value },
              page.size.widthIn,
              page.size.heightIn
            ),
          })}
          onColumnCountChange={(columnCount) => {
            if (columnCount === page.columnCount) return;
            updatePage({ columnCount });
            notifyCommittedPageMetadata(onCommittedMutation, page.id);
          }}
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
              setReference({ ...page.reference, ...update });
            }
          }}
          onResetReference={() => {
            if (page.reference) {
              setReference({
                ...page.reference,
                offsetXPx: 0,
                offsetYPx: 0,
                scale: 1,
              });
            }
          }}
          onToggleReferenceLock={() => {
            if (page.reference) {
              const locked = !page.reference.locked;
              setReference({ ...page.reference, locked });
              if (locked) setReferenceAdjustMode(false);
            }
          }}
          onFitReferenceToPage={fitReferenceToPage}
          onSelectOverlay={(id) => {
            setSelectedOverlayId(id);
            setSelectedFlowImage(null);
            setSelectedStructuredImageIds([]);
            setSelectedImageGroupId(null);
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
            onFlowControl={handleFlowControl}
            onImportImages={(files) => void importImages(files)}
            onReferenceAdjustModeChange={handleReferenceAdjustModeChange}
            onReferenceChange={(update) => {
              if (page.reference) {
                setReference({ ...page.reference, ...update });
              }
            }}
            onResetReference={() => {
              if (page.reference) {
                setReference({
                  ...page.reference,
                  offsetXPx: 0,
                  offsetYPx: 0,
                  scale: 1,
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
            onResetSelectedImageCrop={resetSelectedImageCrop}
            onArrangeSelectedImages={arrangeSelectedImages}
            onSelectedImageGroupChange={updateSelectedImageGroup}
            onUngroupSelectedImages={ungroupSelectedImages}
            onAlignSelectedImages={alignSelectedImages}
            onDistributeSelectedImages={distributeSelectedImages}
          />

          {!useSharedChrome && <DocumentPageNavigation
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
          />}

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
                  setReference({ ...page.reference, ...update });
                }
              }}
              onSelectOverlay={(id) => {
                setSelectedOverlayId(id);
                if (id) {
                  setSelectedFlowImage(null);
                  setSelectedStructuredImageIds([]);
                  setSelectedImageGroupId(null);
                  setSelectedFlowImageId(null);
                }
              }}
              onUpdateOverlay={(id, geometry) => {
                const committed = commitOverlayGeometry(page.id, id, geometry);
                if (committed) {
                  notifyCommittedOverlayGeometry(onCommittedMutation, id);
                }
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
                    setFocusedTextRegion(focused ? 'title' : null);
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
                  pageId={page.id}
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
                    const selectedImage = getSelectedDocumentImage(editor);
                    setFocusedTextRegion(
                      focused && !selectedImage ? 'body' : null
                    );
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
                    setFocusedTextRegion(
                      selection ? null : editor.isFocused ? 'body' : null
                    );
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
                  onImageSelectionRequest={(
                    imageId,
                    additive
                  ) => {
                    handleStructuredImageSelectionRequest(imageId, additive);
                  }}
                  onRequestImageReplace={handleNodeReplaceRequest}
                  onDeleteFlowImage={commitFlowImageRemoval}
                  onPasteDispatch={handlePasteDispatch}
                  onDropDispatch={handleDropDispatch}
                  onOverflowChange={setOverflowing}
                />
              )}
            />
          </main>

          {!useSharedChrome && <DocumentZoomControls
            zoom={zoom}
            fitMode={fitMode}
            onZoomChange={handleManualZoomChange}
            onFitPage={fitPage}
          />}
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
