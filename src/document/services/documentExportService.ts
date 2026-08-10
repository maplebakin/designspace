import { jsPDF } from 'jspdf';
import { sanitizeExportBaseName } from '../../editor/utils/exportFileName';
import {
  deliverFile,
  deliverFiles,
  triggerBrowserFileDownload,
} from '../../editor/services/fileDeliveryService';
import {
  DEFAULT_DOCUMENT_PAPER_COLOR,
  normalizeDocumentPaperColor,
} from '../utils/documentColor';
import { isTauriRecoveryAvailable } from '../../editor/recovery/recoveryClient';

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
  '[data-document-drop-cap-target="true"]',
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
  onWarning?: (warnings: readonly string[]) => void;
  onDiagnostics?: (diagnostics: DocumentExportDiagnostics) => void;
};

export type DocumentExportPageSource = {
  pageId: string;
  element: HTMLElement;
  options: DocumentExportOptions;
};

export type DocumentPixelDimensions = {
  width: number;
  height: number;
};

/**
 * The export surface has two deliberately different resolutions: the
 * browser layout surface is expressed in CSS pixels, while the output PNG
 * (and the raster embedded in PDF) is expressed in print pixels. Keeping
 * both dimensions and their conversion together prevents a zoomed live DOM
 * rect, a fractional CSS page, and a rounded canvas dimension from drifting
 * apart at the bottom edge of a page.
 */
export type DocumentExportSurfaceGeometry = {
  css: DocumentPixelDimensions;
  raster: DocumentPixelDimensions;
  cssToRasterX: number;
  cssToRasterY: number;
};

export type DocumentExportSvgTarget = 'browser' | 'tauri';

export type DocumentExportRectDiagnostics = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type DocumentExportImageSourceType =
  | 'data-url'
  | 'blob-url'
  | 'file-url'
  | 'tauri-asset-url'
  | 'app-url'
  | 'other';

export type DocumentExportImageDiagnostics = {
  index: number;
  imageId: string | null;
  assetId: string | null;
  sourceType: DocumentExportImageSourceType;
  sourceMimeType: string;
  sourceLength: number;
  sourceByteLength: number;
  naturalWidth: number;
  naturalHeight: number;
  renderedWidth: number;
  renderedHeight: number;
  complete: boolean;
  clone: {
    sourceType: DocumentExportImageSourceType;
    sourceMimeType: string;
    sourceLength: number;
    sourceByteLength: number;
    naturalWidth: number;
    naturalHeight: number;
    renderedWidth: number;
    renderedHeight: number;
    complete: boolean;
    decode: 'resolved';
  };
  serializedSourcePresent: boolean;
  rasterElement: 'xhtml-img' | 'svg-image';
};

export type DocumentExportDiagnostics = {
  target: DocumentExportSvgTarget;
  page: {
    widthIn: number;
    heightIn: number;
    dpi: number;
    cssPixelsPerInch: number;
    devicePixelRatio: number;
  };
  surface: DocumentExportSurfaceGeometry;
  sourceRoot: {
    rect: DocumentExportRectDiagnostics;
    computedWidth: string;
    computedHeight: string;
    transform: string;
    zoom: string;
  };
  exportHost: DocumentExportRectDiagnostics | null;
  svg: {
    width: number;
    height: number;
    viewBox: string;
    foreignObjectWidth: number;
    foreignObjectHeight: number;
  };
  image: {
    naturalWidth: number;
    naturalHeight: number;
    width: number;
    height: number;
  };
  retainedImages: DocumentExportImageDiagnostics[];
  canvas: DocumentPixelDimensions;
  draw: {
    source: DocumentExportRectDiagnostics;
    destination: DocumentExportRectDiagnostics;
  };
  pdf?: {
    pageIndex: number;
    pageWidthIn: number;
    pageHeightIn: number;
    pageWidthPt: number;
    pageHeightPt: number;
    imageXIn: number;
    imageYIn: number;
    imageWidthIn: number;
    imageHeightIn: number;
  };
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
  cssPixelsPerInch?: number;
};

const finitePositive = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0 ? value : fallback;

const normalizePhysicalSize = (size: DocumentPhysicalSize): DocumentPhysicalSize => ({
  widthIn: finitePositive(size.widthIn, 8.5),
  heightIn: finitePositive(size.heightIn, 11),
});

const documentPdfOrientation = (size: DocumentPhysicalSize) =>
  size.widthIn >= size.heightIn ? 'landscape' as const : 'portrait' as const;

const documentPdfImageAlias = (pageId: string, pageIndex: number) => {
  const normalizedPageId = pageId
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'page';
  return `document-page-${pageIndex + 1}-${normalizedPageId}`;
};

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

export const calculateDocumentExportSurfaceGeometry = (
  size: DocumentPhysicalSize,
  dpi = DEFAULT_DOCUMENT_EXPORT_DPI,
  cssPixelsPerInch = CSS_PIXELS_PER_INCH
): DocumentExportSurfaceGeometry => {
  const css = calculateDocumentCssDimensions(size, cssPixelsPerInch);
  const raster = calculateDocumentPixelDimensions(size, dpi);
  return {
    css,
    raster,
    cssToRasterX: raster.width / Math.max(1, css.width),
    cssToRasterY: raster.height / Math.max(1, css.height),
  };
};

export const calculateDocumentImageEffectiveDpi = ({
  naturalWidthPx,
  renderedWidthPx,
}: {
  naturalWidthPx: number;
  renderedWidthPx: number;
}) => {
  const natural = finitePositive(naturalWidthPx, 0);
  const rendered = finitePositive(renderedWidthPx, 0);
  if (natural <= 0 || rendered <= 0) return 0;
  return natural * CSS_PIXELS_PER_INCH / rendered;
};

export const collectDocumentImageDpiWarnings = (
  root: HTMLElement,
  minimumDpi = 150
) => {
  const warnings: string[] = [];
  root.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    const naturalWidth = image.naturalWidth || Number(image.getAttribute('width'));
    const renderedWidth = Number.parseFloat(image.style.width)
      || image.getBoundingClientRect().width
      || naturalWidth;
    const dpi = calculateDocumentImageEffectiveDpi({
      naturalWidthPx: naturalWidth,
      renderedWidthPx: renderedWidth,
    });
    if (dpi > 0 && dpi < minimumDpi) {
      warnings.push(
        `${image.alt || 'An image'} is approximately ${Math.round(dpi)} DPI at print size.`
      );
    }
  });
  return warnings;
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
  // The live root is an absolutely positioned child of the bordered page
  // sheet.  That editor border shifts its containing block by one CSS pixel
  // and the live sheet clips the overflow.  An export clone is its own page
  // surface, so it must start at (0, 0); the explicit SVG/print page surface
  // below owns clipping instead of the editor sheet.
  clone.style.position = 'relative';
  clone.style.inset = 'auto';
  clone.style.margin = '0';
  clone.style.boxShadow = 'none';
  clone.style.overflow = 'visible';
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

const waitForDocumentImage = async (
  image: HTMLImageElement,
  options?: DocumentResourceWaitOptions
) => {
  if (options?.decodeImage) {
    await options.decodeImage(image);
    return;
  }
  await waitForImage(image);
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
      waitForDocumentImage(image, options)
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

const dataUrlMetadata = (source: string) => {
  const match = source.match(/^data:([^,]*),(.*)$/is);
  if (!match) return null;
  const header = match[1] || '';
  const payload = match[2] || '';
  const headerParts = header.split(';');
  const mimeType = headerParts[0] || 'text/plain';
  const isBase64 = headerParts.some((part) => part.toLowerCase() === 'base64');
  if (isBase64) {
    const normalizedPayload = payload.replace(/\s/g, '');
    const padding = normalizedPayload.endsWith('==')
      ? 2
      : normalizedPayload.endsWith('=')
        ? 1
        : 0;
    return {
      mimeType,
      byteLength: Math.max(0, Math.floor(normalizedPayload.length * 3 / 4) - padding),
    };
  }
  try {
    const decodedPayload = decodeURIComponent(payload);
    return {
      mimeType,
      byteLength: typeof TextEncoder === 'undefined'
        ? decodedPayload.length
        : new TextEncoder().encode(decodedPayload).byteLength,
    };
  } catch {
    return { mimeType, byteLength: 0 };
  }
};

const documentImageSourceType = (source: string): DocumentExportImageSourceType => {
  if (/^data:/i.test(source)) return 'data-url';
  if (/^blob:/i.test(source)) return 'blob-url';
  if (/^file:/i.test(source)) return 'file-url';
  if (/^(?:asset|tauri):/i.test(source)) return 'tauri-asset-url';
  if (/^(?:https?|app):/i.test(source)) return 'app-url';
  return 'other';
};

const describeDocumentImageSource = (source: string) => {
  const data = dataUrlMetadata(source);
  return {
    sourceType: documentImageSourceType(source),
    sourceMimeType: data?.mimeType || '',
    sourceLength: source.length,
    sourceByteLength: data?.byteLength || 0,
  };
};

const documentImageSource = (image: HTMLImageElement) => (
  image.currentSrc || image.src || image.getAttribute('src') || ''
);

const documentImageIdentity = (image: HTMLImageElement, attribute: string) => (
  image.getAttribute(attribute)
  || image.closest(`[${attribute}]`)?.getAttribute(attribute)
  || null
);

const documentImageRenderedSize = (image: HTMLImageElement) => {
  const rect = image.getBoundingClientRect();
  return {
    width: rect.width || Number.parseFloat(image.style.width) || image.width || 0,
    height: rect.height || Number.parseFloat(image.style.height) || image.height || 0,
  };
};

const makeImageSourceSelfContained = async (
  source: string,
  fetchResource: typeof fetch
) => {
  const response = await fetchResource(source);
  if (!response.ok) {
    throw new Error(`Could not load a document image for export (${response.status}).`);
  }
  const blob = await response.blob();
  return blobToDataUrl(blob);
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
    const imageSource = documentImageSource(sourceImage);
    if (!imageSource) {
      throw new Error(`Document image has no source${sourceImage.alt ? `: ${sourceImage.alt}` : '.'}`);
    }

    if (!fetchResource && !/^data:/i.test(imageSource)) {
      throw new Error('This environment cannot make document images self-contained for export.');
    }

    clonedImage.removeAttribute('srcset');
    clonedImage.removeAttribute('sizes');
    clonedImage.setAttribute('loading', 'eager');
    clonedImage.setAttribute('decoding', 'sync');
    const selfContainedSource = /^data:/i.test(imageSource)
      ? imageSource
      : await makeImageSourceSelfContained(imageSource, fetchResource as typeof fetch);
    clonedImage.src = selfContainedSource;
    await waitForDocumentImage(clonedImage, options.resourceWaitOptions);
    if (clonedImage.naturalWidth > 0 && clonedImage.naturalHeight > 0) {
      clonedImage.setAttribute(
        'data-export-natural-width',
        String(clonedImage.naturalWidth)
      );
      clonedImage.setAttribute(
        'data-export-natural-height',
        String(clonedImage.naturalHeight)
      );
    }

    // A clone can lose explicit dimensions when the source came from a
    // responsive image. Keep the committed geometry authoritative after the
    // source is replaced and before SVG/print serialization.
    if (!clonedImage.getAttribute('width') && sourceImage.getAttribute('width')) {
      clonedImage.setAttribute('width', sourceImage.getAttribute('width') || '');
    }
    if (!clonedImage.getAttribute('height') && sourceImage.getAttribute('height')) {
      clonedImage.setAttribute('height', sourceImage.getAttribute('height') || '');
    }
    clonedImage.removeAttribute('loading');
    clonedImage.removeAttribute('decoding');
  }));
};

export const prepareDocumentExportClone = async (
  source: HTMLElement,
  size: DocumentPhysicalSize,
  options: PrepareDocumentCloneOptions = {}
) => {
  const missingImages = source.querySelectorAll(
    '.document-image__missing, .document-overlay-image__missing'
  );
  if (missingImages.length > 0) {
    throw new Error(
      `Document export cannot continue: ${missingImages.length} image asset${missingImages.length === 1 ? '' : 's'} missing.`
    );
  }
  await waitForDocumentResources(
    source,
    options.resourceWaitOptions,
    options.excludedSelectors
  );
  const clone = createCleanDocumentClone(source, options);
  await inlineRetainedImages(source, clone, options);

  const cssDimensions = calculateDocumentCssDimensions(
    size,
    options.cssPixelsPerInch
  );
  clone.style.width = `${cssDimensions.width}px`;
  clone.style.height = `${cssDimensions.height}px`;
  clone.style.minWidth = `${cssDimensions.width}px`;
  clone.style.maxWidth = `${cssDimensions.width}px`;
  clone.style.minHeight = `${cssDimensions.height}px`;
  clone.style.maxHeight = `${cssDimensions.height}px`;
  clone.style.boxSizing = 'border-box';

  return clone;
};

export const getDocumentExportSvgTarget = (): DocumentExportSvgTarget => (
  isTauriRecoveryAvailable() ? 'tauri' : 'browser'
);

const escapeXmlAttribute = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const positiveImageDimension = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

const parseObjectPositionCoordinate = (
  value: string | undefined,
  axis: 'x' | 'y'
) => {
  const token = value?.trim().toLowerCase() || '';
  if (token === (axis === 'x' ? 'left' : 'top')) return 0;
  if (token === 'center') return 0.5;
  if (token === (axis === 'x' ? 'right' : 'bottom')) return 1;
  if (token.endsWith('%')) {
    const numeric = Number.parseFloat(token.slice(0, -1));
    if (Number.isFinite(numeric)) return Math.min(1, Math.max(0, numeric / 100));
  }
  return 0.5;
};

const getTauriImageViewport = (
  image: HTMLImageElement,
  width: number,
  height: number
) => {
  const objectFit = image.style.getPropertyValue('object-fit')
    || image.style.objectFit
    || 'fill';
  const naturalWidth = positiveImageDimension(
    image.naturalWidth
      || image.getAttribute('data-export-natural-width')
      || image.getAttribute('data-natural-width'),
    width
  );
  const naturalHeight = positiveImageDimension(
    image.naturalHeight
      || image.getAttribute('data-export-natural-height')
      || image.getAttribute('data-natural-height'),
    height
  );
  const position = (image.style.getPropertyValue('object-position')
    || image.style.objectPosition
    || '50% 50%')
    .trim()
    .split(/\s+/);
  const focalX = parseObjectPositionCoordinate(position[0], 'x');
  const focalY = parseObjectPositionCoordinate(position[1] || position[0], 'y');

  if (objectFit === 'cover' || objectFit === 'contain' || objectFit === 'scale-down') {
    const cover = objectFit === 'cover';
    const scale = cover
      ? Math.max(width / naturalWidth, height / naturalHeight)
      : Math.min(width / naturalWidth, height / naturalHeight);
    const boundedScale = objectFit === 'scale-down'
      ? Math.min(1, scale)
      : scale;
    const imageWidth = naturalWidth * boundedScale;
    const imageHeight = naturalHeight * boundedScale;
    return {
      x: (width - imageWidth) * focalX,
      y: (height - imageHeight) * focalY,
      width: imageWidth,
      height: imageHeight,
    };
  }

  return {
    x: 0,
    y: 0,
    width,
    height,
  };
};

/**
 * WebKitGTK lays out XHTML inside foreignObject correctly at CSS size, but it
 * drops raster HTMLImageElement content when the same XHTML is loaded from an
 * SVG data URL. SVG image resources are supported by that raster path. The
 * replacement is made on the export-only clone and keeps the image's computed
 * box, class, accessibility metadata, and object-fit behavior intact.
 */
const replaceTauriCloneImagesWithSvgImages = (clone: HTMLElement) => {
  const images = Array.from(clone.querySelectorAll<HTMLImageElement>('img'));
  images.forEach((image) => {
    const source = documentImageSource(image);
    if (!/^data:/i.test(source)) {
      throw new Error(
        `Document image could not be embedded for Tauri export${image.alt ? `: ${image.alt}` : '.'}`
      );
    }

    const width = Number.parseFloat(image.style.width)
      || Number.parseFloat(image.getAttribute('width') || '')
      || image.width
      || image.naturalWidth;
    const height = Number.parseFloat(image.style.height)
      || Number.parseFloat(image.getAttribute('height') || '')
      || image.height
      || image.naturalHeight;
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      throw new Error(
        `Document image has no usable dimensions for Tauri export${image.alt ? `: ${image.alt}` : '.'}`
      );
    }

    const svgImage = clone.ownerDocument.createElementNS(SVG_NAMESPACE, 'svg');
    Array.from(image.attributes).forEach((attribute) => {
      if (['src', 'srcset', 'sizes', 'loading', 'decoding', 'alt', 'width', 'height'].includes(attribute.name)) {
        return;
      }
      svgImage.setAttribute(attribute.name, attribute.value);
    });
    svgImage.setAttribute('width', String(width));
    svgImage.setAttribute('height', String(height));
    svgImage.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svgImage.setAttribute('preserveAspectRatio', 'none');
    if (image.alt) {
      svgImage.setAttribute('role', 'img');
      svgImage.setAttribute('aria-label', image.alt);
    }

    const viewport = getTauriImageViewport(image, width, height);
    const embeddedImage = clone.ownerDocument.createElementNS(SVG_NAMESPACE, 'image');
    embeddedImage.setAttribute('x', String(viewport.x));
    embeddedImage.setAttribute('y', String(viewport.y));
    embeddedImage.setAttribute('width', String(viewport.width));
    embeddedImage.setAttribute('height', String(viewport.height));
    // The viewport above has already applied CSS object-fit and focal
    // positioning.  Disabling SVG's own aspect-ratio negotiation keeps the
    // result identical in Chromium and WebKitGTK, including non-centre crops.
    embeddedImage.setAttribute('preserveAspectRatio', 'none');
    embeddedImage.setAttribute('href', source);
    svgImage.appendChild(embeddedImage);
    image.replaceWith(svgImage);
  });
  return images.length;
};

export const createDocumentSvgMarkup = (
  cleanClone: HTMLElement,
  size: DocumentPhysicalSize,
  dpi = DEFAULT_DOCUMENT_EXPORT_DPI,
  cssPixelsPerInch = CSS_PIXELS_PER_INCH,
  target: DocumentExportSvgTarget = 'browser'
) => {
  if (typeof XMLSerializer === 'undefined') {
    throw new Error('Document serialization is unavailable in this environment.');
  }
  const normalizedSize = normalizePhysicalSize(size);
  const surface = calculateDocumentExportSurfaceGeometry(
    normalizedSize,
    dpi,
    cssPixelsPerInch
  );
  const pixelDimensions = surface.raster;
  const cssDimensions = surface.css;
  const wrapper = cleanClone.ownerDocument.createElement('div');
  wrapper.setAttribute('xmlns', XHTML_NAMESPACE);
  wrapper.style.width = `${cssDimensions.width}px`;
  wrapper.style.height = `${cssDimensions.height}px`;
  wrapper.style.margin = '0';
  wrapper.style.padding = '0';
  wrapper.style.overflow = 'hidden';
  wrapper.style.position = 'relative';
  wrapper.style.boxSizing = 'border-box';
  const exportClone = cleanClone.cloneNode(true) as HTMLElement;
  if (target === 'tauri') {
    replaceTauriCloneImagesWithSvgImages(exportClone);
  }
  wrapper.appendChild(exportClone);

  const serializedXhtml = new XMLSerializer().serializeToString(wrapper);
  // Chromium applies the root viewBox transform to foreignObject content. The
  // WebKitGTK version used by Tauri lays out the XHTML at its CSS-pixel size
  // instead, while still exposing the physical SVG viewport to canvas. Use a
  // CSS-sized SVG only for that runtime; canvas performs the one explicit
  // CSS-to-raster scale below. The browser target retains the established
  // high-resolution SVG contract and output.
  const intrinsicDimensions = target === 'tauri' ? cssDimensions : pixelDimensions;
  return [
    `<svg xmlns="${SVG_NAMESPACE}"`,
    ` width="${intrinsicDimensions.width}"`,
    ` height="${intrinsicDimensions.height}"`,
    ` viewBox="0 0 ${cssDimensions.width} ${cssDimensions.height}"`,
    ' preserveAspectRatio="none">',
    `<title>${escapeXmlAttribute('Design Space document export')}</title>`,
    `<foreignObject x="0" y="0" width="${cssDimensions.width}" height="${cssDimensions.height}">`,
    serializedXhtml,
    '</foreignObject>',
    '</svg>',
  ].join('');
};

const exportRectDiagnostics = (element: Element): DocumentExportRectDiagnostics => {
  const rect = (element as HTMLElement).getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
};

const exportOptionalRectDiagnostics = (element: Element | null) => (
  element ? exportRectDiagnostics(element) : null
);

const exportComputedStyleValue = (element: Element, property: string) => {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return '';
  }
  return window.getComputedStyle(element).getPropertyValue(property);
};

const collectDocumentExportImageDiagnostics = (
  sourceRoot: HTMLElement,
  clone: HTMLElement,
  serializedSvg: string,
  target: DocumentExportSvgTarget
): DocumentExportImageDiagnostics[] => {
  const sourceImages = retainedSourceImages(sourceRoot);
  const clonedImages = Array.from(clone.querySelectorAll<HTMLImageElement>('img'));
  return sourceImages.map((sourceImage, index) => {
    const clonedImage = clonedImages[index];
    if (!clonedImage) {
      throw new Error('The document export image diagnostics could not match the cloned images.');
    }
    const source = documentImageSource(sourceImage);
    const clonedSource = documentImageSource(clonedImage);
    const sourceMetadata = describeDocumentImageSource(source);
    const clonedMetadata = describeDocumentImageSource(clonedSource);
    const sourceRenderedSize = documentImageRenderedSize(sourceImage);
    const clonedRenderedSize = documentImageRenderedSize(clonedImage);
    return {
      index,
      imageId: documentImageIdentity(sourceImage, 'data-image-id'),
      assetId: documentImageIdentity(sourceImage, 'data-asset-id'),
      ...sourceMetadata,
      naturalWidth: sourceImage.naturalWidth,
      naturalHeight: sourceImage.naturalHeight,
      renderedWidth: sourceRenderedSize.width,
      renderedHeight: sourceRenderedSize.height,
      complete: sourceImage.complete,
      clone: {
        ...clonedMetadata,
        naturalWidth: clonedImage.naturalWidth,
        naturalHeight: clonedImage.naturalHeight,
        renderedWidth: clonedRenderedSize.width,
        renderedHeight: clonedRenderedSize.height,
        complete: clonedImage.complete,
        decode: 'resolved' as const,
      },
      serializedSourcePresent: serializedSvg.includes(clonedSource),
      rasterElement: target === 'tauri' ? 'svg-image' : 'xhtml-img',
    };
  });
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
  // WebKitGTK exposes Blob.arrayBuffer(), but its promise can remain pending
  // for the multi-megabyte PNG produced by a page export. FileReader uses the
  // native blob read path consistently in both WebKitGTK and Chromium.
  if (typeof FileReader === 'function') {
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
  }

  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }

  throw new Error('Could not read the exported document image.');
};

export const triggerDocumentDownload = (blob: Blob, fileName: string) => {
  triggerBrowserFileDownload(blob, fileName);
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
    const surface = calculateDocumentExportSurfaceGeometry(
      normalizedSize,
      dpi,
      options.cssPixelsPerInch
    );
    const cssPixelsPerInch = finitePositive(
      options.cssPixelsPerInch ?? CSS_PIXELS_PER_INCH,
      CSS_PIXELS_PER_INCH
    );
    const target = getDocumentExportSvgTarget();
    const backgroundColor = normalizeDocumentPaperColor(options.backgroundColor);
    const clone = await prepareDocumentExportClone(pageElement, normalizedSize, {
      cssPixelsPerInch: options.cssPixelsPerInch,
    });
    options.onWarning?.(collectDocumentImageDpiWarnings(pageElement));
    clone.style.backgroundColor = backgroundColor;

    const svgMarkup = createDocumentSvgMarkup(
      clone,
      normalizedSize,
      dpi,
      options.cssPixelsPerInch,
      target
    );
    const retainedImages = collectDocumentExportImageDiagnostics(
      pageElement,
      clone,
      svgMarkup,
      target
    );
    const image = await loadSvgImage(svgMarkup);
    const canvas = document.createElement('canvas');
    canvas.width = surface.raster.width;
    canvas.height = surface.raster.height;
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

    options.onDiagnostics?.({
      target,
      page: {
        widthIn: normalizedSize.widthIn,
        heightIn: normalizedSize.heightIn,
        dpi,
        cssPixelsPerInch,
        devicePixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
      },
      surface,
      sourceRoot: {
        rect: exportRectDiagnostics(pageElement),
        computedWidth: exportComputedStyleValue(pageElement, 'width'),
        computedHeight: exportComputedStyleValue(pageElement, 'height'),
        transform: exportComputedStyleValue(pageElement, 'transform'),
        zoom: exportComputedStyleValue(pageElement, 'zoom'),
      },
      exportHost: exportOptionalRectDiagnostics(
        pageElement.closest('[data-document-committed-export-host]')
      ),
      svg: {
        width: target === 'tauri' ? surface.css.width : surface.raster.width,
        height: target === 'tauri' ? surface.css.height : surface.raster.height,
        viewBox: `0 0 ${surface.css.width} ${surface.css.height}`,
        foreignObjectWidth: surface.css.width,
        foreignObjectHeight: surface.css.height,
      },
      image: {
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        width: image.width,
        height: image.height,
      },
      retainedImages,
      canvas: {
        width: canvas.width,
        height: canvas.height,
      },
      draw: {
        source: {
          left: 0,
          top: 0,
          width: image.naturalWidth || image.width,
          height: image.naturalHeight || image.height,
        },
        destination: {
          left: 0,
          top: 0,
          width: canvas.width,
          height: canvas.height,
        },
      },
    });

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
    return this.exportPdfPagesBlob([{
      pageId: 'document-page',
      element: pageElement,
      options,
    }]);
  }

  async exportPdfPagesBlob(
    sources: readonly DocumentExportPageSource[]
  ): Promise<Blob> {
    if (sources.length === 0) {
      throw new Error('At least one document page is required for PDF export.');
    }

    const firstSize = normalizePhysicalSize(sources[0].options);
    const pdf = new jsPDF({
      orientation: documentPdfOrientation(firstSize),
      unit: 'in',
      format: [firstSize.widthIn, firstSize.heightIn],
    });

    for (let pageIndex = 0; pageIndex < sources.length; pageIndex += 1) {
      const source = sources[pageIndex];
      const normalizedSize = normalizePhysicalSize(source.options);
      if (pageIndex > 0) {
        pdf.addPage(
          [normalizedSize.widthIn, normalizedSize.heightIn],
          documentPdfOrientation(normalizedSize)
        );
      }

      // Rasterize one page at a time. exportPngBlob releases its temporary
      // image and canvas before this loop advances to the next source.
      let rasterDiagnostics: DocumentExportDiagnostics | undefined;
      const rasterOptions = source.options.onDiagnostics
        ? {
          ...source.options,
          onDiagnostics: (diagnostics: DocumentExportDiagnostics) => {
            rasterDiagnostics = diagnostics;
            source.options.onDiagnostics?.(diagnostics);
          },
        }
        : source.options;
      const pngBlob = await this.exportPngBlob(source.element, rasterOptions);
      const imageBytes = await readBlobBytes(pngBlob);
      pdf.addImage(
        imageBytes,
        'PNG',
        0,
        0,
        normalizedSize.widthIn,
        normalizedSize.heightIn,
        documentPdfImageAlias(source.pageId, pageIndex),
        'FAST'
      );
      if (rasterDiagnostics) {
        source.options.onDiagnostics?.({
          ...rasterDiagnostics,
          pdf: {
            pageIndex,
            pageWidthIn: normalizedSize.widthIn,
            pageHeightIn: normalizedSize.heightIn,
            pageWidthPt: normalizedSize.widthIn * 72,
            pageHeightPt: normalizedSize.heightIn * 72,
            imageXIn: 0,
            imageYIn: 0,
            imageWidthIn: normalizedSize.widthIn,
            imageHeightIn: normalizedSize.heightIn,
          },
        });
      }
    }

    const blob = pdf.output('blob');
    if (!blob || blob.size <= 0) {
      throw new Error('PDF export did not produce a nonzero Blob.');
    }
    return blob;
  }

  async downloadPng(pageElement: HTMLElement, options: DocumentExportOptions) {
    const blob = await this.exportPngBlob(pageElement, options);
    const fileName = `${sanitizeExportBaseName(options.fileName)}.png`;
    const delivery = await deliverFile({
      content: blob,
      fileName,
      extension: 'png',
      dialogTitle: 'Save PNG export',
      filterName: 'PNG image',
    });
    return { blob, fileName, delivery };
  }

  async downloadPngPages(
    sources: readonly DocumentExportPageSource[],
    fileName?: string
  ) {
    if (sources.length === 0) {
      throw new Error('At least one document page is required for PNG export.');
    }
    const baseName = sanitizeExportBaseName(fileName);
    const results: Array<{ blob: Blob; fileName: string }> = [];
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      const blob = await this.exportPngBlob(source.element, source.options);
      const outputName = `${baseName}-page-${String(index + 1).padStart(2, '0')}.png`;
      results.push({ blob, fileName: outputName });
    }
    const delivery = await deliverFiles(
      results.map(({ blob, fileName: outputName }) => ({
        content: blob,
        fileName: outputName,
        extension: 'png',
      })),
      { dialogTitle: 'Choose a folder for the exported PNG pages' }
    );
    return { files: results, delivery };
  }

  async downloadPdf(pageElement: HTMLElement, options: DocumentExportOptions) {
    const blob = await this.exportPdfBlob(pageElement, options);
    const fileName = `${sanitizeExportBaseName(options.fileName)}.pdf`;
    const delivery = await deliverFile({
      content: blob,
      fileName,
      extension: 'pdf',
      dialogTitle: 'Save PDF export',
      filterName: 'PDF document',
    });
    return { blob, fileName, delivery };
  }

  async downloadPdfPages(
    sources: readonly DocumentExportPageSource[],
    fileName?: string
  ) {
    const blob = await this.exportPdfPagesBlob(sources);
    const sanitizedFileName = `${sanitizeExportBaseName(fileName)}.pdf`;
    const delivery = await deliverFile({
      content: blob,
      fileName: sanitizedFileName,
      extension: 'pdf',
      dialogTitle: 'Save PDF export',
      filterName: 'PDF document',
    });
    return { blob, fileName: sanitizedFileName, delivery };
  }

  async print(
    pageElement: HTMLElement,
    options: DocumentExportOptions
  ): Promise<() => void> {
    if (typeof window === 'undefined' || typeof window.print !== 'function') {
      throw new Error('Printing is unavailable in this environment.');
    }
    return this.printPages([{
      pageId: 'document-page',
      element: pageElement,
      options,
    }]);
  }

  async printPages(
    sources: readonly DocumentExportPageSource[]
  ): Promise<() => void> {
    if (typeof window === 'undefined' || typeof window.print !== 'function') {
      throw new Error('Printing is unavailable in this environment.');
    }
    if (sources.length === 0) {
      throw new Error('At least one document page is required for printing.');
    }
    const firstSize = normalizePhysicalSize(sources[0].options);
    const host = document.createElement('div');
    host.setAttribute(DOCUMENT_PRINT_HOST_ATTRIBUTE, 'true');
    host.setAttribute('aria-hidden', 'true');
    for (const source of sources) {
      const normalizedSize = normalizePhysicalSize(source.options);
      const backgroundColor = normalizeDocumentPaperColor(source.options.backgroundColor);
      const clone = await prepareDocumentExportClone(source.element, normalizedSize, {
        cssPixelsPerInch: source.options.cssPixelsPerInch,
      });
      // PNG/PDF use the XHTML page wrapper as the clip.  Print has no SVG
      // wrapper, so retain a page-local clip for each committed clone.
      clone.style.overflow = 'hidden';
      clone.style.width = `${normalizedSize.widthIn}in`;
      clone.style.height = `${normalizedSize.heightIn}in`;
      clone.style.backgroundColor = backgroundColor;
      host.appendChild(clone);
    }

    const style = document.createElement('style');
    style.setAttribute('data-document-print-style', 'true');
    style.textContent = createDocumentPrintCss(firstSize, normalizeDocumentPaperColor(
      sources[0].options.backgroundColor
    ));
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
