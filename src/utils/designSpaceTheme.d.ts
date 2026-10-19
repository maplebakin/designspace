export type DesignSpaceColorRole =
  | 'background'
  | 'surface'
  | 'heading'
  | 'text'
  | 'mutedText'
  | 'accent'
  | 'cta'
  | 'ctaForeground'
  | 'border';
export interface DesignSpaceTheme {
  format: 'design-space-theme';
  version: 1;
  name: string;
  mode: 'light' | 'dark' | 'pop';
  colors: Record<DesignSpaceColorRole, string>;
  metadata: {
    source: 'apocapalette';
    sourceSurface: 'tasting-room';
    exportedAt: string;
    seedColor: string;
    harmony:
      | 'Monochromatic'
      | 'Analogous'
      | 'Complementary'
      | 'Tertiary'
      | 'Apocalypse';
    lockedRoles: DesignSpaceColorRole[];
    adjustedRoles: DesignSpaceColorRole[];
  };
}
export const DESIGN_SPACE_THEME_FORMAT: 'design-space-theme';
export const DESIGN_SPACE_THEME_VERSION: 1;
export const DESIGN_SPACE_COLOR_ROLES: readonly DesignSpaceColorRole[];
export function validateDesignSpaceTheme(value: unknown): DesignSpaceTheme;
