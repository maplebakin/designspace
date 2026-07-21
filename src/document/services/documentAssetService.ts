import { v4 as uuidv4 } from 'uuid';
import { validateRasterImageFile } from '../../editor/services/assetLoader';

export type DocumentAsset = {
  id: string;
  source: string;
  mimeType: string;
  fileName: string;
  naturalWidth: number;
  naturalHeight: number;
};

const readBlobAsDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === 'string') {
      resolve(reader.result);
    } else {
      reject(new Error('The image could not be read.'));
    }
  };
  reader.onerror = () => reject(reader.error || new Error('The image could not be read.'));
  reader.readAsDataURL(blob);
});

export const readImageDimensions = (source: string) => new Promise<{
  width: number;
  height: number;
}>((resolve, reject) => {
  const image = new Image();
  image.onload = () => {
    if (!image.naturalWidth || !image.naturalHeight) {
      reject(new Error('The image has invalid dimensions.'));
      return;
    }
    resolve({ width: image.naturalWidth, height: image.naturalHeight });
  };
  image.onerror = () => reject(new Error('The image could not be decoded.'));
  image.src = source;
});

const toFile = (blob: Blob, fileName: string) =>
  blob instanceof File
    ? blob
    : new File([blob], fileName, { type: blob.type || 'application/octet-stream' });

export const ingestDocumentImage = async (
  input: File | Blob,
  options: { fileName?: string; id?: string } = {}
): Promise<DocumentAsset> => {
  const fileName = input instanceof File
    ? input.name
    : options.fileName || 'pasted-image';
  const file = toFile(input, fileName);
  await validateRasterImageFile(file);
  const source = await readBlobAsDataUrl(file);
  const dimensions = await readImageDimensions(source);
  return {
    id: options.id || uuidv4(),
    source,
    mimeType: file.type,
    fileName,
    naturalWidth: dimensions.width,
    naturalHeight: dimensions.height,
  };
};

const DATA_IMAGE_PATTERN = /^data:image\/(?:png|jpe?g|webp);base64,/i;

export const isSafeDocumentImageSource = (source: string) =>
  DATA_IMAGE_PATTERN.test(source)
  || /^https?:\/\//i.test(source);

const dataUrlToFile = (source: string, fileName: string) => {
  const match = /^data:([^;,]+);base64,(.*)$/i.exec(source);
  if (!match) throw new Error('The pasted image data is malformed.');
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], fileName, { type: match[1] });
};

export const ingestDocumentImageSource = async (
  source: string,
  options: { fileName?: string; id?: string } = {}
) => {
  if (!isSafeDocumentImageSource(source)) {
    throw new Error('That pasted image source is not supported.');
  }
  const fileName = options.fileName || 'pasted-image';
  if (DATA_IMAGE_PATTERN.test(source)) {
    return ingestDocumentImage(dataUrlToFile(source, fileName), options);
  }

  let response: Response;
  try {
    response = await fetch(source, {
      mode: 'cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new Error('The browser could not access the pasted image.');
  }
  if (!response.ok) {
    throw new Error(`The pasted image could not be downloaded (${response.status}).`);
  }
  const blob = await response.blob();
  return ingestDocumentImage(blob, {
    ...options,
    fileName,
  });
};

export const getImageFiles = (files: FileList | File[]) =>
  Array.from(files).filter((file) => file.type.startsWith('image/'));
