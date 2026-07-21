import {
  ingestDocumentImage,
  ingestDocumentImageSource,
  isSafeDocumentImageSource,
  type DocumentAsset,
} from './documentAssetService';

const handledPasteEvents = new WeakSet<Event>();

const findSafeHtmlImage = (html: string) => {
  if (!html || typeof DOMParser === 'undefined') return null;
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelectorAll('script, style, iframe, object, embed, svg, foreignObject').forEach((node) => node.remove());
  const image = parsed.querySelector('img[src]');
  const source = image?.getAttribute('src')?.trim() || '';
  return source && isSafeDocumentImageSource(source) ? source : null;
};

export const sanitizeDocumentHtml = (html: string) => {
  if (!html || typeof DOMParser === 'undefined') return '';
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelectorAll('script, style, iframe, object, embed, svg, foreignObject, form, input, button')
    .forEach((node) => node.remove());
  parsed.body.querySelectorAll('*').forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      const keepHref = name === 'href' && /^https?:\/\//i.test(value);
      const keepImageSource = name === 'src'
        && element.tagName.toLowerCase() === 'img'
        && isSafeDocumentImageSource(value);
      const keepSemantic = ['colspan', 'rowspan'].includes(name);
      if (name.startsWith('on') || (!keepHref && !keepImageSource && !keepSemantic)) {
        element.removeAttribute(attribute.name);
      }
    });
  });
  return parsed.body.innerHTML;
};

export type DocumentPasteResult =
  | { handled: true; asset: DocumentAsset }
  | { handled: false; reason: 'text' | 'unsupported' | 'duplicate' };

export const ingestImageFromClipboardEvent = async (
  event: ClipboardEvent | React.ClipboardEvent
): Promise<DocumentPasteResult> => {
  const nativeEvent = 'nativeEvent' in event ? event.nativeEvent : event;
  if (handledPasteEvents.has(nativeEvent)) {
    return { handled: false, reason: 'duplicate' };
  }

  const data = event.clipboardData;
  if (!data) return { handled: false, reason: 'unsupported' };
  const imageFile = Array.from(data.items || [])
    .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
    ?.getAsFile();
  if (imageFile) {
    handledPasteEvents.add(nativeEvent);
    return { handled: true, asset: await ingestDocumentImage(imageFile) };
  }

  const html = data.getData('text/html');
  const imageSource = findSafeHtmlImage(html);
  if (imageSource) {
    handledPasteEvents.add(nativeEvent);
    return {
      handled: true,
      asset: await ingestDocumentImageSource(imageSource),
    };
  }

  if (data.getData('text/plain') || html) {
    return { handled: false, reason: 'text' };
  }
  return { handled: false, reason: 'unsupported' };
};
