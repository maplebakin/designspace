import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import {
  getImageFiles,
  ingestDocumentImage,
  isSafeDocumentImageSource,
} from '../src/document/services/documentAssetService';
import {
  ingestImageFromClipboardEvent,
  sanitizeDocumentHtml,
} from '../src/document/services/documentClipboardService';
import { ingestDocumentReference } from '../src/document/services/documentReferenceService';

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {
    workerSrc: '',
  },
  getDocument: vi.fn(),
}));

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x00,
]);

const makePngFile = (name = 'family-photo.png') =>
  new File([PNG_BYTES], name, { type: 'image/png' });

const pngDataUrl = () =>
  `data:image/png;base64,${btoa(String.fromCharCode(...PNG_BYTES))}`;

class DecodedImage {
  naturalWidth = 640;
  naturalHeight = 480;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private value = '';

  get src() {
    return this.value;
  }

  set src(source: string) {
    this.value = source;
    queueMicrotask(() => this.onload?.());
  }
}

type ClipboardItemFixture = {
  kind: string;
  type: string;
  getAsFile: () => File | null;
};

const makeClipboardEvent = ({
  items = [],
  html = '',
  text = '',
}: {
  items?: ClipboardItemFixture[];
  html?: string;
  text?: string;
}) => {
  const event = new Event('paste') as ClipboardEvent;
  const getData = vi.fn((type: string) => {
    if (type === 'text/html') return html;
    if (type === 'text/plain') return text;
    return '';
  });
  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: {
      items,
      getData,
    },
  });
  return { event, getData };
};

describe('document image assets', () => {
  beforeEach(() => {
    vi.stubGlobal('Image', DecodedImage as unknown as typeof Image);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses the shared raster validation path and returns a reusable data asset', async () => {
    const asset = await ingestDocumentImage(makePngFile(), { id: 'asset-photo' });

    expect(asset).toMatchObject({
      id: 'asset-photo',
      mimeType: 'image/png',
      fileName: 'family-photo.png',
      naturalWidth: 640,
      naturalHeight: 480,
    });
    expect(asset.source).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);

    const spoofed = new File([PNG_BYTES], 'spoofed.jpg', { type: 'image/jpeg' });
    await expect(ingestDocumentImage(spoofed)).rejects.toThrow(/do not match/i);
  });

  it('filters shared file input to image candidates without changing the input', () => {
    const image = makePngFile();
    const text = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    const files = [text, image];

    expect(getImageFiles(files)).toEqual([image]);
    expect(files).toEqual([text, image]);
  });

  it('imports an image reference through the same validated asset pipeline', async () => {
    const referenceAsset = await ingestDocumentReference(makePngFile('scan.png'));

    expect(referenceAsset).toMatchObject({
      fileName: 'scan.png',
      mimeType: 'image/png',
      naturalWidth: 640,
      naturalHeight: 480,
    });
    expect(referenceAsset.id).toEqual(expect.any(String));
    expect(referenceAsset.source).toMatch(/^data:image\/png;base64,/);
  });

  it('renders and persists the first PDF page as a raster reference asset', async () => {
    const pdfBytes = new TextEncoder().encode('%PDF-1.7\nreference fixture');
    const pdfFile = new File([pdfBytes], 'newsletter.pdf', {
      type: 'application/pdf',
    });
    Object.defineProperty(pdfFile, 'arrayBuffer', {
      configurable: true,
      value: vi.fn().mockResolvedValue(pdfBytes.buffer),
    });
    const render = vi.fn(() => ({ promise: Promise.resolve() }));
    const getPage = vi.fn().mockResolvedValue({
      getViewport: ({ scale }: { scale: number }) => ({
        width: 612 * scale,
        height: 792 * scale,
      }),
      render,
    });
    const destroy = vi.fn().mockResolvedValue(undefined);
    vi.mocked(pdfjsLib.getDocument).mockReturnValue({
      promise: Promise.resolve({ getPage }),
      destroy,
    } as any);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({
          data: new Uint8ClampedArray([40, 40, 40, 255]),
        })),
      } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => {
        callback(new Blob([PNG_BYTES], { type: 'image/png' }));
      });

    const diagnostics = vi.fn();
    const referenceAsset = await ingestDocumentReference(pdfFile, {
      onDiagnostics: diagnostics,
    });

    expect(pdfjsLib.getDocument).toHaveBeenCalledTimes(1);
    expect(pdfjsLib.getDocument).toHaveBeenCalledWith(expect.objectContaining({
      isImageDecoderSupported: false,
      isOffscreenCanvasSupported: false,
      canvasMaxAreaInBytes: 100_000_000,
    }));
    expect(getPage).toHaveBeenCalledWith(1);
    expect(render).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({
      width: 1224,
      height: 1584,
      nonTransparentPixelCount: 1,
      hasMeaningfulPaint: true,
    }));
    expect(referenceAsset).toMatchObject({
      fileName: 'newsletter-page-1.png',
      mimeType: 'image/png',
      naturalWidth: 640,
      naturalHeight: 480,
    });
  });

  it('does not accept a PDF render that produced an empty canvas', async () => {
    const pdfBytes = new TextEncoder().encode('%PDF-1.7\nempty render fixture');
    const pdfFile = new File([pdfBytes], 'empty-reference.pdf', {
      type: 'application/pdf',
    });
    Object.defineProperty(pdfFile, 'arrayBuffer', {
      configurable: true,
      value: vi.fn().mockResolvedValue(pdfBytes.buffer),
    });
    vi.mocked(pdfjsLib.getDocument).mockReturnValue({
      promise: Promise.resolve({
        getPage: vi.fn().mockResolvedValue({
          getViewport: ({ scale }: { scale: number }) => ({
            width: 612 * scale,
            height: 792 * scale,
          }),
          render: vi.fn(() => ({ promise: Promise.resolve() })),
        }),
      }),
      destroy: vi.fn().mockResolvedValue(undefined),
    } as any);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({
          data: new Uint8ClampedArray(4),
        })),
      } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => {
        callback(new Blob([PNG_BYTES], { type: 'image/png' }));
      });

    await expect(ingestDocumentReference(pdfFile)).rejects.toMatchObject({
      code: 'REFERENCE_PDF_RENDER_EMPTY',
    });
  });

  it('prefers a clipboard image file and handles a native paste event only once', async () => {
    const file = makePngFile('clipboard-photo.png');
    const { event } = makeClipboardEvent({
      items: [{
        kind: 'file',
        type: 'image/png',
        getAsFile: () => file,
      }],
      html: '<img src="https://example.test/fallback.png">',
      text: 'fallback text',
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const first = await ingestImageFromClipboardEvent(event);
    const duplicate = await ingestImageFromClipboardEvent(event);

    expect(first).toMatchObject({
      handled: true,
      asset: {
        fileName: 'clipboard-photo.png',
        mimeType: 'image/png',
      },
    });
    expect(duplicate).toEqual({ handled: false, reason: 'duplicate' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('imports the first safe HTML image when no image file is present', async () => {
    const source = pngDataUrl();
    const { event } = makeClipboardEvent({
      html: `<p>Copied article</p><img src="${source}" onerror="alert(1)">`,
      text: 'Copied article',
    });

    const result = await ingestImageFromClipboardEvent(event);

    expect(result).toMatchObject({
      handled: true,
      asset: {
        fileName: 'pasted-image',
        mimeType: 'image/png',
        naturalWidth: 640,
        naturalHeight: 480,
      },
    });
  });

  it('leaves ordinary and unsupported clipboard data available to the text editor', async () => {
    const unsupportedFile = new File(['archive'], 'archive.zip', {
      type: 'application/zip',
    });
    const unsupported = makeClipboardEvent({
      items: [{
        kind: 'file',
        type: 'application/zip',
        getAsFile: () => unsupportedFile,
      }],
    });
    const plainText = makeClipboardEvent({ text: 'Keep this paragraph' });
    const preventUnsupported = vi.spyOn(unsupported.event, 'preventDefault');
    const preventText = vi.spyOn(plainText.event, 'preventDefault');

    await expect(ingestImageFromClipboardEvent(unsupported.event))
      .resolves.toEqual({ handled: false, reason: 'unsupported' });
    await expect(ingestImageFromClipboardEvent(plainText.event))
      .resolves.toEqual({ handled: false, reason: 'text' });

    expect(preventUnsupported).not.toHaveBeenCalled();
    expect(preventText).not.toHaveBeenCalled();
    expect(plainText.getData).toHaveBeenCalledWith('text/plain');
  });

  it('strips scripts, event handlers, forms, and unsafe attributes from pasted HTML', () => {
    const safeImage = pngDataUrl();
    const sanitized = sanitizeDocumentHtml(`
      <section class="copied" onclick="steal()" style="position:fixed">
        <script>alert('bad')</script>
        <style>body { display: none }</style>
        <form action="https://attacker.test"><input value="secret"></form>
        <p id="intro">Keep <a href="https://example.test/article" onmouseover="bad()">this text</a>.</p>
        <a href="javascript:alert(1)">unsafe link</a>
        <img src="${safeImage}" onerror="bad()" width="999">
        <img src="data:image/svg+xml;base64,PHN2Zz4=">
      </section>
    `);

    expect(sanitized).toContain('Keep');
    expect(sanitized).toContain('href="https://example.test/article"');
    expect(sanitized).toContain(`src="${safeImage}"`);
    expect(sanitized).not.toMatch(/<script|<style|<form|<input/i);
    expect(sanitized).not.toMatch(/\son\w+=|javascript:|position:fixed/i);
    expect(sanitized).not.toMatch(/\s(?:class|id|width)=/i);
    expect(sanitized).not.toContain('data:image/svg+xml');
  });

  it('accepts only the document image source protocols and raster formats', () => {
    expect(isSafeDocumentImageSource(pngDataUrl())).toBe(true);
    expect(isSafeDocumentImageSource('https://cdn.example.test/photo.webp')).toBe(true);
    expect(isSafeDocumentImageSource('http://localhost/photo.jpg')).toBe(true);
    expect(isSafeDocumentImageSource('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isSafeDocumentImageSource('javascript:alert(1)')).toBe(false);
    expect(isSafeDocumentImageSource('blob:https://example.test/private')).toBe(false);
  });
});
