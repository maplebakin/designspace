export interface DesignSpacePalette {
  canvasBackground: string;
  panelBackground: string;
  surfaceBackground: string;
  textPrimary: string;
  textSecondary: string;
  textOnBrand: string;
  brandPrimary: string;
  brandSecondary: string;
  brandAccent: string;
  interactiveDefault: string;
  interactiveHover: string;
  interactiveActive: string;
  statusSuccess: string;
  statusWarning: string;
  statusError: string;
  neutralBorder: string;
  neutralDivider: string;
  neutralDisabled: string;
  neutralShadow100: string;
  neutralShadow200: string;
  name: string;
  mode: 'light' | 'dark';
}

export interface TokenValue {
  value: string;
  type?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  [key: string]: unknown;
}

export type TokenSection = Record<string, TokenValue | undefined>;

export interface BrandTokens extends TokenSection {
  primary?: TokenValue;
  secondary?: TokenValue;
  accent?: TokenValue;
  accentstrong?: TokenValue;
  cta?: TokenValue;
  ctahover?: TokenValue;
  linkcolor?: TokenValue;
  focusring?: TokenValue;
  gradientstart?: TokenValue;
  gradientend?: TokenValue;
}

export interface TypographyTokens extends TokenSection {
  heading?: TokenValue;
  body?: TokenValue;
  textstrong?: TokenValue;
  textbody?: TokenValue;
  textmuted?: TokenValue;
  texthint?: TokenValue;
  textdisabled?: TokenValue;
  textaccent?: TokenValue;
  textaccentstrong?: TokenValue;
  footertext?: TokenValue;
  footertextmuted?: TokenValue;
  'text-body'?: TokenValue;
  'text-hint'?: TokenValue;
}

export interface SurfaceTokens extends TokenSection {
  background?: TokenValue;
  pagebackground?: TokenValue;
  headerbackground?: TokenValue;
  surfaceplain?: TokenValue;
  surfaceplainborder?: TokenValue;
  'page-background'?: TokenValue;
  'header-background'?: TokenValue;
  'surface-plain'?: TokenValue;
  'surface-plain-border'?: TokenValue;
}

export interface BorderTokens extends TokenSection {
  bordersubtle?: TokenValue;
  borderstrong?: TokenValue;
  'border-subtle'?: TokenValue;
  'border-strong'?: TokenValue;
}

export interface ThemeMeta {
  schema?: string;
  name?: string;
  slug?: string;
  label?: string;
  mode?: string;
  category?: string;
  [key: string]: unknown;
}

export interface ApocapaletteTheme {
  meta?: ThemeMeta;
  mode?: string;
  brand?: BrandTokens;
  typography?: TypographyTokens;
  surfaces?: SurfaceTokens;
  borders?: BorderTokens;
  cards?: TokenSection;
  glass?: TokenSection;
  entity?: TokenSection;
  named?: TokenSection;
  status?: TokenSection;
  semantic?: TokenSection;
  accents?: TokenSection;
  neutrals?: TokenSection;
  aliases?: TokenSection;
  foundation?: TokenSection;
  textPalette?: TokenSection;
  dawn?: TokenSection;
  [key: string]: unknown;
}
