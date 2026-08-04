import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CSS_PIXELS_PER_INCH,
  DOCUMENT_PRINT_HOST_ATTRIBUTE,
  DocumentExportService,
  calculateDocumentCssDimensions,
  calculateDocumentExportSurfaceGeometry,
  calculateDocumentImageEffectiveDpi,
  calculateDocumentPixelDimensions,
  collectDocumentImageDpiWarnings,
  createCleanDocumentClone,
  createDocumentPrintCss,
  createDocumentSvgMarkup,
  triggerDocumentDownload,
  waitForDocumentResources,
} from '../src/document/services/documentExportService';
import { DEFAULT_DOCUMENT_PAPER_COLOR } from '../src/document/utils/documentColor';

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

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

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

  it('keeps the CSS page surface, raster canvas, and PDF scale contract aligned', () => {
    expect(calculateDocumentExportSurfaceGeometry(
      { widthIn: 8.5, heightIn: 11 },
      300
    )).toEqual({
      css: { width: 816, height: 1056 },
      raster: { width: 2550, height: 3300 },
      cssToRasterX: 2550 / 816,
      cssToRasterY: 3300 / 1056,
    });

    const customCssSurface = calculateDocumentExportSurfaceGeometry(
      { widthIn: 8.5, heightIn: 11 },
      300,
      100
    );
    expect(customCssSurface.css).toEqual({ width: 850, height: 1100 });
    expect(customCssSurface.raster).toEqual({ width: 2550, height: 3300 });
    expect(customCssSurface.cssToRasterY).toBeCloseTo(3);
  });

  it('calculates effective source-image DPI and reports low-resolution print images', () => {
    expect(calculateDocumentImageEffectiveDpi({
      naturalWidthPx: 600,
      renderedWidthPx: 192,
    })).toBe(300);
    expect(calculateDocumentImageEffectiveDpi({
      naturalWidthPx: 0,
      renderedWidthPx: 192,
    })).toBe(0);

    const root = document.createElement('main');
    const image = document.createElement('img');
    image.alt = 'Low resolution photograph';
    image.setAttribute('width', '960');
    image.style.width = '768px';
    root.appendChild(image);

    expect(collectDocumentImageDpiWarnings(root, 150)).toEqual([
      'Low resolution photograph is approximately 120 DPI at print size.',
    ]);
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
    expect(clone.style.position).toBe('relative');
    expect(clone.style.inset).toBe('auto');
    expect(clone.style.overflow).toBe('visible');
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
        data-text-editing="true"
        data-hidden-for-editing="true"
        data-span-count="2"
        data-span-start-column="2"
        data-vertical-anchor="page-position"
        data-image-top-px="286"
        data-image-left-px="398"
        data-image-x-offset-px="150"
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
          data-image-left-px="398"
          data-image-x-offset-px="150"
          style="left:398px;top:286px;width:322px"
        >
          <figure data-document-image="true" data-wrap="span-columns">
            <img src="data:image/png;base64,photo" alt="Family">
            <figcaption>Attached caption</figcaption>
          </figure>
          <button
            class="document-image__resize-handle"
            data-document-editor-only="true"
            data-document-export-exclude="true"
          ></button>
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
    expect(layout?.getAttribute('data-text-editing')).toBe('false');
    expect(layout?.getAttribute('data-layout-content-height-px')).toBe('612');
    expect(layout?.getAttribute('data-vertical-anchor')).toBe('page-position');
    expect(layout?.getAttribute('data-image-top-px')).toBe('286');
    expect(layout?.getAttribute('data-image-left-px')).toBe('398');
    const imageSlot = layout?.querySelector<HTMLElement>(
      '[data-layout-role="occupied-columns"]'
    );
    expect(imageSlot?.style.left).toBe('398px');
    expect(imageSlot?.getAttribute('data-image-x-offset-px')).toBe('150');
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
    expect(clone.querySelector('.document-image__resize-handle')).toBeNull();

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
    expect(svg).toContain('<foreignObject x="0" y="0" width="816" height="1056">');
    expect(svg).toContain('Full-width title');
    expect(svg).toContain('column-count: 3');
    expect(svg).not.toContain('Reference scan');
  });

  it('keeps source hyphenation text stable without inventing malformed glyphs', () => {
    const source = document.createElement('main');
    source.lang = 'de';
    source.innerHTML = `
      <p style="hyphens: auto; -webkit-hyphens: auto">
        Donaudampfschifffahrtsgesellschaftskapitän Übergrößen Straße großartig
        resettle\u00ADment tradi\u00ADtions Ciu\u00ADcurova
      </p>
    `;

    const clone = createCleanDocumentClone(source, { copyComputedStyles: false });
    const serializedText = clone.textContent || '';
    const svg = createDocumentSvgMarkup(clone, { widthIn: 8.5, heightIn: 11 }, 300);
    const codePoints = (value: string) => Array.from(value)
      .map((character) => character.codePointAt(0) || 0);

    expect(serializedText).toContain('Donaudampfschifffahrtsgesellschaftskapitän');
    expect(serializedText).toContain('Übergrößen');
    expect(serializedText).toContain('Straße');
    expect(serializedText).toContain('großartig');
    expect(serializedText).toContain('resettle\u00ADment');
    expect(serializedText).toContain('tradi\u00ADtions');
    expect(serializedText).toContain('Ciu\u00ADcurova');
    expect(clone.querySelector('p')?.style.hyphens).toBe('auto');
    expect(codePoints(svg).filter((codePoint) => codePoint === 0x00ad))
      .toHaveLength(3);
    expect(codePoints(svg).filter((codePoint) => codePoint === 0xfffe))
      .toHaveLength(0);
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

  it('exports four ordered pages with independent physical sizes and image resources', async () => {
    const service = new DocumentExportService();
    const pageIds = ['page-49', 'page-50', 'page-51', 'page-52'];
    const elements = pageIds.map((pageId) => {
      const element = document.createElement('main');
      element.dataset.pageId = pageId;
      return element;
    });
    const options = [
      { widthIn: 8.5, heightIn: 11, dpi: 300, backgroundColor: '#FAF8F5' },
      { widthIn: 8.27, heightIn: 11.69, dpi: 300, backgroundColor: '#F4EBD8' },
      { widthIn: 11, heightIn: 8.5, dpi: 300, backgroundColor: '#FAF8F5' },
      { widthIn: 7.25, heightIn: 10.5, dpi: 300, backgroundColor: '#FAF8F5' },
    ];
    const rasterizedPageIds: string[] = [];
    const pngSpy = vi.spyOn(service, 'exportPngBlob').mockImplementation(
      async (element, pageOptions) => {
        rasterizedPageIds.push(element.dataset.pageId ?? '');
        const pageIndex = elements.indexOf(element);
        expect(pageOptions).toBe(options[pageIndex]);
        return tinyPng;
      }
    );

    const pdfBlob = await service.exportPdfPagesBlob(
      pageIds.map((pageId, pageIndex) => ({
        pageId,
        element: elements[pageIndex],
        options: options[pageIndex],
      }))
    );
    const pdf = await PDFDocument.load(await blobToBytes(pdfBlob));
    const pages = pdf.getPages();

    expect(rasterizedPageIds).toEqual(pageIds);
    expect(pngSpy).toHaveBeenCalledTimes(4);
    expect(pages).toHaveLength(4);
    expect(pages.map((page) => [page.getWidth(), page.getHeight()])).toEqual([
      [8.5 * 72, 11 * 72],
      [8.27 * 72, 11.69 * 72],
      [11 * 72, 8.5 * 72],
      [7.25 * 72, 10.5 * 72],
    ]);

    const resources = pages[0].node.Resources();
    expect(resources).toBeDefined();
    const imageResources = resources?.lookup(PDFName.of('XObject'), PDFDict);
    expect(imageResources).toBeDefined();
    expect(new Set(
      imageResources?.entries().map(([, reference]) => reference.toString())
    ).size).toBe(4);

    expect(pages.map((page) => {
      const contents = page.node.Contents();
      expect(contents).toBeInstanceOf(PDFRawStream);
      return (contents as PDFRawStream).getContentsString().match(/\/I\d+ Do/)?.[0];
    })).toEqual(['/I0 Do', '/I1 Do', '/I2 Do', '/I3 Do']);
  });

  it('rejects a multi-page PDF export with no page sources', async () => {
    const service = new DocumentExportService();
    const pngSpy = vi.spyOn(service, 'exportPngBlob');

    await expect(service.exportPdfPagesBlob([])).rejects.toThrow(
      /at least one document page/i
    );
    expect(pngSpy).not.toHaveBeenCalled();
  });

  it('rasterizes multi-page PDF sources sequentially', async () => {
    const service = new DocumentExportService();
    const elements = Array.from({ length: 3 }, (_, index) => {
      const element = document.createElement('main');
      element.dataset.pageId = `page-${index + 1}`;
      return element;
    });
    const pendingPages = elements.map(() => createDeferred<Blob>());
    let rasterizationIndex = 0;
    const pngSpy = vi.spyOn(service, 'exportPngBlob').mockImplementation(() => {
      const pendingPage = pendingPages[rasterizationIndex];
      rasterizationIndex += 1;
      return pendingPage.promise;
    });
    const sources = elements.map((element, index) => ({
      pageId: element.dataset.pageId ?? `page-${index + 1}`,
      element,
      options: { widthIn: 8.5, heightIn: 11 },
    }));

    const exporting = service.exportPdfPagesBlob(sources);
    expect(pngSpy).toHaveBeenCalledTimes(1);
    expect(pngSpy.mock.calls[0][0]).toBe(elements[0]);

    pendingPages[0].resolve(tinyPng);
    await vi.waitFor(() => expect(pngSpy).toHaveBeenCalledTimes(2));
    expect(pngSpy.mock.calls[1][0]).toBe(elements[1]);

    pendingPages[1].resolve(tinyPng);
    await vi.waitFor(() => expect(pngSpy).toHaveBeenCalledTimes(3));
    expect(pngSpy.mock.calls[2][0]).toBe(elements[2]);

    pendingPages[2].resolve(tinyPng);
    const pdf = await PDFDocument.load(await blobToBytes(await exporting));
    expect(pdf.getPageCount()).toBe(3);
  });

  it('downloads a multi-page PDF with a sanitized filename', async () => {
    const service = new DocumentExportService();
    const source = {
      pageId: 'page-49',
      element: document.createElement('main'),
      options: { widthIn: 8.5, heightIn: 11 },
    };
    vi.spyOn(service, 'exportPdfPagesBlob').mockResolvedValue(tinyPng);
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:multi-page-document');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    const result = await service.downloadPdfPages(
      [source],
      'Historical Pages 49–52'
    );

    expect(result).toEqual({
      blob: tinyPng,
      fileName: 'historical-pages-4952.pdf',
      delivery: {
        status: 'saved',
        fileName: 'historical-pages-4952.pdf',
      },
    });
    expect(createObjectUrl).toHaveBeenCalledWith(tinyPng);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:multi-page-document');
  });

  it('downloads all PNG pages sequentially with deterministic page filenames', async () => {
    const service = new DocumentExportService();
    const sources = ['49', '50', '51'].map((folio) => ({
      pageId: `page-${folio}`,
      element: document.createElement('main'),
      options: { widthIn: 8.5, heightIn: 11, fileName: `page-${folio}` },
    }));
    vi.spyOn(service, 'exportPngBlob').mockResolvedValue(tinyPng);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:page');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    const results = await service.downloadPngPages(sources, 'Historical Pages 49–52');

    expect(results.files.map((result) => result.fileName)).toEqual([
      'historical-pages-4952-page-01.png',
      'historical-pages-4952-page-02.png',
      'historical-pages-4952-page-03.png',
    ]);
    expect(results.delivery).toEqual({
      status: 'saved',
      files: [
        { fileName: 'historical-pages-4952-page-01.png' },
        { fileName: 'historical-pages-4952-page-02.png' },
        { fileName: 'historical-pages-4952-page-03.png' },
      ],
    });
    expect(click).toHaveBeenCalledTimes(3);
    expect(Array.from(document.querySelectorAll('a[download]'))).toHaveLength(0);
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

  it('builds print CSS with an exact page box, authoritative paper colour, and hard reference exclusion', () => {
    const css = createDocumentPrintCss({ widthIn: 8.5, heightIn: 11 });

    expect(css).toContain('size: 8.5in 11in');
    expect(css).toContain('width: 8.5in !important');
    expect(css).toContain('height: 11in !important');
    expect(css).toContain(`background: ${DEFAULT_DOCUMENT_PAPER_COLOR} !important`);
    expect(css).not.toContain('background: #fff !important');
    expect(css).toContain('[data-document-export-exclude]');
    expect(css).toContain('display: none !important');

    const landscapeCss = createDocumentPrintCss({
      widthIn: 11,
      heightIn: 8.5,
    }, '#e7dcc8');
    expect(landscapeCss).toContain('size: 11in 8.5in');
    expect(landscapeCss).toContain('width: 11in !important');
    expect(landscapeCss).toContain('height: 8.5in !important');
    expect(landscapeCss).toContain('background: #E7DCC8 !important');

    const malformedCss = createDocumentPrintCss(
      { widthIn: 8.5, heightIn: 11 },
      'url(javascript:alert(1))'
    );
    expect(malformedCss).toContain(
      `background: ${DEFAULT_DOCUMENT_PAPER_COLOR} !important`
    );
    expect(malformedCss).not.toContain('javascript');
  });

  it('creates the print host from a normalized paper colour and removes it on cleanup', async () => {
    const service = new DocumentExportService();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const source = document.createElement('main');
    source.innerHTML = `
      <p>Printable article</p>
      <figure><figcaption>Attached caption remains printable</figcaption>
      </figure>
    `;

    const cleanupPrint = await service.print(source, {
      widthIn: 8.5,
      heightIn: 11,
      dpi: 300,
      backgroundColor: '#e7dcc8',
    });

    const host = document.querySelector<HTMLElement>(
      `[${DOCUMENT_PRINT_HOST_ATTRIBUTE}]`
    );
    const clone = host?.firstElementChild as HTMLElement | null;
    const printStyle = document.querySelector<HTMLStyleElement>(
      'style[data-document-print-style]'
    );
    expect(print).toHaveBeenCalledTimes(1);
    expect(clone?.style.backgroundColor).toBe('rgb(231, 220, 200)');
    expect(clone?.textContent).toContain('Printable article');
    expect(clone?.textContent).toContain('Attached caption remains printable');
    expect(clone?.style.overflow).toBe('hidden');
    expect(clone?.style.width).toBe('8.5in');
    expect(clone?.style.height).toBe('11in');
    expect(printStyle?.textContent).toContain(
      'background: #E7DCC8 !important'
    );

    cleanupPrint();

    expect(document.querySelector(`[${DOCUMENT_PRINT_HOST_ATTRIBUTE}]`)).toBeNull();
    expect(document.querySelector('style[data-document-print-style]')).toBeNull();
  });
});
