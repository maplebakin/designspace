// Creator bridge v1. These colors are resolved by the Tasting Room, never by a seed.
export const DESIGN_SPACE_THEME_FORMAT = 'design-space-theme';
export const DESIGN_SPACE_THEME_VERSION = 1;
export const DESIGN_SPACE_COLOR_ROLES = Object.freeze([
  'background', 'surface', 'heading', 'text', 'mutedText',
  'accent', 'cta', 'ctaForeground', 'border',
]);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isHex = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const hasExactKeys = (value, keys) => isRecord(value)
  && Object.keys(value).length === keys.length
  && keys.every((key) => Object.hasOwn(value, key));

/** Throws on unsupported or incomplete contracts. No coercion, defaults or color repair. */
export function validateDesignSpaceTheme(theme) {
  const fail = (detail) => { throw new Error(`Invalid Design Space theme: ${detail}`); };
  if (!hasExactKeys(theme, ['format', 'version', 'name', 'mode', 'colors', 'metadata'])) fail('fields');
  if (theme.format !== DESIGN_SPACE_THEME_FORMAT || theme.version !== DESIGN_SPACE_THEME_VERSION) fail('unsupported format/version');
  if (typeof theme.name !== 'string' || !theme.name.trim() || theme.name.length > 120) fail('name');
  if (!['light', 'dark', 'pop'].includes(theme.mode)) fail('mode');
  if (!hasExactKeys(theme.colors, DESIGN_SPACE_COLOR_ROLES)
    || !DESIGN_SPACE_COLOR_ROLES.every((role) => isHex(theme.colors[role]))) fail('colors must contain nine #RRGGBB roles');
  const meta = theme.metadata;
  if (!hasExactKeys(meta, ['source', 'sourceSurface', 'exportedAt', 'seedColor', 'harmony', 'lockedRoles', 'adjustedRoles'])) fail('metadata');
  if (meta.source !== 'apocapalette' || meta.sourceSurface !== 'tasting-room') fail('source');
  if (typeof meta.exportedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(meta.exportedAt)
    || !Number.isFinite(Date.parse(meta.exportedAt))
    || new Date(meta.exportedAt).toISOString() !== meta.exportedAt) fail('exportedAt');
  if (!isHex(meta.seedColor)) fail('seedColor');
  if (!['Monochromatic', 'Analogous', 'Complementary', 'Tertiary', 'Apocalypse'].includes(meta.harmony)) fail('harmony');
  for (const key of ['lockedRoles', 'adjustedRoles']) {
    if (!Array.isArray(meta[key]) || new Set(meta[key]).size !== meta[key].length
      || !meta[key].every((role) => DESIGN_SPACE_COLOR_ROLES.includes(role))) fail(key);
  }
  return theme;
}
