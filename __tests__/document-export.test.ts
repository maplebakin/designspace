import { PDFDocument } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CSS_PIXELS_PER_INCH,
  DocumentExportService,
  calculateDocumentCssDimensions,
  calculateDocumentPixelDimensions,
  createCleanDocumentClone,
  createDocumentPrintCss,
  createDocumentSvgMarkup,
  triggerDocumentDownload,
  waitForDocumentResources,
} from '../src/document/services/documentExportService';

const tinyPng = new Blob([
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAABmJLR0QA/wD/AP+gvaeTAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64'
  ),
], { type: 'image/png' });

const blobToBytes = (blob: Blob) => new Promise<Uint8Array>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    if (reader.result instanceof ArrayBuffer) {
      resolve(new Uint8Array(reader.result));
      return;
    }
    reject(new Error('Expected Blob to produce an ArrayBuffer.'));
  };
  reader.onerror = () => reject(reader.error || new Error('Failed to read Blob.'));
  reader.readAsArrayBuffer(blob);
});

describe('document export', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('calculates exact print pixels independently from CSS layout pixels', () => {
    expect(calculateDocumentPixelDimensions({ widthIn: 8.5, heightIn: 11 }, 300))
      .toEqual({ width: 2550, height: 3300 });
    expect(calculateDocumentPixelDimensions({ widthIn: 8.27, heightIn: 11.69 }, 300))
      .toEqual({ width: 2481, height: 3507 });
    expect(calculateDocumentCssDimensions({ widthIn: 8.5, heightIn: 11 }))
      .toEqual({ width: 8.5 * CSS_PIXELS_PER_INCH, height: 11 * CSS_PIXELS_PER_INCH });
    expect(calculateDocumentPixelDimensions({ widthIn: 11, heightIn: 8.5 }, 300))
      .toEqual({ width: 3300, height: 2550 });
    expect(calculateDocumentPixelDimensions({
      widthIn: 297 / 25.4,
      heightIn: 210 / 25.4,
    }, 300)).toEqual({ width: 3508, height: 2480 });
  });

  it('physically removes reference and editor UI while retaining document content', () => {
    const source = document.createElement('article');
    source.id = 'live-page';
    source.dataset.testid = 'document-page';
    source.innerHTML = `
      <div data-document-reference-layer data-document-export-exclude>
        <img src="data:image/png;base64,reference" alt="Reference scan">
      </div>
      <div data-document-editor-ui>Toolbar</div>
      <p data-document-overflow-warning>Overflow warning</p>
      <span data-document-export-exclude data-testid="document-title-placeholder">
        Add a title
      </span>
      <section contenteditable="true" spellcheck="true" class="ProseMirror ProseMirror-focused">
        <h1>Family history</h1>
        <p><span data-font-size-px="24" style="font-size: 24px">Large text</span>
        and <span data-font-size-px="12" style="font-size: 12px">small text</span></p>
        <figure class="ProseMirror-selectednode document-image--selected" aria-selected="true">
          <img src="data:image/png;base64,photo" alt="Granddad">
          <figcaption>A persistent caption</figcaption>
          <button data-document-resize-handle>Resize</button>
        </figure>
        <p>The translated article remains.</p>
      </section>
    `;

    const clone = createCleanDocumentClone(source, { copyComputedStyles: false });

    expect(clone.id).toBe('');
    expect(clone.hasAttribute('data-testid')).toBe(false);
    expect(clone.querySelector('[data-document-reference-layer]')).toBeNull();
    expect(clone.querySelector('[data-document-editor-ui]')).toBeNull();
    expect(clone.querySelector('[data-document-overflow-warning]')).toBeNull();
    expect(clone.querySelector('[data-testid="document-title-placeholder"]')).toBeNull();
    expect(clone.querySelector('[data-document-resize-handle]')).toBeNull();
    expect(clone.querySelector('[contenteditable]')).toBeNull();
    expect(clone.querySelector('.ProseMirror-focused')).toBeNull();
    expect(clone.querySelector('.ProseMirror-selectednode')).toBeNull();
    expect(clone.querySelector('.document-image--selected')).toBeNull();
    expect(clone.textContent).toContain('Family history');
    expect(clone.textContent).toContain('A persistent caption');
    expect(clone.textContent).toContain('The translated article remains.');
    expect(
      (clone.querySelector('[data-font-size-px="24"]') as HTMLElement).style.fontSize
    ).toBe('24px');
    expect(
      (clone.querySelector('[data-font-size-px="12"]') as HTMLElement).style.fontSize
    ).toBe('12px');
    expect(clone.textContent).not.toContain('Add a title');
    expect(clone.querySelector('img')?.getAttribute('alt')).toBe('Granddad');
  });

  it('preserves the structured spanning layout for PNG, PDF, and print clones', () => {
    const source = document.createElement('article');
    source.innerHTML = `
      <div class="document-flow-editor__content--span-source">
        <p>Hidden editable source</p>
      </div>
      <div
        data-document-span-layout="true"
        data-hidden-for-editing="true"
        data-span-count="2"
        data-span-start-column="2"
        data-vertical-anchor="page-position"
        data-image-top-px="286"
        data-layout-content-height-px="612"
        style="display:none; --document-span-image-top: 286px"
      >
        <div class="document-span-layout__column-stacks">
          <div data-layout-role="physical-column" data-column="1">
            <div data-layout-role="explicit-text-column" data-layout-region="above">
              <div data-layout-role="continuing-column" data-column="1">
                <p>Column one fills continuously</p>
              </div>
            </div>
          </div>
          <div data-layout-role="physical-column" data-column="2">
            <div data-layout-role="explicit-text-column" data-layout-region="above">
              <p>Column two above the image</p>
            </div>
            <div data-layout-role="image-exclusion"></div>
            <div data-layout-role="explicit-text-column" data-layout-region="below">
              <p>Column two below the image</p>
            </div>
          </div>
          <div data-layout-role="physical-column" data-column="3">
            <div data-layout-role="explicit-text-column" data-layout-region="above">
              <p>Column three above the image</p>
            </div>
            <div data-layout-role="image-exclusion"></div>
            <div data-layout-role="explicit-text-column" data-layout-region="below">
              <p>Column three below the image</p>
            </div>
          </div>
        </div>
        <div
          data-layout-role="occupied-columns"
          data-start-column="2"
          data-end-column="3"
        >
          <figure data-document-image="true" data-wrap="span-columns">
            <img src="data:image/png;base64,photo" alt="Family">
            <figcaption>Attached caption</figcaption>
          </figure>
        </div>
      </div>
    `;

    const clone = createCleanDocumentClone(source, {
      copyComputedStyles: false,
    });
    const layout = clone.querySelector<HTMLElement>(
      '[data-document-span-layout]'
    );
    expect(clone.textContent).not.toContain('Hidden editable source');
    expect(layout).not.toBeNull();
    expect(layout?.style.display).toBe('block');
    expect(layout?.getAttribute('data-hidden-for-editing')).toBe('false');
    expect(layout?.getAttribute('data-layout-content-height-px')).toBe('612');
    expect(layout?.getAttribute('data-vertical-anchor')).toBe('page-position');
    expect(layout?.getAttribute('data-image-top-px')).toBe('286');
    expect(layout?.style.getPropertyValue('--document-span-image-top'))
      .toBe('286px');
    expect(layout?.querySelector(
      '[data-layout-role="continuing-column"][data-column="1"]'
    )?.textContent).toContain('Column one fills continuously');
    expect(layout?.querySelectorAll(
      '[data-layout-role="physical-column"]'
    )).toHaveLength(3);
    expect(layout?.querySelector(
      '[data-layout-role="occupied-columns"][data-start-column="2"][data-end-column="3"]'
    )?.textContent).toContain('Attached caption');

    const svg = createDocumentSvgMarkup(
      clone,
      { widthIn: 8.5, heightIn: 11 },
      300
    );
    expect(svg).toContain('data-document-span-layout');
    expect(svg).toContain('data-start-column="2"');
    expect(svg).toContain('Attached caption');
  });

  it('refuses to export a page root explicitly marked as editor-only', () => {
    const source = document.createElement('div');
    source.setAttribute('data-document-export-exclude', 'true');

    expect(() => createCleanDocumentClone(source, { copyComputedStyles: false }))
      .toThrow(/root is marked as excluded/i);
  });

  it('waits for fonts and retained images but ignores an excluded scan reference', async () => {
    const source = document.createElement('div');
    source.innerHTML = `
      <img alt="Article photo" src="data:image/png;base64,photo">
      <div data-document-export-exclude>
        <img alt="Reference scan" src="data:image/png;base64,reference">
      </div>
    `;
    const decodeImage = vi.fn().mockResolvedValue(undefined);
    let resolveFonts: (() => void) | undefined;
    const fontsReady = new Promise<void>((resolve) => {
      resolveFonts = resolve;
    });

    const waiting = waitForDocumentResources(source, { fontsReady, decodeImage });
    expect(decodeImage).not.toHaveBeenCalled();
    resolveFonts?.();
    await waiting;

    expect(decodeImage).toHaveBeenCalledTimes(1);
    expect(decodeImage.mock.calls[0][0].alt).toBe('Article photo');
  });

  it('serializes a clean, fixed-size XHTML page into an exact-dimension SVG', () => {
    const source = document.createElement('main');
    source.innerHTML = `
      <div data-document-export-exclude>Reference scan</div>
      <h1>Full-width title</h1>
      <div style="column-count: 3"><p>Column body</p></div>
    `;
    const clone = createCleanDocumentClone(source, { copyComputedStyles: false });
    const svg = createDocumentSvgMarkup(clone, { widthIn: 8.5, heightIn: 11 }, 300);

    expect(svg).toContain('width="2550"');
    expect(svg).toContain('height="3300"');
    expect(svg).toContain('viewBox="0 0 816 1056"');
    expect(svg).toContain('<foreignObject');
    expect(svg).toContain('Full-width title');
    expect(svg).toContain('column-count: 3');
    expect(svg).not.toContain('Reference scan');
  });

  it('creates a raster-backed PDF with the requested physical MediaBox', async () => {
    const service = new DocumentExportService();
    const pngSpy = vi.spyOn(service, 'exportPngBlob').mockResolvedValue(tinyPng);
    const page = document.createElement('main');

    const letterBlob = await service.exportPdfBlob(page, {
      widthIn: 8.5,
      heightIn: 11,
      dpi: 300,
    });
    const letterPdf = await PDFDocument.load(await blobToBytes(letterBlob));
    expect(letterPdf.getPageCount()).toBe(1);
    expect(letterPdf.getPage(0).getWidth()).toBeCloseTo(8.5 * 72, 4);
    expect(letterPdf.getPage(0).getHeight()).toBeCloseTo(11 * 72, 4);
    expect(pngSpy).toHaveBeenCalledTimes(1);

    const a4Blob = await service.exportPdfBlob(page, {
      widthIn: 8.27,
      heightIn: 11.69,
      dpi: 300,
    });
    const a4Pdf = await PDFDocument.load(await blobToBytes(a4Blob));
    expect(a4Pdf.getPage(0).getWidth()).toBeCloseTo(8.27 * 72, 4);
    expect(a4Pdf.getPage(0).getHeight()).toBeCloseTo(11.69 * 72, 4);
    expect(pngSpy).toHaveBeenCalledTimes(2);

    const letterLandscapeBlob = await service.exportPdfBlob(page, {
      widthIn: 11,
      heightIn: 8.5,
      dpi: 300,
    });
    const letterLandscapePdf = await PDFDocument.load(
      await blobToBytes(letterLandscapeBlob)
    );
    expect(letterLandscapePdf.getPage(0).getWidth()).toBeCloseTo(11 * 72, 4);
    expect(letterLandscapePdf.getPage(0).getHeight()).toBeCloseTo(8.5 * 72, 4);

    const a4LandscapeBlob = await service.exportPdfBlob(page, {
      widthIn: 297 / 25.4,
      heightIn: 210 / 25.4,
      dpi: 300,
    });
    const a4LandscapePdf = await PDFDocument.load(
      await blobToBytes(a4LandscapeBlob)
    );
    expect(a4LandscapePdf.getPage(0).getWidth())
      .toBeCloseTo((297 / 25.4) * 72, 4);
    expect(a4LandscapePdf.getPage(0).getHeight())
      .toBeCloseTo((210 / 25.4) * 72, 4);
    expect(pngSpy).toHaveBeenCalledTimes(4);
  });

  it('downloads sanitized filenames and revokes the temporary URL', () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:document-export');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    triggerDocumentDownload(tinyPng, 'family-history.png');

    expect(createObjectUrl).toHaveBeenCalledWith(tinyPng);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:document-export');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('builds print CSS with an exact page box and hard reference exclusion', () => {
    const css = createDocumentPrintCss({ widthIn: 8.5, heightIn: 11 });

    expect(css).toContain('size: 8.5in 11in');
    expect(css).toContain('width: 8.5in !important');
    expect(css).toContain('height: 11in !important');
    expect(css).toContain('[data-document-export-exclude]');
    expect(css).toContain('display: none !important');

    const landscapeCss = createDocumentPrintCss({
      widthIn: 11,
      heightIn: 8.5,
    });
    expect(landscapeCss).toContain('size: 11in 8.5in');
    expect(landscapeCss).toContain('width: 11in !important');
    expect(landscapeCss).toContain('height: 8.5in !important');
  });
});
