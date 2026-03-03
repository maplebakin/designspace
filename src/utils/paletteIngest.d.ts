export interface IngestedPalette {
  name: string;
  mode: string;
  categories: {
    backgrounds?: Record<string, string>;
    text?: Record<string, string>;
    brand?: Record<string, string>;
    interactive?: Record<string, string>;
    status?: Record<string, string>;
    neutrals?: Record<string, string>;
  };
}

export function ingestApocapalette(rawPalette: Record<string, unknown>): IngestedPalette;
