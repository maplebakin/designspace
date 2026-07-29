import {
  useEffect,
  useRef,
  type CSSProperties,
} from 'react';
import {
  type Editor,
  type JSONContent,
} from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  DocumentAlignmentExtension,
} from '../extensions/DocumentAlignmentExtension';
import {
  DocumentTextStyleExtension,
} from '../extensions/DocumentTextStyleExtension';
import {
  DocumentBlockStyleExtension,
} from '../extensions/DocumentBlockStyleExtension';
import {
  SanitizedPasteExtension,
  sanitizeDocumentPastedText,
} from '../extensions/SanitizedPasteExtension';
import '../styles/document-page.css';
import '../styles/document-print.css';

const EMPTY_DOCUMENT: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

export type DocumentEditorRegion = 'title' | 'body';

export type DocumentPasteDispatcher = (
  event: ClipboardEvent,
  editor: Editor,
  region: DocumentEditorRegion
) => boolean;

export interface TitleEditorProps {
  content?: JSONContent;
  editable?: boolean;
  ariaLabel?: string;
  className?: string;
  baseFontSizePx?: number;
  language?: string;
  onUpdate?: (content: JSONContent, editor: Editor) => void;
  onEditorReady?: (editor: Editor | null) => void;
  onFocusChange?: (focused: boolean, editor: Editor) => void;
  onSelectionChange?: (editor: Editor) => void;
  onPasteDispatch?: DocumentPasteDispatcher;
}

const jsonEquals = (left: JSONContent, right: JSONContent) =>
  JSON.stringify(left) === JSON.stringify(right);

export const TitleEditor = ({
  content = EMPTY_DOCUMENT,
  editable = true,
  ariaLabel = 'Document title',
  className = '',
  baseFontSizePx = 36,
  language = 'en',
  onUpdate,
  onEditorReady,
  onFocusChange,
  onSelectionChange,
  onPasteDispatch,
}: TitleEditorProps) => {
  const callbacksRef = useRef({
    onUpdate,
    onFocusChange,
    onSelectionChange,
    onPasteDispatch,
  });
  callbacksRef.current = {
    onUpdate,
    onFocusChange,
    onSelectionChange,
    onPasteDispatch,
  };
  const editorInstanceRef = useRef<Editor | null>(null);

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
          defaultStyleId: 'article-title',
        }),
        SanitizedPasteExtension,
      ],
      editorProps: {
        attributes: {
          class: 'document-title-prosemirror',
          'aria-label': ariaLabel,
          'data-document-editor-region': 'title',
          spellcheck: 'true',
        },
        transformPastedText: sanitizeDocumentPastedText,
        handlePaste: (_view, event) => {
          const activeEditor = editorInstanceRef.current;
          if (!activeEditor) return false;
          const handled = callbacksRef.current.onPasteDispatch?.(
            event,
            activeEditor,
            'title'
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
      },
      onFocus: ({ editor: focusedEditor }) => {
        callbacksRef.current.onFocusChange?.(true, focusedEditor);
      },
      onBlur: ({ editor: blurredEditor }) => {
        callbacksRef.current.onFocusChange?.(false, blurredEditor);
      },
      onSelectionUpdate: ({ editor: updatedEditor }) => {
        callbacksRef.current.onSelectionChange?.(updatedEditor);
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
    return () => {
      onEditorReady?.(null);
    };
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isFocused) return;
    const current = editor.getJSON();
    if (!jsonEquals(current, content)) {
      editor.commands.setContent(content, {
        emitUpdate: false,
        errorOnInvalidContent: true,
      });
    }
  }, [content, editor]);

  const style = {
    '--document-title-font-size': `${Math.max(12, baseFontSizePx)}px`,
  } as CSSProperties;

  return (
    <section
      className={`document-title-editor ${className}`.trim()}
      data-testid="document-title-editor"
      data-document-region="title"
      lang={language}
      style={style}
    >
      <EditorContent
        editor={editor}
        className="document-title-editor__content"
      />
    </section>
  );
};
