import { describe, expect, it } from 'vitest';
import * as fabric from 'fabric';
import fixture from './fixtures/design-space-theme-v1.json';
import {
  validateDesignSpaceTheme,
  DESIGN_SPACE_COLOR_ROLES,
} from '../src/utils/designSpaceTheme';
import { ingestApocapalette } from '../src/utils/paletteIngest';
import {
  createBlankDocumentProject,
  useDocumentStore,
} from '../src/document/state/documentStore';
import {
  projectDocumentTheme,
  DOCUMENT_THEME_ROLES,
} from '../src/document/services/documentThemeBridge';
import { normalizeDesignSpaceProjectPayload } from '../src/editor/project/projectSchema';
import { createDocumentHistory } from '../src/document/state/documentHistory';
import { useUiThemeStore } from '../src/editor/state/uiThemeStore';
import { useThemeStore } from '../src/editor/state/useThemeStore';
import {
  bridgeThemeTokens,
  visitBridgeObjects,
} from '../src/editor/services/themeBridge';

const theme = () => validateDesignSpaceTheme(structuredClone(fixture));

describe('Apocapalette v1 receiving contract', () => {
  it.each(['light', 'dark', 'pop'])(
    'preserves every byte of every colour in %s mode',
    (mode) => {
      const value = { ...fixture, mode };
      expect(validateDesignSpaceTheme(value)).toBe(value);
      expect(
        ingestApocapalette(JSON.parse(JSON.stringify(value))).bridgeTheme
      ).toEqual(value);
    }
  );

  it.each([
    (v: any) => {
      v.version = 2;
    },
    (v: any) => {
      v.format = 'other';
    },
    (v: any) => {
      v.extra = true;
    },
    (v: any) => {
      delete v.colors.border;
    },
    (v: any) => {
      v.colors.extra = '#123456';
    },
    (v: any) => {
      v.colors.text = '#123';
    },
    (v: any) => {
      v.colors.text = '#123456ff';
    },
    (v: any) => {
      v.colors.text = 'var(--text)';
    },
    (v: any) => {
      v.metadata.seedColor = '#abc';
    },
    (v: any) => {
      v.metadata.exportedAt = '2026-02-30T12:00:00.000Z';
    },
    (v: any) => {
      v.metadata.exportedAt = '2026-10-18T12:00:00Z';
    },
    (v: any) => {
      v.metadata.lockedRoles = ['accent', 'accent'];
    },
    (v: any) => {
      v.metadata.adjustedRoles = ['muted'];
    },
    (v: any) => {
      v.metadata.source = 'unknown';
    },
    (v: any) => {
      v.metadata.harmony = 'unknown';
    },
    (v: any) => {
      v.metadata.extra = true;
    },
    (v: any) => {
      v.name = ' ';
    },
    (v: any) => {
      v.name = 'x'.repeat(121);
    },
    (v: any) => {
      v.mode = 'auto';
    },
  ])('rejects invalid contracts without treating them as legacy', (mutate) => {
    const value = structuredClone(fixture);
    mutate(value);
    expect(() => ingestApocapalette(value)).toThrow();
  });

  it('accepts duplicate colours and low contrast without repair', () => {
    const value = theme();
    DESIGN_SPACE_COLOR_ROLES.forEach((role) => {
      value.colors[role] = '#aAbBcC';
    });
    expect(validateDesignSpaceTheme(value).colors).toEqual(value.colors);
  });

  it('retains legacy flat palette imports', () => {
    expect(
      ingestApocapalette({
        name: 'Legacy',
        mode: 'dark',
        canvasBackground: '#112233',
        textPrimary: '#ABC',
        brandAccent: '#ee00aa',
      })
    ).toEqual({
      name: 'Legacy',
      mode: 'dark',
      categories: {
        backgrounds: { canvas: '#112233' },
        text: { primary: '#ABC' },
        brand: { accent: '#ee00aa' },
      },
    });
    expect(() => ingestApocapalette(null as any)).toThrow();
  });
});

describe('Document theme projection and authored state', () => {
  it('previews without mutation; preserves content, custom colours, fonts, geometry, images and locks', () => {
    const base = createBlankDocumentProject();
    base.document.styles.body.fontFamilyId = 'book-serif';
    base.document.styles.caption.color = '#123456';
    const original = structuredClone(base);
    const result = projectDocumentTheme(base, theme());
    expect(base).toEqual(original);
    expect(result.project.pages).toBe(base.pages);
    expect(result.project.assets).toBe(base.assets);
    expect(result.project.document.styles.body.fontFamilyId).toBe('book-serif');
    expect(result.project.document.styles.caption.color).toBe('#123456');
    expect(result.preservedStyles).toEqual(['caption']);
    expect(result.project.document.styles['article-title'].color).toBe(
      fixture.colors.heading
    );
    expect(result.project.document.background?.value).toBe(
      fixture.colors.background
    );
  });

  it('applies atomically, rolls back through existing history and preserves all nine exact strings on reopen', () => {
    useDocumentStore.getState().createBlankProject('Bridge');
    const before = useDocumentStore.getState().project!;
    const history = createDocumentHistory();
    history.reset(before, 'bridge');
    useDocumentStore.getState().applyBridgeTheme(theme());
    const after = useDocumentStore.getState().project!;
    useDocumentStore.getState().updateDocumentStyle('article-title', { fontSizePx: 48 });
    expect(useDocumentStore.getState().project?.document.styles['article-title'].color).toBe(fixture.colors.heading);
    history.observeTransition(before, after, {
      previousSessionIdentity: 'bridge',
      sessionIdentity: 'bridge',
    });
    history.flushPending();
    expect(history.getState().length).toBe(1);
    history.undo((p) =>
      useDocumentStore.getState().restoreDocumentHistoryProject(p)
    );
    expect(useDocumentStore.getState().project?.document).toEqual(
      before.document
    );
    history.redo((p) =>
      useDocumentStore.getState().restoreDocumentHistoryProject(p)
    );
    const reopened = normalizeDesignSpaceProjectPayload(
      JSON.parse(JSON.stringify(after))
    );
    expect(reopened.document.bridgeTheme).toEqual(fixture);
    for (const [id, role] of Object.entries(DOCUMENT_THEME_ROLES)) {
      expect(
        reopened.document.styles?.[id as keyof typeof DOCUMENT_THEME_ROLES]
          .color
      ).toBe(fixture.colors[role]);
    }
    expect(reopened.document.background?.value).toBe(fixture.colors.background);
    const edited = {
      ...after,
      document: {
        ...after.document,
        styles: {
          ...after.document.styles,
          body: { ...after.document.styles.body, color: '#123456' },
        },
      },
    };
    const next = theme();
    next.colors.heading = '#112233';
    expect(
      projectDocumentTheme(edited, next).project.document.styles.body.color
    ).toBe('#123456');
    expect(
      projectDocumentTheme(edited, next).project.document.styles[
        'article-title'
      ].color
    ).toBe('#112233');
  });
});

describe('freeform linked-only application', () => {
  it('does not sync creator theme colours into chrome and keeps background casing', () => {
    const uiBefore = useUiThemeStore.getState().vars;
    const tokens = bridgeThemeTokens(theme());
    useUiThemeStore.getState().applyThemeFromTokens(tokens);
    expect(useUiThemeStore.getState().vars).toBe(uiBefore);
    useThemeStore.getState().setThemeData(tokens);
    useThemeStore
      .getState()
      .setCanvasBackgroundColor(fixture.colors.background);
    expect(useThemeStore.getState().canvasBackgroundColor).toBe(
      fixture.colors.background
    );
    useThemeStore.getState().setThemeData(null);
  });
  it('uses exact semantic tokens and skips manual colours, locked groups and photos', () => {
    const linked = new fabric.Rect({ fill: '#000000' });
    Object.assign(linked, { tokenRole: 'typography.heading.value' });
    const manual = new fabric.Rect({ fill: '#123456' });
    const locked = new fabric.Rect({ fill: '#654321' });
    Object.assign(locked, { tokenRole: 'brand.accent', colorLocked: true });
    const child = new fabric.Rect({ fill: '#654321' });
    Object.assign(child, { tokenRole: 'colors.border' });
    const group = new fabric.Group([child]);
    Object.assign(group, { colorLocked: true });
    const image = new fabric.FabricImage(document.createElement('img'));
    Object.assign(image, { tokenRole: 'brand.accent' });
    const objects = [linked, manual, locked, group, image];
    const tokens = bridgeThemeTokens(theme());
    expect(visitBridgeObjects(objects, tokens)).toEqual({
      linked: 1,
      unthemed: 1,
      locked: 2,
      images: 1,
      unthemedObjects: ['rect'],
    });
    expect(linked.fill).toBe('#000000');
    visitBridgeObjects(objects, tokens, true);
    expect(linked.fill).toBe(fixture.colors.heading);
    expect(manual.fill).toBe('#123456');
    expect(child.fill).toBe('#654321');
    expect(locked.fill).toBe('#654321');
    expect(image.filters).toEqual([]);
  });
});
