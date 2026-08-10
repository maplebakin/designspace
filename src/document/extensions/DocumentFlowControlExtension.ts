import { Extension, type Command } from '@tiptap/core';

export type DocumentFlowControl =
  | 'column-break'
  | 'keep-with-next'
  | 'keep-lines-together';

export const DOCUMENT_FLOW_CONTROL_ATTRIBUTES = [
  'documentColumnBreakBefore',
  'documentKeepWithNext',
  'documentKeepLinesTogether',
] as const;

type DocumentFlowControlAttribute =
  typeof DOCUMENT_FLOW_CONTROL_ATTRIBUTES[number];

const CONTROL_BY_KIND: Record<DocumentFlowControl, DocumentFlowControlAttribute> = {
  'column-break': 'documentColumnBreakBefore',
  'keep-with-next': 'documentKeepWithNext',
  'keep-lines-together': 'documentKeepLinesTogether',
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    documentFlowControl: {
      toggleDocumentColumnBreak: () => ReturnType;
      toggleDocumentKeepWithNext: () => ReturnType;
      toggleDocumentKeepLinesTogether: () => ReturnType;
      setDocumentColumnBreak: (enabled: boolean) => ReturnType;
      setDocumentKeepWithNext: (enabled: boolean) => ReturnType;
      setDocumentKeepLinesTogether: (enabled: boolean) => ReturnType;
    };
  }
}

/**
 * Small model-backed paragraph controls used by the deterministic structured
 * layout. They are deliberately attributes on existing paragraphs, so a
 * column break never requires filler text or a second editor node type.
 */
export const DocumentFlowControlExtension = Extension.create({
  name: 'documentFlowControl',

  addGlobalAttributes() {
    return [{
      types: ['paragraph'],
      attributes: {
        documentColumnBreakBefore: {
          default: false,
          parseHTML: (element: HTMLElement) =>
            element.getAttribute('data-document-column-break-before') === 'true',
          renderHTML: (attributes: Record<string, unknown>) => (
            attributes.documentColumnBreakBefore === true
              ? { 'data-document-column-break-before': 'true' }
              : {}
          ),
        },
        documentKeepWithNext: {
          default: false,
          parseHTML: (element: HTMLElement) =>
            element.getAttribute('data-document-keep-with-next') === 'true',
          renderHTML: (attributes: Record<string, unknown>) => (
            attributes.documentKeepWithNext === true
              ? { 'data-document-keep-with-next': 'true' }
              : {}
          ),
        },
        documentKeepLinesTogether: {
          default: false,
          parseHTML: (element: HTMLElement) =>
            element.getAttribute('data-document-keep-lines-together') === 'true',
          renderHTML: (attributes: Record<string, unknown>) => (
            attributes.documentKeepLinesTogether === true
              ? { 'data-document-keep-lines-together': 'true' }
              : {}
          ),
        },
      },
    }];
  },

  addCommands() {
    const toggleControl = (kind: DocumentFlowControl): Command => ({
      commands,
      state,
    }) => {
      const paragraph = state.selection.$from.parent;
      const attribute = CONTROL_BY_KIND[kind];
      return commands.updateAttributes('paragraph', {
        [attribute]: paragraph.attrs[attribute] !== true,
      });
    };

    const setControl = (
      kind: DocumentFlowControl,
      enabled: boolean
    ): Command => ({ commands }) => commands.updateAttributes('paragraph', {
      [CONTROL_BY_KIND[kind]]: enabled,
    });

    return {
      toggleDocumentColumnBreak: () => toggleControl('column-break'),
      toggleDocumentKeepWithNext: () => toggleControl('keep-with-next'),
      toggleDocumentKeepLinesTogether: () =>
        toggleControl('keep-lines-together'),
      setDocumentColumnBreak: (enabled) =>
        setControl('column-break', enabled),
      setDocumentKeepWithNext: (enabled) =>
        setControl('keep-with-next', enabled),
      setDocumentKeepLinesTogether: (enabled) =>
        setControl('keep-lines-together', enabled),
    };
  },
});
