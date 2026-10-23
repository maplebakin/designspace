import * as fabric from 'fabric';
import { v4 as uuidv4 } from 'uuid';
import { useCanvasStore } from '../state/useCanvasStore';
import { useThemeStore } from '../state/useThemeStore';

export type TarotBorderType = 'none' | 'single' | 'double';
export type TarotLabelPlacement = 'inside' | 'below' | 'hidden';
export type TarotTitleAlignment = 'left' | 'center' | 'right';
export type TarotOrnamentStyle = 'none' | 'divider';
export type TarotOrnamentPlacement = 'header' | 'footer';
export type TarotCardFillMode = 'filled' | 'outline';

export interface TarotPageStyle {
  version: 1;
  page: {
    backgroundColor: string;
    contentInset: number;
    headerSpreadGap: number;
  };
  border: {
    type: TarotBorderType;
    color: string;
    width: number;
    inset: number;
    doubleSpacing: number;
    cornerRadius: number;
    opacity: number;
  };
  header: {
    titleText: string;
    titleFontFamily: string;
    titleFontSize: number;
    titleFontWeight: string;
    titleLetterSpacing: number;
    titleColor: string;
    titleAlignment: TarotTitleAlignment;
    titleOffsetX: number;
    titleOffsetY: number;
    titleUppercase: boolean;
    subtitleVisible: boolean;
    subtitleText: string;
    subtitleFontFamily: string;
    subtitleFontSize: number;
    subtitleItalic: boolean;
    subtitleLineHeight: number;
    subtitleColor: string;
    subtitleSpacing: number;
    subtitleAlignment: TarotTitleAlignment;
  };
  card: {
    fillMode: TarotCardFillMode;
    fillColor: string;
    borderColor: string;
    borderWidth: number;
    cornerRadius: number;
    opacity: number;
    numberFontFamily: string;
    numberFontSize: number;
    numberColor: string;
    labelPlacement: TarotLabelPlacement;
    labelFontFamily: string;
    labelFontSize: number;
    labelColor: string;
    labelMaxWidth: number;
    labelSpacing: number;
    labelAlignment: TarotTitleAlignment;
  };
  footer: {
    visible: boolean;
    dateVisible: boolean;
    deckVisible: boolean;
    questionVisible: boolean;
    notesVisible: boolean;
    dateText: string;
    deckText: string;
    questionText: string;
    notesText: string;
    fontFamily: string;
    fontSize: number;
    lineColor: string;
    spacing: number;
    height: number;
  };
  ornament: {
    style: TarotOrnamentStyle;
    color: string;
    size: number;
    placement: TarotOrnamentPlacement;
  };
}

export const DEFAULT_TAROT_PAGE_STYLE: TarotPageStyle = {
  version: 1,
  page: {
    backgroundColor: '#FAF8F5',
    contentInset: 72,
    headerSpreadGap: 72,
  },
  border: {
    type: 'single',
    color: '#463A34',
    width: 2,
    inset: 72,
    doubleSpacing: 14,
    cornerRadius: 0,
    opacity: 1,
  },
  header: {
    titleText: 'Tarot Spread',
    titleFontFamily: 'Georgia',
    titleFontSize: 78,
    titleFontWeight: 'bold',
    titleLetterSpacing: 0,
    titleColor: '#302935',
    titleAlignment: 'center',
    titleOffsetX: 0,
    titleOffsetY: 0,
    titleUppercase: false,
    subtitleVisible: false,
    subtitleText: '',
    subtitleFontFamily: 'Georgia',
    subtitleFontSize: 34,
    subtitleItalic: true,
    subtitleLineHeight: 1.2,
    subtitleColor: '#6B5B62',
    subtitleSpacing: 18,
    subtitleAlignment: 'center',
  },
  card: {
    fillMode: 'filled',
    fillColor: '#302935',
    borderColor: '#B98F9D',
    borderWidth: 2,
    cornerRadius: 9,
    opacity: 1,
    numberFontFamily: 'Georgia',
    numberFontSize: 75,
    numberColor: '#EADFCB',
    labelPlacement: 'inside',
    labelFontFamily: 'Georgia',
    labelFontSize: 17,
    labelColor: '#EADFCB',
    labelMaxWidth: 158,
    labelSpacing: 14,
    labelAlignment: 'center',
  },
  footer: {
    visible: false,
    dateVisible: false,
    deckVisible: false,
    questionVisible: false,
    notesVisible: false,
    dateText: 'Date',
    deckText: 'Deck',
    questionText: 'Question / Intention',
    notesText: 'Notes',
    fontFamily: 'Georgia',
    fontSize: 22,
    lineColor: '#B8A9A0',
    spacing: 18,
    height: 160,
  },
  ornament: {
    style: 'none',
    color: '#B98F9D',
    size: 28,
    placement: 'header',
  },
};

const STARTER_STYLE_OVERRIDES: Record<string, Partial<TarotPageStyle>> = {
  Minimal: {
    border: { ...DEFAULT_TAROT_PAGE_STYLE.border, type: 'none' },
    card: { ...DEFAULT_TAROT_PAGE_STYLE.card, fillMode: 'outline', fillColor: '#FAF8F5', borderColor: '#463A34' },
    header: { ...DEFAULT_TAROT_PAGE_STYLE.header, titleFontFamily: 'Inter', titleFontSize: 64, titleFontWeight: '600' },
  },
  Framed: {
    border: { ...DEFAULT_TAROT_PAGE_STYLE.border, type: 'single', inset: 72 },
    header: { ...DEFAULT_TAROT_PAGE_STYLE.header, titleAlignment: 'center' },
    card: { ...DEFAULT_TAROT_PAGE_STYLE.card, fillMode: 'outline', fillColor: '#FAF8F5', borderColor: '#463A34' },
  },
  Bookish: {
    border: { ...DEFAULT_TAROT_PAGE_STYLE.border, type: 'double', inset: 72, doubleSpacing: 16 },
    header: { ...DEFAULT_TAROT_PAGE_STYLE.header, titleFontFamily: 'Cinzel', subtitleFontFamily: 'Cormorant Garamond', subtitleVisible: true, subtitleText: 'A page for reflection' },
    card: { ...DEFAULT_TAROT_PAGE_STYLE.card, labelFontFamily: 'Cormorant Garamond', labelFontSize: 20 },
    ornament: { ...DEFAULT_TAROT_PAGE_STYLE.ornament, style: 'divider' },
  },
};

const mergeStyle = (value: Partial<TarotPageStyle> | null | undefined): TarotPageStyle => {
  const source = value ?? {};
  return {
    ...DEFAULT_TAROT_PAGE_STYLE,
    ...source,
    page: { ...DEFAULT_TAROT_PAGE_STYLE.page, ...(source.page ?? {}) },
    border: { ...DEFAULT_TAROT_PAGE_STYLE.border, ...(source.border ?? {}) },
    header: { ...DEFAULT_TAROT_PAGE_STYLE.header, ...(source.header ?? {}) },
    card: { ...DEFAULT_TAROT_PAGE_STYLE.card, ...(source.card ?? {}) },
    footer: { ...DEFAULT_TAROT_PAGE_STYLE.footer, ...(source.footer ?? {}) },
    ornament: { ...DEFAULT_TAROT_PAGE_STYLE.ornament, ...(source.ornament ?? {}) },
  } as TarotPageStyle;
};

export const normalizeTarotPageStyle = (value: Partial<TarotPageStyle> | null | undefined): TarotPageStyle => {
  const style = mergeStyle(value);
  const finite = (number: number, fallback: number, minimum = 0) => (
    Number.isFinite(number) ? Math.max(minimum, number) : fallback
  );
  style.page.contentInset = finite(style.page.contentInset, DEFAULT_TAROT_PAGE_STYLE.page.contentInset);
  style.page.headerSpreadGap = finite(style.page.headerSpreadGap, DEFAULT_TAROT_PAGE_STYLE.page.headerSpreadGap);
  style.border.width = finite(style.border.width, 2, 1);
  style.border.inset = finite(style.border.inset, 72);
  style.border.doubleSpacing = finite(style.border.doubleSpacing, 14);
  style.border.cornerRadius = finite(style.border.cornerRadius, 0);
  style.border.opacity = Math.min(1, finite(style.border.opacity, 1));
  style.header.titleFontSize = finite(style.header.titleFontSize, 78, 8);
  style.header.titleLetterSpacing = finite(style.header.titleLetterSpacing, 0);
  style.header.titleOffsetY = finite(style.header.titleOffsetY, 0);
  style.header.subtitleFontSize = finite(style.header.subtitleFontSize, 34, 8);
  style.header.subtitleLineHeight = finite(style.header.subtitleLineHeight, 1.2, 0.6);
  style.header.subtitleSpacing = finite(style.header.subtitleSpacing, 18);
  style.card.borderWidth = finite(style.card.borderWidth, 2, 0);
  style.card.cornerRadius = finite(style.card.cornerRadius, 9);
  style.card.opacity = Math.min(1, finite(style.card.opacity, 1));
  style.card.numberFontSize = finite(style.card.numberFontSize, 75, 8);
  style.card.labelFontSize = finite(style.card.labelFontSize, 17, 8);
  style.card.labelMaxWidth = finite(style.card.labelMaxWidth, 158, 20);
  style.card.labelSpacing = finite(style.card.labelSpacing, 14);
  style.footer.fontSize = finite(style.footer.fontSize, 22, 8);
  style.footer.spacing = finite(style.footer.spacing, 18);
  style.footer.height = finite(style.footer.height, 160, 30);
  style.ornament.size = finite(style.ornament.size, 28, 4);
  return style;
};

export const makeStarterTarotPageStyles = () => Object.entries(STARTER_STYLE_OVERRIDES).map(([name, overrides]) => ({
  id: `starter-${name.toLowerCase()}`,
  name,
  style: normalizeTarotPageStyle(overrides),
  starter: true,
}));

export const getTarotPageStyleMarker = (canvas: fabric.Canvas): fabric.Object | null =>
  canvas.getObjects().find((object) => (object as any).isTarotPageStyle) ?? null;

export const getTarotPageStyle = (canvas: fabric.Canvas): TarotPageStyle => {
  const marker = getTarotPageStyleMarker(canvas);
  if (marker && (marker as any).tarotPageStyle) {
    return normalizeTarotPageStyle((marker as any).tarotPageStyle);
  }
  const title = canvas.getObjects().find((object) => (
    (object as any).semanticRole === 'tarot-page-title'
    || String((object as any).name ?? '').startsWith('Tarot spread title:')
  )) as any;
  const background = useThemeStore.getState().canvasBackgroundColor || DEFAULT_TAROT_PAGE_STYLE.page.backgroundColor;
  return normalizeTarotPageStyle({
    page: { backgroundColor: background },
    header: { titleText: typeof title?.text === 'string' ? title.text : DEFAULT_TAROT_PAGE_STYLE.header.titleText },
  } as any);
};

export const createTarotPageStyleMarker = (style: TarotPageStyle): fabric.Rect => {
  const marker = new fabric.Rect({
    left: 0,
    top: 0,
    width: 1,
    height: 1,
    fill: 'transparent',
    opacity: 0,
    selectable: false,
    evented: false,
    lockMovementX: true,
    lockMovementY: true,
  });
  (marker as any).id = 'tarot-page-style';
  (marker as any).isTarotPageStyle = true;
  (marker as any).semanticRole = 'tarot-page-style';
  (marker as any).name = 'Tarot Page Style';
  (marker as any).tarotPageStyle = normalizeTarotPageStyle(style);
  return marker;
};

const ensureMarker = (canvas: fabric.Canvas, style: TarotPageStyle) => {
  const existing = getTarotPageStyleMarker(canvas);
  if (existing) {
    (existing as any).tarotPageStyle = normalizeTarotPageStyle(style);
    return existing;
  }
  const marker = createTarotPageStyleMarker(style);
  canvas.add(marker);
  canvas.sendObjectToBack(marker);
  return marker;
};

const getCardChild = (group: fabric.Group, role: string) =>
  group.getObjects().find((child) => (child as any).semanticRole === role);

const isTarotCard = (object: fabric.Object | null | undefined): object is fabric.Group =>
  object?.type === 'group'
  && Number.isInteger((object as any).tarotPosition?.number)
  && typeof (object as any).tarotPosition?.spreadId === 'string';

const setTextboxLayout = (
  textbox: fabric.Textbox,
  options: { left: number; top: number; width: number; align: TarotTitleAlignment },
) => {
  textbox.set({
    left: options.left,
    top: options.top,
    width: options.width,
    originX: options.align === 'left' ? 'left' : options.align === 'right' ? 'right' : 'center',
    textAlign: options.align,
  });
  textbox.initDimensions();
  textbox.setCoords();
};

const updateTitle = (canvas: fabric.Canvas, style: TarotPageStyle, applyContent: boolean) => {
  const { width } = useCanvasStore.getState();
  let title = canvas.getObjects().find((object) => (
    (object as any).semanticRole === 'tarot-page-title'
    || String((object as any).name ?? '').startsWith('Tarot spread title:')
  )) as fabric.Textbox | undefined;
  if (!title && style.header.titleText.trim()) {
    title = new fabric.Textbox(style.header.titleText.trim(), { width: Math.max(200, width - style.page.contentInset * 2) });
    (title as any).id = uuidv4();
    (title as any).semanticRole = 'tarot-page-title';
    (title as any).name = 'Spread Title';
    canvas.add(title);
  }
  if (!title) return;
  (title as any).semanticRole = 'tarot-page-title';
  (title as any).name = 'Spread Title';
  if (applyContent && style.header.titleText.trim()) {
    title.set('text', style.header.titleText.trim());
  }
  const titleWidth = Math.max(200, width - style.page.contentInset * 2);
  const left = style.header.titleAlignment === 'left'
    ? style.page.contentInset + style.header.titleOffsetX
    : style.header.titleAlignment === 'right'
      ? width - style.page.contentInset + style.header.titleOffsetX
      : width / 2 + style.header.titleOffsetX;
  title.set({
    fontFamily: style.header.titleFontFamily,
    fontSize: style.header.titleFontSize,
    fontWeight: style.header.titleFontWeight,
    charSpacing: style.header.titleLetterSpacing,
    fill: style.header.titleColor,
    top: style.page.contentInset + style.header.titleOffsetY,
    opacity: 1,
    visible: true,
  });
  setTextboxLayout(title, { left, top: style.page.contentInset + style.header.titleOffsetY, width: titleWidth, align: style.header.titleAlignment });
  if (style.header.titleUppercase) {
    title.set('text', String(title.text || '').toUpperCase());
  }
  title.setCoords();
};

const updateSubtitle = (canvas: fabric.Canvas, style: TarotPageStyle, applyContent: boolean) => {
  const { width } = useCanvasStore.getState();
  const title = canvas.getObjects().find((object) => (
    (object as any).semanticRole === 'tarot-page-title'
    || String((object as any).name ?? '').startsWith('Tarot spread title:')
  )) as fabric.Textbox | undefined;
  let subtitle = canvas.getObjects().find((object) => (object as any).semanticRole === 'tarot-page-subtitle') as fabric.Textbox | undefined;
  if (!subtitle && style.header.subtitleVisible && style.header.subtitleText.trim()) {
    subtitle = new fabric.Textbox(style.header.subtitleText.trim(), { width: Math.max(200, width - style.page.contentInset * 2) });
    (subtitle as any).id = uuidv4();
    (subtitle as any).semanticRole = 'tarot-page-subtitle';
    (subtitle as any).name = 'Spread Subtitle';
    canvas.add(subtitle);
  }
  if (!subtitle) return;
  if (applyContent && style.header.subtitleText.trim()) subtitle.set('text', style.header.subtitleText.trim());
  const titleBottom = (title?.top ?? style.page.contentInset) + (title?.height ?? style.header.titleFontSize);
  const left = style.header.subtitleAlignment === 'left'
    ? style.page.contentInset
    : style.header.subtitleAlignment === 'right'
      ? width - style.page.contentInset
      : width / 2;
  subtitle.set({
    fontFamily: style.header.subtitleFontFamily,
    fontSize: style.header.subtitleFontSize,
    fontStyle: style.header.subtitleItalic ? 'italic' : 'normal',
    lineHeight: style.header.subtitleLineHeight,
    fill: style.header.subtitleColor,
    visible: style.header.subtitleVisible,
    opacity: style.header.subtitleVisible ? 1 : 0,
  });
  setTextboxLayout(subtitle, { left, top: titleBottom + style.header.subtitleSpacing, width: Math.max(200, width - style.page.contentInset * 2), align: style.header.subtitleAlignment });
};

const updateCards = (canvas: fabric.Canvas, style: TarotPageStyle) => {
  canvas.getObjects().filter(isTarotCard).forEach((group) => {
    const rects = group.getObjects().filter((child) => child.type === 'rect');
    const face = (getCardChild(group, 'tarot-card-face') ?? rects[0]) as fabric.Rect | undefined;
    const inset = (getCardChild(group, 'tarot-card-inset') ?? rects[1]) as fabric.Rect | undefined;
    const number = (getCardChild(group, 'tarot-card-number') ?? group.getObjects().find((child) => child.type === 'text')) as fabric.Text | undefined;
    const label = getCardChild(group, 'tarot-position-label') as fabric.Textbox | undefined;
    if (face) (face as any).semanticRole = 'tarot-card-face';
    if (inset) (inset as any).semanticRole = 'tarot-card-inset';
    if (number) (number as any).semanticRole = 'tarot-card-number';
    (group as any).semanticRole = 'tarot-card';
    if (face) face.set({
      fill: style.card.fillMode === 'outline' ? 'transparent' : style.card.fillColor,
      stroke: style.card.borderColor,
      strokeWidth: style.card.borderWidth,
      rx: style.card.cornerRadius,
      ry: style.card.cornerRadius,
    });
    if (inset) inset.set({ stroke: style.card.borderColor, rx: Math.max(2, style.card.cornerRadius - 3), ry: Math.max(2, style.card.cornerRadius - 3) });
    if (number) number.set({ fontFamily: style.card.numberFontFamily, fontSize: style.card.numberFontSize, fill: style.card.numberColor });
    if (label) {
      label.set({
        fontFamily: style.card.labelFontFamily,
        fontSize: style.card.labelFontSize,
        fill: style.card.labelColor,
        width: style.card.labelMaxWidth,
        textAlign: style.card.labelAlignment,
        visible: style.card.labelPlacement !== 'hidden',
        opacity: style.card.labelPlacement === 'hidden' ? 0 : 1,
        top: style.card.labelPlacement === 'below' ? 146 + style.card.labelSpacing : 46,
        originX: 'center',
        originY: style.card.labelPlacement === 'below' ? 'top' : 'top',
      });
    }
    group.set({ opacity: style.card.opacity });
    group.setCoords();
  });
};

const footerFields = [
  ['dateVisible', 'dateText', 'tarot-footer-date', 'Date'],
  ['deckVisible', 'deckText', 'tarot-footer-deck', 'Deck'],
  ['questionVisible', 'questionText', 'tarot-footer-question', 'Question / Intention'],
  ['notesVisible', 'notesText', 'tarot-footer-notes', 'Notes'],
] as const;

const updateFooter = (canvas: fabric.Canvas, style: TarotPageStyle, applyContent: boolean) => {
  const { width, height } = useCanvasStore.getState();
  let rule = canvas.getObjects().find((object) => (object as any).semanticRole === 'tarot-footer-rule') as fabric.Line | undefined;
  if (!rule && style.footer.visible) {
    rule = new fabric.Line([style.page.contentInset, height - style.footer.height, width - style.page.contentInset, height - style.footer.height]);
    (rule as any).id = uuidv4();
    (rule as any).semanticRole = 'tarot-footer-rule';
    (rule as any).name = 'Footer Rule';
    canvas.add(rule);
  }
  if (rule) rule.set({
      stroke: style.footer.lineColor,
      strokeWidth: 1,
      visible: style.footer.visible,
      opacity: style.footer.visible ? 1 : 0,
      x1: style.page.contentInset,
      x2: width - style.page.contentInset,
      y1: height - style.footer.height,
      y2: height - style.footer.height,
    });
  footerFields.forEach(([visibleKey, textKey, role, fallback], index) => {
    const visible = style.footer.visible && style.footer[visibleKey];
    let field = canvas.getObjects().find((object) => (object as any).semanticRole === role) as fabric.Textbox | undefined;
    if (!field && visible) {
      field = new fabric.Textbox(style.footer[textKey] || fallback, { width: Math.max(120, width - style.page.contentInset * 2) });
      (field as any).id = uuidv4();
      (field as any).semanticRole = role;
      (field as any).tarotFooterField = textKey;
      (field as any).name = fallback;
      canvas.add(field);
    }
    if (!field) return;
    if (applyContent && style.footer[textKey]) field.set('text', style.footer[textKey]);
    field.set({
      fontFamily: style.footer.fontFamily,
      fontSize: style.footer.fontSize,
      fill: style.footer.lineColor,
      visible,
      opacity: visible ? 1 : 0,
      top: height - style.footer.height + style.footer.spacing + index * (style.footer.fontSize + style.footer.spacing),
      left: style.page.contentInset,
      width: Math.max(120, width - style.page.contentInset * 2),
      textAlign: 'left',
    });
    field.setCoords();
  });
};

const makeDivider = (style: TarotPageStyle, width: number, top: number): fabric.Group => {
  const lineWidth = Math.max(36, style.ornament.size * 2.5);
  const line = new fabric.Line([-lineWidth / 2, 0, lineWidth / 2, 0], { stroke: style.ornament.color, strokeWidth: 2, originX: 'center', originY: 'center' });
  const diamond = new fabric.Polygon([{ x: 0, y: -style.ornament.size / 4 }, { x: style.ornament.size / 4, y: 0 }, { x: 0, y: style.ornament.size / 4 }, { x: -style.ornament.size / 4, y: 0 }], { fill: style.ornament.color, originX: 'center', originY: 'center' });
  const group = new fabric.Group([line, diamond], { left: width / 2, top, originX: 'center', originY: 'center' });
  (group as any).id = uuidv4();
  (group as any).semanticRole = 'tarot-ornament';
  (group as any).name = style.ornament.placement === 'footer' ? 'Footer Ornament' : 'Header Ornament';
  (group as any).tarotOrnamentSize = style.ornament.size;
  return group;
};

const updateOrnament = (canvas: fabric.Canvas, style: TarotPageStyle) => {
  const { width, height } = useCanvasStore.getState();
  let ornament = canvas.getObjects().find((object) => (object as any).semanticRole === 'tarot-ornament') as fabric.Group | undefined;
  const title = canvas.getObjects().find((object) => (object as any).semanticRole === 'tarot-page-title') as fabric.Textbox | undefined;
  const subtitle = canvas.getObjects().find((object) => (object as any).semanticRole === 'tarot-page-subtitle') as fabric.Textbox | undefined;
  const top = style.ornament.placement === 'footer'
    ? height - style.footer.height / 2
    : (subtitle?.top ?? title?.top ?? style.page.contentInset) + (subtitle?.height ?? title?.height ?? style.header.titleFontSize) + style.header.subtitleSpacing;
  if (!ornament && style.ornament.style === 'divider') {
    ornament = makeDivider(style, width, top);
    canvas.add(ornament);
  }
  if (!ornament) return;
  const previousSize = Number((ornament as any).tarotOrnamentSize) || style.ornament.size;
  const scale = style.ornament.size / previousSize;
  ornament.set({
    visible: style.ornament.style !== 'none',
    opacity: style.ornament.style === 'none' ? 0 : 1,
    left: width / 2,
    top,
    scaleX: scale,
    scaleY: scale,
  });
  (ornament as any).tarotOrnamentSize = style.ornament.size;
  (ornament as any).name = style.ornament.placement === 'footer' ? 'Footer Ornament' : 'Header Ornament';
  ornament.getObjects().forEach((child) => {
    child.set('fill', style.ornament.color);
    child.set('stroke', style.ornament.color);
  });
  ornament.setCoords();
};

const applyBorder = (canvas: fabric.Canvas, style: TarotPageStyle) => {
  const { width, height } = useCanvasStore.getState();
  canvas.getObjects()
    .filter((object) => (object as any).isPageBorder)
    .forEach((object) => canvas.remove(object));
  if (style.border.type === 'none') return;
  const makeRect = (inset: number) => new fabric.Rect({
    left: inset,
    top: inset,
    width: Math.max(1, width - inset * 2),
    height: Math.max(1, height - inset * 2),
    fill: 'transparent',
    stroke: style.border.color,
    strokeWidth: style.border.width,
    rx: style.border.cornerRadius,
    ry: style.border.cornerRadius,
    opacity: style.border.opacity,
    originX: 'left',
    originY: 'top',
    selectable: false,
    evented: false,
  });
  const children = [makeRect(style.border.inset)];
  if (style.border.type === 'double') children.push(makeRect(style.border.inset + style.border.doubleSpacing));
  const group = new fabric.Group(children, { left: 0, top: 0, originX: 'left', originY: 'top', selectable: false, evented: false, hasControls: false, lockMovementX: true, lockMovementY: true });
  (group as any).id = 'tarot-page-border';
  (group as any).isPageBorder = true;
  (group as any).semanticRole = 'tarot-page-border';
  (group as any).name = style.border.type === 'double' ? 'Tarot Double Border' : 'Tarot Page Border';
  (group as any).borderSettings = {
    lineEnabled: true,
    lineStyle: 'solid',
    lineColor: style.border.color,
    lineWeight: style.border.width,
    inset: style.border.inset,
    tarotBorderType: style.border.type,
    doubleSpacing: style.border.doubleSpacing,
    cornerRadius: style.border.cornerRadius,
    opacity: style.border.opacity,
  };
  canvas.add(group);
  const firstContent = canvas.getObjects().find((object) => !(object as any).isGuide && !(object as any).isPageBorder);
  if (firstContent) canvas.moveObjectTo(group, Math.max(0, canvas.getObjects().indexOf(firstContent)));
};

export const applyTarotPageStyle = (
  canvas: fabric.Canvas,
  value: Partial<TarotPageStyle>,
  options: { applyContent?: boolean } = {},
): TarotPageStyle => {
  const style = normalizeTarotPageStyle(value);
  const applyContent = options.applyContent ?? true;
  const existingTitle = canvas.getObjects().find((object) => (
    (object as any).semanticRole === 'tarot-page-title'
    || String((object as any).name ?? '').startsWith('Tarot spread title:')
  )) as any;
  const existingSubtitle = canvas.getObjects().find((object) => (object as any).semanticRole === 'tarot-page-subtitle') as any;
  const existingFooterText = (role: string, fallback: string) => {
    const field = canvas.getObjects().find((object) => (object as any).semanticRole === role) as any;
    return typeof field?.text === 'string' ? field.text : fallback;
  };
  const markerStyle = applyContent
    ? style
    : normalizeTarotPageStyle({
      ...style,
      header: {
        ...style.header,
        titleText: typeof existingTitle?.text === 'string' ? existingTitle.text : style.header.titleText,
        subtitleText: typeof existingSubtitle?.text === 'string' ? existingSubtitle.text : style.header.subtitleText,
      },
      footer: {
        ...style.footer,
        dateText: existingFooterText('tarot-footer-date', style.footer.dateText),
        deckText: existingFooterText('tarot-footer-deck', style.footer.deckText),
        questionText: existingFooterText('tarot-footer-question', style.footer.questionText),
        notesText: existingFooterText('tarot-footer-notes', style.footer.notesText),
      },
    } as any);
  ensureMarker(canvas, markerStyle);
  useThemeStore.getState().setCanvasBackgroundColor(style.page.backgroundColor);
  canvas.backgroundColor = 'transparent';
  applyBorder(canvas, style);
  updateTitle(canvas, style, applyContent);
  updateSubtitle(canvas, style, applyContent);
  updateCards(canvas, style);
  updateFooter(canvas, style, applyContent);
  updateOrnament(canvas, style);
  canvas.requestRenderAll();
  return style;
};

/** Rebuild only the page-aligned border after an authored page resize. */
export const refitTarotPageBorder = (canvas: fabric.Canvas) => {
  const marker = getTarotPageStyleMarker(canvas);
  const style = marker && (marker as any).tarotPageStyle
    ? normalizeTarotPageStyle((marker as any).tarotPageStyle)
    : null;
  if (!style) return;
  applyBorder(canvas, style);
  canvas.requestRenderAll();
};

export const tarotPageStyleFingerprint = (canvas: fabric.Canvas) => JSON.stringify({
  style: (getTarotPageStyleMarker(canvas) as any)?.tarotPageStyle ?? null,
  objects: canvas.getObjects()
    .filter((object) => (object as any).semanticRole?.startsWith('tarot-') || isTarotCard(object))
    .map((object) => object.toObject(['id', 'name', 'semanticRole', 'tarotPosition', 'tarotFooterField', 'isPageBorder', 'borderSettings'])),
  background: useThemeStore.getState().canvasBackgroundColor,
});
