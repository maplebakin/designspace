import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  type Editor,
  type JSONContent,
} from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
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
  normalizeDocumentImageAttributes,
  normalizeDocumentImageSpanForColumnCount,
  type DocumentImageAttributes,
  type DocumentImageNodeName,
  type DocumentImageReplaceRequest,
} from '../extensions/DocumentImageExtension';
import {
  DocumentTextStyleExtension,
} from '../extensions/DocumentTextStyleExtension';
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
  StructuredDocumentSpanLayout,
} from './StructuredDocumentSpanLayout';

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
  editable?: boolean;
  ariaLabel?: string;
  className?: string;
  columnCount: DocumentColumnCount;
  columnGapPx: number;
  dropCap: boolean;
  viewScale?: number;
  minImageWidthPx?: number;
  maxImageWidthPx?: number;
  maxSpanImageWidthPx?: number;
  resolveAssetSource: (assetId: string) => string | undefined;
  onUpdate?: (content: JSONContent, editor: Editor) => void;
  onEditorReady?: (editor: Editor | null) => void;
  onFocusChange?: (focused: boolean, editor: Editor) => void;
  onSelectionChange?: (editor: Editor) => void;
  onImageSelectionChange?: (
    selection: SelectedDocumentImage | null,
    editor: Editor
  ) => void;
  onRequestImageReplace?: (request: DocumentImageReplaceRequest) => void;
  onPasteDispatch?: DocumentPasteDispatcher;
  onDropDispatch?: DocumentDropDispatcher;
  onOverflowChange?: (overflowing: boolean) => void;
}

const jsonEquals = (left: JSONContent, right: JSONContent) =>
  JSON.stringify(left) === JSON.stringify(right);

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
  editable = true,
  ariaLabel = 'Document body',
  className = '',
  columnCount,
  columnGapPx,
  dropCap,
  viewScale = 1,
  minImageWidthPx = 48,
  maxImageWidthPx = 720,
  maxSpanImageWidthPx = 720,
  resolveAssetSource,
  onUpdate,
  onEditorReady,
  onFocusChange,
  onSelectionChange,
  onImageSelectionChange,
  onRequestImageReplace,
  onPasteDispatch,
  onDropDispatch,
  onOverflowChange,
}: FlowEditorProps) => {
  const rootRef = useRef<HTMLElement | null>(null);
  const editorInstanceRef = useRef<Editor | null>(null);
  const frameRef = useRef<number | null>(null);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [layoutHeightPx, setLayoutHeightPx] = useState(720);
  const [editingStructuredText, setEditingStructuredText] = useState(false);
  const callbacksRef = useRef({
    resolveAssetSource,
    onUpdate,
    onFocusChange,
    onSelectionChange,
    onImageSelectionChange,
    onRequestImageReplace,
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
    onRequestImageReplace,
    onPasteDispatch,
    onDropDispatch,
    onOverflowChange,
    viewScale,
    columnCount,
    columnGapPx,
    maxSpanImageWidthPx,
  };

  const measureOverflow = useCallback(() => {
    const proseMirror =
      rootRef.current?.querySelector<HTMLElement>(
        '[data-document-span-layout][data-hidden-for-editing="false"]'
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
      },
      onCreate: ({ editor: createdEditor }) => {
        editorInstanceRef.current = createdEditor;
      },
      onUpdate: ({ editor: updatedEditor }) => {
        callbacksRef.current.onUpdate?.(
          updatedEditor.getJSON(),
          updatedEditor
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
        setEditingStructuredText(
          !selectedImage
          || selectedImage.attributes.wrap !== 'span-columns'
        );
        callbacksRef.current.onFocusChange?.(true, focusedEditor);
      },
      onBlur: ({ editor: blurredEditor }) => {
        setEditingStructuredText(false);
        callbacksRef.current.onFocusChange?.(false, blurredEditor);
      },
      onSelectionUpdate: ({ editor: updatedEditor }) => {
        const selectedImage = getSelectedDocumentImage(updatedEditor);
        setEditingStructuredText(
          updatedEditor.isFocused
          && (
            !selectedImage
            || selectedImage.attributes.wrap !== 'span-columns'
          )
        );
        callbacksRef.current.onSelectionChange?.(updatedEditor);
        callbacksRef.current.onImageSelectionChange?.(
          getSelectedDocumentImage(updatedEditor),
          updatedEditor
        );
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

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const transaction = editor.state.tr;
    let changed = false;
    let foundStructuredSpan = false;
    editor.state.doc.descendants((node, position) => {
      if (
        node.type.name !== 'documentFlowImage'
        || node.attrs.wrap !== 'span-columns'
      ) {
        return;
      }
      let normalized = foundStructuredSpan
        ? {
            ...normalizeDocumentImageAttributes(
              node.attrs as Partial<DocumentImageAttributes>
            ),
            wrap: 'top-bottom' as const,
            spanCount: 1 as const,
            spanStartColumn: 1 as const,
          }
        : normalizeDocumentImageSpanForColumnCount(
            node.attrs as Partial<DocumentImageAttributes>,
            columnCount
          );
      foundStructuredSpan = true;
      if (normalized.wrap === 'span-columns') {
        const columnWidth = (
          maxSpanImageWidthPx - columnGapPx * (columnCount - 1)
        ) / columnCount;
        const spanWidth = Math.max(
          1,
          columnWidth * normalized.spanCount
          + columnGapPx * (normalized.spanCount - 1)
        );
        if (normalized.widthPx > spanWidth) {
          const aspectRatio =
            normalized.naturalWidth / Math.max(1, normalized.naturalHeight);
          normalized = {
            ...normalized,
            widthPx: spanWidth,
            heightPx: spanWidth / aspectRatio,
          };
        }
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
    const current = editor.getJSON();
    if (!jsonEquals(current, content)) {
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
    dropCap,
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

  useEffect(() => () => {
    if (frameRef.current === null || typeof window === 'undefined') return;
    if (typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(frameRef.current);
    } else {
      window.clearTimeout(frameRef.current);
    }
  }, []);

  const style = {
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
        dropCap ? 'document-flow-editor--drop-cap' : '',
        className,
      ].filter(Boolean).join(' ')}
      data-testid="document-flow-editor"
      data-document-region="body"
      data-column-count={columnCount}
      data-drop-cap={dropCap ? 'true' : 'false'}
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
        ].filter(Boolean).join(' ')}
      />
      {editor && hasStructuredSpan && (
        <StructuredDocumentSpanLayout
          editor={editor}
          columnCount={columnCount}
          columnGapPx={columnGapPx}
          availableWidthPx={maxSpanImageWidthPx}
          availableHeightPx={layoutHeightPx}
          revision={layoutRevision}
          hidden={editingStructuredText}
          viewScale={viewScale}
          onSelectImage={(position) => {
            editor.commands.setNodeSelection(position);
            editor.commands.focus();
          }}
          onCommitImageY={(position, yPx) => {
            editor.chain()
              .focus()
              .setNodeSelection(position)
              .updateSelectedDocumentImage({
                verticalAnchor: 'page-position',
                yPx,
              })
              .run();
          }}
          onEditText={() => {
            setEditingStructuredText(true);
            editor.commands.focus();
          }}
        />
      )}
    </section>
  );
};
