import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  type Editor,
  type JSONContent,
} from '@tiptap/core';
import {
  NodeSelection,
  TextSelection,
  type Transaction,
} from '@tiptap/pm/state';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  DocumentAlignmentExtension,
} from '../extensions/DocumentAlignmentExtension';
import {
  DOCUMENT_IMAGE_NODE_NAMES,
  DocumentFlowImageExtension,
  DocumentImageCommandsExtension,
  DocumentInlineImageExtension,
  calculateDocumentImageXOffset,
  findDocumentImagePositionById,
  getDocumentImageSpanDimensions,
  normalizeDocumentImageAttributes,
  normalizeDocumentImageSpanForColumnCount,
  selectDocumentImageById,
  type DocumentImageAttributes,
  type DocumentImageNodeName,
  type DocumentImageReplaceRequest,
} from '../extensions/DocumentImageExtension';
import {
  DocumentTextStyleExtension,
} from '../extensions/DocumentTextStyleExtension';
import {
  DocumentBlockStyleExtension,
} from '../extensions/DocumentBlockStyleExtension';
import {
  DocumentFlowControlExtension,
} from '../extensions/DocumentFlowControlExtension';
import {
  SanitizedPasteExtension,
  sanitizeDocumentPastedText,
} from '../extensions/SanitizedPasteExtension';
import type {
  DocumentPasteDispatcher,
} from './TitleEditor';
import '../styles/document-page.css';
import '../styles/document-print.css';
import {
  measureDocumentPagePositionOriginOffsetPx,
  StructuredDocumentSpanLayout,
} from './StructuredDocumentSpanLayout';
import {
  normalizeDocumentDropCap,
  type DocumentDropCapSettings,
} from '../typography/documentTypography';
import {
  normalizeDocumentImageContentGeometry,
  type DocumentImageGroup,
} from '../types/documentProject';

const EMPTY_DOCUMENT: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

export type DocumentColumnCount = 1 | 2 | 3;

export interface SelectedDocumentImage {
  position: number;
  nodeType: DocumentImageNodeName;
  attributes: DocumentImageAttributes;
}

export const getSelectedDocumentImage = (
  editor: Editor
): SelectedDocumentImage | null => {
  const selection = editor.state.selection;
  if (
    !(selection instanceof NodeSelection)
    || !DOCUMENT_IMAGE_NODE_NAMES.includes(
      selection.node.type.name as DocumentImageNodeName
    )
  ) {
    return null;
  }
  const nodeType = selection.node.type.name as DocumentImageNodeName;
  return {
    position: selection.from,
    nodeType,
    attributes: normalizeDocumentImageAttributes(
      selection.node.attrs as Partial<DocumentImageAttributes>,
      nodeType === 'documentInlineImage' ? 'inline' : 'float-left'
    ),
  };
};

export const commitStructuredDocumentImagePosition = (
  editor: Editor,
  _expectedPosition: number,
  imageId: string,
  xOffsetPx: number,
  yPx: number
) => {
  if (editor.isDestroyed) return false;
  const targetPosition = findDocumentImagePositionById(
    editor,
    imageId,
    'documentFlowImage'
  );
  if (targetPosition === null) return false;
  const targetNode = editor.state.doc.nodeAt(targetPosition);
  if (!targetNode) return false;

  const nextAttributes = normalizeDocumentImageAttributes({
    ...(targetNode.attrs as Partial<DocumentImageAttributes>),
    coordinateSpace: 'page',
    verticalAnchor: 'page-position',
    horizontalPlacement: 'custom',
    xOffsetPx,
    yPx,
  });
  const transaction = editor.state.tr
    .setNodeMarkup(targetPosition, undefined, nextAttributes);
  transaction.setSelection(
    NodeSelection.create(transaction.doc, targetPosition)
  );
  editor.view.dispatch(transaction);
  editor.view.focus();

  const committedNode = editor.state.doc.nodeAt(targetPosition);
  return (
    committedNode?.type.name === 'documentFlowImage'
    && committedNode.attrs.id === imageId
    && committedNode.attrs.verticalAnchor === 'page-position'
    && committedNode.attrs.horizontalPlacement === 'custom'
    && committedNode.attrs.xOffsetPx === nextAttributes.xOffsetPx
    && committedNode.attrs.yPx === nextAttributes.yPx
  );
};

export const commitStructuredDocumentImageSize = (
  editor: Editor,
  _expectedPosition: number,
  imageId: string,
  widthPx: number,
  heightPx: number,
  xOffsetPx: number
) => {
  if (editor.isDestroyed) return false;
  const targetPosition = findDocumentImagePositionById(
    editor,
    imageId,
    'documentFlowImage'
  );
  if (targetPosition === null) return false;
  const targetNode = editor.state.doc.nodeAt(targetPosition);
  if (!targetNode) return false;

  const nextAttributes = normalizeDocumentImageAttributes({
    ...(targetNode.attrs as Partial<DocumentImageAttributes>),
    widthPx,
    heightPx,
    xOffsetPx,
  });
  const transaction = editor.state.tr
    .setNodeMarkup(targetPosition, undefined, nextAttributes);
  transaction.setSelection(
    NodeSelection.create(transaction.doc, targetPosition)
  );
  editor.view.dispatch(transaction);
  editor.view.focus();

  const committedNode = editor.state.doc.nodeAt(targetPosition);
  return (
    committedNode?.type.name === 'documentFlowImage'
    && committedNode.attrs.id === imageId
    && committedNode.attrs.widthPx === nextAttributes.widthPx
    && committedNode.attrs.heightPx === nextAttributes.heightPx
    && committedNode.attrs.xOffsetPx === nextAttributes.xOffsetPx
  );
};

export const DOCUMENT_IMAGE_GROUPS_TRANSACTION_META =
  'designSpaceDocumentImageGroups';

export type StructuredDocumentImageBatch = {
  updatesByImageId?: Readonly<
    Record<string, Partial<DocumentImageAttributes>>
  >;
  deleteImageIds?: readonly string[];
  selectedImageId?: string | null;
  imageGroupsMeta?: unknown;
  focus?: boolean;
};

/**
 * Applies a stable-ID image batch in one ProseMirror transaction. Group
 * operations use the transaction metadata to commit page-level group records
 * alongside the resulting body JSON in one store revision.
 */
export const commitStructuredDocumentImageBatch = (
  editor: Editor,
  {
    updatesByImageId = {},
    deleteImageIds = [],
    selectedImageId = null,
    imageGroupsMeta,
    focus = true,
  }: StructuredDocumentImageBatch
) => {
  if (editor.isDestroyed) return false;
  const requestedIds = new Set([
    ...Object.keys(updatesByImageId),
    ...deleteImageIds,
    ...(selectedImageId ? [selectedImageId] : []),
  ]);
  const positions = new Map<string, number[]>();
  editor.state.doc.descendants((node, position) => {
    if (
      (
        node.type.name === 'documentFlowImage'
        || node.type.name === 'documentInlineImage'
      )
      && requestedIds.has(String(node.attrs.id))
    ) {
      const id = String(node.attrs.id);
      positions.set(id, [...(positions.get(id) || []), position]);
    }
    return true;
  });
  if ([...requestedIds].some((id) => positions.get(id)?.length !== 1)) {
    return false;
  }

  const deleted = new Set(deleteImageIds);
  let transaction = editor.state.tr;
  deleteImageIds
    .map((id) => ({
      id,
      position: positions.get(id)?.[0] ?? -1,
    }))
    .sort((left, right) => right.position - left.position)
    .forEach(({ position }) => {
      const mappedPosition = transaction.mapping.map(position);
      const node = transaction.doc.nodeAt(mappedPosition);
      if (node) {
        transaction = transaction.delete(
          mappedPosition,
          mappedPosition + node.nodeSize
        );
      }
    });

  Object.entries(updatesByImageId).forEach(([imageId, update]) => {
    if (deleted.has(imageId)) return;
    const originalPosition = positions.get(imageId)?.[0];
    if (originalPosition === undefined) return;
    const mappedPosition = transaction.mapping.map(originalPosition);
    const node = transaction.doc.nodeAt(mappedPosition);
    if (
      !node
      || (
        node.type.name !== 'documentFlowImage'
        && node.type.name !== 'documentInlineImage'
      )
      || node.attrs.id !== imageId
    ) {
      return;
    }
    transaction = transaction.setNodeMarkup(
      mappedPosition,
      undefined,
      normalizeDocumentImageAttributes({
        ...(node.attrs as Partial<DocumentImageAttributes>),
        ...update,
      })
    );
  });

  if (selectedImageId && !deleted.has(selectedImageId)) {
    const originalPosition = positions.get(selectedImageId)?.[0];
    if (originalPosition !== undefined) {
      const mappedPosition = transaction.mapping.map(originalPosition);
      const node = transaction.doc.nodeAt(mappedPosition);
      if (
        node
        && (
          node.type.name === 'documentFlowImage'
          || node.type.name === 'documentInlineImage'
        )
        && node.attrs.id === selectedImageId
      ) {
        transaction = transaction.setSelection(
          NodeSelection.create(transaction.doc, mappedPosition)
        );
      }
    }
  }
  if (imageGroupsMeta !== undefined) {
    transaction = transaction.setMeta(
      DOCUMENT_IMAGE_GROUPS_TRANSACTION_META,
      imageGroupsMeta
    );
  }
  if (!transaction.docChanged && imageGroupsMeta === undefined) return false;
  editor.view.dispatch(transaction);
  if (focus) editor.view.focus();
  return true;
};

export interface DocumentDropContext {
  position?: number;
  moved: boolean;
}

export type DocumentDropDispatcher = (
  event: DragEvent,
  editor: Editor,
  context: DocumentDropContext
) => boolean;

export interface FlowEditorProps {
  content?: JSONContent;
  pageId?: string;
  editable?: boolean;
  ariaLabel?: string;
  className?: string;
  columnCount: DocumentColumnCount;
  columnGapPx: number;
  dropCap: DocumentDropCapSettings | boolean;
  language?: string;
  typographyStyle?: CSSProperties;
  viewScale?: number;
  minImageWidthPx?: number;
  maxImageWidthPx?: number;
  maxSpanImageWidthPx?: number;
  imageGroups?: readonly DocumentImageGroup[];
  resolveAssetSource: (assetId: string) => string | undefined;
  onUpdate?: (
    content: JSONContent,
    editor: Editor,
    transaction: Transaction
  ) => void;
  onEditorReady?: (editor: Editor | null) => void;
  onFocusChange?: (focused: boolean, editor: Editor) => void;
  onSelectionChange?: (editor: Editor) => void;
  onImageSelectionChange?: (
    selection: SelectedDocumentImage | null,
    editor: Editor
  ) => void;
  selectedStructuredImageIds?: readonly string[];
  onStructuredImageSelectionRequest?: (
    imageId: string,
    additive: boolean
  ) => string | null;
  onImageSelectionRequest?: (
    imageId: string,
    additive: boolean
  ) => string | null;
  onRequestImageReplace?: (request: DocumentImageReplaceRequest) => void;
  onCommittedImageLayout?: (imageId: string) => void;
  onDeleteFlowImage?: (editor: Editor, imageId: string) => boolean;
  onPasteDispatch?: DocumentPasteDispatcher;
  onDropDispatch?: DocumentDropDispatcher;
  onOverflowChange?: (overflowing: boolean) => void;
}

const FLOW_CONTROL_DEFAULT_KEYS = [
  'documentColumnBreakBefore',
  'documentKeepWithNext',
  'documentKeepLinesTogether',
] as const;
const EDITOR_DEFAULT_NULL_KEYS = ['textAlign'] as const;

const normalizeEditorComparisonContent = (
  value: JSONContent
): JSONContent => {
  const {
    attrs: sourceAttrs,
    content: sourceContent,
    ...sourceFields
  } = value;
  const attrs = sourceAttrs && typeof sourceAttrs === 'object'
    ? { ...sourceAttrs }
    : undefined;
  FLOW_CONTROL_DEFAULT_KEYS.forEach((key) => {
    if (attrs?.[key] === false) delete attrs[key];
  });
  EDITOR_DEFAULT_NULL_KEYS.forEach((key) => {
    if (attrs?.[key] === null) delete attrs[key];
  });
  return {
    ...sourceFields,
    ...(attrs && Object.keys(attrs).length > 0
      ? { attrs }
      : { attrs: undefined }),
    ...(sourceContent
      ? { content: sourceContent.map(normalizeEditorComparisonContent) }
      : {}),
  };
};

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(object[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
};

const jsonEquals = (left: JSONContent, right: JSONContent) =>
  stableJson(normalizeEditorComparisonContent(left))
  === stableJson(normalizeEditorComparisonContent(right));

export const isDocumentFlowOverflowing = ({
  clientHeight,
  clientWidth,
  scrollHeight,
  scrollWidth,
  structuredContentHeightPx,
  structuredOverflowing,
}: {
  clientHeight: number;
  clientWidth: number;
  scrollHeight: number;
  scrollWidth: number;
  structuredContentHeightPx?: number;
  structuredOverflowing?: boolean;
}) => (
  (
    typeof structuredOverflowing === 'boolean'
    && structuredOverflowing
  )
  || (
    typeof structuredOverflowing !== 'boolean'
    && clientHeight > 0
    && Number.isFinite(structuredContentHeightPx)
    && Number(structuredContentHeightPx) > clientHeight + 1
  )
  || (
    typeof structuredOverflowing !== 'boolean'
    && !Number.isFinite(structuredContentHeightPx)
    && scrollHeight > clientHeight + 1
  )
  || scrollWidth > clientWidth + 1
);

export const FlowEditor = ({
  content = EMPTY_DOCUMENT,
  pageId,
  editable = true,
  ariaLabel = 'Document body',
  className = '',
  columnCount,
  columnGapPx,
  dropCap,
  language = 'en',
  typographyStyle,
  viewScale = 1,
  minImageWidthPx = 48,
  maxImageWidthPx = 720,
  maxSpanImageWidthPx = 720,
  imageGroups = [],
  resolveAssetSource,
  onUpdate,
  onEditorReady,
  onFocusChange,
  onSelectionChange,
  onImageSelectionChange,
  selectedStructuredImageIds = [],
  onStructuredImageSelectionRequest,
  onImageSelectionRequest,
  onRequestImageReplace,
  onCommittedImageLayout,
  onDeleteFlowImage,
  onPasteDispatch,
  onDropDispatch,
  onOverflowChange,
}: FlowEditorProps) => {
  const normalizedDropCap = useMemo(
    () => normalizeDocumentDropCap(dropCap),
    [dropCap]
  );
  const rootRef = useRef<HTMLElement | null>(null);
  const editorInstanceRef = useRef<Editor | null>(null);
  const frameRef = useRef<number | null>(null);
  const enteringStructuredTextRef = useRef(false);
  const [layoutRevision, setLayoutRevision] = useState(0);
  // Selection changes still need to repaint selection handles/context, but
  // they are not layout inputs and must not invalidate the page-space model.
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [layoutHeightPx, setLayoutHeightPx] = useState(720);
  const [pagePositionOriginOffsetPx, setPagePositionOriginOffsetPx] = useState(0);
  const [editingStructuredText, setEditingStructuredText] = useState(false);
  const callbacksRef = useRef({
    resolveAssetSource,
    onUpdate,
    onFocusChange,
    onSelectionChange,
    onImageSelectionChange,
    onStructuredImageSelectionRequest,
    onImageSelectionRequest,
    selectedStructuredImageIds,
    onRequestImageReplace,
    onCommittedImageLayout,
    onDeleteFlowImage,
    onPasteDispatch,
    onDropDispatch,
    onOverflowChange,
    viewScale,
    columnCount,
    columnGapPx,
    maxSpanImageWidthPx,
  });
  callbacksRef.current = {
    resolveAssetSource,
    onUpdate,
    onFocusChange,
    onSelectionChange,
    onImageSelectionChange,
    onStructuredImageSelectionRequest,
    onImageSelectionRequest,
    selectedStructuredImageIds,
    onRequestImageReplace,
    onCommittedImageLayout,
    onDeleteFlowImage,
    onPasteDispatch,
    onDropDispatch,
    onOverflowChange,
    viewScale,
    columnCount,
    columnGapPx,
    maxSpanImageWidthPx,
  };

  const measureOverflow = useCallback(() => {
    // Structured spans are the canonical layout/overflow surface in every
    // editor state.  The live ProseMirror document is an interaction layer
    // while text is being edited and its browser CSS-column measurement must
    // never replace the page-space layout kernel's result.
    const proseMirror =
      rootRef.current?.querySelector<HTMLElement>(
        '[data-document-span-layout]'
      )
      || rootRef.current?.querySelector<HTMLElement>('.ProseMirror');
    if (!proseMirror) return;
    const structuredHeight = Number(
      proseMirror.dataset.layoutContentHeightPx
    );
    const structuredOverflowing =
      proseMirror.dataset.layoutOverflowing === 'true'
        ? true
        : proseMirror.dataset.layoutOverflowing === 'false'
          ? false
          : undefined;
    const overflowing = isDocumentFlowOverflowing({
      clientHeight: proseMirror.clientHeight,
      clientWidth: proseMirror.clientWidth,
      scrollHeight: proseMirror.scrollHeight,
      scrollWidth: proseMirror.scrollWidth,
      structuredContentHeightPx: structuredHeight,
      structuredOverflowing,
    });
    callbacksRef.current.onOverflowChange?.(overflowing);
  }, []);

  const scheduleOverflowMeasure = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (frameRef.current !== null) {
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(frameRef.current);
      } else {
        window.clearTimeout(frameRef.current);
      }
    }
    frameRef.current =
      typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame(() => {
            frameRef.current = null;
            measureOverflow();
          })
        : window.setTimeout(() => {
            frameRef.current = null;
            measureOverflow();
          }, 0);
  }, [measureOverflow]);

  const imageExtensionOptions = useRef({
    resolveAssetSource: (assetId: string) =>
      callbacksRef.current.resolveAssetSource(assetId),
    onRequestReplace: (request: DocumentImageReplaceRequest) =>
      callbacksRef.current.onRequestImageReplace?.(request),
    onCommittedImageLayout: (imageId: string) =>
      callbacksRef.current.onCommittedImageLayout?.(imageId),
    onSelectImage: ({
      imageId,
      additive,
    }: { imageId: string; additive: boolean }) => {
      const requestedImageId = callbacksRef.current.onImageSelectionRequest?.(
        imageId,
        additive
      );
      return requestedImageId === undefined ? imageId : requestedImageId;
    },
    isImageSelected: (imageId: string) =>
      callbacksRef.current.selectedStructuredImageIds.includes(imageId),
    getViewScale: () => callbacksRef.current.viewScale,
    minWidthPx: minImageWidthPx,
    maxWidthPx: maxImageWidthPx,
    maxSpanWidthPx: maxSpanImageWidthPx,
    getSpanWidthPx: (spanCount: 1 | 2 | 3) => {
      const safeColumnCount = Math.max(1, callbacksRef.current.columnCount);
      const gap = Math.max(0, callbacksRef.current.columnGapPx);
      const columnWidth = (
        callbacksRef.current.maxSpanImageWidthPx
        - gap * (safeColumnCount - 1)
      ) / safeColumnCount;
      const safeSpanCount = Math.min(spanCount, safeColumnCount);
      return columnWidth * safeSpanCount + gap * (safeSpanCount - 1);
    },
  }).current;
  imageExtensionOptions.minWidthPx = minImageWidthPx;
  imageExtensionOptions.maxWidthPx = maxImageWidthPx;
  imageExtensionOptions.maxSpanWidthPx = maxSpanImageWidthPx;

  const editor = useEditor(
    {
      immediatelyRender: false,
      content,
      editable,
      extensions: [
        StarterKit.configure({
          blockquote: false,
          bulletList: false,
          code: false,
          codeBlock: false,
          heading: false,
          horizontalRule: false,
          link: false,
          listItem: false,
          listKeymap: false,
          orderedList: false,
          strike: false,
        }),
        DocumentAlignmentExtension.configure({
          types: ['paragraph'],
        }),
        DocumentTextStyleExtension,
        DocumentBlockStyleExtension.configure({
          defaultStyleId: 'body',
        }),
        DocumentFlowControlExtension,
        SanitizedPasteExtension,
        DocumentInlineImageExtension.configure(imageExtensionOptions),
        DocumentFlowImageExtension.configure(imageExtensionOptions),
        DocumentImageCommandsExtension,
      ],
      editorProps: {
        attributes: {
          class: 'document-flow-prosemirror',
          'aria-label': ariaLabel,
          'data-document-editor-region': 'body',
          spellcheck: 'true',
        },
        transformPastedText: sanitizeDocumentPastedText,
        handlePaste: (_view, event) => {
          const activeEditor = editorInstanceRef.current;
          if (!activeEditor) return false;
          const handled = callbacksRef.current.onPasteDispatch?.(
            event,
            activeEditor,
            'body'
          ) ?? false;
          if (handled) {
            event.preventDefault();
            event.stopPropagation();
          }
          return handled;
        },
        handleDrop: (view, event, _slice, moved) => {
          const activeEditor = editorInstanceRef.current;
          if (!activeEditor) return false;
          const position = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          })?.pos;
          const handled = callbacksRef.current.onDropDispatch?.(
            event,
            activeEditor,
            { position, moved }
          ) ?? false;
          if (handled) {
            event.preventDefault();
            event.stopPropagation();
          }
          return handled;
        },
        handleKeyDown: (_view, event) => {
          const activeEditor = editorInstanceRef.current;
          const selection = activeEditor?.state.selection;
          if (
            !activeEditor
            || !(selection instanceof NodeSelection)
            || !DOCUMENT_IMAGE_NODE_NAMES.includes(
              selection.node.type.name as DocumentImageNodeName
            )
            || (event.key !== 'Delete' && event.key !== 'Backspace')
          ) {
            return false;
          }
          const handled = callbacksRef.current.onDeleteFlowImage?.(
            activeEditor,
            String(selection.node.attrs.id || '')
          ) ?? false;
          if (!handled) return false;
          event.preventDefault();
          return true;
        },
      },
      onCreate: ({ editor: createdEditor }) => {
        editorInstanceRef.current = createdEditor;
      },
      onUpdate: ({ editor: updatedEditor, transaction }) => {
        callbacksRef.current.onUpdate?.(
          updatedEditor.getJSON(),
          updatedEditor,
          transaction
        );
        callbacksRef.current.onImageSelectionChange?.(
          getSelectedDocumentImage(updatedEditor),
          updatedEditor
        );
        scheduleOverflowMeasure();
        setLayoutRevision((revision) => revision + 1);
      },
      onFocus: ({ editor: focusedEditor }) => {
        const selectedImage = getSelectedDocumentImage(focusedEditor);
        setEditingStructuredText(!selectedImage);
        callbacksRef.current.onFocusChange?.(true, focusedEditor);
      },
      onBlur: ({ editor: blurredEditor }) => {
        if (!enteringStructuredTextRef.current) {
          setEditingStructuredText(false);
        }
        callbacksRef.current.onFocusChange?.(false, blurredEditor);
      },
      onSelectionUpdate: ({ editor: updatedEditor }) => {
        const selectedImage = getSelectedDocumentImage(updatedEditor);
        setEditingStructuredText(
          enteringStructuredTextRef.current
          || (updatedEditor.isFocused && !selectedImage)
        );
        callbacksRef.current.onSelectionChange?.(updatedEditor);
        callbacksRef.current.onImageSelectionChange?.(
          getSelectedDocumentImage(updatedEditor),
          updatedEditor
        );
        setSelectionRevision((revision) => revision + 1);
      },
      onDestroy: () => {
        editorInstanceRef.current = null;
      },
    },
    []
  );

  useEffect(() => {
    if (!editor) return;
    editorInstanceRef.current = editor;
    onEditorReady?.(editor);
    scheduleOverflowMeasure();
    return () => {
      onEditorReady?.(null);
    };
  }, [editor, onEditorReady, scheduleOverflowMeasure]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(editable);
  }, [editable, editor]);

  // React node views are owned by Tiptap and do not necessarily rerender when
  // the shell's transient additive-selection state changes. Keep the visible
  // source-image affordance in sync without writing selection into the
  // document or dispatching a persistence transaction.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const selectedIds = new Set(selectedStructuredImageIds);
    root
      .querySelectorAll<HTMLElement>(
        '[data-document-image="true"], .document-image-node'
      )
      .forEach((image) => {
        const selected = selectedIds.has(image.dataset.imageId || '');
        image.classList.toggle('document-image--multi-selected', selected);
        image.dataset.imageSelected = selected
          || image.classList.contains('document-image--selected')
          ? 'true'
          : 'false';
      });
  }, [editor, selectedStructuredImageIds, selectionRevision]);

  useEffect(() => {
    if (!editingStructuredText || !editor || editor.isDestroyed) return;
    const focusTextEditor = () => {
      if (!editor.isDestroyed) {
        editor.commands.focus(undefined, { scrollIntoView: false });
      }
      enteringStructuredTextRef.current = false;
    };
    if (typeof window.requestAnimationFrame === 'function') {
      const frame = window.requestAnimationFrame(focusTextEditor);
      return () => window.cancelAnimationFrame(frame);
    }
    const timeout = window.setTimeout(focusTextEditor, 0);
    return () => window.clearTimeout(timeout);
  }, [editingStructuredText, editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const transaction = editor.state.tr;
    let changed = false;
    editor.state.doc.descendants((node, position) => {
      if (
        node.type.name !== 'documentFlowImage'
        || node.attrs.wrap !== 'span-columns'
      ) {
        return;
      }
      let normalized = normalizeDocumentImageSpanForColumnCount(
        node.attrs as Partial<DocumentImageAttributes>,
        columnCount
      );
      if (normalized.wrap === 'span-columns') {
        const columnWidth = (
          maxSpanImageWidthPx - columnGapPx * (columnCount - 1)
        ) / columnCount;
        const spanWidth = Math.max(
          1,
          columnWidth * normalized.spanCount
          + columnGapPx * (normalized.spanCount - 1)
        );
        const spanDimensions = getDocumentImageSpanDimensions(
          normalized,
          spanWidth
        );
        if (
          spanDimensions.widthPx !== normalized.widthPx
          || spanDimensions.heightPx !== normalized.heightPx
        ) {
          normalized = {
            ...normalized,
            ...spanDimensions,
          };
        }
        normalized = {
          ...normalized,
          xOffsetPx: calculateDocumentImageXOffset({
            placement: normalized.horizontalPlacement,
            xOffsetPx: normalized.xOffsetPx,
            spanWidthPx: spanWidth,
            imageWidthPx: normalized.widthPx,
          }),
        };
      }
      if (JSON.stringify(normalized) === JSON.stringify(node.attrs)) return;
      transaction.setNodeMarkup(position, undefined, normalized);
      changed = true;
    });
    if (changed) editor.view.dispatch(transaction);
  }, [
    columnCount,
    columnGapPx,
    editor,
    maxSpanImageWidthPx,
  ]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isFocused) return;
    const current = normalizeDocumentImageContentGeometry(editor.getJSON());
    const next = normalizeDocumentImageContentGeometry(content);
    if (!jsonEquals(current, next)) {
      editor.commands.setContent(content, {
        emitUpdate: false,
        errorOnInvalidContent: true,
      });
      scheduleOverflowMeasure();
    }
  }, [content, editor, scheduleOverflowMeasure]);

  useEffect(() => {
    scheduleOverflowMeasure();
  }, [
    columnCount,
    columnGapPx,
    normalizedDropCap,
    scheduleOverflowMeasure,
  ]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observeTarget = root.querySelector<HTMLElement>('.ProseMirror');
    if (!observeTarget) return;

    const syncLayoutHeight = () => {
      if (root.clientHeight <= 0) return;
      setLayoutHeightPx((current) =>
        Math.abs(current - root.clientHeight) > 0.5
          ? root.clientHeight
          : current
      );
    };
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          syncLayoutHeight();
          scheduleOverflowMeasure();
        })
      : null;
    const mutationObserver = typeof MutationObserver !== 'undefined'
      ? new MutationObserver(scheduleOverflowMeasure)
      : null;

    resizeObserver?.observe(root);
    resizeObserver?.observe(observeTarget);
    mutationObserver?.observe(observeTarget, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    root.addEventListener('load', scheduleOverflowMeasure, true);
    syncLayoutHeight();
    scheduleOverflowMeasure();

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      root.removeEventListener('load', scheduleOverflowMeasure, true);
    };
  }, [editor, scheduleOverflowMeasure]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const syncOrigin = () => {
      const next = measureDocumentPagePositionOriginOffsetPx(root, viewScale);
      setPagePositionOriginOffsetPx((current) => (
        Math.abs(current - next) > 0.5 ? next : current
      ));
    };
    syncOrigin();
    const contentRoot = root.closest<HTMLElement>('.document-page-content');
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(syncOrigin)
      : null;
    resizeObserver?.observe(root);
    if (contentRoot) resizeObserver?.observe(contentRoot);
    return () => resizeObserver?.disconnect();
  }, [editor, viewScale]);

  useEffect(() => () => {
    if (frameRef.current === null || typeof window === 'undefined') return;
    if (typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(frameRef.current);
    } else {
      window.clearTimeout(frameRef.current);
    }
  }, []);

  const style = {
    ...typographyStyle,
    '--document-column-count': columnCount,
    '--document-column-gap': `${Math.max(0, columnGapPx)}px`,
  } as CSSProperties;
  let hasStructuredSpan = false;
  editor?.state.doc.descendants((node) => {
    if (
      node.type.name === 'documentFlowImage'
      && node.attrs.wrap === 'span-columns'
    ) {
      hasStructuredSpan = true;
      return false;
    }
    return !hasStructuredSpan;
  });

  return (
    <section
      ref={rootRef}
      className={[
        'document-flow-editor',
        normalizedDropCap.enabled ? 'document-flow-editor--drop-cap' : '',
        className,
      ].filter(Boolean).join(' ')}
      data-testid="document-flow-editor"
      data-document-region="body"
      data-column-count={columnCount}
      data-drop-cap={normalizedDropCap.enabled ? 'true' : 'false'}
      data-drop-cap-line-span={normalizedDropCap.lineSpan}
      lang={language}
      style={style}
    >
      <EditorContent
        editor={editor}
        className={[
          'document-flow-editor__content',
          hasStructuredSpan && !editingStructuredText
            ? 'document-flow-editor__content--structured-source'
            : '',
          hasStructuredSpan
            ? 'document-flow-editor__content--span-source'
            : '',
          hasStructuredSpan && editingStructuredText
            ? 'document-flow-editor__content--structured-text-editing'
            : '',
        ].filter(Boolean).join(' ')}
      />
      {editor && hasStructuredSpan && (
        <StructuredDocumentSpanLayout
          editor={editor}
          pageId={pageId}
          columnCount={columnCount}
          columnGapPx={columnGapPx}
          availableWidthPx={maxSpanImageWidthPx}
          availableHeightPx={layoutHeightPx}
          revision={layoutRevision}
          selectionRevision={selectionRevision}
          textEditing={editingStructuredText}
          viewScale={viewScale}
          minimumImageWidthPx={minImageWidthPx}
          maximumFlowImageWidthPx={maxImageWidthPx}
          typographyStyle={typographyStyle}
          dropCap={normalizedDropCap}
          language={language}
          imageGroups={imageGroups}
          selectedImageIds={selectedStructuredImageIds}
          pagePositionOriginOffsetPx={pagePositionOriginOffsetPx}
          onSelectImage={(
            _position,
            imageId,
            additive,
            nodeType = 'documentFlowImage'
          ) => {
            enteringStructuredTextRef.current = false;
            setEditingStructuredText(false);
            const clickedPosition = findDocumentImagePositionById(
              editor,
              imageId,
              nodeType
            );
            if (clickedPosition === null) return;
            const requestedPrimaryId =
              callbacksRef.current.onStructuredImageSelectionRequest?.(
                imageId,
                additive
              );
            const primaryId = requestedPrimaryId === undefined
              ? imageId
              : requestedPrimaryId;
            if (
              !primaryId
              || selectDocumentImageById(
                editor,
                primaryId,
                nodeType
              ) === null
            ) return;
            editor.commands.focus(undefined, { scrollIntoView: false });
          }}
          onCommitImagePosition={(
            position,
            imageId,
            xOffsetPx,
            yPx
          ) => {
            const committed = commitStructuredDocumentImagePosition(
              editor,
              position,
              imageId,
              xOffsetPx,
              yPx
            );
            if (committed) {
              callbacksRef.current.onCommittedImageLayout?.(imageId);
            }
            return committed;
          }}
          onCommitImageSize={(
            position,
            imageId,
            widthPx,
            heightPx,
            xOffsetPx
          ) => {
            const committed = commitStructuredDocumentImageSize(
              editor,
              position,
              imageId,
              widthPx,
              heightPx,
              xOffsetPx
            );
            if (committed) {
              callbacksRef.current.onCommittedImageLayout?.(imageId);
            }
            return committed;
          }}
          onEditText={() => {
            enteringStructuredTextRef.current = true;
            setEditingStructuredText(true);
            const { selection, doc } = editor.state;
            if (selection instanceof NodeSelection) {
              const near = TextSelection.near(
                doc.resolve(selection.from),
                -1
              );
              editor.view.dispatch(
                editor.state.tr.setSelection(near)
              );
            }
            editor.commands.focus(undefined, { scrollIntoView: false });
          }}
        />
      )}
    </section>
  );
};
