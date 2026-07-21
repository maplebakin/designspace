import { Extension } from '@tiptap/core';

export type DocumentTextAlignment = 'left' | 'center' | 'right' | 'justify';

const DOCUMENT_ALIGNMENTS = new Set<DocumentTextAlignment>([
  'left',
  'center',
  'right',
  'justify',
]);

const normalizeAlignment = (value: unknown): DocumentTextAlignment | null =>
  typeof value === 'string'
  && DOCUMENT_ALIGNMENTS.has(value as DocumentTextAlignment)
    ? value as DocumentTextAlignment
    : null;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    documentAlignment: {
      setDocumentTextAlign: (alignment: DocumentTextAlignment) => ReturnType;
      unsetDocumentTextAlign: () => ReturnType;
    };
  }
}

export interface DocumentAlignmentOptions {
  types: string[];
}

export const DocumentAlignmentExtension =
  Extension.create<DocumentAlignmentOptions>({
    name: 'documentAlignment',

    addOptions() {
      return {
        types: ['paragraph', 'heading'],
      };
    },

    addGlobalAttributes() {
      return [
        {
          types: this.options.types,
          attributes: {
            textAlign: {
              default: null,
              parseHTML: (element) =>
                normalizeAlignment(element.style.textAlign),
              renderHTML: (attributes) => {
                const textAlign = normalizeAlignment(attributes.textAlign);
                return textAlign ? { style: `text-align: ${textAlign}` } : {};
              },
            },
          },
        },
      ];
    },

    addCommands() {
      return {
        setDocumentTextAlign:
          (alignment) =>
          ({ commands, editor }) => {
            const normalized = normalizeAlignment(alignment);
            if (!normalized) return false;

            let didApply = false;
            this.options.types.forEach((type) => {
              if (!editor.schema.nodes[type]) return;
              didApply = commands.updateAttributes(type, {
                textAlign: normalized,
              }) || didApply;
            });
            return didApply;
          },
        unsetDocumentTextAlign:
          () =>
          ({ commands, editor }) => {
            let didApply = false;
            this.options.types.forEach((type) => {
              if (!editor.schema.nodes[type]) return;
              didApply = commands.resetAttributes(type, 'textAlign') || didApply;
            });
            return didApply;
          },
      };
    },
  });
