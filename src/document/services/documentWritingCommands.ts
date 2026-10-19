import type { Editor } from '@tiptap/core';
import { normalizeWritingAttributes } from '../model/documentWriting';

/**
 * Update only the writing paragraph containing the editor selection. Using
 * setNodeMarkup at its resolved block position avoids applying inspector
 * changes to every paragraph touched by a non-empty text selection.
 */
export const updateSelectedWritingArea = (
  editor: Editor,
  attributes: Record<string, unknown>
) => {
  if (editor.isDestroyed) return false;
  const { $from } = editor.state.selection;
  if ($from.parent.type.name !== 'paragraph') return false;
  const position = $from.before($from.depth);
  const selectedNode = editor.state.doc.nodeAt(position);
  if (!selectedNode || selectedNode.type.name !== 'paragraph') return false;
  const currentAttributes = normalizeWritingAttributes(selectedNode.attrs);
  const writingAttributes = normalizeWritingAttributes(attributes);
  if (!currentAttributes.documentWritingRows || !writingAttributes.documentWritingRows) {
    return false;
  }
  editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, {
    ...selectedNode.attrs,
    ...writingAttributes,
  }));
  return true;
};

/**
 * Insert an editable block after the paragraph containing the selection.
 * This keeps an active text selection intact instead of replacing its text.
 */
export const insertDocumentWritingBlock = (
  editor: Editor,
  attributes: Record<string, unknown>
) => {
  if (editor.isDestroyed) return false;
  const selection = editor.state.selection;
  const insertionPosition = selection.$from.after(selection.$from.depth);
  return editor.chain().focus().insertContentAt(insertionPosition, [
    { type: 'paragraph', attrs: attributes },
    { type: 'paragraph' },
  ]).run();
};
