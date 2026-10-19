import type * as fabric from 'fabric';
import type { ApocapaletteTheme } from '../types/apocapalette';
import {
  validateDesignSpaceTheme,
  type DesignSpaceTheme,
} from '../../utils/designSpaceTheme';
import { resolveThemeValue } from '../utils/themeResolver';

/** Explicit aliases for existing links. No generated defaults or status colours. */
export const bridgeThemeTokens = (
  input: DesignSpaceTheme
): ApocapaletteTheme => {
  const theme = validateDesignSpaceTheme(input);
  const c = theme.colors;
  const token = (value: string) => ({ value });
  return {
    meta: {
      name: theme.name,
      mode: theme.mode,
      schema: 'design-space-theme/1',
    },
    bridgeTheme: theme,
    mode: theme.mode,
    colors: Object.fromEntries(
      Object.entries(c).map(([key, value]) => [key, token(value)])
    ),
    brand: {
      primary: token(c.accent),
      secondary: token(c.surface),
      accent: token(c.accent),
      cta: token(c.cta),
    },
    typography: {
      heading: token(c.heading),
      body: token(c.text),
      textmuted: token(c.mutedText),
      textaccent: token(c.accent),
    },
    surfaces: {
      background: token(c.background),
      pagebackground: token(c.background),
      'page-background': token(c.background),
      surfaceplain: token(c.surface),
      'surface-plain': token(c.surface),
    },
    borders: {
      bordersubtle: token(c.border),
      borderstrong: token(c.border),
      'border-subtle': token(c.border),
      'border-strong': token(c.border),
    },
    textPalette: {
      'text-primary': token(c.text),
      'text-secondary': token(c.mutedText),
      'text-on-brand': token(c.ctaForeground),
    },
  };
};

export const visitBridgeObjects = (
  objects: fabric.FabricObject[],
  tokens: ApocapaletteTheme,
  apply = false
) => {
  const report = {
    linked: 0,
    locked: 0,
    images: 0,
    unthemed: 0,
    unthemedObjects: [] as string[],
  };
  const visit = (object: fabric.FabricObject, parentLocked = false) => {
    const obj = object as fabric.FabricObject & {
      id?: string;
      name?: string;
      colorLocked?: boolean;
      tokenRole?: string;
      getObjects?: () => fabric.FabricObject[];
    };
    const locked =
      parentLocked ||
      !!obj.colorLocked ||
      (!!obj.lockMovementX && !!obj.lockMovementY);
    if (obj.type.toLowerCase() === 'image') {
      report.images++;
      return;
    }
    if (obj.getObjects) {
      obj.getObjects().forEach((child) => visit(child, locked));
      return;
    }
    if (locked) {
      report.locked++;
      return;
    }
    const color = obj.tokenRole
      ? resolveThemeValue(tokens, obj.tokenRole)
      : null;
    if (!color || !/^#[0-9a-f]{6}$/i.test(color)) {
      report.unthemed++;
      report.unthemedObjects.push(
        `${obj.name || obj.id || obj.type}${obj.tokenRole ? ` (${obj.tokenRole})` : ''}`
      );
      return;
    }
    report.linked++;
    if (apply) obj.set(obj.stroke && !obj.fill ? 'stroke' : 'fill', color);
  };
  objects.forEach((object) => visit(object));
  return report;
};
