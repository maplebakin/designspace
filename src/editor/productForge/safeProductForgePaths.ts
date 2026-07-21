const PATH_SEPARATORS = /[\\/]+/g;
const UNSAFE_FILE_CHARACTERS = /[^a-zA-Z0-9._-]+/g;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

const stripKnownExtension = (value: string) => value.replace(/\.[a-z0-9]+$/i, '');

const stripControlCharacters = (value: string) =>
  Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && (codePoint < 127 || codePoint > 159);
    })
    .join('');

const getLastPathPart = (value: string) => {
  const parts = stripControlCharacters(value)
    .split(PATH_SEPARATORS)
    .filter((part) => part && part !== '.' && part !== '..');
  return parts[parts.length - 1] || '';
};

export const sanitizeProductForgePathPart = (
  value: string | null | undefined,
  fallback = 'file'
) => {
  const lastPart = getLastPathPart(typeof value === 'string' ? value : '');
  const sanitized = lastPart
    .trim()
    .replace(UNSAFE_FILE_CHARACTERS, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^\.+/, '')
    .slice(0, 160);
  const safe = sanitized && sanitized !== '.' && sanitized !== '..' ? sanitized : fallback;
  return WINDOWS_RESERVED_NAME.test(safe) ? `file-${safe}` : safe;
};

export const sanitizeProductForgeFileName = (
  value: string | null | undefined,
  extension: `.${string}`,
  fallbackBase: string
) => {
  const rawPart = sanitizeProductForgePathPart(value, fallbackBase);
  const withoutExtension = stripKnownExtension(rawPart);
  const safeBase = sanitizeProductForgePathPart(withoutExtension, fallbackBase);
  return `${safeBase}${extension.toLowerCase()}`;
};

export const sanitizeProductForgeSlug = (
  value: string | null | undefined,
  fallback = 'design-space-product'
) => {
  const raw = typeof value === 'string' ? value.toLowerCase() : '';
  const lastPart = getLastPathPart(raw);
  const slug = lastPart
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return slug || fallback;
};

export const buildProductForgeArchivePath = (
  rootFolder: string,
  fileName: string,
  directories: string[] = []
) => {
  const safeRoot = sanitizeProductForgeSlug(rootFolder);
  const safeFileName = sanitizeProductForgePathPart(fileName);
  const safeDirectories = directories.map((directory) =>
    sanitizeProductForgePathPart(directory, 'files')
  );
  return [safeRoot, ...safeDirectories, safeFileName].join('/');
};

export const getProductForgePathCollisionKey = (path: string) =>
  path.normalize('NFKC').toLocaleLowerCase('en-US');
