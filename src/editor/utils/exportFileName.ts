export const sanitizeExportBaseName = (name?: string | null) => {
  const trimmed = name?.trim() ?? '';
  if (!trimmed) return 'design-space';

  const sanitized = trimmed
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9-_]/g, '')
    .toLowerCase();

  return sanitized || 'design-space';
};
