import { Extension } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { normalizeWritingAttributes } from '../model/documentWriting';

const CSS_PIXELS_PER_POINT = 96 / 72;
const keys = ['documentWritingRows', 'documentWritingSpacing', 'documentWritingRuleWidthPt', 'documentDivider', 'documentRuleColor', 'documentSpaceBeforePx', 'documentSpaceAfterPx'] as const;

export const DocumentWritingExtension = Extension.create({
  name: 'documentWriting',
  addProseMirrorPlugins() {
    return [new Plugin({ props: {
      decorations: (state) => {
        const { selection } = state;
        if (!(selection instanceof TextSelection)) return DecorationSet.empty;
        const { $from } = selection;
        const writing = normalizeWritingAttributes($from.parent.attrs);
        if ($from.parent.type.name !== 'paragraph' || !writing.documentWritingRows) return DecorationSet.empty;
        const from = $from.before();
        return DecorationSet.create(state.doc, [Decoration.node(
          from,
          from + $from.parent.nodeSize,
          { class: 'document-writing-area--selected', 'data-document-writing-area-selected': 'true' },
        )]);
      },
      handleDOMEvents: {
        mousedown: (view, event) => {
          const target = event.target instanceof Element ? event.target.closest('[data-document-writing-area]') : null;
          if (!target || !view.dom.contains(target) || target.textContent?.trim()) return false;
          // Empty ruled paragraphs have a large visual box but no text glyphs.
          // Clicking any line must select that paragraph, not the preceding prompt.
          const position = view.posAtDOM(target, 0);
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)));
          view.focus();
          event.preventDefault();
          return true;
        },
      },
    } })];
  },
  addGlobalAttributes() {
    return [{
      types: ['paragraph'],
      attributes: Object.fromEntries(keys.map((key) => [key, {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const value = element.getAttribute(`data-${key}`);
          return key === 'documentDivider' ? value === 'true' : value;
        },
        renderHTML: (attrs: Record<string, unknown>) => {
          const normalized = normalizeWritingAttributes(attrs);
          if (key !== 'documentWritingRows') {
            return key in normalized ? { [`data-${key}`]: String(normalized[key as keyof typeof normalized]) } : {};
          }
          const rows = normalized.documentWritingRows;
          const spacing = normalized.documentWritingSpacing || 32;
          const color = normalized.documentRuleColor;
          const ruleWidth = normalized.documentWritingRuleWidthPt
            ? normalized.documentWritingRuleWidthPt * CSS_PIXELS_PER_POINT
            : 1;
          let css = rows
            ? `min-height:${rows * spacing}px;line-height:${spacing}px;background-image:repeating-linear-gradient(to bottom,transparent 0,transparent ${spacing - ruleWidth}px,${color} ${spacing - ruleWidth}px,${color} ${spacing}px);background-size:100% ${spacing}px;break-inside:avoid;`
            : normalized.documentDivider ? `border-top:1px solid ${color};min-height:12px;` : '';
          if (normalized.documentSpaceBeforePx) css += `padding-top:${normalized.documentSpaceBeforePx}px;`;
          if (normalized.documentSpaceAfterPx) css += `padding-bottom:${normalized.documentSpaceAfterPx}px;`;
          return css ? { style: css, ...(rows ? { 'data-document-writing-area': 'true', [`data-${key}`]: String(rows) } : {}) } : {};
        },
      }])),
    }];
  },
});
