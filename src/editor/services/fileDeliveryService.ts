import { isTauriRecoveryAvailable, recoveryErrorMessage } from '../recovery/recoveryClient';

export type FileDeliveryContent = Blob | ArrayBuffer | Uint8Array;

export type FileDeliveryRequest = {
  content: FileDeliveryContent;
  fileName: string;
  extension?: string;
  dialogTitle?: string;
  filterName?: string;
};

export type FileDeliveryResult =
  | {
      status: 'saved';
      fileName: string;
      path?: string;
    }
  | {
      status: 'cancelled';
      fileName: string;
    };

export type FileBatchDeliveryResult =
  | {
      status: 'saved';
      files: Array<{
        fileName: string;
        path?: string;
      }>;
      directory?: string;
    }
  | {
      status: 'cancelled';
      files: [];
    };

export type FileBatchDeliveryOptions = {
  dialogTitle?: string;
};

const INVALID_FILE_NAME_CHARACTER_PATTERN = /[<>:"/\\|?*]/g;

const normalizeExtension = (extension: string | undefined) => {
  const normalized = extension?.trim().replace(/^\.+/, '');
  return normalized || undefined;
};

const getExtensionFromFileName = (fileName: string) => {
  const lastSeparator = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'));
  const baseName = fileName.slice(lastSeparator + 1);
  const lastDot = baseName.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === baseName.length - 1) return undefined;
  return baseName.slice(lastDot + 1);
};

export const ensureFileExtension = (filePath: string, extension?: string) => {
  const normalizedExtension = normalizeExtension(extension);
  if (!normalizedExtension) return filePath;

  const lastSeparator = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  const directory = filePath.slice(0, lastSeparator + 1);
  const baseName = filePath.slice(lastSeparator + 1);
  const expectedSuffix = `.${normalizedExtension}`;
  if (baseName.toLowerCase().endsWith(expectedSuffix.toLowerCase())) {
    return filePath;
  }

  const withoutExtension = baseName.replace(/\.[^.]+$/, '');
  return `${directory}${withoutExtension || 'download'}${expectedSuffix}`;
};

export const sanitizeDeliveredFileName = (fileName: string, extension?: string) => {
  const normalizedExtension = normalizeExtension(extension);
  const withoutControlCharacters = Array.from(fileName)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join('');
  const cleaned = withoutControlCharacters
    .replace(INVALID_FILE_NAME_CHARACTER_PATTERN, '-')
    .trim();
  const baseName = cleaned || 'download';
  return ensureFileExtension(baseName, normalizedExtension);
};

const getRequestedExtension = (request: FileDeliveryRequest) =>
  normalizeExtension(request.extension) || getExtensionFromFileName(request.fileName);

const toBrowserBlob = (content: FileDeliveryContent) => {
  if (typeof Blob !== 'undefined' && content instanceof Blob) return content;
  return new Blob([content as BlobPart]);
};

export const fileContentToBytes = async (content: FileDeliveryContent): Promise<Uint8Array> => {
  if (content instanceof Uint8Array) return new Uint8Array(content);
  if (content instanceof ArrayBuffer) return new Uint8Array(content);

  if (typeof content.arrayBuffer === 'function') {
    return new Uint8Array(await content.arrayBuffer());
  }

  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result));
        return;
      }
      reject(new Error('Could not read the file content.'));
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read the file content.'));
    reader.readAsArrayBuffer(content as Blob);
  });
};

export const triggerBrowserFileDownload = (content: FileDeliveryContent, fileName: string) => {
  if (typeof document === 'undefined') {
    throw new Error('Downloads are unavailable in this environment.');
  }
  const url = URL.createObjectURL(toBrowserBlob(content));
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

const joinDirectoryAndFileName = (directory: string, fileName: string) => {
  if (directory.endsWith('/') || directory.endsWith('\\')) return `${directory}${fileName}`;
  return `${directory}${directory.includes('\\') ? '\\' : '/'}${fileName}`;
};

const getErrorMessage = (error: unknown, fallback: string) =>
  recoveryErrorMessage(error, fallback);

const loadTauriDeliveryApis = async () => {
  const [{ save, open }, { writeFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ]);
  return { save, open, writeFile };
};

const createDialogFilters = (request: FileDeliveryRequest) => {
  const extension = getRequestedExtension(request);
  if (!extension) return undefined;
  return [{
    name: request.filterName || extension.toUpperCase(),
    extensions: [extension.split('.').pop() || extension],
  }];
};

const writeTauriFile = async (
  writeFile: (path: string, data: Uint8Array) => Promise<void>,
  path: string,
  fileName: string,
  content: FileDeliveryContent
) => {
  try {
    await writeFile(path, await fileContentToBytes(content));
  } catch (error) {
    const message = getErrorMessage(error, 'The selected destination could not be written.');
    throw new Error(`Could not save ${fileName}: ${message}`);
  }
};

export const deliverFile = async (request: FileDeliveryRequest): Promise<FileDeliveryResult> => {
  const extension = getRequestedExtension(request);
  const fileName = sanitizeDeliveredFileName(request.fileName, extension);

  if (!isTauriRecoveryAvailable()) {
    triggerBrowserFileDownload(request.content, fileName);
    return { status: 'saved', fileName };
  }

  const { save, writeFile } = await loadTauriDeliveryApis();
  let selectedPath: string | null;
  try {
    selectedPath = await save({
      title: request.dialogTitle,
      defaultPath: fileName,
      filters: createDialogFilters(request),
    });
  } catch (error) {
    const message = getErrorMessage(error, 'The save dialog could not be opened.');
    throw new Error(`Could not save ${fileName}: ${message}`);
  }

  if (!selectedPath) return { status: 'cancelled', fileName };

  const finalPath = ensureFileExtension(selectedPath, extension);
  await writeTauriFile(writeFile, finalPath, fileName, request.content);
  return { status: 'saved', fileName, path: finalPath };
};

export const deliverFiles = async (
  requests: readonly FileDeliveryRequest[],
  options: FileBatchDeliveryOptions = {}
): Promise<FileBatchDeliveryResult> => {
  if (requests.length === 0) return { status: 'saved', files: [] };

  if (!isTauriRecoveryAvailable()) {
    const files: Array<{ fileName: string; path?: string }> = [];
    for (const request of requests) {
      const result = await deliverFile(request);
      if (result.status === 'cancelled') return { status: 'cancelled', files: [] };
      files.push({ fileName: result.fileName });
    }
    return { status: 'saved', files };
  }

  const { open, writeFile } = await loadTauriDeliveryApis();
  let selectedDirectory: string | string[] | null;
  try {
    selectedDirectory = await open({
      title: options.dialogTitle || 'Choose a folder for the exported pages',
      directory: true,
      multiple: false,
    });
  } catch (error) {
    const message = getErrorMessage(error, 'The folder dialog could not be opened.');
    throw new Error(`Could not save exported files: ${message}`);
  }

  const directory = Array.isArray(selectedDirectory)
    ? selectedDirectory[0]
    : selectedDirectory;
  if (!directory) return { status: 'cancelled', files: [] };

  const files: Array<{ fileName: string; path: string }> = [];
  for (const request of requests) {
    const extension = getRequestedExtension(request);
    const fileName = sanitizeDeliveredFileName(request.fileName, extension);
    const path = joinDirectoryAndFileName(directory, fileName);
    await writeTauriFile(writeFile, path, fileName, request.content);
    files.push({ fileName, path });
  }
  return { status: 'saved', files, directory };
};

export const getDeliverySuccessLocation = (
  result: FileDeliveryResult | FileBatchDeliveryResult
) => {
  if (result.status !== 'saved') return null;
  if ('path' in result && result.path) return result.path;
  if ('directory' in result && result.directory) return result.directory;
  return null;
};
