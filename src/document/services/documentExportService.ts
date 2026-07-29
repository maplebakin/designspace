import { jsPDF } from 'jspdf';
import { sanitizeExportBaseName } from '../../editor/utils/exportFileName';
import {
  DEFAULT_DOCUMENT_PAPER_COLOR,
  normalizeDocumentPaperColor,
} from '../utils/documentColor';

export const DOCUMENT_EXPORT_EXCLUDE_ATTRIBUTE = 'data-document-export-exclude';
export const DOCUMENT_PRINT_HOST_ATTRIBUTE = 'data-document-print-host';
export const CSS_PIXELS_PER_INCH = 96;
export const DEFAULT_DOCUMENT_EXPORT_DPI = 300;

const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const DEFAULT_EXCLUDED_SELECTORS = [
  `[${DOCUMENT_EXPORT_EXCLUDE_ATTRIBUTE}]`,
  '[data-document-reference-layer]',
  '[data-document-editor-ui]',
  '[data-document-overflow-warning]',
  '[data-document-resize-handle]',
  '.document-reference-layer',
  '.document-editor-ui',
  '.document-overflow-warning',
  '.document-resize-handle',
  '.ProseMirror-gapcursor',
  '.ProseMirror-dropcursor',
  '.ProseMirror-separator',
  '.document-flow-editor__content--span-source',
].join(',');

const EDITING_STATE_CLASSES = [
  'ProseMirror-focused',
  'ProseMirror-selectednode',
  'is-selected',
  'document-image--selected',
  'document-overlay-image--selected',
];

const DROP_CAP_SELECTOR = [
  '[data-drop-cap="true"]',
  '[data-document-drop-cap="true"]',
  '.document-drop-cap',
].join(',');

export type DocumentPhysicalSize = {
  widthIn: number;
  heightIn: number;
};

export type DocumentExportOptions = DocumentPhysicalSize & {
  dpi?: number;
  fileName?: string;
  backgroundColor?: string;
  cssPixelsPerInch?: number;
};

export type DocumentPixelDimensions = {
  width: number;
  height: number;
};

export type CleanDocumentCloneOptions = {
  copyComputedStyles?: boolean;
  excludedSelectors?: string[];
};

export type DocumentResourceWaitOptions = {
  /**
   * Supplying null explicitly skips the font wait. This is primarily useful in
   * non-browser unit tests; normal exports use document.fonts.ready.
   */
  fontsReady?: PromiseLike<unknown> | null;
  decodeImage?: (image: HTMLImageElement) => Promise<void>;
};

export type PrepareDocumentCloneOptions = CleanDocumentCloneOptions & {
  resourceWaitOptions?: DocumentResourceWaitOptions;
  fetchResource?: typeof fetch;
};

const finitePositive = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0 ? value : fallback;

const normalizePhysicalSize = (size: DocumentPhysicalSize): DocumentPhysicalSize => ({
  widthIn: finitePositive(size.widthIn, 8.5),
  heightIn: finitePositive(size.heightIn, 11),
});

export const calculateDocumentPixelDimensions = (
  size: DocumentPhysicalSize,
  dpi = DEFAULT_DOCUMENT_EXPORT_DPI
): DocumentPixelDimensions => {
  const normalizedSize = normalizePhysicalSize(size);
  const normalizedDpi = finitePositive(dpi, DEFAULT_DOCUMENT_EXPORT_DPI);
  return {
    width: Math.max(1, Math.round(normalizedSize.widthIn * normalizedDpi)),
    height: Math.max(1, Math.round(normalizedSize.heightIn * normalizedDpi)),
  };
};

export const calculateDocumentCssDimensions = (
  size: DocumentPhysicalSize,
  cssPixelsPerInch = CSS_PIXELS_PER_INCH
): DocumentPixelDimensions => {
  const normalizedSize = normalizePhysicalSize(size);
  const normalizedCssPixelsPerInch = finitePositive(cssPixelsPerInch, CSS_PIXELS_PER_INCH);
  return {
    width: normalizedSize.widthIn * normalizedCssPixelsPerInch,
    height: normalizedSize.heightIn * normalizedCssPixelsPerInch,
  };
};

const getExclusionSelector = (extraSelectors: string[] = []) =>
  [DEFAULT_EXCLUDED_SELECTORS, ...extraSelectors.filter(Boolean)].filter(Boolean).join(',');

const isElementWithStyle = (element: Element): element is HTMLElement | SVGElement =>
  'style' in element;

const copyStyleDeclaration = (
  source: Element,
  target: Element,
  pseudoElement?: string
) => {
  if (!isElementWithStyle(target) || typeof window === 'undefined') return '';
  const computed = window.getComputedStyle(source, pseudoElement);
  const declarations: string[] = [];

  for (let index = 0; index < computed.length; index += 1) {
    const property = computed.item(index);
    const value = computed.getPropertyValue(property);
    const priority = computed.getPropertyPriority(property);
    if (!property || !value) continue;

    declarations.push(`${property}:${value}${priority ? ` !${priority}` : ''}`);
    if (!pseudoElement) {
      target.style.setProperty(property, value, priority);
    }
  }

  return declarations.join(';');
};

const copyComputedStylesAndDropCaps = (source: HTMLElement, clone: HTMLElement) => {
  const sourceElements: Element[] = [source, ...Array.from(source.querySelectorAll('*'))];
  const cloneElements: Element[] = [clone, ...Array.from(clone.querySelectorAll('*'))];
  const dropCapRules: string[] = [];

  sourceElements.forEach((sourceElement, index) => {
    const cloneElement = cloneElements[index];
    if (!cloneElement) return;
    copyStyleDeclaration(sourceElement, cloneElement);

    const parent = sourceElement.parentElement;
    const isFirstBodyParagraph =
      sourceElement.tagName.toLowerCase() === 'p'
      && !!parent?.classList.contains('ProseMirror')
      && !!sourceElement.closest(DROP_CAP_SELECTOR)
      && !Array.from(parent.children)
        .slice(0, Array.from(parent.children).indexOf(sourceElement))
        .some((sibling) => sibling.tagName.toLowerCase() === 'p');
    if (!sourceElement.matches(DROP_CAP_SELECTOR) && !isFirstBodyParagraph) return;
    try {
      const ruleId = `drop-cap-${dropCapRules.length + 1}`;
      const declarations = copyStyleDeclaration(sourceElement, cloneElement, '::first-letter');
      if (!declarations) return;
      cloneElement.setAttribute('data-document-export-pseudo', ruleId);
      dropCapRules.push(
        `[data-document-export-pseudo="${ruleId}"]::first-letter{${declarations}}`
      );
    } catch {
      // A browser may not expose computed pseudo-element styles. The ordinary
      // element styles still export correctly, and the retained drop-cap class
      // can be styled by the caller's document CSS.
    }
  });

  if (dropCapRules.length > 0) {
    const style = clone.ownerDocument.createElement('style');
    style.setAttribute(DOCUMENT_EXPORT_EXCLUDE_ATTRIBUTE, 'style-metadata');
    style.textContent = dropCapRules.join('\n');
    clone.prepend(style);
    // The style is export metadata, not editor-only UI. Remove the exclusion
    // marker after cleanup so it remains in the serialized XHTML.
    style.removeAttribute(DOCUMENT_EXPORT_EXCLUDE_ATTRIBUTE);
  }
};

const clearEditingState = (root: HTMLElement) => {
  const elements: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];

  elements.forEach((element) => {
    const hadEditingState = EDITING_STATE_CLASSES.some((className) =>
      element.classList.contains(className)
    );
    EDITING_STATE_CLASSES.forEach((className) => element.classList.remove(className));

    element.removeAttribute('contenteditable');
    element.removeAttribute('spellcheck');
    element.removeAttribute('autocorrect');
    element.removeAttribute('autocapitalize');
    element.removeAttribute('aria-selected');
    element.removeAttribute('draggable');

    if (element.hasAttribute('tabindex')) {
      element.removeAttribute('tabindex');
    }

    if (isElementWithStyle(element)) {
      element.style.caretColor = 'transparent';
      element.style.outline = 'none';
      if (hadEditingState) {
        element.style.boxShadow = 'none';
      }
    }
  });
};

/**
 * Creates a detached export-only clone. Editor assistance is physically
 * removed from the clone, rather than hidden in the live editor, so a visible
 * scan reference can never leak into PNG, PDF, or print output.
 */
export const createCleanDocumentClone = (
  source: HTMLElement,
  options: CleanDocumentCloneOptions = {}
): HTMLElement => {
  const exclusionSelector = getExclusionSelector(options.excludedSelectors);
  if (source.matches(exclusionSelector)) {
    throw new Error('The document page root is marked as excluded from export.');
  }

  const clone = source.cloneNode(true) as HTMLElement;
  if (options.copyComputedStyles ?? true) {
    copyComputedStylesAndDropCaps(source, clone);
  }

  clone.querySelectorAll(exclusionSelector).forEach((element) => element.remove());
  clearEditingState(clone);
  clone.querySelectorAll<HTMLElement>('[data-document-span-layout]').forEach(
    (layout) => {
      layout.style.display = 'block';
      layout.setAttribute('data-text-editing', 'false');
      layout.setAttribute('data-hidden-for-editing', 'false');
    }
  );

  clone.removeAttribute('id');
  clone.removeAttribute('data-testid');
  clone.style.transform = 'none';
  clone.style.transformOrigin = 'top left';
  clone.style.zoom = '1';
  clone.style.margin = '0';
  clone.style.boxShadow = 'none';
  clone.style.overflow = 'hidden';
  clone.style.pointerEvents = 'none';
  clone.style.userSelect = 'none';

  return clone;
};

const waitForImage = async (image: HTMLImageElement) => {
  if (typeof image.decode === 'function') {
    try {
      await image.decode();
      return;
    } catch (error) {
      if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) return;
      const reason = error instanceof Error && error.message ? ` (${error.message})` : '';
      throw new Error(
        `Document image could not be decoded before export${image.alt ? `: ${image.alt}` : '.'}${reason}`
      );
    }
  }

  if (image.complete) {
    if (image.naturalWidth > 0 && image.naturalHeight > 0) return;
    throw new Error(`Document image could not be loaded before export${image.alt ? `: ${image.alt}` : '.'}`);
  }

  await new Promise<void>((resolve, reject) => {
    const handleLoad = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error(`Document image could not be loaded before export${image.alt ? `: ${image.alt}` : '.'}`));
    };
    const cleanup = () => {
      image.removeEventListener('load', handleLoad);
      image.removeEventListener('error', handleError);
    };
    image.addEventListener('load', handleLoad, { once: true });
    image.addEventListener('error', handleError, { once: true });
  });
};

const retainedSourceImages = (
  root: HTMLElement,
  excludedSelectors: string[] = []
) => {
  const exclusionSelector = getExclusionSelector(excludedSelectors);
  return Array.from(root.querySelectorAll('img')).filter(
    (image) => !image.closest(exclusionSelector)
  );
};

export const waitForDocumentResources = async (
  root: HTMLElement,
  options: DocumentResourceWaitOptions = {},
  excludedSelectors: string[] = []
) => {
  const fontsReady = options.fontsReady === undefined
    ? (typeof document !== 'undefined' ? document.fonts?.ready : null)
    : options.fontsReady;
  if (fontsReady) await fontsReady;

  const images = retainedSourceImages(root, excludedSelectors);
  await Promise.all(
    images.map((image) =>
      options.decodeImage ? options.decodeImage(image) : waitForImage(image)
    )
  );
};

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('Could not encode a document image for export.'));
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read a document image for export.'));
    reader.readAsDataURL(blob);
  });

const makeImageSourceSelfContained = async (
  source: string,
  fetchResource: typeof fetch
) => {
  if (/^data:/i.test(source)) return source;
  const response = await fetchResource(source);
  if (!response.ok) {
    throw new Error(`Could not load a document image for export (${response.status}).`);
  }
  return blobToDataUrl(await response.blob());
};

const inlineRetainedImages = async (
  source: HTMLElement,
  clone: HTMLElement,
  options: PrepareDocumentCloneOptions
) => {
  const sourceImages = retainedSourceImages(source, options.excludedSelectors);
  const clonedImages = Array.from(clone.querySelectorAll('img'));
  if (sourceImages.length !== clonedImages.length) {
    throw new Error('The document export clone did not retain the expected images.');
  }

  const fetchResource = options.fetchResource
    ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);

  await Promise.all(sourceImages.map(async (sourceImage, index) => {
    const clonedImage = clonedImages[index];
    const imageSource = sourceImage.currentSrc || sourceImage.src || sourceImage.getAttribute('src') || '';
    if (!imageSource) {
      throw new Error(`Document image has no source${sourceImage.alt ? `: ${sourceImage.alt}` : '.'}`);
    }

    if (/^data:/i.test(imageSource)) {
      clonedImage.src = imageSource;
    } else {
      if (!fetchResource) {
        throw new Error('This environment cannot make document images self-contained for export.');
      }
      clonedImage.src = await makeImageSourceSelfContained(imageSource, fetchResource);
    }
    clonedImage.removeAttribute('srcset');
    clonedImage.removeAttribute('sizes');
    clonedImage.removeAttribute('loading');
    clonedImage.removeAttribute('decoding');
  }));
};

export const prepareDocumentExportClone = async (
  source: HTMLElement,
  size: DocumentPhysicalSize,
  options: PrepareDocumentCloneOptions = {}
) => {
  await waitForDocumentResources(
    source,
    options.resourceWaitOptions,
    options.excludedSelectors
  );
  const clone = createCleanDocumentClone(source, options);
  await inlineRetainedImages(source, clone, options);

  const cssDimensions = calculateDocumentCssDimensions(size);
  clone.style.width = `${cssDimensions.width}px`;
  clone.style.height = `${cssDimensions.height}px`;
  clone.style.minWidth = `${cssDimensions.width}px`;
  clone.style.maxWidth = `${cssDimensions.width}px`;
  clone.style.minHeight = `${cssDimensions.height}px`;
  clone.style.maxHeight = `${cssDimensions.height}px`;
  clone.style.boxSizing = 'border-box';

  return clone;
};

const escapeXmlAttribute = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export const createDocumentSvgMarkup = (
  cleanClone: HTMLElement,
  size: DocumentPhysicalSize,
  dpi = DEFAULT_DOCUMENT_EXPORT_DPI,
  cssPixelsPerInch = CSS_PIXELS_PER_INCH
) => {
  if (typeof XMLSerializer === 'undefined') {
    throw new Error('Document serialization is unavailable in this environment.');
  }
  const normalizedSize = normalizePhysicalSize(size);
  const pixelDimensions = calculateDocumentPixelDimensions(normalizedSize, dpi);
  const cssDimensions = calculateDocumentCssDimensions(normalizedSize, cssPixelsPerInch);
  const wrapper = cleanClone.ownerDocument.createElement('div');
  wrapper.setAttribute('xmlns', XHTML_NAMESPACE);
  wrapper.style.width = `${cssDimensions.width}px`;
  wrapper.style.height = `${cssDimensions.height}px`;
  wrapper.style.margin = '0';
  wrapper.style.padding = '0';
  wrapper.style.overflow = 'hidden';
  wrapper.appendChild(cleanClone.cloneNode(true));

  const serializedXhtml = new XMLSerializer().serializeToString(wrapper);
  return [
    `<svg xmlns="${SVG_NAMESPACE}"`,
    ` width="${pixelDimensions.width}"`,
    ` height="${pixelDimensions.height}"`,
    ` viewBox="0 0 ${cssDimensions.width} ${cssDimensions.height}"`,
    ' preserveAspectRatio="none">',
    `<title>${escapeXmlAttribute('Design Space document export')}</title>`,
    `<foreignObject x="0" y="0" width="${cssDimensions.width}" height="${cssDimensions.height}">`,
    serializedXhtml,
    '</foreignObject>',
    '</svg>',
  ].join('');
};

const loadSvgImage = async (svgMarkup: string) => {
  // Chromium treats an SVG containing foreignObject as cross-origin when it is
  // loaded from a blob URL, which taints the destination canvas. A fully
  // self-contained data URL keeps the render exportable via canvas.toBlob().
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
  const image = new Image();
  image.decoding = 'sync';

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The browser could not render the document page.'));
    image.src = url;
  });
  return image;
};

const canvasToPngBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob && blob.size > 0) {
        resolve(blob);
        return;
      }
      reject(new Error('PNG export did not produce a nonzero Blob.'));
    }, 'image/png');
  });

const readBlobBytes = async (blob: Blob): Promise<Uint8Array> => {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result));
        return;
      }
      reject(new Error('Could not read the exported document image.'));
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read the exported document image.'));
    reader.readAsArrayBuffer(blob);
  });
};

export const triggerDocumentDownload = (blob: Blob, fileName: string) => {
  if (typeof document === 'undefined') {
    throw new Error('Downloads are unavailable in this environment.');
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
};

export const createDocumentPrintCss = (
  size: DocumentPhysicalSize,
  backgroundColor = DEFAULT_DOCUMENT_PAPER_COLOR
) => {
  const normalizedSize = normalizePhysicalSize(size);
  const normalizedBackgroundColor = normalizeDocumentPaperColor(backgroundColor);
  return `
@page {
  size: ${normalizedSize.widthIn}in ${normalizedSize.heightIn}in;
  margin: 0;
}
@media screen {
  [${DOCUMENT_PRINT_HOST_ATTRIBUTE}] {
    position: fixed !important;
    left: -100000px !important;
    top: 0 !important;
    pointer-events: none !important;
  }
}
@media print {
  html,
  body {
    width: ${normalizedSize.widthIn}in !important;
    height: ${normalizedSize.heightIn}in !important;
    margin: 0 !important;
    padding: 0 !important;
    background: ${normalizedBackgroundColor} !important;
  }
  body > :not([${DOCUMENT_PRINT_HOST_ATTRIBUTE}]) {
    display: none !important;
  }
  [${DOCUMENT_PRINT_HOST_ATTRIBUTE}] {
    display: block !important;
    position: static !important;
    width: ${normalizedSize.widthIn}in !important;
    height: ${normalizedSize.heightIn}in !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
  }
  [${DOCUMENT_PRINT_HOST_ATTRIBUTE}] > * {
    width: ${normalizedSize.widthIn}in !important;
    height: ${normalizedSize.heightIn}in !important;
    margin: 0 !important;
    box-shadow: none !important;
  }
  [${DOCUMENT_EXPORT_EXCLUDE_ATTRIBUTE}] {
    display: none !important;
  }
}`;
};

export class DocumentExportService {
  async exportPngBlob(
    pageElement: HTMLElement,
    options: DocumentExportOptions
  ): Promise<Blob> {
    const normalizedSize = normalizePhysicalSize(options);
    const dpi = finitePositive(options.dpi ?? DEFAULT_DOCUMENT_EXPORT_DPI, DEFAULT_DOCUMENT_EXPORT_DPI);
    const backgroundColor = normalizeDocumentPaperColor(options.backgroundColor);
    const clone = await prepareDocumentExportClone(pageElement, normalizedSize);
    clone.style.backgroundColor = backgroundColor;

    const svgMarkup = createDocumentSvgMarkup(
      clone,
      normalizedSize,
      dpi,
      options.cssPixelsPerInch
    );
    const image = await loadSvgImage(svgMarkup);
    const pixelDimensions = calculateDocumentPixelDimensions(normalizedSize, dpi);
    const canvas = document.createElement('canvas');
    canvas.width = pixelDimensions.width;
    canvas.height = pixelDimensions.height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('The browser could not create a document export canvas.');
    }

    context.save();
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    context.restore();

    try {
      return await canvasToPngBlob(canvas);
    } finally {
      image.src = '';
      canvas.width = 1;
      canvas.height = 1;
    }
  }

  async exportPdfBlob(
    pageElement: HTMLElement,
    options: DocumentExportOptions
  ): Promise<Blob> {
    const normalizedSize = normalizePhysicalSize(options);
    const pngBlob = await this.exportPngBlob(pageElement, options);
    const imageBytes = await readBlobBytes(pngBlob);
    const pdf = new jsPDF({
      orientation: normalizedSize.widthIn >= normalizedSize.heightIn ? 'landscape' : 'portrait',
      unit: 'in',
      format: [normalizedSize.widthIn, normalizedSize.heightIn],
    });
    pdf.addImage(
      imageBytes,
      'PNG',
      0,
      0,
      normalizedSize.widthIn,
      normalizedSize.heightIn,
      'document-page',
      'FAST'
    );
    const blob = pdf.output('blob');
    if (!blob || blob.size <= 0) {
      throw new Error('PDF export did not produce a nonzero Blob.');
    }
    return blob;
  }

  async downloadPng(pageElement: HTMLElement, options: DocumentExportOptions) {
    const blob = await this.exportPngBlob(pageElement, options);
    const fileName = `${sanitizeExportBaseName(options.fileName)}.png`;
    triggerDocumentDownload(blob, fileName);
    return { blob, fileName };
  }

  async downloadPdf(pageElement: HTMLElement, options: DocumentExportOptions) {
    const blob = await this.exportPdfBlob(pageElement, options);
    const fileName = `${sanitizeExportBaseName(options.fileName)}.pdf`;
    triggerDocumentDownload(blob, fileName);
    return { blob, fileName };
  }

  async print(
    pageElement: HTMLElement,
    options: DocumentExportOptions
  ): Promise<() => void> {
    if (typeof window === 'undefined' || typeof window.print !== 'function') {
      throw new Error('Printing is unavailable in this environment.');
    }
    const normalizedSize = normalizePhysicalSize(options);
    const backgroundColor = normalizeDocumentPaperColor(options.backgroundColor);
    const clone = await prepareDocumentExportClone(pageElement, normalizedSize);
    clone.style.width = `${normalizedSize.widthIn}in`;
    clone.style.height = `${normalizedSize.heightIn}in`;
    clone.style.backgroundColor = backgroundColor;

    const host = document.createElement('div');
    host.setAttribute(DOCUMENT_PRINT_HOST_ATTRIBUTE, 'true');
    host.setAttribute('aria-hidden', 'true');
    host.appendChild(clone);

    const style = document.createElement('style');
    style.setAttribute('data-document-print-style', 'true');
    style.textContent = createDocumentPrintCss(normalizedSize, backgroundColor);
    document.head.appendChild(style);
    document.body.appendChild(host);

    const fallbackTimer: { id?: number } = {};
    const cleanup = () => {
      window.removeEventListener('afterprint', cleanup);
      if (fallbackTimer.id !== undefined) window.clearTimeout(fallbackTimer.id);
      host.remove();
      style.remove();
    };

    window.addEventListener('afterprint', cleanup, { once: true });
    window.print();
    fallbackTimer.id = window.setTimeout(cleanup, 60_000);
    return cleanup;
  }
}

export const documentExportService = new DocumentExportService();
