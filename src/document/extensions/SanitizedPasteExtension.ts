import { Extension } from '@tiptap/core';

const ALLOWED_ELEMENTS = new Set([
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'del',
  'span',
  'div',
  'blockquote',
  'pre',
  'code',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
]);

const REMOVE_WITH_CONTENT = [
  'script',
  'style',
  'template',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'foreignObject',
  'img',
  'video',
  'audio',
  'source',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
];

const ALIGNMENTS = new Set(['left', 'center', 'right', 'justify']);
const FONT_SIZE_PATTERN = /^(?:[8-9]|[1-9]\d|1[0-3]\d|140)(?:\.\d+)?px$/;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

export const sanitizeDocumentPastedText = (value: string) =>
  Array.from(value)
    .filter((character) => character.charCodeAt(0) !== 0)
    .join('')
    .replace(/\r\n?/g, '\n');

const sanitizeElementStyle = (element: HTMLElement) => {
  const safeStyles: string[] = [];
  const textAlign = element.style.textAlign.toLowerCase();
  const fontSize = element.style.fontSize.toLowerCase();
  const fontWeight = element.style.fontWeight.toLowerCase();
  const fontStyle = element.style.fontStyle.toLowerCase();
  const textDecoration = (
    element.style.textDecorationLine
    || element.style.textDecoration
  ).toLowerCase();

  if (ALIGNMENTS.has(textAlign)) {
    safeStyles.push(`text-align: ${textAlign}`);
  }
  if (FONT_SIZE_PATTERN.test(fontSize)) {
    safeStyles.push(`font-size: ${fontSize}`);
  }
  if (
    fontWeight === 'bold'
    || (/^[1-9]00$/.test(fontWeight) && Number(fontWeight) >= 600)
  ) {
    safeStyles.push('font-weight: bold');
  }
  if (fontStyle === 'italic') {
    safeStyles.push('font-style: italic');
  }
  if (textDecoration.includes('underline')) {
    safeStyles.push('text-decoration-line: underline');
  } else if (textDecoration.includes('line-through')) {
    safeStyles.push('text-decoration-line: line-through');
  }

  Array.from(element.attributes).forEach((attribute) => {
    element.removeAttribute(attribute.name);
  });
  if (safeStyles.length > 0) {
    element.setAttribute('style', safeStyles.join('; '));
  }
};

/**
 * Reduces clipboard HTML to the small schema used by the document editors.
 * Images are deliberately removed here: the document clipboard dispatcher
 * handles supported image data before ProseMirror parses text.
 */
export const sanitizeDocumentPasteHtml = (source: string): string => {
  if (typeof DOMParser === 'undefined') {
    return escapeHtml(source.replace(/<[^>]*>/g, ''));
  }

  const parsed = new DOMParser().parseFromString(source, 'text/html');
  parsed.querySelectorAll(REMOVE_WITH_CONTENT.join(',')).forEach((node) => {
    node.remove();
  });

  Array.from(parsed.body.querySelectorAll('*')).forEach((node) => {
    const element = node as HTMLElement;
    const tagName = element.tagName.toLowerCase();
    if (!ALLOWED_ELEMENTS.has(tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      return;
    }
    sanitizeElementStyle(element);
  });

  return parsed.body.innerHTML;
};

export const SanitizedPasteExtension = Extension.create({
  name: 'documentSanitizedPaste',

  transformPastedHTML(html) {
    return sanitizeDocumentPasteHtml(html);
  },
});
